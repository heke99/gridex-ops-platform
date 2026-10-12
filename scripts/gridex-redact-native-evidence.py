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

SENSITIVE = {'password', 'access_token', 'refresh_token', 'id_token', 'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'service_role_key', 'anon_key', 'jwt_secret'}
REDACTED = '[REDACTED_LOCAL_CREDENTIAL]'
JWT = re.compile(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b')
EMBEDDED_ZIP = re.compile(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)')
JWT_RUN = re.compile(rb'[A-Za-z0-9_-]+')
JWT_START = re.compile(rb'\beyJ[A-Za-z0-9_-]')


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


def scrub(data, secrets=()):
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
    data = EMBEDDED_ZIP.sub(lambda m: b'data:application/zip;base64,' + base64.b64encode(scrub(base64.b64decode(m[1]), secrets)), data)
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
                result = scrub(record, secrets)
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
