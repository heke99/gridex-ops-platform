#!/usr/bin/env python3
"""Temporary, unmerged PR367 generation/transport; never updates Git refs."""
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path.cwd()
OUT = ROOT / 'pr367-generation'
BASE = '9496c01c45925d5754cef21d9f8e85846e5d12cd'
REPO = 'heke99/gridex-ops-platform'
BRANCH = 'codex/ediel-pr367-schema-preparation-20260921'
EXPECTED = {
 'lib/inbound-mail/inboundStatusUpdater.ts': '7ae96dff37e7bef49a66563d36eea2b6f6778454',
 'lib/inbound-mail/edielInboundProcessor.ts': '115617fd67692c6711c001654cbf4e2abd91a1db',
 'supabase/schema.sql': '2041c4d932df2a0ced686774d841f333168bfb3f',
 'supabase/database.types.ts': '35c34d178032e8a5b3485761f77ce027f4605e53',
 'scripts/supabase-types-manifest.json': '9c16bea7e35f0384d32ba83959f69e4cffa4cb7b',
 'scripts/migration-history-manifest.runtime.additions.json': '54cd7ac592dc24811a2ed2f9c3f0da22e75d4e4b',
 'supabase/schema.fingerprint.json': 'bde92ef0d164b2590cfb079bf23c29ede9c60e53',
}
INSERT = """  -- Seal only newly received EDIFACT PRODAT source bytes; never backfill UPDATEs.
  -- Null is no source. Empty text is a source. Ignore a caller-supplied hash.
  if tg_op='INSERT' and new.direction='inbound'
     and upper(coalesce(new.message_family,''))='PRODAT'
     and new.message_standard='edifact' then
    new.immutable_payload_hash := case when new.raw_payload is null then null
      else encode(digest(convert_to(new.raw_payload,'UTF8'),'sha256'),'hex') end;
  end if;
"""
FUNCTION = re.compile(r'CREATE FUNCTION public\.gridex_validate_ediel_message_contract\(\) RETURNS trigger\n.*?end \$\$;', re.S)


def sha(data): return hashlib.sha256(data).hexdigest()
def blob(data): return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
def command(*args): return subprocess.check_output(args, text=True).strip()
def base_bytes(path): return subprocess.check_output(['git', 'show', BASE + ':' + path])
def replace_one(text, old, new):
    assert text.count(old) == 1, ('ambiguous patch', old[:90], text.count(old))
    return text.replace(old, new, 1)
def save_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')
def checked_environment():
    assert os.environ['GITHUB_REPOSITORY'] == REPO
    assert os.environ['GITHUB_REF'] == 'refs/heads/' + BRANCH
    assert command('git', 'rev-parse', 'HEAD^') == BASE
    for path, expected in EXPECTED.items():
        assert blob(base_bytes(path)) == expected, ('base blob mismatch', path)


def prepare():
    checked_environment()
    OUT.mkdir(exist_ok=True)
    assert command('git', 'status', '--porcelain') == '', 'non-clean preparation checkout'
    for path, expected in EXPECTED.items():
        assert blob(Path(path).read_bytes()) == expected, ('working blob mismatch', path)
    schema = Path('supabase/schema.sql').read_text()
    matches = FUNCTION.findall(schema)
    assert len(matches) == 1
    old_function = matches[0]
    new_function = replace_one(old_function, "  if tg_op='UPDATE' and old.immutable_payload_hash is not null then", INSERT + "  if tg_op='UPDATE' and old.immutable_payload_hash is not null then")
    before = set(Path('supabase/migrations').glob('*.sql'))
    subprocess.run(['supabase', 'migration', 'new', 'ediel_inbound_prodat_source_seal'], check=True)
    new_files = set(Path('supabase/migrations').glob('*.sql')) - before
    assert len(new_files) == 1
    migration = new_files.pop()
    assert re.fullmatch(r'\d{14}_ediel_inbound_prodat_source_seal.sql', migration.name)
    sql = '-- PR367: insertion-scoped received-source seal; existing guard and privileges retained.\nBEGIN;\n' + new_function.replace('CREATE FUNCTION ', 'CREATE OR REPLACE FUNCTION ', 1) + '\nCOMMIT;\n'
    migration.write_text(sql)
    runtime_path = Path('scripts/migration-history-manifest.runtime.additions.json')
    runtime = json.loads(runtime_path.read_text())
    assert migration.name not in runtime['files']
    runtime['files'][migration.name] = sha(migration.read_bytes())
    save_json(runtime_path, runtime)

    path = Path('lib/inbound-mail/inboundStatusUpdater.ts')
    text = path.read_text()
    text = replace_one(text,
      "  if (result.error) {\n    if (isPostgresUniqueViolation(result.error)) {",
      "  if (result.error) {\n    if (\n      input.parsed.messageFamily === 'PRODAT' &&\n      result.error.code === '23514' &&\n      result.error.message === 'immutable_ediel_payload_cannot_change'\n    ) {\n      throw new Error('INBOUND_PRODAT_SOURCE_CONFLICT', { cause: result.error })\n    }\n    if (isPostgresUniqueViolation(result.error)) {")
    text = replace_one(text,
      'export async function applySafeInboundStatusUpdate(input: {\n  companyId: string\n',
      'export async function applySafeInboundStatusUpdate(input: {\n  companyId: string\n  environment?: string | null\n')
    text = replace_one(text,
      '  const inboundEdielMessageId = await createInboundEdielMessage({\n    companyId: input.companyId,\n',
      '  const inboundEdielMessageId = await createInboundEdielMessage({\n    companyId: input.companyId,\n    environment: input.environment,\n')
    path.write_text(text)
    path = Path('lib/inbound-mail/edielInboundProcessor.ts')
    path.write_text(replace_one(path.read_text(),
      '    await applySafeInboundStatusUpdate({\n      companyId: tenant.companyId,\n',
      '    await applySafeInboundStatusUpdate({\n      companyId: tenant.companyId,\n      environment,\n'))
    # Retain the real CLI-named migration before the unmodified replay script
    # temporarily substitutes its official-ledger markers and later restores it.
    target = OUT / 'delivery' / migration
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(migration, target)
    (OUT / 'expected-schema.sql').write_text(replace_one(schema, old_function, new_function))
    (OUT / 'function-before.sql').write_text(old_function + '\n')
    (OUT / 'function-after.sql').write_text(new_function + '\n')
    save_json(OUT / 'state.json', {
      'base': BASE, 'base_tree': command('git', 'rev-parse', BASE + '^{tree}'),
      'preparation_sha': command('git', 'rev-parse', 'HEAD'),
      'run_id': os.environ['GITHUB_RUN_ID'], 'migration': str(migration),
      'migration_sha256': sha(sql.encode()),
      'supabase_cli': command('supabase', '--version'), 'node': command('node', '--version'),
      'pg_dump': command(os.environ['GRIDEX_PG_DUMP'], '--version'), 'expected_base_blobs': EXPECTED,
    })
    print('PREPARATION_PATCH_READY', str(migration), flush=True)


def finish():
    checked_environment()
    state = json.loads((OUT / 'state.json').read_text())
    types1 = (OUT / 'types-first.ts').read_bytes()
    types2 = (OUT / 'types-second.ts').read_bytes()
    assert types1 == types2 == base_bytes('supabase/database.types.ts'), 'generated type surface changed'
    schema1 = (OUT / 'schema-first/schema.sql').read_bytes()
    schema2 = (OUT / 'schema-second/schema.sql').read_bytes()
    assert schema1 == schema2 == (OUT / 'expected-schema.sql').read_bytes(), 'unexpected full schema delta'
    fingerprint1 = (OUT / 'schema-first/schema.fingerprint.json').read_bytes()
    assert fingerprint1 == (OUT / 'schema-second/schema.fingerprint.json').read_bytes(), 'unstable fingerprint'
    old = json.loads(base_bytes('supabase/schema.fingerprint.json'))
    new = json.loads(fingerprint1)
    assert old['algorithm'] == new['algorithm'] and old['schemas'] == new['schemas']
    assert set(old['sections']) == set(new['sections'])
    for name, section in old['sections'].items():
        assert section['count'] == new['sections'][name]['count'], ('object count change', name)
        if name != 'functions': assert section == new['sections'][name], ('unexpected section delta', name)
    assert old['sections']['functions']['sha256'] != new['sections']['functions']['sha256']
    Path('supabase/schema.sql').write_bytes(schema1)
    Path('supabase/schema.fingerprint.json').write_bytes(fingerprint1)
    manifest_path = Path('scripts/supabase-types-manifest.json')
    manifest = json.loads(manifest_path.read_text())
    manifest.update({
      'generated_at': dt.datetime.now(dt.timezone.utc).isoformat(),
      'generated_with': 'supabase-cli-' + state['supabase_cli'] + '-repeated-isolated-clean-replay',
      'sha256': sha(types1), 'latest_migration': Path(state['migration']).name,
      'latest_migration_schema_effect': 'PR367 existing trigger body only; two real type generations equal committed surface; exact schema delta and unchanged object counts, grants, RLS, triggers verified',
    })
    save_json(manifest_path, manifest)
    state.update({
      'generated_types_sha256': sha(types1), 'types_identical_to_base': True,
      'repeated_schema_identical': True, 'schema_only_expected_function_delta': True,
      'schema_sha256': sha(schema1), 'fingerprint_sha256': sha(fingerprint1),
      'fingerprint_only_functions_changed': True,
      'paths': [state['migration'], 'scripts/migration-history-manifest.runtime.additions.json',
        'scripts/supabase-types-manifest.json', 'supabase/schema.sql', 'supabase/schema.fingerprint.json',
        'lib/inbound-mail/inboundStatusUpdater.ts', 'lib/inbound-mail/edielInboundProcessor.ts'],
    })
    for path in state['paths']:
        if path == state['migration']: continue
        target = OUT / 'delivery' / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    save_json(OUT / 'state.json', state)
    print('GENUINE_GENERATION_VERIFIED', state['schema_sha256'], flush=True)


def transport():
    checked_environment()
    state = json.loads((OUT / 'state.json').read_text())
    changed = {line for line in command('git', 'diff', '--name-only', BASE, '--').splitlines() if line}
    # Preparation workflow/scripts exist in the scratch commit, not in BASE.
    assert changed == set(state['paths']) - {state['migration']} | {
      '.github/workflows/pr367-schema-preparation.yml', 'scripts/prepare-pr367-source-seal.py'
    }, ('unexpected changed paths', sorted(changed))
    entries = []
    for path in state['paths']:
        data = (OUT / 'delivery' / path).read_bytes()
        assert data == Path(path).read_bytes(), ('restored/generated bytes differ', path)
        # Fixed repository and endpoint; upload immutable blobs only, never refs.
        request = json.dumps({'content': base64.b64encode(data).decode(), 'encoding': 'base64'})
        response = subprocess.run(['gh','api','--method','POST',f'repos/{REPO}/git/blobs','--input','-'],
          input=request,text=True,check=True,capture_output=True)
        uploaded = json.loads(response.stdout)['sha']
        assert uploaded == blob(data), ('uploaded blob mismatch', path)
        entries.append({'path':path,'mode':'100644','type':'blob','sha':uploaded,'sha256':sha(data),'bytes':len(data)})
    state['delivery_blobs'] = entries
    state['writes'] = 'Immutable Git blobs only; no ref, commit, PR, merge or deployment operation.'
    save_json(OUT / 'generation-receipt.json', state)
    print(json.dumps({'delivery_blobs': entries}, indent=2), flush=True)


if __name__ == '__main__':
    {'prepare':prepare, 'finish':finish, 'transport':transport}[sys.argv[1]]()
