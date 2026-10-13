"""Regression tests for MIME reconstruction; no PST contents or pypff install needed."""
import email
import json
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "read_pff", Path(__file__).parents[2] / "scripts" / "read-pff.py"
)
reader = importlib.util.module_from_spec(spec)
with patch.dict("sys.modules", {"pypff": SimpleNamespace()}):
    spec.loader.exec_module(reader)


def records(properties):
    entries = [SimpleNamespace(entry_type=key, value_type=0x0003 if isinstance(value, int) else 0x001F,
                               data_as_string=value, data_as_integer=value)
               for key, value in properties.items()]
    return SimpleNamespace(number_of_entries=len(entries), get_entry=entries.__getitem__)


def attachment(data, content_type, filename="report.dat", cid=None):
    props = {0x370E: content_type, 0x3707: filename}
    if cid:
        props[0x3712] = cid
    record = records(props)
    # Bookworm pypff has no long_filename attribute: use MAPI 0x3707.
    return SimpleNamespace(size=len(data), read_buffer=lambda size: data[:size],
                           number_of_record_sets=1, get_record_set=lambda _: record)


def item(attachments):
    return SimpleNamespace(subject="Import regression", plain_text_body=b"Message body",
                           transport_headers="From: sender@example.com\r\nTo: recipient@example.com\r\n",
                           number_of_record_sets=0, number_of_sub_items=0,
                           number_of_attachments=len(attachments), get_attachment=attachments.__getitem__)


REPORT = (b"Reporting-MTA: dns; mail.example.com\r\n\r\n"
          b"Final-Recipient: rfc822; recipient@example.com\r\n"
          b"Action: failed\r\nStatus: 5.1.1\r\n\r\n"
          b"Final-Recipient: rfc822; other@example.com\r\n"
          b"Action: delivered\r\nStatus: 2.0.0\r\n")
FORWARDED = (b"From: original@example.com\r\nTo: recipient@example.com\r\n"
             b"Subject: Original message\r\nMessage-ID: <original@example.com>\r\n"
             b"Content-Type: text/plain; charset=utf-8\r\n\r\nOriginal body\r\n")


class MimeReconstructionTests(unittest.TestCase):
    def parse(self, attachments):
        return email.message_from_bytes(reader.convert(item(attachments)), policy=reader.default)

    def test_delivery_status_keeps_all_report_blocks_and_does_not_abort_next_message(self):
        first = self.parse([attachment(REPORT, "message/delivery-status", "delivery.txt")])
        report = list(first.iter_attachments())[0]
        self.assertEqual(report.get_content_type(), "message/delivery-status")
        self.assertIsNone(report.get_boundary())
        self.assertEqual(report.get_filename(), "delivery.txt")
        blocks = report.get_payload()
        self.assertEqual(len(blocks), 3)
        self.assertEqual(blocks[0]["Reporting-MTA"], "dns; mail.example.com")
        self.assertEqual(blocks[1]["Status"], "5.1.1")
        self.assertEqual(blocks[2]["Status"], "2.0.0")
        self.assertEqual(self.parse([]).get_content(), "Message body\r\n")

    def test_forwarded_message_is_nested_mime_instead_of_base64_text(self):
        result = self.parse([attachment(FORWARDED, "message/rfc822", "original.eml")])
        nested = list(result.iter_attachments())[0]
        self.assertEqual(nested.get_content_type(), "message/rfc822")
        self.assertIsNone(nested.get_boundary())
        self.assertEqual(nested.get_filename(), "original.eml")
        original = nested.get_payload()[0]
        self.assertEqual(original["Message-ID"], "<original@example.com>")
        self.assertEqual(original.get_content(), "Original body\r\n")

    def test_multiple_reports_and_binary_attachments_preserve_content(self):
        data = bytes(range(256))
        result = self.parse([attachment(REPORT, "message/delivery-status"),
                             attachment(data, "application/octet-stream", "document.bin"),
                             attachment(FORWARDED, "message/rfc822")])
        parts = list(result.iter_attachments())
        self.assertEqual(len(parts), 3)
        self.assertEqual(parts[1].get_payload(decode=True), data)
        self.assertEqual(result.get_body(preferencelist=("plain",)).get_content(), "Message body\r\n")

    def test_html_alternative_and_inline_content_id_are_preserved(self):
        message = item([attachment(FORWARDED, "message/rfc822", "forwarded.eml", "part@example.com")])
        message.html_body = b"<p>Message body</p>"
        result = email.message_from_bytes(reader.convert(message), policy=reader.default)
        self.assertEqual(result.get_content_type(), "multipart/mixed")
        self.assertEqual(result.get_body(preferencelist=("html",)).get_content(), "<p>Message body</p>\r\n")
        nested = list(result.iter_attachments())[0]
        self.assertEqual(nested["Content-ID"], "<part@example.com>")
        self.assertEqual(nested.get_content_disposition(), "inline")

    def test_repeated_conversion_has_identical_bytes_for_deduplication_and_resume(self):
        source = item([attachment(REPORT, "message/delivery-status"),
                       attachment(FORWARDED, "message/rfc822")])
        self.assertEqual(reader.convert(source), reader.convert(source))

    def test_outlook_attach_none_placeholder_is_not_read_or_exported_as_empty_file(self):
        record = records({0x3705: 0})
        placeholder = SimpleNamespace(number_of_record_sets=1, get_record_set=lambda _: record)
        with patch.object(placeholder, "read_buffer", create=True,
                          side_effect=AssertionError("ATTACH_NONE has no binary stream")):
            result = self.parse([placeholder, attachment(b"valid", "application/pdf", "document.pdf")])
        parts = list(result.iter_attachments())
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].get_filename(), "document.pdf")
        self.assertEqual(parts[0].get_payload(decode=True), b"valid")

    def test_folder_walk_emits_report_and_following_mail_in_order(self):
        messages = [item([attachment(REPORT, "message/delivery-status")]), item([])]
        folder = SimpleNamespace(name="Inbox", number_of_sub_messages=2,
                                 get_sub_message=messages.__getitem__, number_of_sub_folders=0)
        output = []
        with patch.object(reader, "print", side_effect=lambda value, **_: output.append(json.loads(value)), create=True):
            reader.walk(folder, [])
        self.assertEqual(len(output), 2)
        self.assertTrue(all(envelope["folder"] == "Inbox" for envelope in output))

    def test_unrelated_outlook_properties_are_not_decoded(self):
        class UnusedEntry:
            entry_type = 0x0070  # Outlook conversation topic, not used in MIME.
            value_type = 0x001F

            @property
            def data_as_string(self):
                raise AssertionError("Unneeded metadata must not be decoded")

        entry = UnusedEntry()
        record = SimpleNamespace(number_of_entries=1, get_entry=lambda _: entry)
        source = item([])
        source.number_of_record_sets = 1
        source.get_record_set = lambda _: record
        result = email.message_from_bytes(reader.convert(source), policy=reader.default)
        self.assertEqual(result["Subject"], "Import regression")
        self.assertEqual(result.get_content(), "Message body\r\n")

    def test_malformed_utf16_subject_keeps_readable_text_and_message_body(self):
        class MalformedEntry:
            entry_type = 0x0037
            value_type = 0x001F
            data = "Backup ".encode("utf-16-le") + b"\x00\xd8\x00\x00"

            @property
            def data_as_string(self):
                raise OSError("unsupported UTF-16 character")

        record = SimpleNamespace(number_of_entries=1, get_entry=lambda _: MalformedEntry())
        source = item([])
        source.subject = None
        source.number_of_record_sets = 1
        source.get_record_set = lambda _: record
        result = email.message_from_bytes(reader.convert(source), policy=reader.default)
        self.assertEqual(result["Subject"], "Backup \ufffd")
        self.assertEqual(result.get_content(), "Message body\r\n")

    def test_each_mapi_recipient_row_keeps_its_type_and_address(self):
        rows = [records({0x3001: "First", 0x3003: "first@example.com", 0x0C15: 1}),
                records({0x3001: "Second", 0x39FE: "second@example.com", 0x0C15: 1}),
                records({0x3001: "Copy", 0x3003: "copy@example.com", 0x0C15: 2})]
        source = item([])
        source.transport_headers = "From: sender@example.com\r\n"
        source.number_of_sub_items = 1
        source.get_sub_item = lambda _: SimpleNamespace(number_of_record_sets=3, get_record_set=rows.__getitem__)
        result = email.message_from_bytes(reader.convert(source), policy=reader.default)
        self.assertEqual([a.addr_spec for a in result["To"].addresses], ["first@example.com", "second@example.com"])
        self.assertEqual([a.addr_spec for a in result["Cc"].addresses], ["copy@example.com"])

    def test_message_and_attachment_limits_are_still_enforced(self):
        with patch.object(reader, "MAX_BYTES", 10):
            with self.assertRaisesRegex(ValueError, "message_too_large"):
                reader.convert(item([]))
        with patch.object(reader, "MAX_BYTES", 20):
            with self.assertRaisesRegex(ValueError, "attachment_too_large"):
                reader.convert(item([attachment(b"x" * 21, "application/octet-stream")]))


if __name__ == "__main__":
    unittest.main()
