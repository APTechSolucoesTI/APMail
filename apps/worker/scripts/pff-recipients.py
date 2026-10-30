"""Read recipient tables through libpff's public C API on Debian's older pypff.

No private Python object memory, writes, bodies, attachments or remote resources.
The file is opened once and each native item/record/entry is explicitly freed.
"""
import ctypes as c
from ctypes.util import find_library
import os

FIELDS = (0x0C15, 0x3001, 0x3003, 0x39FE)


class RecipientTable:
    def __init__(self, filename):
        name = find_library('pff')
        if not name:
            raise RuntimeError('libpff recipient reader unavailable')
        self.lib = c.CDLL(name)
        pointer = c.c_void_p
        out = c.POINTER(pointer)
        signatures = {
            'file_initialize': [out], 'file_free': [out],
            'file_open': [pointer, c.c_char_p, c.c_int], 'file_close': [pointer],
            'file_get_item_by_identifier': [pointer, c.c_uint32, out],
            'message_get_recipients': [pointer, out], 'item_free': [out],
            'item_get_number_of_record_sets': [pointer, c.POINTER(c.c_int)],
            'item_get_record_set_by_index': [pointer, c.c_int, out], 'record_set_free': [out],
            'record_set_get_entry_by_type': [pointer, c.c_uint32, c.c_uint32, out, c.c_uint8],
            'record_entry_free': [out],
            'record_entry_get_data_as_32bit_integer': [pointer, c.POINTER(c.c_uint32)],
            'record_entry_get_data_as_utf8_string_size': [pointer, c.POINTER(c.c_size_t)],
            'record_entry_get_data_as_utf8_string': [pointer, pointer, c.c_size_t],
        }
        for method, args in signatures.items():
            function = getattr(self.lib, 'libpff_' + method)
            function.argtypes = args + [out]
            function.restype = c.c_int
        self.lib.libpff_error_free.argtypes = [out]
        self.lib.libpff_error_free.restype = None
        self.file = pointer()
        self.opened = False
        try:
            self.call('file_initialize', c.byref(self.file))
            self.call('file_open', self.file, os.fsencode(filename), 1)
            self.opened = True
        except Exception:
            self.close()
            raise

    def call(self, name, *args):
        error = c.c_void_p()
        result = getattr(self.lib, 'libpff_' + name)(*args, c.byref(error))
        if error:
            self.lib.libpff_error_free(c.byref(error))
        if result < 0:
            # Never expose native diagnostics containing private archive content.
            raise OSError('Cannot read Outlook recipient metadata: ' + name)
        return result

    def rows(self, item):
        message, table = c.c_void_p(), c.c_void_p()
        try:
            if not self.call('file_get_item_by_identifier', self.file, item.identifier, c.byref(message)):
                raise OSError('Outlook recipient message not found')
            if not self.call('message_get_recipients', message, c.byref(table)):
                return []
            count = c.c_int()
            self.call('item_get_number_of_record_sets', table, c.byref(count))
            if not 0 <= count.value <= 100000:
                raise ValueError('Outlook recipient limit exceeded')
            rows = []
            for index in range(count.value):
                record = c.c_void_p()
                try:
                    self.call('item_get_record_set_by_index', table, index, c.byref(record))
                    row = {}
                    for field in FIELDS:
                        entry = c.c_void_p()
                        try:
                            # MATCH_ANY_VALUE_TYPE accepts ANSI and Unicode strings.
                            if not self.call('record_set_get_entry_by_type', record, field, 0, c.byref(entry), 1):
                                continue
                            if field == 0x0C15:
                                number = c.c_uint32()
                                self.call('record_entry_get_data_as_32bit_integer', entry, c.byref(number))
                                row[field] = number.value
                            else:
                                size = c.c_size_t()
                                self.call('record_entry_get_data_as_utf8_string_size', entry, c.byref(size))
                                if size.value == 0:
                                    continue
                                if size.value > 65536:
                                    raise ValueError('Outlook recipient field limit exceeded')
                                value = c.create_string_buffer(size.value)
                                self.call('record_entry_get_data_as_utf8_string', entry, value, size.value)
                                row[field] = value.value.decode('utf-8', errors='replace')
                        finally:
                            if entry:
                                self.call('record_entry_free', c.byref(entry))
                    rows.append(row)
                finally:
                    if record:
                        self.call('record_set_free', c.byref(record))
            return rows
        finally:
            if table:
                self.call('item_free', c.byref(table))
            if message:
                self.call('item_free', c.byref(message))

    def close(self):
        if self.file:
            try:
                if self.opened:
                    self.call('file_close', self.file)
            finally:
                self.call('file_free', c.byref(self.file))
                self.opened = False
