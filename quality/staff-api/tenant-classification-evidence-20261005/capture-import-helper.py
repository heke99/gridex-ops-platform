import argparse
import copy
import datetime
import hashlib
import json
import pathlib
import subprocess
import zipfile

ROOT = pathlib.Path('/workspace/gridex-support-portal-ops')
TEMP = pathlib.Path('/tmp/gridex-staff-review')
HEAD = 'a315f2f96f4d0ed249e0b8621289c5d8aba275d4'
TREE = '0da2e5b25028f4f5b1136718697fd2323005c115'
RUN = 37341406566
WITNESS_SHA = '876927b344134cebb584ecc25b67ed681b1965b4dab5cb168fcc0130223acc94'
FORWARD = '20261005160940_classify_tenant_staff_external_identity_tables.sql'
FORWARD_SHA = 'f103cebf3d3891554270cfdedc4374178c867eecda24175c81ccbedbaf88805d'
EVIDENCE = ROOT / 'quality/staff-api/tenant-classification-evidence-20261005'
RAW = ['database.types.ts', 'schema.sql', 'schema.fingerprint.json']

def digest(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()

parser = argparse.ArgumentParser()
parser.add_argument('zip_path', type=pathlib.Path)
parser.add_argument('artifact_metadata', type=pathlib.Path)
parser.add_argument('run_metadata', type=pathlib.Path)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
witness_bytes = (TEMP / 'tenant-classification-capture-pilot-source-witness.json').read_bytes()
assert digest(witness_bytes) == WITNESS_SHA
witness = json.loads(witness_bytes)
assert witness['source_head'] == HEAD and witness['source_tree'] == TREE
assert witness['capture_run'] == RUN
assert set(witness['input_sha256']) == {'scripts/gridex-aud-003-clean-replay.sh', 'scripts/migration-history-manifest.json', 'scripts/migration-history-manifest.additions.json', 'scripts/migration-history-manifest.runtime.additions.json', 'scripts/supabase-types-manifest.json', 'scripts/apply-supabase-types-nullability-overrides.cjs', 'scripts/gridex-schema-snapshot.cjs', 'supabase/config.toml'}
assert git('rev-parse', 'HEAD') == HEAD
assert git('rev-parse', 'HEAD^{tree}') == TREE
assert not git('status', '--porcelain')
assert digest((ROOT / 'supabase/migrations' / FORWARD).read_bytes()) == FORWARD_SHA
for name in RAW:
    assert digest((ROOT / 'supabase' / name).read_bytes()) == witness['old_raw3_sha256'][name], name
run = json.loads(args.run_metadata.read_text())
assert run['id'] == RUN and run['head_sha'] == HEAD
assert run['status'] == 'completed' and run['conclusion'] == 'success'
artifacts = json.loads(args.artifact_metadata.read_text())['artifacts']
matches = [a for a in artifacts if a['name'] == 'staff-schema-capture-' + HEAD]
assert len(matches) == 1
artifact = matches[0]
assert artifact['workflow_run']['id'] == RUN and artifact['workflow_run']['head_sha'] == HEAD
assert not artifact['expired']
assert datetime.datetime.fromisoformat(artifact['expires_at'].replace('Z', '+00:00')) > datetime.datetime.now(datetime.timezone.utc)
zip_bytes = args.zip_path.read_bytes()
zip_sha = digest(zip_bytes)
assert artifact['size_in_bytes'] == len(zip_bytes)
assert artifact['digest'] == 'sha256:' + zip_sha
with zipfile.ZipFile(args.zip_path) as archive:
    members = archive.infolist()
    assert len(members) == 4
    assert {m.filename for m in members} == set(RAW + ['capture-receipt.json'])
    assert all(m.file_size < 32 * 1024 * 1024 for m in members)
    assert all((m.external_attr >> 16) & 0o170000 != 0o120000 for m in members)
    assert archive.testzip() is None
    data = {m.filename: archive.read(m.filename) for m in members}
receipt = json.loads(data['capture-receipt.json'])
assert receipt['purpose'] == 'capture_only'
assert receipt['checkout_sha'] == HEAD and receipt['checkout_tree'] == TREE
assert int(receipt['workflow_run_id']) == RUN
assert receipt['latest_replay_migration'] == {'name': FORWARD, 'sha256': FORWARD_SHA}
assert receipt['postgres_server_version'].startswith('17.')
assert receipt['input_sha256'] == witness['input_sha256']
for relative, expected in receipt['input_sha256'].items():
    assert digest((ROOT / relative).read_bytes()) == expected, relative
for name in RAW:
    assert digest(data[name]) == receipt['artifact_sha256'][name], name
for field in ['native_tests', 'browser_tests', 'type_schema_comparison', 'upgrade_parity']:
    assert receipt[field] == 'NOT_RUN'
assert digest(data['schema.sql']) == witness['comparison_only_expected_three_constraint_schema_sha256']
old_fp = json.loads((ROOT / 'supabase/schema.fingerprint.json').read_text())
new_fp = json.loads(data['schema.fingerprint.json'])
assert old_fp['schemas'] == new_fp['schemas'] == receipt['schema_names']
assert set(old_fp['sections']) == set(new_fp['sections'])
changed = [name for name in old_fp['sections'] if old_fp['sections'][name] != new_fp['sections'][name]]
assert set(changed) == {'constraints', 'indexes'}
assert all(old_fp['sections'][name]['count'] == new_fp['sections'][name]['count'] for name in old_fp['sections'])
canonical = json.dumps(new_fp['sections'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
assert digest(canonical) == new_fp['sha256'] == receipt['schema_fingerprint']
extracted = pathlib.Path('/tmp/gridex-tenant-classification-capture-a315')
extracted.mkdir(exist_ok=True)
for name, raw in data.items():
    target = extracted / name
    assert not target.exists() or target.read_bytes() == raw
    target.write_bytes(raw)
result = {
    'status': 'PASS_AUTHENTIC_CAPTURE_EXACT_THREE_CONSTRAINT_DELTA_IMPORT_NOT_APPLIED',
    'source_head': HEAD, 'source_tree': TREE, 'workflow_run': RUN,
    'artifact_id': artifact['id'], 'zip_path': str(args.zip_path),
    'zip_sha256': zip_sha, 'safe_members_crc_verified': True,
    'extraction_path': str(extracted), 'producer_input8_sha256': receipt['input_sha256'],
    'actual_raw3_sha256': receipt['artifact_sha256'],
    'types_unchanged': data['database.types.ts'] == (ROOT / 'supabase/database.types.ts').read_bytes(),
    'schema_exactly_three_preserved_name_unique_keys_add_company_id': True,
    'fingerprint_changed_sections_only': changed,
    'canonical_fingerprint': new_fp['sha256'],
    'hosted_writes': 0,
    'qualification_limits': ['Capture-only; native/browser/comparison/upgrade NOT_RUN remain honest.', 'Actual raw producer bytes only; final exact-head native/upgrade CI required.'],
}
if args.apply:
    manifest_path = ROOT / 'scripts/supabase-types-manifest.json'
    previous = manifest_path.read_bytes()
    old = json.loads(previous)
    assert old['composition_capture_pending']
    preimport_path = EVIDENCE / 'preimport-complete-types-manifest-a315.json'
    assert not preimport_path.exists() or preimport_path.read_bytes() == previous
    preimport_path.write_bytes(previous)
    new = copy.deepcopy(old)
    new['generated_at'] = receipt['captured_at']
    new['generated_with'] = f"supabase-cli-{receipt['supabase_cli_version']}-local-native-clean-replay-capture-run{RUN}"
    new['sha256'] = receipt['artifact_sha256']['database.types.ts']
    new['latest_migration'] = FORWARD
    new['latest_migration_schema_effect'] = 'Authentic PostgreSQL17 capture of three company-scoped invitation uniqueness constraints and tenant classifications. Exact dump delta is three preserved-name UNIQUE keys; other schema sections/functions/ACLs unchanged. Raw3 copied byte-for-byte; no native acceptance inferred.'
    new['composition_capture_pending'] = False
    del new['pending_forward_capture']
    new['previous_capture'] = copy.deepcopy(old['capture'])
    new['previous_current_capture_composition'] = {key: copy.deepcopy(old.get(key)) for key in ['composition_note', 'composition_capture_pending_scope', 'current_prefix_verification', 'capture_artifact']}
    new['composition_note'] = 'The current authentic capture is exact a315 source with the additive company-scoped invitation-key/classification forward. Complete prior manifests and capture/composition scopes remain immutable history. Final composed-source native/upgrade/API/required CI is independently qualified.'
    new['composition_capture_pending_scope'] = f'Completed authentic capture{RUN} of exact{HEAD}/tree{TREE}, latest{FORWARD} {FORWARD_SHA}; genuine raw3 imported from artifact{artifact["id"]}. Native/browser/comparison/upgrade were NOT_RUN in this producer; final exact-source clean/upgrade/required CI remains mandatory.'
    prefix = new['current_prefix_verification']
    prefix['capture_latest_migration'] = FORWARD
    assert all(digest((ROOT / 'supabase/migrations' / item['name']).read_bytes()) == item['sha256'] for item in prefix['source_migrations'])
    assert not any(item['name'] == FORWARD for item in prefix['source_migrations'])
    prefix['source_migrations'].append({'name': FORWARD, 'sha256': FORWARD_SHA})
    new['previous_complete_manifest_preserved'] = {'path': 'quality/staff-api/tenant-classification-evidence-20261005/previous-complete-types-manifest-0cf.json', 'sha256': digest((EVIDENCE / 'previous-complete-types-manifest-0cf.json').read_bytes())}
    new['preimport_complete_manifest_preserved'] = {'path': str(preimport_path.relative_to(ROOT)), 'sha256': digest(previous)}
    new['capture'] = copy.deepcopy(receipt)
    receipt_relative = 'quality/staff-api/tenant-classification-evidence-20261005/authentic-capture-receipt-a315.json'
    new['capture'].update({'artifact_id': artifact['id'], 'artifact_zip_sha256': zip_sha, 'published_artifact_digest': artifact['digest'], 'artifact_expires_at': artifact['expires_at'], 'actual_checkout_commit': HEAD, 'actual_checkout_tree': TREE, 'receipt': receipt_relative, 'input_hash_scope': 'All eight inputs bind exact a315 pre-import source. Genuine raw output import changes generated/provenance files; final native/upgrade acceptance is separate.'})
    new['capture_artifact'] = {'workflow_run': RUN, 'artifact_id': artifact['id'], 'zip_sha256': zip_sha, 'source_head': HEAD, 'source_tree': TREE, 'purpose': 'capture_only', 'receipt': receipt_relative}
    for name in RAW:
        (ROOT / 'supabase' / name).write_bytes(data[name])
    manifest_path.write_text(json.dumps(new, indent=2) + '\n')
    (EVIDENCE / 'authentic-capture-receipt-a315.json').write_bytes(data['capture-receipt.json'])
    result['status'] = 'PASS_AUTHENTIC_RAW3_IMPORT_EXACT_THREE_CONSTRAINT_DELTA_FINAL_CI_PENDING'
    result['imported_raw3_sha256'] = {name: digest((ROOT / 'supabase' / name).read_bytes()) for name in RAW}
output = TEMP / ('tenant-classification-capture-import-applied.json' if args.apply else 'tenant-classification-capture-verification.json')
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'receipt_path': str(output), 'receipt_sha256': digest(output.read_bytes()), 'types_unchanged': result['types_unchanged'], 'canonical_fingerprint': new_fp['sha256']}))
