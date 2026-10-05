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
EVIDENCE = ROOT / 'quality/staff-api/main-f88-composition-20261005'
HEAD = 'cff34a54982f6b5269c340511c933c5af76ec8e8'
TREE = '20a7dc9d75b5db20a32f918fe638a11ca928fbf3'
RUN = 37359791003
WITNESS_SHA = '44a151d5e31f8423f0d024018d31bbabfab25a4cfff8f85acf06fdcbd4981b97'
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
witness_bytes = (TEMP / 'f88-union-capture-pilot-source-witness.json').read_bytes()
assert digest(witness_bytes) == WITNESS_SHA
witness = json.loads(witness_bytes)
assert witness['source_head'] == HEAD and witness['source_tree'] == TREE
assert witness['capture_run'] == RUN
assert git('rev-parse', 'HEAD') == HEAD and git('rev-parse', 'HEAD^{tree}') == TREE
assert not git('status', '--porcelain')
assert witness['migration_integrity'] == {'files': 1076, 'version_groups': 979, 'status': 'PASS'}
assert set(witness['input_sha256']) == {
    'scripts/gridex-aud-003-clean-replay.sh', 'scripts/migration-history-manifest.json',
    'scripts/migration-history-manifest.additions.json', 'scripts/migration-history-manifest.runtime.additions.json',
    'scripts/supabase-types-manifest.json', 'scripts/apply-supabase-types-nullability-overrides.cjs',
    'scripts/gridex-schema-snapshot.cjs', 'supabase/config.toml',
}
composition = witness['composition_source_witness']
for section in ['staff_and_fixture_source_sha256', 'main_added_migrations_sha256']:
    for path, expected in composition[section].items():
        assert digest((ROOT / path).read_bytes()) == expected, path
for name in RAW:
    assert digest((ROOT / 'supabase' / name).read_bytes()) == witness['old_raw3_sha256'][name], name
run = json.loads(args.run_metadata.read_text())
assert run['id'] == RUN and run['head_sha'] == HEAD
assert run['status'] == 'completed' and run['conclusion'] == 'success'
assert run['event'] == 'pull_request' and run['head_branch'] == 'codex/support-portal-ops'
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
    assert len(members) == 4 and {m.filename for m in members} == set(RAW + ['capture-receipt.json'])
    assert all(m.file_size < 32 * 1024 * 1024 for m in members)
    assert all((m.external_attr >> 16) & 0o170000 != 0o120000 for m in members)
    assert archive.testzip() is None
    data = {m.filename: archive.read(m.filename) for m in members}
receipt = json.loads(data['capture-receipt.json'])
assert receipt['purpose'] == 'capture_only'
assert receipt['checkout_sha'] == HEAD and receipt['checkout_tree'] == TREE
assert int(receipt['workflow_run_id']) == RUN
assert receipt['latest_replay_migration'] == witness['latest_migration']
assert receipt['supabase_cli_version'] == '2.101.0'
assert receipt['postgres_server_version'].startswith('17.')
assert 'PostgreSQL) 17.' in receipt['pg_dump_version']
assert receipt['input_sha256'] == witness['input_sha256']
for path, expected in receipt['input_sha256'].items():
    assert digest((ROOT / path).read_bytes()) == expected, path
for name in RAW:
    assert digest(data[name]) == receipt['artifact_sha256'][name], name
for field in ['native_tests', 'browser_tests', 'type_schema_comparison', 'upgrade_parity']:
    assert receipt[field] == 'NOT_RUN'
comparison = composition['comparison_only_expected_raw2_sha256']
for name, expected in comparison.items():
    assert digest(data[name]) == expected, 'Actual producer differs from comparison-only Git merge: ' + name
new_fp = json.loads(data['schema.fingerprint.json'])
old_fp = json.loads((ROOT / 'supabase/schema.fingerprint.json').read_text())
main_fp = json.loads(subprocess.check_output(['git', 'show', witness['main_head'] + ':supabase/schema.fingerprint.json'], cwd=ROOT))
assert new_fp['schemas'] == receipt['schema_names'] == sorted(set(old_fp['schemas']) | set(main_fp['schemas']))
assert set(new_fp['sections']) == set(old_fp['sections']) == set(main_fp['sections'])
canonical = json.dumps(new_fp['sections'], sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
assert digest(canonical) == new_fp['sha256'] == receipt['schema_fingerprint']
extracted = pathlib.Path('/tmp/gridex-main-f88-union-capture-cff')
extracted.mkdir(exist_ok=True)
for name, raw in data.items():
    target = extracted / name
    assert not target.exists() or target.read_bytes() == raw
    target.write_bytes(raw)
result = {
    'status': 'PASS_AUTHENTIC_COMPOSED1076_CAPTURE_IMPORT_NOT_APPLIED',
    'source_head': HEAD, 'source_tree': TREE, 'workflow_run': RUN,
    'artifact_id': artifact['id'], 'zip_path': str(args.zip_path), 'zip_sha256': zip_sha,
    'safe_members_crc_verified': True, 'extraction_path': str(extracted),
    'producer_input8_sha256': receipt['input_sha256'], 'actual_raw3_sha256': receipt['artifact_sha256'],
    'comparison_only_auto_merged_raw2_match': True,
    'types_unchanged_from_dc2': data['database.types.ts'] == (ROOT / 'supabase/database.types.ts').read_bytes(),
    'canonical_fingerprint': new_fp['sha256'], 'schema_names': new_fp['schemas'],
    'fingerprint_changed_sections_from_dc2': [k for k in new_fp['sections'] if new_fp['sections'][k] != old_fp['sections'][k]],
    'all_historical_manifests_retained': True, 'hosted_writes': 0,
    'qualification_limits': ['Capture-only; native/browser/comparison/upgrade NOT_RUN remain unchanged.', 'Only actual authenticated producer bytes may be imported; fresh exact-final-head native and required CI remain mandatory.'],
}
if args.apply:
    manifest_path = ROOT / 'scripts/supabase-types-manifest.json'
    previous = manifest_path.read_bytes()
    old = json.loads(previous)
    assert old['composition_capture_pending'] is True
    preimport_path = EVIDENCE / 'preimport-complete-types-manifest-cff.json'
    assert not preimport_path.exists() or preimport_path.read_bytes() == previous
    new = copy.deepcopy(old)
    new['main_f88_prior_capture_state'] = {k: copy.deepcopy(old.get(k)) for k in ['capture', 'capture_artifact', 'composition_note', 'composition_capture_pending_scope', 'current_prefix_verification']}
    new['generated_at'] = receipt['captured_at']
    new['generated_with'] = f"supabase-cli-{receipt['supabase_cli_version']}-local-native-clean-replay-capture-run{RUN}"
    new['sha256'] = receipt['artifact_sha256']['database.types.ts']
    new['latest_migration'] = witness['latest_migration']['name']
    new['latest_migration_schema_effect'] = 'Authentic PostgreSQL17 capture of the1076-file immutable main f88 plus independent-tenant Staff union. Raw3 copied byte-for-byte from the authenticated producer; complete prior source/capture manifests remain history. Native final-head acceptance is separate.'
    new['composition_capture_pending'] = False
    new['composition_note'] = 'The active raw3 are authentic outputs from exact cff main-f88/Staff union capture. Complete previous dc2 and main-f88 manifests and the preimport manifest retain their original provenance. Fresh final-source required CI and native clean/ancestor upgrade/parity remain mandatory.'
    new['composition_capture_pending_scope'] = f'Completed capture-only run{RUN} of exact{HEAD}/tree{TREE}, latest f103; actual raw3 imported from artifact{artifact["id"]}. Native/browser/comparison/upgrade were NOT_RUN in this producer and are not relabeled as acceptance.'
    new['main_f88_composition_history']['capture_status'] = 'COMPLETED_AUTHENTIC_CAPTURE_ONLY'
    new['preimport_main_f88_complete_manifest_preserved'] = {'path': str(preimport_path.relative_to(ROOT)), 'sha256': digest(previous)}
    prefix = new['current_prefix_verification']
    source_migrations = {i['name']: i for i in prefix['source_migrations']}
    for path, expected in composition['main_added_migrations_sha256'].items():
        name = pathlib.Path(path).name
        assert name not in source_migrations
        source_migrations[name] = {'name': name, 'sha256': expected}
    prefix['source_migrations'] = sorted(source_migrations.values(), key=lambda i: i['name'])
    assert all(digest((ROOT / 'supabase/migrations' / i['name']).read_bytes()) == i['sha256'] for i in prefix['source_migrations'])
    receipt_relative = str((EVIDENCE / 'authentic-capture-receipt-cff.json').relative_to(ROOT))
    new['capture'] = copy.deepcopy(receipt)
    new['capture'].update({'artifact_id': artifact['id'], 'artifact_zip_sha256': zip_sha, 'published_artifact_digest': artifact['digest'], 'artifact_expires_at': artifact['expires_at'], 'actual_checkout_commit': HEAD, 'actual_checkout_tree': TREE, 'receipt': receipt_relative, 'input_hash_scope': 'All eight inputs bind exact pre-import cff union source; later genuine generated/provenance import has its own final CI qualification.'})
    new['capture_artifact'] = {'workflow_run': RUN, 'artifact_id': artifact['id'], 'zip_sha256': zip_sha, 'source_head': HEAD, 'source_tree': TREE, 'purpose': 'capture_only', 'receipt': receipt_relative}
    preimport_path.write_bytes(previous)
    for name in RAW:
        (ROOT / 'supabase' / name).write_bytes(data[name])
    manifest_path.write_text(json.dumps(new, indent=2) + '\n')
    (EVIDENCE / 'authentic-capture-receipt-cff.json').write_bytes(data['capture-receipt.json'])
    result['status'] = 'PASS_AUTHENTIC_COMPOSED1076_RAW3_IMPORT_FINAL_CI_PENDING'
    result['imported_raw3_sha256'] = {name: digest((ROOT / 'supabase' / name).read_bytes()) for name in RAW}
output = TEMP / ('main-f88-union-capture-import-applied.json' if args.apply else 'main-f88-union-capture-verification.json')
output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': result['status'], 'receipt_path': str(output), 'receipt_sha256': digest(output.read_bytes()), 'canonical_fingerprint': new_fp['sha256']}))
