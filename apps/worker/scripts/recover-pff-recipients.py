"""Emit recipient-only repairs matched by existing MIME hashes, never by subject.

The subject list only avoids converting irrelevant items. Each emitted record
must match an exact stored source/reconstructed SHA256 before a database update.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

def load_reader():
    spec = importlib.util.spec_from_file_location('pff_reader', Path(__file__).with_name('read-pff.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def recover(folder, reader, recipients, candidates, depth=0):
    if depth > 100:
        raise ValueError('folder_depth')
    for index in range(folder.number_of_sub_messages):
        item = folder.get_sub_message(index)
        props = reader.record_properties(item)
        if not str(props.get(0x001A, 'IPM.Note')).lower().startswith(('ipm.note', 'report.ipm.note')):
            continue
        headers = reader.email.message_from_string(reader.text(reader.safe_get(item,'transport_headers')),policy=reader.default)
        subject = ' '.join(reader.text(headers.get('Subject') or reader.safe_get(item,'subject') or props.get(0x0037)).replace('\x00','\ufffd').splitlines())
        masks = candidates.get(subject)
        if masks is None:
            continue
        groups = reader.message_recipients(item,recipients.rows)
        if not any(groups[kind] and masks.get(str(kind)) for kind in (1,2,3)):
            continue
        # No body/attachment is rewritten. Hashes identify the exact prior MIME,
        # including mail with no Message-ID, before any recipient is repaired.
        legacy = hashlib.sha256(reader.convert(item)).hexdigest()
        corrected = hashlib.sha256(reader.convert(item,recipients.rows)).hexdigest()
        print(json.dumps({'previous_key':legacy,'corrected_key':corrected,'recipients':groups}),flush=True)
    for index in range(folder.number_of_sub_folders):
        recover(folder.get_sub_folder(index),reader,recipients,candidates,depth+1)

if __name__ == '__main__':
    reader = load_reader()
    candidates = json.load(sys.stdin)
    archive = reader.pypff.file()
    recipients = reader.ArchiveRecipients(sys.argv[1])
    try:
        archive.open(sys.argv[1])
        recover(archive.get_root_folder(),reader,recipients,candidates)
    finally:
        archive.close()
        recipients.close()
