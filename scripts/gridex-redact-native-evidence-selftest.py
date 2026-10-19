#!/usr/bin/env python3
"""Keep authentic failure evidence useful without publishing auth material."""
import base64
import importlib.util
import io
import contextlib
import json
from pathlib import Path
import sys
import subprocess
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

# Public fake token spellings: preserve the original bytes-regex boundaries,
# earliest non-overlapping span and trailing '-' outside the matched token.
for name, payload, expected in [
    ('jwt_after_hyphen', b'prefix-eyJx.a.b', b'prefix-' + module.REDACTED.encode()),
    ('jwt_word_prefix_refused', b'AeyJx.a.b', b'AeyJx.a.b'),
    ('jwt_underscore_prefix_refused', b'_eyJx.a.b', b'_eyJx.a.b'),
    ('jwt_trailing_hyphens_retained', b'eyJx.a.b---', module.REDACTED.encode() + b'---'),
    ('jwt_overlapping_three_run_windows', b'safe.eyJx.a.b', b'safe.' + module.REDACTED.encode()),
    ('jwt_third_run_all_hyphens_refused', b'eyJx.a.---', b'eyJx.a.---'),
    ('jwt_fourth_segment_retained', b'eyJx.a.b.c', module.REDACTED.encode() + b'.c'),
    ('jwt_adjacent_global_spans', b'eyJx.a.b/eyJy.c.d', module.REDACTED.encode() + b'/' + module.REDACTED.encode()),
    ('jwt_non_utf8_boundaries', b'\xffeyJx.a.b\xfe', b'\xff' + module.REDACTED.encode() + b'\xfe'),
    ('jwt_incomplete_prefix_storm_identity', b'eyJ-' * 4096, b'eyJ-' * 4096),
]:
    check(name, module.scrub(payload) == expected)


# Declared plaintext log/XML records are processed without loading the whole
# file. These public fixtures are not a native run or authentic business proof.
with tempfile.TemporaryDirectory(prefix='native-redactor-records-selftest-') as directory:
    root = Path(directory)
    payload = (b'visible-before\r\n' + password + b' ' + token.encode()
               + b'\n{"Cookie":"opaque-record-cookie","safe":1}\r\n'
               + b'<failure>public failure remains</failure>')
    evidence = root / 'native.log'
    evidence.write_bytes(payload)
    try:
        module.redact_line_records(evidence, [password], max_line_bytes=1024)
        result = evidence.read_bytes()
        check('records_auth_removed', all(secret not in result for secret in
              [password, token.encode(), b'opaque-record-cookie']))
        check('records_plaintext_xml_and_endings_preserved',
              result.startswith(b'visible-before\r\n')
              and result.endswith(b'<failure>public failure remains</failure>')
              and b'public failure remains' in result)
        unchanged = b'public unchanged\r\n<testcase/>\nno final newline'
        evidence.write_bytes(unchanged)
        module.redact_line_records(evidence, [], max_line_bytes=1024)
        check('records_secret_free_byte_identity', evidence.read_bytes() == unchanged)
        oversized = b'x' * 1025
        evidence.write_bytes(oversized)
        refused = False
        try:
            module.redact_line_records(evidence, [], max_line_bytes=1024)
        except ValueError as error:
            refused = str(error) == 'redaction_record_exceeds_memory_bound'
        check('records_oversized_fail_closed_before_replacement',
              refused and evidence.read_bytes() == oversized)
        evidence.write_bytes(payload)
        refused = False
        try:
            module.redact_line_records(evidence, [b'private\nspanning'], max_line_bytes=1024)
        except ValueError as error:
            refused = str(error) == 'redaction_record_secret_spans_records'
        check('records_spanning_secret_fail_closed', refused and evidence.read_bytes() == payload)
        check('records_failed_temporary_outputs_removed',
              sorted(path.name for path in root.iterdir()) == ['native.log'])
    except AttributeError:
        check('records_actual_bounded_redaction_required', False)

for kind in ['secret','publishable']:
    key=('sb_'+kind+'_DECLARED_fake_opaque_api_key-0123456789').encode()
    result=module.scrub(b'public visible '+key+b' remains')
    check('opaque_supabase_'+kind+'_removed', key not in result and b'public visible' in result)

# Supabase CLI 2.101.0 start prints these S3 status fields before the later
# status file exists. All values below are declared synthetic fixtures.
s3_access = b'DECLARED_S3_access|opaque-with-space value'
s3_secret = b'DECLARED_S3_secret/+opaque=value'
for key, marker in [
    ('S3_PROTOCOL_ACCESS_KEY_ID', s3_access),
    ('S3_PROTOCOL_ACCESS_KEY_SECRET', s3_secret),
]:
    for name, payload in [
        ('json', json.dumps({'nested': {key: marker.decode()}, 'safe': 'visible-s3-diagnostic'}).encode()),
        ('header', json.dumps({'headers': [{'name': key, 'value': marker.decode()}], 'safe': 'visible-s3-diagnostic'}).encode()),
    ]:
        result = module.scrub(payload)
        check('s3_alias_' + key + '_' + name,
              marker not in result and b'visible-s3-diagnostic' in result)

s3_tables = [
    ('plain', '\n'.join([
        'visible-s3-diagnostic-before',
        '╭────────────┬─────────────────────────────────────────────╮',
        '│ Access Key │ ' + s3_access.decode() + ' │',
        '│ Secret Key │ ' + s3_secret.decode() + ' │',
        '│ Region     │ local                                       │',
        '╰────────────┴─────────────────────────────────────────────╯',
        'visible-s3-diagnostic-after',
    ]).encode()),
    ('ansi_cells', (
        'visible-s3-diagnostic-before\r\n'
        '│ \x1b[32mAccess Key\x1b[0m │ \x1b[33m' + s3_access.decode() + '\x1b[0m │\r\n'
        '│ \x1b[32mSecret Key\x1b[0m │ \x1b[33m' + s3_secret.decode() + '\x1b[0m │\r\n'
        'visible-s3-diagnostic-after').encode()),
    ('ansi_rows', (
        'visible-s3-diagnostic-before\n'
        '\x1b[32m│ Access Key │ ' + s3_access.decode() + ' │\x1b[0m\n'
        '\x1b[32m│ Secret Key │ ' + s3_secret.decode() + ' │\x1b[0m\n'
        'visible-s3-diagnostic-after').encode()),
]

for name, payload in s3_tables:
    result = module.scrub(payload)
    check('s3_table_' + name + '_opaque_values_removed',
          all(marker not in result for marker in [s3_access, s3_secret]))
    check('s3_table_' + name + '_adjacent_diagnostics_preserved',
          result.startswith(b'visible-s3-diagnostic-before')
          and result.endswith(b'visible-s3-diagnostic-after'))
    check('s3_table_' + name + '_field_labels_retained',
          b'Access Key' in result and b'Secret Key' in result)
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w') as writer:
        writer.writestr('replay.log', payload)
    with zipfile.ZipFile(io.BytesIO(module.scrub(archive.getvalue()))) as reader:
        result = reader.read('replay.log')
        check('s3_zip_' + name + '_values_removed_diagnostics_preserved',
              all(marker not in result for marker in [s3_access, s3_secret])
              and b'visible-s3-diagnostic-after' in result)

# Exercise the actual executable, including bounded log records, when status
# was never produced, its path is missing, or exact-value S3 status is present.
with tempfile.TemporaryDirectory(prefix='native-redactor-s3-selftest-') as directory:
    root = Path(directory)
    evidence = root / 'replay.log'
    local = root / 'local.json'
    for mode in ['no_status', 'missing_status', 'local_status']:
        payload = s3_tables[1][1]
        if mode == 'local_status':
            local.write_text(json.dumps({
                'API_URL': 'http://127.0.0.1:54321',
                'S3_PROTOCOL_ACCESS_KEY_ID': s3_access.decode(),
                'S3_PROTOCOL_ACCESS_KEY_SECRET': s3_secret.decode(),
            }))
            payload += b'\nuntyped copies: ' + s3_access + b' ' + s3_secret
        evidence.write_bytes(payload)
        command = [sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                   '--root', str(evidence), '--line-records', str(evidence)]
        if mode != 'no_status':
            command += ['--local-secrets', str(local)]
        completed = subprocess.run(command, capture_output=True, check=False)
        result = evidence.read_bytes()
        check('s3_actual_cli_' + mode + '_removed',
              completed.returncode == 0
              and all(marker not in result for marker in [s3_access, s3_secret]))
        check('s3_actual_cli_' + mode + '_safe_evidence_retained',
              b'visible-s3-diagnostic-before' in result
              and b'visible-s3-diagnostic-after' in result)
        check('s3_actual_cli_' + mode + '_does_not_log_values',
              all(marker not in completed.stdout + completed.stderr
                  for marker in [s3_access, s3_secret]))

# Reviewer probes on #838: credential forms that must be removed by name,
# with no status file, around invalid UTF-8 and across line records.
probe_value = b'syntheticS3VALUE0123456789abcdef'
probe_secret = b'syntheticSECRETvalue9876543210xyz'
before, after = b'visible-probe-diagnostic-before\n', b'\nvisible-probe-diagnostic-after'
for name, body in [
    ('env_plain', b'S3_PROTOCOL_ACCESS_KEY_ID=' + probe_value),
    ('env_quoted', b'S3_PROTOCOL_ACCESS_KEY_SECRET="' + probe_value + b'"'),
    ('env_export', b"export S3_PROTOCOL_ACCESS_KEY_ID='" + probe_value + b"'"),
    ('legacy_colon', b'S3 Access Key: ' + probe_value),
    ('json_in_log', b'2026-10-19T12:00:00Z status {"s3_protocol_access_key_secret":"' + probe_value + b'","region":"local"}'),
    ('jwt_secret_env', b'JWT_SECRET="' + probe_value + b'"'),
    ('db_url_password', b'DB_URL=postgresql://postgres:' + probe_value + b'@127.0.0.1:54322/postgres'),
    ('table_lowercase', '│ access key │ '.encode() + probe_value + ' │'.encode()),
    ('table_ascii', b'| Access Key | ' + probe_value + b' |'),
    ('table_prefixed', '2026-10-19T12:00:00Z │ Secret Key │ '.encode() + probe_value + ' │'.encode()),
    ('table_s3_label', '│ S3 Access Key │ '.encode() + probe_value + ' │'.encode()),
    ('table_no_final_border', '│ Access Key │ '.encode() + probe_value),
    ('table_wrapped', '│ Secret Key │ '.encode() + probe_value + ' │\n│            │ '.encode() + probe_secret + ' │\n│ Region     │ local │'.encode()),
    ('label_next_line', b'Secret Key\n  ' + probe_value),
    ('invalid_utf8_before_table', b'\xff\xfe binary prefix\n' + '│ Access Key │ '.encode() + probe_value + ' │'.encode()),
]:
    result = module.scrub(before + body + after)
    check('probe_' + name + '_removed', all(marker not in result for marker in [probe_value, probe_secret]))
    check('probe_' + name + '_diagnostics_preserved', result.startswith(before) and result.endswith(after))
check('probe_table_wrapped_safe_row_retained',
      '│ Region     │ local │'.encode() in module.scrub('│ Secret Key │ v1 │\n│            │ v2 │\n│ Region     │ local │'.encode()))
check('probe_quoted_json_stays_json',
      json.loads(module.scrub(b'{"s3_protocol_access_key_id":"' + probe_value + b'","safe":"visible"}'))['safe'] == 'visible')

# The actual executable in line-record mode keeps wrapped-row and next-line
# label state across records.
with tempfile.TemporaryDirectory(prefix='native-redactor-probe-selftest-') as directory:
    evidence = Path(directory) / 'replay.log'
    evidence.write_bytes(before + '│ Secret Key │ '.encode() + probe_value + ' │\n│            │ '.encode() + probe_secret
                         + ' │\nAccess Key\n'.encode() + probe_value + after)
    completed = subprocess.run([sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                                '--root', str(evidence), '--line-records', str(evidence)], capture_output=True, check=False)
    result = evidence.read_bytes()
    check('probe_actual_cli_line_records_removed', completed.returncode == 0
          and all(marker not in result for marker in [probe_value, probe_secret]))
    check('probe_actual_cli_line_records_diagnostics_preserved', result.startswith(before) and result.endswith(after))
    check('probe_actual_cli_does_not_log_values',
          all(marker not in completed.stdout + completed.stderr for marker in [probe_value, probe_secret]))

for name, payload in [
    ('foreign_key_error', b'ERROR: insert violates foreign key constraint "x_fkey"\n'),
    ('duplicate_key_error', b'ERROR: duplicate key value violates unique constraint "x_key"\n'),
    ('password_prose', b'Password reset required before login\n'),
    ('ascii_safe_table', b'| Region | local |\n| URL | http://127.0.0.1:54321/storage/v1/s3 |\n'),
    ('url_without_password', b'API URL: http://127.0.0.1:54321\n'),
]:
    identity(name, payload)

for name, payload in [
    ('safe_storage_table', '│ Region │ local │\r\n│ URL │ http://127.0.0.1:54321/storage/v1/s3 │'.encode()),
    ('prose_mentions_access_key', b'Access Key lookup failed; diagnostic remains\r\n'),
    ('noncredential_table_label', '│ Access Key count │ 2 │'.encode()),
]:
    identity(name, payload)

# Byte-level log matching must not corrupt structured JSON or its escaped
# strings, and redaction must be stable when evidence is processed twice.
for name, payload in [
    ('number', {'password': 123, 'safe': 'visible-json-diagnostic'}),
    ('boolean', {'api_key': False, 'safe': 'visible-json-diagnostic'}),
    ('array', {'password': [1, 2], 'safe': 'visible-json-diagnostic'}),
    ('object', {'password': {'a': 1}, 'safe': 'visible-json-diagnostic'}),
    ('null', {'password': None, 'safe': 'visible-json-diagnostic'}),
    ('formatted', {'password': 123, 'safe': 'visible-json-diagnostic'}),
]:
    raw = json.dumps(payload, indent=2 if name == 'formatted' else None).encode()
    result = module.scrub(raw)
    try:
        decoded = json.loads(result)
    except json.JSONDecodeError:
        decoded = {}
    key = 'api_key' if name == 'boolean' else 'password'
    check('probe_json_typed_' + name + '_valid_and_redacted',
          decoded.get(key) == module.REDACTED and decoded.get('safe') == 'visible-json-diagnostic')

for name, value in [
    ('simple', 'password=DECLARED_JSON_LOG_SECRET'),
    ('escaped_quote', 'password=DECLARED_JSON_LOG_SECRET\\"tail'),
    ('nested_json', json.dumps({'password': 123, 'safe': 'visible-json-diagnostic'})),
]:
    result = module.scrub(json.dumps({'body': value, 'safe': 'visible-json-diagnostic'}).encode())
    try:
        decoded = json.loads(result)
    except json.JSONDecodeError:
        decoded = {}
    check('probe_json_string_' + name + '_valid_and_redacted',
          decoded.get('safe') == 'visible-json-diagnostic'
          and 'DECLARED_JSON_LOG_SECRET' not in decoded.get('body', 'DECLARED_JSON_LOG_SECRET')
          and module.REDACTED in decoded.get('body', ''))

ndjson = (b'{"body":"password=DECLARED_JSON_LOG_SECRET","safe":1}\r\n'
          b'{"password":123,"safe":2}\n')
result = module.scrub(ndjson)
try:
    decoded_records = [json.loads(line) for line in result.splitlines()]
except json.JSONDecodeError:
    decoded_records = []
check('probe_ndjson_valid_and_redacted', len(decoded_records) == 2
      and decoded_records[0].get('safe') == 1 and decoded_records[1].get('safe') == 2
      and b'DECLARED_JSON_LOG_SECRET' not in result)
for name, payload in [
    ('env', b'S3_PROTOCOL_ACCESS_KEY_ID=DECLARED_IDEMPOTENT_SECRET'),
    ('colon', b'S3 Access Key: DECLARED_IDEMPOTENT_SECRET'),
    ('url', b'DB_URL=postgresql://postgres:DECLARED_IDEMPOTENT_SECRET@127.0.0.1/db'),
]:
    once = module.scrub(payload)
    check('probe_redaction_idempotent_' + name,
          b'DECLARED_IDEMPOTENT_SECRET' not in once and module.scrub(once) == once)

failed = [name for name, okay in checks if not okay]
for name in failed:
    print('NATIVE_EVIDENCE_SELFTEST_FAIL: ' + name)
print('NATIVE_EVIDENCE_SELFTEST: checks=' + str(len(checks)) + '; pass=' + str(len(checks) - len(failed)) + '; fail=' + str(len(failed)) + '; no credential values logged')
if failed:
    sys.exit(1)
print('NATIVE_EVIDENCE_SELFTEST: nested auth headers/body, ZIP trace and HTML-embedded report ZIP PASS; observable mutation retained')
