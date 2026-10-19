#!/usr/bin/env python3
"""Redact disposable credentials from evidence, including Playwright trace ZIPs."""
import argparse
import base64
import io
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile

SENSITIVE = {'password', 'access_token', 'refresh_token', 'id_token', 'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'service_role_key', 'anon_key', 'jwt_secret', 's3_protocol_access_key_id', 's3_protocol_access_key_secret'}
REDACTED = '[REDACTED_LOCAL_CREDENTIAL]'
JWT = re.compile(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b')
OPAQUE_API_KEY = re.compile(rb'sb_(?:secret|publishable)_[A-Za-z0-9_-]+')
EMBEDDED_ZIP = re.compile(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)')
JWT_RUN = re.compile(rb'[A-Za-z0-9_-]+')
JWT_START = re.compile(rb'\beyJ[A-Za-z0-9_-]')
ANSI_CSI_BYTES = re.compile(rb'\x1b\[[0-?]*[ -/]*[@-~]')
# Credential names as they appear in env files, `key: value` logs, embedded
# JSON and CLI output. Matching is by name, so it works without a status file.
CREDENTIAL_NAME = (rb'(?:s3[_ ]protocol[_ ]access[_ ]key[_ ](?:id|secret)|(?:s3[_ ])?(?:access|secret)[_ ]key'
                   rb'|jwt[_ ]secret|service[_ ]role[_ ]key|anon[_ ]key|api[_ ]?key|password)')
KEY_VALUE = re.compile(rb'(?i)((?:^|(?<=[^A-Za-z0-9_]))(?:export\s+)?["\']?' + CREDENTIAL_NAME
                       + rb'["\']?[ \t]*[:=][ \t]*)(' + re.escape(REDACTED.encode())
                       + rb'|"(?:[^"\\\r\n]|\\.)*"|\'[^\'\r\n]*\'|[^\s,;}\]\r\n]+)')
URL_PASSWORD = re.compile(rb'(?i)(\b[a-z][a-z0-9+.-]*://[^\s/:@]+:)([^\s@/]+)(@)')
TABLE_LABELS = {b'access key', b'secret key', b's3 access key', b's3 secret key'}


def scrub_jwts(data):
    # Without the original matcher's required prefix there is no JWT span.
    if JWT_START.search(data) is None:
        return data
    # A candidate can start after '-' inside an ASCII token run. Scanning the
    # same remaining run at every such start makes incomplete tokens quadratic.
    # Visit each three-run window once, then use the original JWT matcher for
    # its exact span (including its trailing word-boundary/backtracking rule).
    runs = iter(JWT_RUN.finditer(data))
    first = next(runs, None)
    second = next(runs, None)
    output = []
    cursor = 0
    for third in runs:
        if (data[first.end():second.start()] == b'.'
                and data[second.end():third.start()] == b'.'
                and third.group().rstrip(b'-')):
            start = JWT_START.search(data, max(cursor, first.start()), first.end())
            match = JWT.match(data, start.start()) if start is not None else None
            if match is not None:
                output.extend((data[cursor:match.start()], REDACTED.encode()))
                cursor = match.end()
        first, second = second, third
    if not output:
        return data
    output.append(data[cursor:])
    return b''.join(output)


def _plain(cell):
    return b' '.join(ANSI_CSI_BYTES.sub(b'', cell).split()).lower()


def _redacted_cell(cell):
    # Keep the cell's own line ending so record boundaries never move.
    ending = cell[len(cell.rstrip(b'\r\n')):]
    return b' ' + REDACTED.encode() + b' ' + ending


def _json_record(data):
    try:
        json.loads(data)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return False
    return True


def scrub_credential_lines(data, state=None):
    """Remove named credentials from plain text, byte for byte.

    Runs before any UTF-8 decode, so one invalid byte cannot disable it. CLI
    start can print S3 credentials before a local status file exists; tables
    may use box or ASCII borders, a log prefix, ANSI styling, a missing final
    border, wrapped values or a label with its value on the next line. Other
    rows and adjacent diagnostics stay intact.
    """
    state = {} if state is None else state
    # Structured JSON is sanitized after decoding, preserving quoted strings,
    # escaped content and non-string values. Never regex-rewrite JSON syntax.
    if not state and _json_record(data):
        return data
    output = []
    for line in data.splitlines(keepends=True):
        if state.pop('next_value', False):
            if line.strip():
                output.append(_redacted_cell(line).lstrip())
                continue
            state['next_value'] = True
        if _json_record(line):
            state.pop('table_value', None)
            output.append(line)
            continue
        plain = ANSI_CSI_BYTES.sub(b'', line)
        separator = '│'.encode() if '│'.encode() in plain else (b'|' if b'|' in plain else None)
        if separator is None:
            state.pop('table_value', None)
            if _plain(line).rstrip(b':') in TABLE_LABELS:
                state['next_value'] = True
            line = KEY_VALUE.sub(lambda m: m[1] + (b'"' + REDACTED.encode() + b'"' if m[2][:1] in b'"\'' else REDACTED.encode()), line)
            output.append(URL_PASSWORD.sub(lambda m: m[1] + REDACTED.encode() + m[3], line))
            continue
        cells = line.split(separator)
        label = 0 if _plain(cells[0]) in TABLE_LABELS else 1
        if label < len(cells) and _plain(cells[label]) in TABLE_LABELS and len(cells) > label + 1:
            state['table_value'] = True
            cells[label + 1:] = [_redacted_cell(cell) if _plain(cell) else cell for cell in cells[label + 1:]]
        elif state.get('table_value') and label < len(cells) and not _plain(cells[label]) and any(_plain(cell) for cell in cells[label + 1:]):
            # A wrapped value continues on a row whose label cell is empty.
            cells[label + 1:] = [_redacted_cell(cell) if _plain(cell) else cell for cell in cells[label + 1:]]
        else:
            state.pop('table_value', None)
        line = separator.join(cells)
        line = KEY_VALUE.sub(lambda m: m[1] + (b'"' + REDACTED.encode() + b'"' if m[2][:1] in b'"\'' else REDACTED.encode()), line)
        output.append(URL_PASSWORD.sub(lambda m: m[1] + REDACTED.encode() + m[3], line))
    return b''.join(output)


def scrub(data, secrets=(), state=None):
    if data.startswith(b'PK\x03\x04'):
        result = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(result, 'w') as target:
            for item in source.infolist():
                target.writestr(item, scrub(source.read(item), secrets))
        return result.getvalue()
    original = data
    for secret in secrets:
        data = data.replace(secret, REDACTED.encode())
    data = scrub_jwts(data)
    data = OPAQUE_API_KEY.sub(REDACTED.encode(), data)
    data = EMBEDDED_ZIP.sub(lambda m: b'data:application/zip;base64,' + base64.b64encode(scrub(base64.b64decode(m[1]), secrets)), data)
    data = scrub_credential_lines(data, state)
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return data

    def load(text):
        duplicate = False

        def pairs(items):
            nonlocal duplicate
            result = {}
            for key, item in items:
                if key in result:
                    duplicate = True
                result[key] = item
            # A later duplicate name must not hide an earlier auth header.
            if (len(result) != len(items) and 'value' in result
                    and any(key == 'name' and str(item).lower() in SENSITIVE for key, item in items)):
                result['value'] = REDACTED
            return result

        return json.loads(text, object_pairs_hook=pairs), duplicate

    def value(item):
        if isinstance(item, list):
            return [value(x) for x in item]
        if isinstance(item, dict):
            if str(item.get('name', '')).lower() in SENSITIVE and 'value' in item:
                item = {**item, 'value': REDACTED}
            return {key: REDACTED if key.lower() in SENSITIVE else value(x) for key, x in item.items()}
        if isinstance(item, str) and item.lstrip().startswith(('{', '[')):
            try:
                parsed, duplicate = load(item)
                cleaned = value(parsed)
                # Preserve formatted nested JSON only when no key was hidden
                # and scrubbing made no change to the decoded value.
                return json.dumps(cleaned, separators=(',', ':')) if duplicate or cleaned != parsed else item
            except json.JSONDecodeError:
                pass
        if isinstance(item, str):
            return scrub_credential_lines(item.encode('utf-8', errors='surrogatepass')).decode('utf-8', errors='surrogatepass')
        return item

    def record(text):
        parsed, duplicate = load(text)
        cleaned = value(parsed)
        # Decoded equality alone cannot authorize a no-op for duplicate keys:
        # an earlier credential may have been shadowed by the last value.
        if duplicate or cleaned != parsed or data != original:
            return json.dumps(cleaned, separators=(',', ':')) + '\n'
        return text

    # JSON scalars in SQL and secret-free JSON/NDJSON keep their original
    # whitespace, line endings and final-newline state.
    try:
        return record(text).encode()
    except json.JSONDecodeError:
        lines = []
        for line in text.splitlines(keepends=True):
            try:
                lines.append(record(line))
            except json.JSONDecodeError:
                lines.append(line)
        return ''.join(lines).encode()


def redact_line_records(path, secrets=(), max_line_bytes=8 * 1024 * 1024):
    """Atomically scrub explicit plaintext log/XML records with bounded memory.

    Whole JSON documents and ZIPs continue to use scrub(). JWTs cannot cross a
    newline; known local credentials that can cross one refuse this format.
    Oversized records fail closed without replacing the original evidence.
    """
    if max_line_bytes < 1:
        raise ValueError('redaction_record_invalid_memory_bound')
    if any(b'\n' in secret or b'\r' in secret for secret in secrets):
        raise ValueError('redaction_record_secret_spans_records')
    path = Path(path)
    temporary = None
    changed = False
    # Table and next-line label state spans records, never files.
    state = {}
    try:
        with path.open('rb') as source, tempfile.NamedTemporaryFile(
                mode='wb', dir=path.parent, prefix=path.name + '.redacting-',
                delete=False) as target:
            temporary = Path(target.name)
            os.fchmod(target.fileno(), path.stat().st_mode & 0o777)
            while True:
                record = source.readline(max_line_bytes + 1)
                if not record:
                    break
                if len(record) > max_line_bytes:
                    raise ValueError('redaction_record_exceeds_memory_bound')
                result = scrub(record, secrets, state)
                changed = changed or result != record
                target.write(result)
        if changed:
            temporary.replace(path)
        return changed
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', action='append', required=True)
    parser.add_argument('--local-secrets')
    parser.add_argument('--line-records', action='append', default=[],
                        help='Explicit plaintext log/XML file; atomic bounded record processing, not whole JSON/ZIP')
    args = parser.parse_args()
    secrets = []
    if args.local_secrets and Path(args.local_secrets).is_file():
        local = json.loads(Path(args.local_secrets).read_text())
        if local.get('API_URL') != 'http://127.0.0.1:54321':
            raise ValueError('redaction_disposable_local_credentials_required')
        secrets = [str(x).encode() for key, x in local.items() if key.lower() in SENSITIVE and isinstance(x, str) and len(x) >= 8]
    line_records = {Path(name).resolve() for name in args.line_records}
    files = []
    for path in map(Path, args.root):
        for file in sorted(path.rglob('*')) if path.is_dir() else [path]:
            if file.is_file():
                files.append(file)
    if line_records - {file.resolve() for file in files}:
        raise ValueError('redaction_record_file_outside_evidence')
    count = 0
    for file in files:
        if file.resolve() in line_records:
            count += int(redact_line_records(file, secrets))
        else:
            data = file.read_bytes()
            result = scrub(data, secrets)
            if result != data:
                file.write_bytes(result)
                count += 1
    print(f'NATIVE_EVIDENCE: credential redaction completed; changed files={count}; no credential values logged')


if __name__ == '__main__':
    main()
