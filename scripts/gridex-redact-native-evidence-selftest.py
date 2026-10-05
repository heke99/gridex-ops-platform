#!/usr/bin/env python3
"""Keep authentic failure evidence useful without publishing auth material."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import sys
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('redact', Path(__file__).with_name('gridex-redact-native-evidence.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
password = b'disposable-password-001'
token = 'eyJ0ZXN0.eyJ0b2tlbg.signature'
data = json.dumps({
    'request': {'headers': [{'name': 'Cookie', 'value': 'sb-session-secret'}], 'postData': {'text': json.dumps({'password': password.decode()})}},
    'response': {'body': json.dumps({'refresh_token': 'opaque-refresh-token', 'access_token': token})},
    'visible': 'retained visible mutation',
}).encode()
out = module.scrub(data, [password])
assert all(value not in out for value in [password, token.encode(), b'opaque-refresh-token', b'sb-session-secret'])
assert b'retained visible mutation' in out
archive = io.BytesIO()
with zipfile.ZipFile(archive, 'w') as writer:
    writer.writestr('trace.network', data)
for payload in [archive.getvalue(), b'<script>"data:application/zip;base64,' + base64.b64encode(archive.getvalue()) + b'"</script>']:
    clean = module.scrub(payload, [password])
    compressed = clean if clean.startswith(b'PK') else base64.b64decode(module.EMBEDDED_ZIP.search(clean)[1])
    with zipfile.ZipFile(io.BytesIO(compressed)) as reader:
        network = reader.read('trace.network')
        assert all(value not in network for value in [password, token.encode(), b'opaque-refresh-token', b'sb-session-secret'])
        assert b'retained visible mutation' in network
print('NATIVE_EVIDENCE_SELFTEST: nested auth headers/body, ZIP trace and HTML-embedded report ZIP PASS; observable mutation retained')
