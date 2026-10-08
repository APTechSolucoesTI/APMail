"""Read-only PST/OST -> bounded JSON lines of reconstructed RFC 5322 messages.

Requires Debian python3-pypff. Only mail items are imported; contacts/calendars are ignored.
No archive data is logged and no files or external URLs are opened from message content.
"""
import base64
import email
from email.message import EmailMessage
from email.policy import SMTP, default
from email.utils import format_datetime, formataddr
import json
import hashlib
import sys
import pypff

MAX_BYTES = 50 * 1024 * 1024

def text(value):
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value or "")

def safe_get(item, field, default=None):
    try:
        return getattr(item, field)
    except (AttributeError, IOError, ValueError):
        return default

def record_properties(item):
    """MAPI properties cover messages without internet transport headers."""
    values = {}
    for index in range(safe_get(item, "number_of_record_sets", 0)):
        record = item.get_record_set(index)
        for entry_index in range(record.number_of_entries):
            entry = record.get_entry(entry_index)
            value_type = entry.value_type
            if value_type in (0x001E, 0x001F):
                values[entry.entry_type] = entry.data_as_string
            elif value_type in (0x0002, 0x0003):
                values[entry.entry_type] = entry.data_as_integer
    return values

def convert(item):
    properties = record_properties(item)
    headers = email.message_from_string(text(safe_get(item, "transport_headers")), policy=default)
    message = EmailMessage(policy=SMTP)
    for key in ("From", "To", "Cc", "Bcc", "Reply-To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"):
        if headers.get(key):
            message[key] = " ".join(str(headers.get(key)).splitlines())
    if not message.get("Subject"):
        message["Subject"] = " ".join(text(safe_get(item, "subject")).splitlines())
    if not message.get("From"):
        sender = properties.get(0x5D01) or properties.get(0x5D02) or properties.get(0x0C1F) or ""
        if "@" in sender:
            message["From"] = formataddr((text(safe_get(item, "sender_name")), sender))
    if not message.get("Message-ID") and properties.get(0x1035):
        message["Message-ID"] = properties[0x1035]
    recipients = {1: [], 2: [], 3: []}
    for index in range(safe_get(item, "number_of_sub_items", 0)):
        child = item.get_sub_item(index)
        for record_index in range(safe_get(child, "number_of_record_sets", 0)):
            record = child.get_record_set(record_index)
            row = {}
            for entry_index in range(record.number_of_entries):
                entry = record.get_entry(entry_index)
                if entry.value_type in (0x001E, 0x001F):
                    row[entry.entry_type] = entry.data_as_string
                elif entry.value_type in (0x0002, 0x0003):
                    row[entry.entry_type] = entry.data_as_integer
            address = row.get(0x39FE) or row.get(0x3003) or ""
            kind = row.get(0x0C15, 1)
            if "@" in address and kind in recipients:
                recipients[kind].append(formataddr((row.get(0x3001, ""), address)))
    for kind, header in ((1, "To"), (2, "Cc"), (3, "Bcc")):
        if not message.get(header) and recipients[kind]:
            message[header] = ", ".join(recipients[kind])
    date = safe_get(item, "client_submit_time") or safe_get(item, "delivery_time")
    if date and not message.get("Date"):
        message["Date"] = format_datetime(date)
    plain = text(safe_get(item, "plain_text_body"))
    html = text(safe_get(item, "html_body"))
    if len(plain.encode()) + len(html.encode()) > MAX_BYTES:
        raise ValueError("message_too_large")
    message.set_content(plain)
    if html:
        message.add_alternative(html, subtype="html")
    total = len(plain.encode()) + len(html.encode())
    for index in range(item.number_of_attachments):
        attachment = item.get_attachment(index)
        size = safe_get(attachment, "size", 0)
        if total + size > MAX_BYTES:
            raise ValueError("attachment_too_large")
        data = attachment.read_buffer(size)
        total += len(data)
        filename = text(safe_get(attachment, "long_filename")) or "anexo-%d" % (index + 1)
        props = record_properties(attachment)
        content_type = props.get(0x370E, "application/octet-stream")
        maintype, _, subtype = content_type.partition("/")
        cid = props.get(0x3712)
        message.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", filename=filename, **({"cid": "<%s>" % cid.strip("<>"), "disposition": "inline"} if cid else {}))
    message["X-APMail-Backup-Source"] = "pst-ost-reconstructed"
    # Stable boundaries keep the same PST/OST message hash across retries/reimports.
    digest = hashlib.sha256()
    parts = list(message.walk())
    for part in parts:
        digest.update(repr(list(part.items())).encode("utf-8"))
        if not part.is_multipart():
            digest.update(part.get_payload(decode=True) or b"")
    for index, part in enumerate(parts):
        if part.is_multipart():
            part.set_boundary("apmail-%s-%d" % (digest.hexdigest()[:48], index))
    raw = message.as_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError("message_too_large")
    return raw

def walk(folder, path, depth=0):
    if depth > 100:
        raise ValueError("folder_depth")
    name = text(safe_get(folder, "name")) or "Importados"
    current = "/".join(path + [name])
    for index in range(folder.number_of_sub_messages):
        item = folder.get_sub_message(index)
        kind = str(record_properties(item).get(0x001A, "IPM.Note")).lower()
        if not kind.startswith(("ipm.note", "report.ipm.note")):
            continue
        raw = convert(item)
        print(json.dumps({"folder": current, "mime": base64.b64encode(raw).decode("ascii")}), flush=True)
    for index in range(folder.number_of_sub_folders):
        walk(folder.get_sub_folder(index), path + [name], depth + 1)

if __name__ == "__main__":
    archive = pypff.file()
    try:
        archive.open(sys.argv[1])
        root = archive.get_root_folder()
        if root is None:
            raise ValueError("missing_root")
        walk(root, [])
    finally:
        archive.close()
