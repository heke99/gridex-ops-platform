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
    for secret in secrets:
        data = data.replace(secret, REDACTED.encode())
    data = JWT.sub(REDACTED.encode(), data)
    data = EMBEDDED_ZIP.sub(lambda m: b'data:application/zip;base64,' + base64.b64encode(scrub(base64.b64decode(m[1]), secrets)), data)
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        return data

    def value(item):
        if isinstance(item, list):
            return [value(x) for x in item]
        if isinstance(item, dict):
            if str(item.get('name', '')).lower() in SENSITIVE and 'value' in item:
                item = {**item, 'value': REDACTED}
            return {key: REDACTED if key.lower() in SENSITIVE else value(x) for key, x in item.items()}
        if isinstance(item, str) and item.lstrip().startswith(('{', '[')):
            try:
                return json.dumps(value(json.loads(item)), separators=(',', ':'))
            except json.JSONDecodeError:
                pass
        return item

    # Each NDJSON trace record and complete JSON resource is independently
    # parsed; a password/token inside a nested response body is covered too.
    try:
        return (json.dumps(value(json.loads(text)), separators=(',', ':')) + '\n').encode()
    except json.JSONDecodeError:
        lines = []
        for line in text.splitlines(keepends=True):
            try:
                lines.append(json.dumps(value(json.loads(line)), separators=(',', ':')) + '\n')
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
