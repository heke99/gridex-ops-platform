#!/usr/bin/env python3
"""Keep authentic failure evidence useful without publishing auth material."""
import base64
import importlib.util
import io
import contextlib
import json
from pathlib import Path
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('redact', Path(__file__).with_name('gridex-redact-native-evidence.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
checks = []


def check(name, condition):
    # Explicit checks remain active under python -O.
    checks.append((name, condition is True))


def identity(name, payload):
    check(name, module.scrub(payload) == payload)


password = b'disposable-password-001'
token = 'eyJ0ZXN0.eyJ0b2tlbg.signature'
data = json.dumps({
    'request': {'headers': [{'name': 'Cookie', 'value': 'sb-session-secret'}], 'postData': {'text': json.dumps({'password': password.decode()})}},
    'response': {'body': json.dumps({'refresh_token': 'opaque-refresh-token', 'access_token': token})},
    'visible': 'retained visible mutation',
}).encode()
out = module.scrub(data, [password])
check('original_nested_auth_removed', all(value not in out for value in [password, token.encode(), b'opaque-refresh-token', b'sb-session-secret']))
check('original_visible_mutation_retained', b'retained visible mutation' in out)
archive = io.BytesIO()
with zipfile.ZipFile(archive, 'w') as writer:
    writer.writestr('trace.network', data)
for payload in [archive.getvalue(), b'<script>"data:application/zip;base64,' + base64.b64encode(archive.getvalue()) + b'"</script>']:
    clean = module.scrub(payload, [password])
    compressed = clean if clean.startswith(b'PK') else base64.b64decode(module.EMBEDDED_ZIP.search(clean)[1])
    with zipfile.ZipFile(io.BytesIO(compressed)) as reader:
        network = reader.read('trace.network')
        check('original_zip_auth_removed_' + ('zip' if payload.startswith(b'PK') else 'embedded'), all(value not in network for value in [password, token.encode(), b'opaque-refresh-token', b'sb-session-secret']))
        check('original_zip_visible_mutation_' + ('zip' if payload.startswith(b'PK') else 'embedded'), b'retained visible mutation' in network)


# These 42 scalar records model the physical SQL lines that the old NDJSON
# branch reformatted. They are public synthetic values, not artifact evidence.
scalar_lines = []
for index in range(42):
    values = [None, True, False, index, index + 0.5, 'safe scalar ' + str(index)]
    scalar = json.dumps(values[index % len(values)]).encode()
    ending = b'\r\n' if index % 3 == 0 else (b'' if index == 41 else b'\n')
    raw = b'    ' + scalar + b'  ' + ending
    scalar_lines.append(raw)
    identity('scalar_sql_line_' + str(index), raw)
identity('combined_scalar_schema', b'CREATE TABLE public.fixture (id integer);\r\n' + b''.join(scalar_lines) + b'\n-- end fixture\r\n')
for name, payload in [
    ('unique_json_formatted_crlf', b' {\r\n  "safe": 1, "items": [true, null, 3]\r\n}\r\n'),
    ('unique_json_no_final_newline', b'{ "safe": 1 }'),
    ('unique_json_trailing_whitespace', b'\t[1,2,3]  \n\t'),
    ('unique_ndjson_crlf', b'{ "safe":1 }\r\n   42  \r\n[ true ]'),
    ('plaintext_schema', b'-- safe SQL\r\nCREATE TABLE t (id uuid);\n'),
    ('nested_formatted_json_string', json.dumps({'body': ' {\r\n  "safe": [1, 2]\r\n} ', 'visible': 'kept'}, indent=2).encode()),
    ('nested_array_json_string', json.dumps({'body': ' [ 1, { "safe": true } ] '}).encode()),
    ('nested_ndjson_safe', json.dumps({'body': ' { "safe":1 } '}, indent=2).encode() + b'\r\n' + b'{ "safe":2 }'),
]:
    identity(name, payload)

for key in sorted(module.SENSITIVE):
    credential = ('OPAQUE_DISPOSABLE_' + key).encode()
    payload = json.dumps({key.upper(): credential.decode(), 'safe': 'retained'}).encode()
    result = module.scrub(payload)
    decoded = json.loads(result)
    check('sensitive_key_' + key, credential not in result and decoded[key.upper()] == module.REDACTED and decoded['safe'] == 'retained')
    payload = json.dumps({'headers': [{'name': key.upper(), 'value': credential.decode()}], 'safe': 'retained'}).encode()
    result = module.scrub(payload)
    check('header_pair_' + key, credential not in result and json.loads(result)['headers'][0]['value'] == module.REDACTED and b'retained' in result)

for name, payload, hidden in [
    ('duplicate_shadow', b'{"password":"EARLIER_DISPOSABLE_SECRET","password":"safe"}', b'EARLIER_DISPOSABLE_SECRET'),
    ('duplicate_unknown_shadow', b'{"entry":{"password":"EARLIER_DISPOSABLE_SECRET"},"entry":"safe"}', b'EARLIER_DISPOSABLE_SECRET'),
    ('duplicate_nested_object', b'{"safe":{"authorization":"EARLIER_DISPOSABLE_SECRET","authorization":"safe"}}', b'EARLIER_DISPOSABLE_SECRET'),
    ('duplicate_equal_safe', b'{ "safe": 1, "safe": 1 }', None),
    ('duplicate_in_nested_string', json.dumps({'body': '{"entry":{"password":"EARLIER_DISPOSABLE_SECRET"},"entry":"safe"}'}).encode(), b'EARLIER_DISPOSABLE_SECRET'),
    ('duplicate_inside_two_strings', json.dumps({'body': json.dumps({'inner': '{"entry":"EARLIER_DISPOSABLE_SECRET","entry":"safe"}'})}).encode(), b'EARLIER_DISPOSABLE_SECRET'),
    ('duplicate_ndjson', b'{ "safe":1 }\r\n{"entry":{"cookie":"EARLIER_DISPOSABLE_SECRET"},"entry":"safe"}\r\n', b'EARLIER_DISPOSABLE_SECRET'),
]:
    result = module.scrub(payload)
    check(name, result != payload and (hidden is None or hidden not in result))

payload = b'-- known local secret: ' + password + b'\r\n-- JWT: ' + token.encode() + b'\n-- safe visible mutation'
result = module.scrub(payload, [password])
check('local_secret_and_jwt_plaintext', password not in result and token.encode() not in result and b'safe visible mutation' in result)
malformed = b'{ malformed ' + token.encode() + b' ' + password + b' }'
check('malformed_text_still_scrubs', password not in module.scrub(malformed, [password]) and token.encode() not in module.scrub(malformed, [password]))
nested_archive = io.BytesIO()
with zipfile.ZipFile(nested_archive, 'w', compression=zipfile.ZIP_DEFLATED) as writer:
    writer.writestr('inner.zip', archive.getvalue())
    writer.writestr('safe.json', b'{ "safe": 1 }\r\n')
with zipfile.ZipFile(io.BytesIO(module.scrub(nested_archive.getvalue(), [password]))) as outer:
    check('recursive_zip_safe_member_identity', outer.read('safe.json') == b'{ "safe": 1 }\r\n')
    with zipfile.ZipFile(io.BytesIO(outer.read('inner.zip'))) as inner:
        network = inner.read('trace.network')
        check('recursive_zip_auth_removed', all(value not in network for value in [password, token.encode(), b'opaque-refresh-token', b'sb-session-secret']) and b'retained visible mutation' in network)

# Exercise the unchanged local-only credential gate on disposable private input.
with tempfile.TemporaryDirectory(prefix='native-redactor-selftest-') as directory:
    root = Path(directory)
    local = root / 'local.json'
    evidence = root / 'evidence.txt'
    evidence.write_bytes(password + b' safe-visible')
    local.write_text(json.dumps({'API_URL': 'https://foreign.invalid', 'password': password.decode()}))
    old_argv = sys.argv
    sys.argv = ['redactor', '--root', str(evidence), '--local-secrets', str(local)]
    refused = False
    try:
        try:
            module.main()
        except ValueError as error:
            refused = str(error) == 'redaction_disposable_local_credentials_required'
    finally:
        sys.argv = old_argv
    check('local_secret_foreign_api_refused_before_write', refused and evidence.read_bytes() == password + b' safe-visible')
    local.write_text(json.dumps({'API_URL': 'http://127.0.0.1:54321', 'password': password.decode()}))
    sys.argv = ['redactor', '--root', str(evidence), '--local-secrets', str(local)]
    stdout = io.StringIO()
    try:
        with contextlib.redirect_stdout(stdout):
            module.main()
    finally:
        sys.argv = old_argv
    check('local_secret_valid_cli_removed', password not in evidence.read_bytes() and b'safe-visible' in evidence.read_bytes() and password.decode() not in stdout.getvalue())

# The source is the current committed public schema, not a historical artifact.
# Its current exact bytes/SHA are recorded in the private author receipt; this
# maintained test deliberately does not pin one historical schema revision.
public_schema = Path(__file__).parents[1] / 'supabase' / 'schema.sql'
identity('current_complete_public_schema', public_schema.read_bytes())
for name, payload in [
    ('duplicate_header_name_shadow', b'{"name":"Authorization","name":"X-Safe","value":"OPAQUE_SHADOWED_HEADER"}'),
    ('duplicate_nested_header_name_shadow', json.dumps({'body': '{"name":"Cookie","name":"X-Safe","value":"OPAQUE_SHADOWED_HEADER"}'}).encode()),
]:
    check(name, b'OPAQUE_SHADOWED_HEADER' not in module.scrub(payload))

failed = [name for name, okay in checks if not okay]
for name in failed:
    print('NATIVE_EVIDENCE_SELFTEST_FAIL: ' + name)
print('NATIVE_EVIDENCE_SELFTEST: checks=' + str(len(checks)) + '; pass=' + str(len(checks) - len(failed)) + '; fail=' + str(len(failed)) + '; no credential values logged')
if failed:
    sys.exit(1)
print('NATIVE_EVIDENCE_SELFTEST: nested auth headers/body, ZIP trace and HTML-embedded report ZIP PASS; observable mutation retained')
