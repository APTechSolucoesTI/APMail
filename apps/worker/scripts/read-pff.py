"""Read-only PST/OST -> bounded JSON lines of reconstructed RFC 5322 messages.

Requires Debian python3-pypff. Only mail items are imported; contacts/calendars are ignored.
No archive data is logged and no files or external URLs are opened from message content.
"""
import base64
import email
from email.message import EmailMessage
from email.headerregistry import HeaderRegistry, UnstructuredHeader
from email.policy import SMTP, default
from email.utils import format_datetime, formataddr, getaddresses
import json
import hashlib
import re
import sys
import importlib.util
from pathlib import Path
import pypff

MAX_BYTES = 50 * 1024 * 1024
MESSAGE_PROPERTIES = {0x001A, 0x0037, 0x0C1A, 0x0C1F, 0x1035, 0x5D01, 0x5D02, 0x3FDE, 0x3FFD}
RECIPIENT_PROPERTIES = {0x0C15, 0x3001, 0x3003, 0x39FE}
ATTACHMENT_PROPERTIES = {0x3704, 0x3705, 0x3707, 0x370E, 0x3712}

def text(value):
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else str(value or "")

def mixed_utf8_html(value):
    """Outlook forwards can embed ANSI quote bytes in an otherwise UTF-8 body.

    Keep valid UTF-8 sequences intact; decode only undecodable byte runs with the
    Windows Western code page. No replacement characters or byte dropping.
    """
    if not isinstance(value, bytes):
        return None
    declared = re.search(br'<meta\b[^>]*\bcharset\s*=\s*["\']?([a-zA-Z0-9._-]+)', value[:16384], re.I)
    if not declared or declared.group(1).lower().replace(b'-', b'') != b'utf8':
        return None
    projected = value.decode('utf-8-sig', errors='surrogateescape')
    if not re.search(r'[\udc80-\udcff]', projected) or not any(127 < ord(c) < 0xDC80 or ord(c) > 0xDCFF for c in projected):
        return None
    def legacy(match):
        raw = match.group().encode('utf-8', errors='surrogateescape')
        try:
            return raw.decode('cp1252')
        except UnicodeError:
            return raw.decode('latin-1')
    return re.sub(r'[\udc80-\udcff]+', legacy, projected)

def body_text(value, properties, is_html=False):
    """HTML is binary MAPI data, unlike pypff's UTF-8 plain-text projection.

    Honor the original BOM/meta/MAPI code page instead of destroying Windows-1252
    accents with UTF-8 replacement characters. MIME is reconstructed as UTF-8.
    """
    if not isinstance(value, bytes):
        result = str(value or "")
    elif is_html and (mixed := mixed_utf8_html(value)) is not None:
        result = mixed
    else:
        encodings = []
        for bom, encoding in ((b"\xff\xfe\x00\x00", "utf-32"), (b"\x00\x00\xfe\xff", "utf-32"),
                              (b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
            if value.startswith(bom):
                encodings.append(encoding)
                break
        if not is_html:
            encodings.append("utf-8")
        if is_html:
            declared = re.search(br'<meta\b[^>]*\bcharset\s*=\s*["\']?([a-zA-Z0-9._-]+)', value[:16384], re.I)
            if declared:
                encodings.append(declared.group(1).decode("ascii"))
        for key in (0x3FDE, 0x3FFD):
            codepage = properties.get(key)
            if isinstance(codepage, int) and codepage > 0:
                encodings.append({1200: "utf-16-le", 1201: "utf-16-be", 65001: "utf-8",
                                  20127: "ascii", 28591: "iso-8859-1", 28605: "iso-8859-15"}.get(codepage, "cp%d" % codepage))
        encodings.extend(("utf-8", "cp1252", "latin-1"))
        for encoding in dict.fromkeys(encodings):
            try:
                result = value.decode(encoding)
                break
            except (UnicodeError, LookupError):
                continue
    if is_html:
        # The outgoing HTML bytes are UTF-8, so an old Outlook meta must agree.
        result = re.sub(r'(<meta\b[^>]*\bcharset\s*=\s*["\']?)[a-zA-Z0-9._-]+', r'\1utf-8', result, flags=re.I)
    return result

def safe_get(item, field, default=None):
    try:
        return getattr(item, field)
    except (AttributeError, IOError, ValueError):
        return default

def record_values(record, fields):
    """Read only needed metadata, not bodies or unrelated Outlook properties."""
    values = {}
    for entry_index in range(record.number_of_entries):
        entry = record.get_entry(entry_index)
        key = entry.entry_type
        if key not in fields:
            continue
        value_type = entry.value_type
        if value_type in (0x001E, 0x001F):
            value = safe_get(entry, "data_as_string")
            if value is None:
                # Outlook metadata can contain unpaired UTF-16 surrogates.
                # Preserve readable text with replacement characters instead
                # of letting one malformed subject abort every email.
                raw = safe_get(entry, "data")
                if isinstance(raw, bytes):
                    value = raw.decode("utf-16-le" if value_type == 0x001F else "cp1252", errors="replace").rstrip("\x00")
            if value is not None:
                values[key] = value
        elif value_type in (0x0002, 0x0003):
            value = safe_get(entry, "data_as_integer")
            if value is not None:
                values[key] = value
    return values

def record_properties(item, fields=MESSAGE_PROPERTIES):
    """MAPI properties cover messages without internet transport headers."""
    values = {}
    for index in range(safe_get(item, "number_of_record_sets", 0)):
        values.update(record_values(item.get_record_set(index), fields))
    return values

def recipient_rows(item, fallback=None):
    table = safe_get(item, 'recipients')
    if table is not None:
        return [record_values(table.get_record_set(index), RECIPIENT_PROPERTIES)
                for index in range(table.number_of_record_sets)]
    if fallback is not None:
        return fallback(item)
    rows = []
    for index in range(safe_get(item, 'number_of_sub_items', 0)):
        child = item.get_sub_item(index)
        for record_index in range(safe_get(child, 'number_of_record_sets', 0)):
            row = record_values(child.get_record_set(record_index), RECIPIENT_PROPERTIES)
            if 0x0C15 in row:
                rows.append(row)
    return rows


class ArchiveRecipients:
    """Lazy native fallback for distro pypff versions without .recipients."""
    def __init__(self, filename):
        self.filename, self.native = filename, None

    def rows(self, item):
        if self.native is None:
            path = Path(__file__).with_name('pff-recipients.py')
            spec = importlib.util.spec_from_file_location('pff_recipients', path)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            self.native = module.RecipientTable(self.filename)
        return self.native.rows(item)

    def close(self):
        if self.native is not None:
            self.native.close()


def message_recipients(item, fallback=None):
    recipients = {1: [], 2: [], 3: []}
    seen = {1: set(), 2: set(), 3: set()}
    for row in recipient_rows(item, fallback):
        address = text(row.get(0x39FE) or row.get(0x3003)).strip()
        kind = row.get(0x0C15)
        if '\r' in address or '\n' in address or '\x00' in address:
            raise ValueError('Invalid Outlook recipient address')
        if '@' in address and kind in recipients and address.casefold() not in seen[kind]:
            seen[kind].add(address.casefold())
            recipients[kind].append(formataddr((' '.join(text(row.get(0x3001)).splitlines()), address)))
    return recipients


def convert(item, recipient_reader=None):
    properties = record_properties(item)
    headers = email.message_from_string(text(safe_get(item, "transport_headers")), policy=default)
    message = EmailMessage(policy=SMTP)
    for key in ("From", "To", "Cc", "Bcc", "Reply-To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"):
        try:
            if headers.get(key):
                message[key] = " ".join(str(headers.get(key)).splitlines())
        except IndexError:
            if key != "Message-ID":
                raise
            # Python 3.11's structured parser crashes on IDs like <[opaque=@host]>.
            # Preserve the unfolded ID as text, without discarding the email.
            value = next(value for name, value in headers.raw_items() if name.lower() == "message-id")
            registry = HeaderRegistry()
            registry.map_to_type(key, UnstructuredHeader)
            message[key] = registry(key, " ".join(value.splitlines()))
    if not message.get("Subject"):
        message["Subject"] = " ".join(text(safe_get(item, "subject") or properties.get(0x0037)).splitlines())
    if not message.get("From"):
        sender = properties.get(0x5D01) or properties.get(0x5D02) or properties.get(0x0C1F) or ""
        if "@" in sender:
            message["From"] = formataddr((text(safe_get(item, "sender_name") or properties.get(0x0C1A)), sender))
    if not message.get("Message-ID") and properties.get(0x1035):
        message["Message-ID"] = properties[0x1035]
    recipients = message_recipients(item, recipient_reader)
    for kind, header in ((1, "To"), (2, "Cc"), (3, "Bcc")):
        if recipients[kind] and not any('@' in address for _, address in getaddresses(message.get_all(header, []))):
            if header in message:
                del message[header]
            message[header] = ", ".join(recipients[kind])
    date = safe_get(item, "client_submit_time") or safe_get(item, "delivery_time")
    if date and not message.get("Date"):
        message["Date"] = format_datetime(date)
    plain = body_text(safe_get(item, "plain_text_body"), properties)
    html = body_text(safe_get(item, "html_body"), properties, is_html=True)
    if len(plain.encode()) + len(html.encode()) > MAX_BYTES:
        raise ValueError("message_too_large")
    message.set_content(plain)
    if html:
        message.add_alternative(html, subtype="html")
    total = len(plain.encode()) + len(html.encode())
    for index in range(item.number_of_attachments):
        attachment = item.get_attachment(index)
        props = record_properties(attachment, ATTACHMENT_PROPERTIES)
        # PidTagAttachMethod = ATTACH_NONE is an Outlook placeholder, with no
        # binary stream. Trying to read it makes libpff abort valid archives.
        if props.get(0x3705) == 0:
            continue
        size = safe_get(attachment, "size", 0)
        if total + size > MAX_BYTES:
            raise ValueError("attachment_too_large")
        data = attachment.read_buffer(size)
        total += len(data)
        filename = text(safe_get(attachment, "long_filename") or props.get(0x3707) or props.get(0x3704)) or "anexo-%d" % (index + 1)
        content_type = props.get(0x370E) or "application/octet-stream"
        maintype, _, subtype = content_type.partition("/")
        cid = props.get(0x3712)
        options = {"filename": filename, **({"cid": "<%s>" % cid.strip("<>"), "disposition": "inline"} if cid else {})}
        if maintype.lower() == "message":
            # Python's MIME generator requires structured payloads for message/*.
            # Raw bytes make delivery-status reports crash during as_bytes(),
            # aborting the whole PST analysis before any messages are imported.
            part = EmailMessage(policy=SMTP)
            part["Content-Type"] = content_type
            header = part["Content-Type"].fold(policy=SMTP).encode("ascii")
            part = email.message_from_bytes(header + b"\r\n" + data, policy=SMTP)
            part.add_header("Content-Disposition", options.get("disposition", "attachment"), filename=filename)
            if cid:
                part["Content-ID"] = options["cid"]
            if message.get_content_type() != "multipart/mixed":
                message.make_mixed()
            message.attach(part)
        else:
            message.add_attachment(data, maintype=maintype or "application", subtype=subtype or "octet-stream", **options)
    message["X-APMail-Backup-Source"] = "pst-ost-reconstructed"
    # Stable boundaries keep the same PST/OST message hash across retries/reimports.
    digest = hashlib.sha256()
    parts = list(message.walk())
    for part in parts:
        digest.update(repr(list(part.items())).encode("utf-8"))
        if not part.is_multipart():
            digest.update(part.get_payload(decode=True) or b"")
    for index, part in enumerate(parts):
        if part.get_content_maintype() == "multipart":
            part.set_boundary("apmail-%s-%d" % (digest.hexdigest()[:48], index))
    raw = message.as_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError("message_too_large")
    return raw

def walk(folder, path, depth=0, recipient_reader=None):
    if depth > 100:
        raise ValueError("folder_depth")
    name = text(safe_get(folder, "name")) or "Importados"
    current = "/".join(path + [name])
    for index in range(folder.number_of_sub_messages):
        item = folder.get_sub_message(index)
        kind = str(record_properties(item, {0x001A}).get(0x001A, "IPM.Note")).lower()
        if not kind.startswith(("ipm.note", "report.ipm.note")):
            continue
        raw = convert(item, recipient_reader) if recipient_reader else convert(item)
        print(json.dumps({"folder": current, "mime": base64.b64encode(raw).decode("ascii")}), flush=True)
    for index in range(folder.number_of_sub_folders):
        walk(folder.get_sub_folder(index), path + [name], depth + 1, recipient_reader)

if __name__ == "__main__":
    archive = pypff.file()
    recipients = ArchiveRecipients(sys.argv[1])
    try:
        archive.open(sys.argv[1])
        root = archive.get_root_folder()
        if root is None:
            raise ValueError("missing_root")
        walk(root, [], recipient_reader=recipients.rows)
    finally:
        archive.close()
        recipients.close()
