#!/usr/bin/env python3
"""Redact disposable credentials from evidence, including Playwright trace ZIPs."""
import argparse
import base64
import io
import json
from pathlib import Path
import re
import zipfile

SENSITIVE = {'password', 'access_token', 'refresh_token', 'id_token', 'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'service_role_key', 'anon_key', 'jwt_secret'}
REDACTED = '[REDACTED_LOCAL_CREDENTIAL]'
JWT = re.compile(rb'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b')
EMBEDDED_ZIP = re.compile(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)')


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
    data = JWT.sub(REDACTED.encode(), data)
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', action='append', required=True)
    parser.add_argument('--local-secrets')
    args = parser.parse_args()
    secrets = []
    if args.local_secrets and Path(args.local_secrets).is_file():
        local = json.loads(Path(args.local_secrets).read_text())
        if local.get('API_URL') != 'http://127.0.0.1:54321':
            raise ValueError('redaction_disposable_local_credentials_required')
        secrets = [str(x).encode() for key, x in local.items() if key.lower() in SENSITIVE and isinstance(x, str) and len(x) >= 8]
    count = 0
    for path in map(Path, args.root):
        for file in sorted(path.rglob('*')) if path.is_dir() else [path]:
            if file.is_file():
                data = file.read_bytes()
                result = scrub(data, secrets)
                if result != data:
                    file.write_bytes(result)
                    count += 1
    print(f'NATIVE_EVIDENCE: credential redaction completed; changed files={count}; no credential values logged')


if __name__ == '__main__':
    main()
