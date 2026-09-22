"""E035 review native verification. Disposable localhost only; no ref writes."""
import datetime,hashlib,json,os,pathlib,re,shutil,subprocess
ROOT=pathlib.Path.cwd();OUT=pathlib.Path(os.environ['E035_OUTPUT_DIR']);OUT.mkdir(parents=True,exist_ok=True)
URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
PSQL=['psql',URL,'-X','-v','ON_ERROR_STOP=1']
def run(args,**kw):
 print('+',' '.join(map(str,args)),flush=True)
 return subprocess.run(list(map(str,args)),check=True,timeout=kw.pop('timeout',1200),**kw)
def logged(name,args):
 with (OUT/name).open('w') as f:
  p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT,timeout=1200)
 return p.returncode,(OUT/name).read_text()
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
old=ROOT/'supabase/migrations/20260922095911_ediel_received_source_ledger.sql'
# During sourced replay the working-tree migration files are ledger markers.
# Use immutable committed bytes and the checksum-pinned manifest, not markers.
old_bytes=subprocess.check_output(['git','show','a89275ba0b34ae27530c2e403d3ae3f2667afe3b:supabase/migrations/'+old.name])
assert hashlib.sha256(old_bytes).hexdigest()=='a3a4933935995dd6525d09d70949f360aa52bcf72e5ab8d93970fdcdea4aae39'
code,text=logged('shape-before-forward.log',PSQL+['-f','scripts/ediel-source-discovery-shape-regression.sql'])
assert code!=0 and 'E035_DISCOVERY_SHAPE_FAILURE' in text,'Actual old function must fail the new behavioral regression'
assert re.search(r'reject/reviewer-minimal-occurrence-and-object\s*\|\s*f\s*\|\s*stored receipt',text),'Original counterexample must actually persist'
assert re.search(r'retained/null-payload-enumerated-rejected-by-original-binding\s*\|\s*t\s*\|',text),'Do not misclassify already rejected null source as an old exploit'
print('Actual SQL counterexample reproduced; real null-payload binding already rejects.',flush=True)
# The corrected two existing fixture assertions must expose removal of the
# row receipt boundary instead of being masked by a context contradiction.
module=ROOT/'lib/ediel/utilts/receivedSourceInventory.ts';original=module.read_bytes()
args=['npx','vitest','run','__tests__/ediel-durable-source-inventory.test.ts','-t','whole-response boundary withholds earlier good identifiers on (future receipt|invalid receipt date)$']
code,_=logged('receipt-fixture-baseline.log',args);assert code==0
try:
 source=original.decode();needle='\n    || (value.sourceReceivedAt !== null && (received === null || received > cutoff))'
 assert source.count(needle)==1
 module.write_text(source.replace(needle,''))
 code,text=logged('receipt-boundary-mutant.log',args)
 assert code!=0 and 'AssertionError' in text and re.search(r'2 failed',text),'Both improved fixtures must kill the boundary-removal mutant'
finally:module.write_bytes(original)
code,_=logged('receipt-fixture-restored.log',args);assert code==0
for args in [['supabase','--version'],['supabase','migration','new','--help'],['supabase','migration','up','--help'],['supabase','gen','types','--help']]:run(args)
before=set((ROOT/'supabase/migrations').glob('*.sql'))
run(['supabase','migration','new','ediel_received_discovery_shape'])
created=set((ROOT/'supabase/migrations').glob('*.sql'))-before;assert len(created)==1
migration=created.pop();sql=old_bytes.decode();sql=sql[sql.index('CREATE FUNCTION gridex_received_sources.append_discovery('):sql.index('CREATE FUNCTION gridex_received_sources.append_validation(')]
sql=sql.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
needle='v_id uuid; v_hash text; n bigint; distinct_n bigint;';assert sql.count(needle)==1
sql=sql.replace(needle,needle+'\n  v_position bigint; v_segment numeric; v_expected_objects jsonb;')
needle="OR (src->>'status'='enumerated' AND (jsonb_array_length(src->'occurrences')=0";assert sql.count(needle)==1
sql=sql.replace(needle,"OR (src->>'status'='enumerated' AND (jsonb_typeof(src->'sourcePayloadHash') IS DISTINCT FROM 'string'\n        OR coalesce(src->>'sourcePayloadHash','') !~ '^[a-f0-9]{64}$' OR jsonb_array_length(src->'occurrences')=0")
start=sql.index('    -- Shape allowlists stop accidental raw bodies');end=sql.index("    IF EXISTS (SELECT FROM jsonb_array_elements(src->'issues')",start)
sql=sql[:start]+(ROOT/'.e035-review-input/discovery-shape-guard.sql.fragment').read_text()+sql[end:]
migration.write_text('-- E035 PR370 review hardening. No original migration or grant is rewritten.\n-- Validate observation shape and tuple bindings; never confer source approval.\nBEGIN;\n\n'+sql+'COMMIT;\n')
shutil.copy2(migration,OUT/migration.name)
run(['supabase','migration','up','--local'])
code,text=logged('shape-after-forward.log',PSQL+['-f','scripts/ediel-source-discovery-shape-regression.sql']);assert code==0,text[-5000:]
match=re.search(r'E035_DISCOVERY_SHAPE: (\d+) total, 0 failed',text);assert match
shape_count=int(match.group(1));print('New actual shape assertions PASS:',shape_count,flush=True)
# No skip, disabled role, altered ACL or old assertion. Existing tests rerun.
for f in ['scripts/manual-inbound-tenant-graph-regression.sql','scripts/gridex-canonical-provision-request-hash-regression.sql','scripts/pr164-review-remediation-regression.sql']:run(PSQL+['-f',f])
run(['supabase','db','lint','--local','--schema','gridex_received_sources','--level','warning','--fail-on','error'])
for n in [1,2]:
 with (OUT/f'types-{n}.ts').open('w') as f:run(['supabase','gen','types','typescript','--local'],stdout=f)
 run(['node','scripts/apply-supabase-types-nullability-overrides.cjs',OUT/f'types-{n}.ts'])
 run(['node','scripts/gridex-schema-snapshot.cjs','--url',URL,'--out-dir',OUT/f'schema-{n}'])
assert (OUT/'types-1.ts').read_bytes()==(OUT/'types-2.ts').read_bytes()==(ROOT/'supabase/database.types.ts').read_bytes()
for f in ['schema.sql','schema.fingerprint.json']:assert (OUT/'schema-1'/f).read_bytes()==(OUT/'schema-2'/f).read_bytes()
old_fp=json.loads((ROOT/'supabase/schema.fingerprint.json').read_text());new_fp=json.loads((OUT/'schema-1/schema.fingerprint.json').read_text())
assert old_fp['schemas']==new_fp['schemas']
changed=[k for k in old_fp['sections'] if old_fp['sections'][k]!=new_fp['sections'][k]];assert changed==['functions'],changed
assert old_fp['sections']['functions']['count']==new_fp['sections']['functions']['count']
run(['npm','run','tenant:invariants'],env={**os.environ,'DATABASE_URL':URL});run(['npm','run','db:parity:selftest','--',URL])
d=OUT/'delivery';d.mkdir(exist_ok=True)
paths=['__tests__/ediel-durable-source-inventory.test.ts','scripts/ediel-source-discovery-shape-regression.sql']
for rel in paths:
 p=d/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/rel,p)
# This adds the new regression to the existing ordinary replay, retaining all
# prior SQL includes exactly. The original E035 migration remains immutable.
p=d/'scripts/manual-inbound-tenant-graph-regression.sql';p.write_text((ROOT/'scripts/manual-inbound-tenant-graph-regression.sql').read_text()+'\n-- PR370 review: mandatory typed physical discovery evidence.\n\\ir ediel-source-discovery-shape-regression.sql\n')
for rel,src in [(f'supabase/migrations/{migration.name}',OUT/migration.name),('supabase/schema.sql',OUT/'schema-1/schema.sql'),('supabase/schema.fingerprint.json',OUT/'schema-1/schema.fingerprint.json')]:
 p=d/rel;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,p)
h=json.loads((ROOT/'scripts/migration-history-manifest.runtime.additions.json').read_text());h['files'][migration.name]=sha(migration)
(d/'scripts/migration-history-manifest.runtime.additions.json').write_text(json.dumps(h,indent=2)+'\n')
m=json.loads((ROOT/'scripts/supabase-types-manifest.json').read_text());m.update(generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),generated_with='supabase-cli-2.101.0-repeated-isolated-clean-replay',latest_migration=migration.name,latest_migration_schema_effect='E035 reviewed discovery observation-shape hardening only; actual repeated type output is byte-identical, only the existing private append_discovery function body changes.')
(d/'scripts/supabase-types-manifest.json').write_text(json.dumps(m,indent=2)+'\n')
receipt={'status':'NATIVE_REVIEW_FIX_VERIFIED_NOT_FINAL_CI_OR_APPROVAL','reviewed_head':'a89275ba0b34ae27530c2e403d3ae3f2667afe3b','run':os.environ['GITHUB_RUN_ID'],'scratch_head':os.environ['GITHUB_SHA'],'migration':migration.name,'migration_sha256':sha(migration),'shape_assertions':shape_count,'old_counterexample':'minimal occurrence/object persisted under original function; now rejected before insert','null_payload':'already rejected by original receipt binding; explicit hash requirement is additional invariant','receipt_fixture_mutation':'2 assertion failures when row receipt boundary removed; baseline and restored pass','types_sha256':sha(OUT/'types-1.ts'),'schema_sha256':sha(OUT/'schema-1/schema.sql'),'schema_changed_sections':changed,'full_source_approval':'NOT_ESTABLISHED','pr310':'UNTOUCHED','hosted_database_changes':False}
p=d/'quality/audits/ediel-masterplan-v2/e035-source-ledger/review-fix-native-receipt.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(receipt,indent=2)+'\n')
paths=sorted(str(p.relative_to(d)) for p in d.rglob('*') if p.is_file());(OUT/'delivery-files.json').write_text(json.dumps(paths,indent=2)+'\n')
print('Actual generated delivery files:',len(paths),flush=True)
