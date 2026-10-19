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

# A binary byte elsewhere in a log cannot disable sanitization of complete
# UTF-8 JSON records. These fixtures contain declared synthetic values only.
binary_json_marker = 'DECLARED_BINARY_JSON_CREDENTIAL'
for name, record in [
    ('alias', {'S3_PROTOCOL_ACCESS_KEY_SECRET': binary_json_marker, 'safe': 'visible-binary-json'}),
    ('nested_alias', {'nested': {'S3_PROTOCOL_ACCESS_KEY_ID': binary_json_marker}, 'safe': 'visible-binary-json'}),
    ('header', {'headers': [{'name': 'S3_PROTOCOL_ACCESS_KEY_SECRET', 'value': binary_json_marker}], 'safe': 'visible-binary-json'}),
    ('nested_header', {'nested': {'headers': [{'name': 'S3_PROTOCOL_ACCESS_KEY_ID', 'value': binary_json_marker}]}, 'safe': 'visible-binary-json'}),
]:
    encoded = json.dumps(record).encode()
    for position in ['prefix', 'suffix']:
        prefix, suffix = (b'\xff\xfe\n', b'') if position == 'prefix' else (b'', b'\n\xfe\xff')
        result = module.scrub(prefix + encoded + suffix)
        check('probe_binary_json_' + name + '_' + position + '_credential_removed',
              binary_json_marker.encode() not in result and b'visible-binary-json' in result)
        check('probe_binary_json_' + name + '_' + position + '_binary_preserved',
              (not prefix or result.startswith(prefix)) and (not suffix or result.endswith(suffix)))
identity('binary_safe_json_records_byte_identity', b'\xff\n{ "safe" : 1 }\r\n\xfe')
identity('binary_safe_scalar_records_byte_identity', b'\xff\n 42 \r\n"safe"\n\xfe')
identity('binary_utf16_json_no_recursive_utf8_fallback', b'\xff\xfe' + '{\"safe\":\"binary-preserved\"}'.encode('utf-16-le'))

with tempfile.TemporaryDirectory(prefix='native-redactor-binary-json-selftest-') as directory:
    evidence = Path(directory) / 'replay.log'
    for mode in ['whole_file', 'line_records']:
        payload = (b'\xff\n' + json.dumps({'S3_PROTOCOL_ACCESS_KEY_SECRET': binary_json_marker,
                   'safe': 'visible-binary-json'}).encode() + b'\n'
                   + json.dumps({'headers': [{'name': 'S3_PROTOCOL_ACCESS_KEY_ID', 'value': binary_json_marker}],
                                 'safe': 'visible-binary-json'}).encode() + b'\n\xfe')
        evidence.write_bytes(payload)
        command = [sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                   '--root', str(evidence)]
        if mode == 'line_records':
            command += ['--line-records', str(evidence)]
        completed = subprocess.run(command, capture_output=True, check=False)
        result = evidence.read_bytes()
        check('probe_binary_json_actual_cli_' + mode + '_removed',
              completed.returncode == 0 and binary_json_marker.encode() not in result)
        check('probe_binary_json_actual_cli_' + mode + '_safe_bytes_preserved',
              result.startswith(b'\xff\n') and result.endswith(b'\n\xfe')
              and result.count(b'visible-binary-json') == 2)
        check('probe_binary_json_actual_cli_' + mode + '_does_not_log_values',
              binary_json_marker.encode() not in completed.stdout + completed.stderr)

# JSON-encoded scalar strings can carry the same named credential inside
# bodies or arrays. Decode each finite layer before sanitizing its value.
quoted_scalar_marker = 'DECLARED_QUOTED_SCALAR_CREDENTIAL'
quoted_credential = 'S3_PROTOCOL_ACCESS_KEY_ID=' + quoted_scalar_marker
for name, body in [
    ('body', json.dumps(quoted_credential)),
    ('array', [json.dumps(quoted_credential)]),
    ('twice', json.dumps(json.dumps(quoted_credential))),
    ('encoded_array', json.dumps([json.dumps(quoted_credential)])),
]:
    result = module.scrub(json.dumps({'body': body, 'safe': 'visible-quoted-scalar'}).encode())
    check('probe_nested_quoted_scalar_' + name + '_removed', quoted_scalar_marker.encode() not in result)
    check('probe_nested_quoted_scalar_' + name + '_valid_json_and_safe',
          json.loads(result).get('safe') == 'visible-quoted-scalar')
identity('nested_safe_json_scalars_keep_whitespace',
         b'{ "body": " 42 ", "flag": " true ", "null": " null ", "quoted": " \\"safe\\" " }')

with tempfile.TemporaryDirectory(prefix='native-redactor-quoted-scalar-selftest-') as directory:
    evidence = Path(directory) / 'replay.log'
    for mode in ['whole_file', 'line_records', 'binary_json_records']:
        record = json.dumps({'body': [json.dumps(quoted_credential)], 'safe': 'visible-quoted-scalar'}).encode()
        evidence.write_bytes(b'\xff\n' + record + b'\n\xfe' if mode == 'binary_json_records' else record)
        command = [sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                   '--root', str(evidence)]
        if mode == 'line_records':
            command += ['--line-records', str(evidence)]
        completed = subprocess.run(command, capture_output=True, check=False)
        result = evidence.read_bytes()
        check('probe_nested_quoted_scalar_actual_cli_' + mode + '_removed',
              completed.returncode == 0 and quoted_scalar_marker.encode() not in result)
        check('probe_nested_quoted_scalar_actual_cli_' + mode + '_safe_bytes_preserved',
              b'visible-quoted-scalar' in result
              and (mode != 'binary_json_records' or result.startswith(b'\xff\n') and result.endswith(b'\n\xfe')))
        check('probe_nested_quoted_scalar_actual_cli_' + mode + '_does_not_log_values',
              quoted_scalar_marker.encode() not in completed.stdout + completed.stderr)

# Published caller/format regressions use synthetic inputs and the real caller
# Python blocks, never replay/native/CI commands or original evidence.
import ast
import os
import re
import textwrap
import xml.etree.ElementTree as ET

named_marker = 'DECLARED_ALIAS_CREDENTIAL_20261019'
for key in ['POSTGRES_PASSWORD', 'SUPABASE_JWT_SECRET', 'AWS_SECRET_ACCESS_KEY',
            'secret_key', 'DB_PASSWORD', 'S3 Access Key', 'PGPASSWORD', 'accessToken', 'X-Api-Key']:
    for form in ['text', 'json', 'header']:
        payload = ((key + '=' + named_marker + '\n').encode() if form == 'text' else
                   json.dumps({key: named_marker, 'safe': 'visible-alias'}).encode() if form == 'json' else
                   json.dumps({'headers': [{'name': key, 'value': named_marker}], 'safe': 'visible-alias'}).encode())
        result = module.scrub(payload)
        check('public_alias_' + key + '_' + form, named_marker.encode() not in result
              and module.scrub(result) == result)
        if form != 'text':
            check('public_alias_' + key + '_' + form + '_valid_json', json.loads(result)['safe'] == 'visible-alias')
    if key in ['PGPASSWORD', 'accessToken', 'X-Api-Key']:
        result = module.scrub((key + ': ' + named_marker + '\n').encode())
        check('public_conventional_alias_colon_' + key, named_marker.encode() not in result)
for payload in [b'\x1b[1mJWT_SECRET\x1b[0m=' + named_marker.encode() + b'\n',
                b'JWT_\x1b[32mSECRET\x1b[0m="' + named_marker.encode() + b'"\n']:
    result = module.scrub(b'\x1b[35mpublic-before\x1b[0m\n' + payload + b'public-after\r\n')
    check('public_ANSI_name_credential_removed', named_marker.encode() not in result)
    check('public_ANSI_safe_bytes_retained', result.startswith(b'\x1b[35mpublic-before\x1b[0m\n')
          and result.endswith(b'public-after\r\n') and module.scrub(result) == result)
for separator in ['│', '┃', '|']:
    table = (separator + ' Access Key ' + separator + ' Secret Key ' + separator + '\n'
             + separator + ' ' + named_marker + ' ' + separator + ' ' + named_marker + '2 ' + separator + '\n')
    payload = ('public-header-before\n' + table + 'public-header-after\n').encode()
    result = module.scrub(payload)
    check('public_horizontal_header_' + separator, named_marker.encode() not in result
          and result.startswith(b'public-header-before\n') and result.endswith(b'public-header-after\n')
          and b'Access Key' in result and b'Secret Key' in result and module.scrub(result) == result)
    with tempfile.TemporaryDirectory(prefix='native-redactor-header-') as directory:
        evidence = Path(directory) / 'header.log'; evidence.write_bytes(payload)
        module.redact_line_records(evidence)
        check('public_horizontal_header_records_' + separator, evidence.read_bytes() == result)
    xml = ('<testsuites><testsuite><testcase><system-out>' + separator + ' Access Key ' + separator
           + ' ' + named_marker + ' ' + separator + '</system-out></testcase></testsuite></testsuites>\r\n').encode()
    result = module.scrub(xml)
    try:
        ET.fromstring(result); valid_xml = True
    except ET.ParseError:
        valid_xml = False
    check('public_table_XML_closing_suffix_' + separator, named_marker.encode() not in result and valid_xml
          and result.endswith((separator + '</system-out></testcase></testsuite></testsuites>\r\n').encode())
          and module.scrub(result) == result)

for name, payload in [
    ('safe_ANSI', b'\x1b[32mpublic SQL diagnostic\x1b[0m\r\n'),
    ('safe_password_policy', b'{ "password_policy":"keep public policy", "access_key_count":2 }\r\n'),
    ('safe_family_substring', b'notpassword=public\nPASSWORD_POLICY=public\n'),
    ('safe_PGPASSWORD_suffix', b'{ "PGPASSWORD_COUNT": 1 }\n'),
    ('safe_accessToken_suffix', b'{ "accessTokenCount": 1 }\n'),
    ('safe_XApiKey_suffix', b'{ "X-Api-Key-Status": "public" }\n'),
    ('safe_SQL_casts_and_assignment', b"SELECT 'missing_authorization'::text, 'DB_PASSWORD'::text;\nv_password := public_fixture;\nempty_feed_authorization = 'public_enum';\n"),
    ('safe_URL_port_and_contact', b'https://example.invalid:443/public?contact=help@example.invalid\n'),
    ('safe_JSON_surrogate_key', b'{ "\\ud800": "public diagnostic", "safe": 1 }\r\n'),
    ('safe_URL', b'https://example.invalid/safe/path?mode=public\n'),
    ('safe_long_scheme_URL', b'custom' + b'a' * 80 + b'://example.invalid/path\n'),
]:
    identity('public_' + name, payload)

for value in ['DECLARED_QUOTED;CREDENTIAL,TAIL', 'DECLARED_QUOTED/CREDENTIAL']:
    for quote in ["'", '"']:
        result = module.scrub(('password=' + quote + value + quote + ' public-diagnostic\n').encode())
        check('public_quoted_delimiter_extent', value.encode() not in result and result.endswith(b' public-diagnostic\n'))

caller_specs = [
    ('ediel-db04-current-consumers-native.yml', 'db04-current-consumers-native-working'),
    ('ediel-db05-native.yml', 'db05-native-working'),
    ('ediel-esco-z14vh-z15v-native.yml', 'esco-z14vh-z15v-native-working'),
    ('ediel-sc014-z14v-native.yml', 'sc014-z14v-native-working'),
]
for workflow_name, working_name in caller_specs:
    workflow = Path(__file__).parents[1] / '.github' / 'workflows' / workflow_name
    lines = workflow.read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if "spec_from_file_location('canonical_redactor'" in line) - 1
    end = next(i for i in range(start + 1, len(lines)) if lines[i].strip() == 'PY')
    caller_block = textwrap.dedent('\n'.join(lines[start:end]))
    tree = ast.parse(caller_block)
    caller_loop = next(node for node in tree.body if isinstance(node, ast.For))
    check('public_caller_' + workflow_name + '_actual_working_root', ast.literal_eval(caller_loop.iter.func.value.args[0]) == working_name)
    regex = next(ast.literal_eval(node.value.args[0]) for node in tree.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == 'remaining' for target in node.targets))
    detector = re.compile(regex)
    fixed_url = b'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
    other_url = b'postgresql://user:DECLARED_OTHER_URL_CREDENTIAL@127.0.0.1:54322/postgres'
    for raw in [fixed_url, other_url, token.encode(), b'sb_secret_DECLARED_caller_key']:
        check('public_caller_' + workflow_name + '_negative_guard', detector.search(raw) is not None)
    with tempfile.TemporaryDirectory(prefix='native-redactor-caller-') as directory:
        root = Path(directory); working = root / working_name; working.mkdir()
        scripts = root / 'scripts'; scripts.mkdir()
        (scripts / 'gridex-redact-native-evidence.py').symlink_to(Path(__file__).with_name('gridex-redact-native-evidence.py').resolve())
        status = root / 'local.json'; status.write_text(json.dumps({'API_URL':'http://127.0.0.1:54321',
                   'DB_URL':fixed_url.decode(), 'SECRET_KEY':'DECLARED_STATUS_SECRET'}))
        (working / 'native.log').write_bytes(b'public-caller-before\nDB URL: ' + fixed_url + b'\nother: ' + other_url + b'\npublic-caller-after\r\n')
        (working / 'body.json').write_text(json.dumps({'db_url':other_url.decode(), 'safe':'public-json-caller'}))
        (working / 'records.jsonl').write_text(json.dumps({'password':named_marker,'safe':1})+'\n'+json.dumps({'db_url':other_url.decode(),'safe':2})+'\n')
        with zipfile.ZipFile(working / 'trace.zip', 'w') as archive:
            archive.writestr('trace.network', b'public-zip-caller ' + other_url)
        first = subprocess.run([sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                '--root',str(working),'--local-secrets',str(status)],capture_output=True,check=False)
        second = subprocess.run([sys.executable,'-c',caller_block],cwd=root,
                env=dict(os.environ,GRIDEX_NATIVE_STATUS=str(status),PYTHONDONTWRITEBYTECODE='1'),capture_output=True,check=False)
        check('public_caller_' + workflow_name + '_actual_CLI_then_actual_block', first.returncode == second.returncode == 0)
        result = (working / 'native.log').read_bytes()
        check('public_caller_' + workflow_name + '_safe_log_and_idempotence', detector.search(result) is None
              and b'DECLARED_OTHER_URL_CREDENTIAL' not in result and result.startswith(b'public-caller-before\n')
              and result.endswith(b'public-caller-after\r\n') and module.scrub(result) == result)
        check('public_caller_' + workflow_name + '_valid_JSON', json.loads((working/'body.json').read_bytes())['safe']=='public-json-caller'
              and detector.search((working/'body.json').read_bytes()) is None)
        records = [json.loads(line) for line in (working/'records.jsonl').read_text().splitlines()]
        check('public_caller_' + workflow_name + '_valid_NDJSON', [row['safe'] for row in records]==[1,2]
              and named_marker not in (working/'records.jsonl').read_text())
        with zipfile.ZipFile(working / 'trace.zip') as archive:
            member=archive.read('trace.network')
        check('public_caller_' + workflow_name + '_decoded_ZIP_member', detector.search(member) is None
              and b'DECLARED_OTHER_URL_CREDENTIAL' not in member and b'public-zip-caller' in member)

# No elapsed-time assertion: the new scanner's non-overlapping admission and
# span consumption are reviewed explicitly. Large finite identity fixtures
# run only with that scanner present; the uncorrected baseline remains bounded.
if hasattr(module, 'scrub_url_passwords'):
    for name, payload in [('dotted', b'a.' * 262144), ('prefixes', b'a://' * 131072), ('colons', b'ab:' * 131072), ('dotted_with_at', b'a.' * 262144 + b'@host.invalid')]:
        identity('public_large_noncredential_' + name, payload)
    storm = b'a://' * 131072 + b'@host.invalid'
    identity('public_noncredential_prefix_storm_with_at', storm)
    slash = b'postgresql://user:DECLARED_PERCENT%2FENCODED_CREDENTIAL@host.invalid/path'
    check('public_valid_percent_encoded_userinfo', module.scrub(slash) == module.REDACTED.encode() + b'@host.invalid/path')
    for scheme in [b'postgresql', b'custom' + b'a' * 80]:
        result=module.scrub(scheme+b'://user:DECLARED_SCANNER_CREDENTIAL@host.invalid/path')
        check('public_unbounded_scheme_credentials', b'DECLARED_SCANNER_CREDENTIAL' not in result
              and b'user:' not in result and result.endswith(b'@host.invalid/path') and module.scrub(result)==result)
else:
    check('public_linear_URL_scanner_required', False)

# ROOT's actual valid-XML failures: preserve lexical structure and outside-
# frame diagnostics, including when the terminal table frame is absent.
xml_root_marker = 'DECLARED_ROOT_ONLY'
xml_open = '<testsuites><testsuite><testcase><system-out>'
xml_close = '</system-out></testcase></testsuite></testsuites>'
xml_cases = []
plain_opaque = b'| Access Key | DECLARED_OPAQUE_FIRST|DECLARED_OPAQUE_SECOND |\n'
plain_clean = module.scrub(plain_opaque)
check('XML_change_preserves_plaintext_opaque_separator_redaction',
      b'DECLARED_OPAQUE_FIRST' not in plain_clean and b'DECLARED_OPAQUE_SECOND' not in plain_clean)
for separator in ['│', '┃', '|']:
    for variant, tail in [('public_suffix', separator + ' public diagnostic'), ('no_frame', '')]:
        body = separator + ' Access Key ' + separator + ' ' + xml_root_marker + ' ' + tail
        raw = (xml_open + body + xml_close + '\r\n').encode()
        xml_cases.append((separator + '_' + variant, raw,
                          (tail + xml_close + '\r\n').encode()))
xml_cases.extend([
    ('entities_UTF8', (xml_open + '│ Secret Key │ ' + xml_root_marker + '&amp;tail │ public &amp; café' + xml_close + '\r\n').encode(),
     ('│ public &amp; café' + xml_close + '\r\n').encode()),
    ('CDATA', (xml_open + '<![CDATA[│ Access Key │ ' + xml_root_marker + ' │ public diagnostic]]>' + xml_close + '\n').encode(),
     ('│ public diagnostic]]>' + xml_close + '\n').encode()),
    ('nested_testcases', ('<testsuite>\n<testcase><system-out>│ Access Key │ ' + xml_root_marker
                         + ' │ public-one</system-out></testcase>\n<testcase><system-out>│ Secret Key │ '
                         + xml_root_marker + '</system-out></testcase>\n</testsuite>\r\n').encode(), b'</testsuite>\r\n'),
    ('attribute_credential', ('<testsuite password="' + xml_root_marker + '"><testcase>public attribute diagnostic</testcase></testsuite>\n').encode(),
     b'<testcase>public attribute diagnostic</testcase></testsuite>\n'),
    ('attribute_URL', ('<testsuite message="postgresql://user:' + xml_root_marker + '@host.invalid/path"><testcase>public URL attribute diagnostic</testcase></testsuite>\n').encode(),
     b'<testcase>public URL attribute diagnostic</testcase></testsuite>\n'),
    ('attribute_inner_single_quote', ('<testsuite message="password=\'' + xml_root_marker + '\' public &amp; diagnostic"><testcase>public quote diagnostic</testcase></testsuite>\n').encode(),
     b' public &amp; diagnostic"><testcase>public quote diagnostic</testcase></testsuite>\n'),
    ('attribute_inner_double_quote', ("<testsuite message='password=\"" + xml_root_marker + "\" public &amp; diagnostic'><testcase>public quote diagnostic</testcase></testsuite>\n").encode(),
     b" public &amp; diagnostic'><testcase>public quote diagnostic</testcase></testsuite>\n"),
    ('Unicode_attribute_quote_boundary', ('<t ö=" password=\'' + xml_root_marker + '" safe="\'"/>\n').encode(),
     b'" safe="\'"/>\n'),
    ('comment_credential', ('<testsuite><!--password=' + xml_root_marker + '--><testcase>public comment diagnostic</testcase></testsuite>\n').encode(),
     b'--><testcase>public comment diagnostic</testcase></testsuite>\n'),
    ('JSON_text', ('<testsuite><system-out>{"password":"' + xml_root_marker + '","safe":"public JSON diagnostic"}</system-out></testsuite>\n').encode(),
     b'</system-out></testsuite>\n'),
])
for name, raw, public_suffix in xml_cases:
    ET.fromstring(raw)
    result = module.scrub(raw)
    try:
        ET.fromstring(result); valid = True
    except ET.ParseError:
        valid = False
    check('XML_structural_' + name, valid and xml_root_marker.encode() not in result
          and result.endswith(public_suffix) and module.scrub(result) == result)
    with tempfile.TemporaryDirectory(prefix='native-redactor-XML-structure-') as directory:
        evidence=Path(directory)/'junit.xml';evidence.write_bytes(raw)
        try:
            module.redact_line_records(evidence)
            ET.fromstring(evidence.read_bytes())
            records_valid = evidence.read_bytes() == result
        except (ValueError, ET.ParseError):
            records_valid = False
        check('XML_structural_records_' + name, records_valid)
for name, raw in [
    ('attrs_comments_entities', b'<?xml version="1.0"?><testsuite name="public &amp; safe"><!--public--><testcase><system-out>public &lt;diagnostic&gt;</system-out></testcase></testsuite>\r\n'),
    ('CDATA_public', b'<testsuite><system-out><![CDATA[public <angle> & diagnostic]]></system-out></testsuite>\n'),
    ('Unicode_attribute_name', '<t öpassword="public diagnostic"/>'.encode()),
]:
    identity('XML_structural_safe_' + name, raw)
xml_dtd = b'<!DOCTYPE root [<!ENTITY ext SYSTEM "https://example.invalid/unread">]><root>&ext;</root>'
refused = False
try:
    module.scrub(xml_dtd)
except ValueError as error:
    refused = str(error).startswith('redaction_xml_')
check('XML_DTD_external_reference_refused', refused)

# Actual Playwright HTML reports open with the HTML5 doctype. A bare doctype
# declares no DTD or entity: it keeps the existing HTML/ZIP sanitization path,
# in memory and through the executable over a real report directory.
html_trace = io.BytesIO()
with zipfile.ZipFile(html_trace, 'w') as writer:
    writer.writestr('trace.network', data)
html_report = (b'<!DOCTYPE html>\n<html><head><meta charset="UTF-8"></head><body>\n<script>"data:application/zip;base64,'
               + base64.b64encode(html_trace.getvalue()) + b'"</script>\npublic report diagnostic\n</body></html>\n')
for name, payload in [('memory', html_report), ('BOM_upper', b'\xef\xbb\xbf' + html_report.replace(b'<!DOCTYPE html>', b'<!doctype HTML>'))]:
    try:
        clean = module.scrub(payload, [password]); network = zipfile.ZipFile(io.BytesIO(base64.b64decode(module.EMBEDDED_ZIP.search(clean)[1]))).read('trace.network')
        okay = (all(value not in network for value in [password, token.encode(), b'opaque-refresh-token', b'sb-session-secret'])
                and b'retained visible mutation' in network and b'public report diagnostic' in clean and module.scrub(clean, [password]) == clean)
    except ValueError:
        okay = False
    check('HTML5_doctype_report_zip_' + name, okay)
with tempfile.TemporaryDirectory(prefix='native-redactor-html-report-') as directory:
    report = Path(directory) / 'e2e-artifacts' / 'playwright-report'
    report.mkdir(parents=True)
    (report / 'index.html').write_bytes(html_report)
    completed = subprocess.run([sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                                '--root', str(Path(directory) / 'e2e-artifacts')], capture_output=True, check=False)
    written = (report / 'index.html').read_bytes()
    network = zipfile.ZipFile(io.BytesIO(base64.b64decode(module.EMBEDDED_ZIP.search(written)[1]))).read('trace.network')
    check('HTML5_doctype_report_actual_cli', completed.returncode == 0 and written.startswith(b'<!DOCTYPE html>')
          and all(value not in network for value in [token.encode(), b'opaque-refresh-token', b'sb-session-secret'])
          and b'public report diagnostic' in written)
for name, payload in [
    ('internal_subset', b'<!DOCTYPE html [<!ENTITY a "b">]><html>&a;</html>'),
    ('public_id', b'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd"><html/>'),
    ('system_id', b'<!DOCTYPE root SYSTEM "https://example.invalid/unread.dtd"><root/>'),
]:
    refused = False
    try:
        module.scrub(payload)
    except ValueError as error:
        refused = str(error).startswith('redaction_xml_')
    check('XML_DTD_still_refused_' + name, refused)

# Actual once-escaped XML quote regressions from the independent 1ac9 review.
entity_marker = 'DECLARED_B_XML_ENTITY_CREDENTIAL;WITH,DELIMITERS'
for quote in ['&quot;', '&apos;', '&#34;', '&#x22;', '&#39;', '&#x27;']:
    for context in ['attribute', 'text']:
        body = 'password=' + quote + entity_marker + quote + ' public &amp; diagnostic'
        raw = (('<testcase message="' + body + '"/>') if context == 'attribute'
               else '<testcase><system-out>' + body + '</system-out></testcase>').encode()
        ET.fromstring(raw)
        clean = module.scrub(raw)
        try:
            ET.fromstring(clean); valid = True
        except ET.ParseError:
            valid = False
        expected = raw.replace(entity_marker.encode(), module.REDACTED.encode())
        check('XML_entity_once_' + context + '_' + quote, valid and clean == expected
              and module.scrub(clean) == clean)
        with tempfile.TemporaryDirectory(prefix='native-redactor-XML-entity-') as directory:
            evidence = Path(directory)/'junit.xml'; evidence.write_bytes(raw)
            module.redact_line_records(evidence)
            check('XML_entity_records_' + context + '_' + quote, evidence.read_bytes() == expected)
for name, raw in [
    ('encoded_name', b'<t>pass&#119;ord=&quot;DECLARED_ENCODED_NAME&quot; public &amp; diagnostic</t>'),
    ('encoded_value', b'<t message="password=&quot;DECLARED&#95;ENCODED_VALUE&quot; public &amp; diagnostic"/>'),
    ('encoded_URL', b'<t message="postgresql://user&#58;DECLARED_ENCODED_URL@host.invalid/path public &amp; diagnostic"/>'),
    ('BOM_LF_table', ('\ufeff\n  <t>│ Access Key │ DECLARED_BOM_VALUE │ public diagnostic</t>\n').encode()),
    ('BOM_CRLF_no_frame', ('\ufeff\r\n  <t>│ Access Key │ DECLARED_BOM_VALUE</t>\r\n').encode()),
]:
    ET.fromstring(raw)
    clean = module.scrub(raw)
    try:
        parsed = ET.fromstring(clean)
        decoded = ET.tostring(parsed, encoding='unicode'); valid = True
    except ET.ParseError:
        decoded = ''; valid = False
    check('XML_entity_' + name, valid and 'DECLARED' not in decoded and module.scrub(clean) == clean
          and (not raw.startswith(b'\xef\xbb\xbf') or clean.startswith(b'\xef\xbb\xbf'))
          and (b'public &amp; diagnostic' not in raw or b'public &amp; diagnostic' in clean))
for name, payload in [('string', '"DECLARED_XML_JSON"'), ('number', '123'), ('boolean', 'true'),
                      ('null', 'null'), ('object', '{"inside":"DECLARED_XML_JSON"}'),
                      ('array', '["DECLARED_XML_JSON"]')]:
    raw = ('<t name="public &amp; outside">{"pass&#119;ord":' + payload + ',"safe":"public &amp; diagnostic"}</t>').encode()
    clean = module.scrub(raw)
    parsed = json.loads(ET.fromstring(clean).text)
    check('XML_entity_JSON_typed_' + name, parsed == {'password':module.REDACTED,'safe':'public & diagnostic'}
          and clean.startswith(b'<t name="public &amp; outside">') and b'public &amp; diagnostic' in clean and module.scrub(clean) == clean)
raw = b'<t>{"headers":[{"name":"Authoriz&#97;tion","value":"DECLARED_XML_HEADER"}],"safe":1}</t>'
clean = module.scrub(raw); parsed = json.loads(ET.fromstring(clean).text)
check('XML_entity_JSON_header_pair', parsed['headers'][0]['value'] == module.REDACTED
      and parsed['safe'] == 1 and module.scrub(clean) == clean)
for name, raw in [
    ('public_attribute_entities', b'<t message="public &quot;diagnostic&quot; &apos;quoted&apos; &amp; &#99;af&#xE9; &amp;quot;"/>'),
    ('public_text_entities', b'<t>public &lt;diagnostic&gt; &quot;quoted&quot; &amp;quot; &#99;af&#xE9;</t>'),
    ('CDATA_literal_entities', b'<t><![CDATA[public &quot;diagnostic&quot; &amp;quot; &#34;]]></t>'),
    ('comment_PI_literal_entities', b'<t><!--public &quot;diagnostic&quot;--><?public &amp;quot; &#34;?></t>'),
    ('BOM_safe_identity', b'\xef\xbb\xbf\r\n  <t message="public &quot;diagnostic&quot;">public &amp; safe</t>\r\n'),
]:
    identity('XML_entity_safe_' + name, raw)
if hasattr(module, '_xml_entity_view'):
    view, boundary = module._xml_entity_view(b'&amp;quot; &#0000000034; &#x000000E9;')
    check('XML_entity_exactly_once_numeric_and_boundary', view == b'&quot; " \xc3\xa9'
          and boundary(len(view)) == len(b'&amp;quot; &#0000000034; &#x000000E9;'))
else:
    check('XML_entity_exactly_once_numeric_and_boundary', False)

# Standard HTML5 report wrapper regression after the actual c587 CLEAN failure.
# Only declared synthetic HTML/ZIP/status/record bytes are used here.
html5_marker = b'DECLARED_HTML5_CREDENTIAL'
html5_zip = io.BytesIO()
with zipfile.ZipFile(html5_zip, 'w') as writer:
    writer.writestr('trace.network', b'password=' + html5_marker + b' public ZIP diagnostic')
html5_body = (b'<html lang="en" data-public="quote > diagnostic"><head><meta charset="utf-8"></head><body>'
              b'<script id="playwrightReportBase64" type="application/zip">data:application/zip;base64,')
html5_suffix = b'</script><p>public HTML diagnostic</p></body></html>\r\n'

def html5_clean_or_none(data):
    try:
        return module.scrub(data, [html5_marker])
    except ValueError:
        return None

def html5_member(data):
    if data is None:
        return None
    embedded = module.EMBEDDED_ZIP.search(data)
    if embedded is None:
        return None
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(embedded[1]))) as reader:
        return reader.read('trace.network')

for name, prefix in [
    ('standard', b'<!DOCTYPE html>\n'),
    ('BOM_whitespace', b'\xef\xbb\xbf \r\n<!doctype html>\r\n'),
    ('HTML_case_whitespace', b' \t<!DoCtYpE \tHTML \f>\n'),
]:
    raw = prefix + html5_body + base64.b64encode(html5_zip.getvalue()) + html5_suffix
    clean = html5_clean_or_none(raw)
    member = html5_member(clean)
    check('HTML5_wrapper_' + name + '_ZIP_sanitized', member is not None
          and html5_marker not in member and b'public ZIP diagnostic' in member)
    check('HTML5_wrapper_' + name + '_public_bytes_retained', clean is not None
          and clean.startswith(prefix + html5_body) and clean.endswith(html5_suffix))
    check('HTML5_wrapper_' + name + '_idempotent', clean is not None and module.scrub(clean) == clean)
    with tempfile.TemporaryDirectory(prefix='native-redactor-HTML5-CLI-') as directory:
        root = Path(directory); artifacts = root/'e2e-artifacts'; report = artifacts/'playwright-report'/'index.html'
        report.parent.mkdir(parents=True); report.write_bytes(raw)
        status = root/'local.json'; status.write_text(json.dumps({'API_URL':'http://127.0.0.1:54321','password':html5_marker.decode()}))
        records = root/'gridex-clean-replay.raw.log'; records.write_bytes(b'public record before\npassword=' + html5_marker + b'\npublic record after\r\n')
        completed = subprocess.run([sys.executable, str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                    '--local-secrets',str(status),'--root',str(artifacts),
                    '--root',str(records),'--line-records',str(records)],capture_output=True,check=False)
        member = html5_member(report.read_bytes())
        check('HTML5_actual_CLI_' + name + '_success', completed.returncode == 0)
        check('HTML5_actual_CLI_' + name + '_ZIP_and_public_HTML', member is not None
              and html5_marker not in member and b'public ZIP diagnostic' in member
              and report.read_bytes().startswith(prefix + html5_body) and report.read_bytes().endswith(html5_suffix))
        check('HTML5_actual_CLI_' + name + '_bounded_record_adapter', html5_marker not in records.read_bytes()
              and records.read_bytes().startswith(b'public record before\n') and records.read_bytes().endswith(b'public record after\r\n'))
        check('HTML5_actual_CLI_' + name + '_no_payload_diagnostic', html5_marker not in completed.stdout + completed.stderr)
for name, raw in [
    ('public_document', b'<!DOCTYPE html><html><body><p>public diagnostic &amp; safe</p></body></html>\r\n'),
    ('BOM_public_document', b'\xef\xbb\xbf\n<!doctype html>\n<html lang="en"><body>public diagnostic</body></html>'),
    ('literal_declarations', b'<!DOCTYPE html><html><script>const publicText="<!ENTITY public> <!DOCTYPE root>";</script><!--ENTITY public--><textarea><!ENTITY public></textarea><p>public diagnostic</p></html>'),
]:
    check('HTML5_secret_free_' + name + '_byte_identity', html5_clean_or_none(raw) == raw)
for name, raw in [
    ('bare_XML_doctype', b'<!DOCTYPE root><root/>'),
    ('HTML_doctype_nonHTML_root', b'<!DOCTYPE html><root/>'),
    ('HTML_root_name_boundary', b'<!DOCTYPE html><htmlish/>'),
    ('HTML_namespaced_root', b'<!DOCTYPE html><html:report xmlns:html="urn:public"/>'),
    ('HTML_missing_root', b'<!DOCTYPE html>'),
    ('HTML_unterminated_root_quote', b'<!DOCTYPE html><html name="unterminated>'),
    ('HTML_internal_ENTITY', b'<!DOCTYPE html [<!ENTITY secret "DECLARED_XML_ENTITY">]><html>&secret;</html>'),
    ('HTML_external_SYSTEM', b'<!DOCTYPE html SYSTEM "https://example.invalid/not-read"><html>public</html>'),
    ('HTML_external_PUBLIC', b'<!DOCTYPE html PUBLIC "-//DECLARED//HTML" "https://example.invalid/not-read"><html>public</html>'),
    ('HTML_lowercase_internal_ENTITY', b'<!doctype html [<!ENTITY secret "DECLARED_XML_ENTITY">]><html>&secret;</html>'),
    ('HTML_lowercase_external_SYSTEM', b'<!doctype html SYSTEM "https://example.invalid/not-read"><html>public</html>'),
    ('HTML_later_ENTITY', b'<!DOCTYPE html><html><!ENTITY secret "DECLARED_XML_ENTITY"></html>'),
    ('HTML_later_lowercase_ENTITY', b'<!doctype html><html>\n<!entity secret "DECLARED_XML_ENTITY"></html>'),
    ('HTML_second_DOCTYPE', b'<!DOCTYPE html><html>\n<!DOCTYPE root><p>public</p></html>'),
    ('XML_declaration_before_HTML', b'<?xml version="1.0"?><!DOCTYPE html><html>public</html>'),
]:
    refused = False
    try:
        module.scrub(raw)
    except ValueError as error:
        refused = str(error) == 'redaction_xml_DTD_or_external_entity_not_supported'
    check('HTML5_exemption_refuses_' + name, refused)
with tempfile.TemporaryDirectory(prefix='native-redactor-HTML5-DTD-CLI-') as directory:
    evidence = Path(directory)/'untrusted.xml'; evidence.write_bytes(xml_dtd)
    completed = subprocess.run([sys.executable,str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                '--root',str(evidence)],capture_output=True,check=False)
    check('HTML5_change_actual_CLI_XML_DTD_still_fail_closed', completed.returncode != 0 and evidence.read_bytes() == xml_dtd)

# Independent b4fc finding: a bare NON-HTML doctype must never bypass the
# qualified XML entity/structured-JSON sanitizer. These valid XML records use
# only declared synthetic credentials; their no-doctype twins must sanitize.
nonhtml_marker = b'DECLARED_NONHTML_XML_CREDENTIAL'
for name, body in [
    ('encoded_assignment', b'<root>pass&#119;ord=&quot;' + nonhtml_marker + b'&quot; public &amp; diagnostic</root>'),
    ('encoded_JSON', b'<root>{"pass&#119;ord":"' + nonhtml_marker + b'","safe":"public &amp; diagnostic"}</root>'),
    ('serializer_attribute', b'<root message="password=&quot;' + nonhtml_marker + b'&quot; public &amp; diagnostic"/>'),
]:
    raw = b'<!DOCTYPE root>' + body
    ET.fromstring(raw)
    clean = module.scrub(body)
    parsed = ET.fromstring(clean)
    decoded = ET.tostring(parsed, encoding='unicode')
    check('NONHTML_XML_' + name + '_no_doctype_sanitizes',
          nonhtml_marker.decode() not in decoded and 'public &amp; diagnostic' in decoded
          and module.REDACTED in decoded and module.scrub(clean) == clean)
    refused = False
    try:
        module.scrub(raw)
    except ValueError as error:
        refused = str(error) == 'redaction_xml_DTD_or_external_entity_not_supported'
    check('NONHTML_XML_' + name + '_bare_doctype_refused', refused)
    with tempfile.TemporaryDirectory(prefix='native-redactor-NONHTML-XML-') as directory:
        evidence = Path(directory)/'junit.xml'; evidence.write_bytes(raw)
        completed = subprocess.run([sys.executable,str(Path(__file__).with_name('gridex-redact-native-evidence.py')),
                    '--root',str(evidence)],capture_output=True,check=False)
        check('NONHTML_XML_' + name + '_actual_CLI_refuses_without_rewrite',
              completed.returncode != 0 and evidence.read_bytes() == raw
              and nonhtml_marker not in completed.stdout + completed.stderr)
        records = Path(directory)/'xml-record.log'
        original = b'password=DECLARED_RECORD_BEFORE\n' + raw + b'\n'
        records.write_bytes(original); inode = records.stat().st_ino
        refused = False
        try:
            module.redact_line_records(records)
        except ValueError as error:
            refused = str(error) == 'redaction_xml_DTD_or_external_entity_not_supported'
        check('NONHTML_XML_' + name + '_bounded_records_refuse_atomically',
              refused and records.read_bytes() == original and records.stat().st_ino == inode
              and not list(Path(directory).glob('*.redacting-*')))

failed = [name for name, okay in checks if not okay]
for name in failed:
    print('NATIVE_EVIDENCE_SELFTEST_FAIL: ' + name)
print('NATIVE_EVIDENCE_SELFTEST: checks=' + str(len(checks)) + '; pass=' + str(len(checks) - len(failed)) + '; fail=' + str(len(failed)) + '; no credential values logged')
if failed:
    sys.exit(1)
print('NATIVE_EVIDENCE_SELFTEST: nested auth headers/body, ZIP trace and HTML-embedded report ZIP PASS; observable mutation retained')
