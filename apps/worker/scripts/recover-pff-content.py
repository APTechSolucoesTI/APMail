"""Read-only repair stream. Original and corrected readers are explicit inputs.

Emits one bounded MIME envelope per mail with the original source hash, so repair
does not depend on subjects or potentially malformed Message-ID headers.
Does not write the source PST.
"""
import base64
import hashlib
import importlib.util
import json
import sys


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def recover(folder, reader, original, depth=0, recipient_reader=None):
    if depth > 100:
        raise ValueError("folder_depth")
    for index in range(folder.number_of_sub_messages):
        item = folder.get_sub_message(index)
        kind = str(reader.record_properties(item, {0x001A}).get(0x001A, "IPM.Note")).lower()
        if not kind.startswith(("ipm.note", "report.ipm.note")):
            continue
        if len(sys.argv) > 4 and sys.argv[4] == '--mixed-only' and reader.mixed_utf8_html(reader.safe_get(item, 'html_body')) is None:
            continue
        raw = reader.convert(item,recipient_reader)
        legacy_key = hashlib.sha256(original.convert(item)).hexdigest()
        print(json.dumps({"mime": base64.b64encode(raw).decode("ascii"), "legacy_key": legacy_key}), flush=True)
    for index in range(folder.number_of_sub_folders):
        recover(folder.get_sub_folder(index), reader, original, depth + 1, recipient_reader)


if __name__ == "__main__":
    reader = load("corrected_pff_reader", sys.argv[2])
    original = load("original_pff_reader", sys.argv[3])
    archive = reader.pypff.file()
    recipients = reader.ArchiveRecipients(sys.argv[1])
    try:
        archive.open(sys.argv[1])
        root = archive.get_root_folder()
        if root is None:
            raise ValueError("missing_root")
        recover(root, reader, original, recipient_reader=recipients.rows)
    finally:
        archive.close()
        recipients.close()
