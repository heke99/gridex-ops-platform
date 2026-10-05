import hashlib, json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[4]
old_path = Path(__file__).with_name('historical-mainf86-source-carry.json')
old = json.loads(old_path.read_text())
main = subprocess.check_output(['git', 'rev-parse', sys.argv[1] if len(sys.argv)>1 else 'a8c991c1672d97cb03486a15ca34a16d1b2814e3'], cwd=root, text=True).strip()
def blob(ref, path):
    return subprocess.check_output(['git', 'show', ref + ':' + path], cwd=root)
def sha(data):
    return hashlib.sha256(data).hexdigest()
def current(path):
    return (root / path).read_bytes()

packet = []
for item in old['packet_eight_hashes_exact']:
    path = item['path']
    data = current(path)
    if path == 'scripts/test-ediel-ten-07-scoped-projection.cjs':
        original = blob(old['head'], path)
        assert data.split(b'\n', 1)[1] == original.split(b'\n', 1)[1]
        old_tags = set(re.findall(rb'(?:AT-)?(?:TR|TEN|ESCO|SC)-\d+', original.split(b'\n', 1)[0]))
        main_tags = set(re.findall(rb'(?:AT-)?(?:TR|TEN|ESCO|SC)-\d+', blob(main, path).split(b'\n', 1)[0]))
        actual_tags = set(re.findall(rb'(?:AT-)?(?:TR|TEN|ESCO|SC)-\d+', data.split(b'\n', 1)[0]))
        assert actual_tags == old_tags | main_tags
        scope = 'Only first metadata line is exact original-plus-main tag union; all asserting bytes exact original ccf.'
    else:
        assert sha(data) == item['sha256'], path
        scope = 'Byte-exact original approved asserting packet.'
    packet.append({'path': path, 'sha256': sha(data), 'qualification': scope})

source = []
for item in old['28_existing_native_effect_sources_exact_current_main']:
    path = item['path']
    data = current(path)
    assert data == blob(main, path), path + ' current main adoption'
    same = sha(data) == item['sha256']
    if not same:
        assert path == 'lib/ediel/services/authorization.ts', path
        original = blob(old['current_main'], path).decode()
        expected = original.replace("import { supabaseService } from '@/lib/supabase/service'\n", "import { supabaseService } from '@/lib/supabase/service'\nimport { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'\n")
        expected = expected.replace("throw new Error('ediel_tenant_actor_forbidden')", "throw new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_TENANT_ACTOR_FORBIDDEN'},'ediel_tenant_actor_forbidden')")
        expected = expected.replace("throw new Error('ediel_tenant_permission_forbidden')", "throw new EdielExecutionFailure({kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'},'ediel_tenant_permission_forbidden')")
        assert data.decode() == expected
    source.append({'path':path,'sha256':sha(data),'exact_historical':same,'exact_main':True})

schema = current('supabase/schema.sql').decode()
sql = []
for item in old['current7_selected_sql_body_hashes_exact']:
    name = item['name']
    found = list(re.finditer(r'^CREATE FUNCTION '+re.escape(name)+r'\(',schema,re.M))
    assert len(found) == 1, name
    after = schema[found[0].start():]
    match = re.search(r'\bAS (\$\w*\$)(.*?)\1;', after, re.S)
    assert match, name
    digest = sha(match.group(2).strip().encode())
    assert digest == item['body_sha256'], name
    sql.append({'name':name,'trimmed_body_sha256':digest,'exact_historical_effect_owner':True})

own_existing = {
 '__tests__/ediel-service-administration.test.ts',
 'quality/audits/ediel-masterplan-v2/coverage.json',
 'quality/audits/ediel-masterplan-v2/sc004-sc006/checkpoint.md',
 'quality/audits/ediel-masterplan-v2/sc004-sc006/independent-review.md',
 'quality/audits/ediel-masterplan-v2/sc004-sc006/verification-receipt.json',
 'scripts/ediel-ten-07-scoped-projection-sql-regression.mjs',
 'scripts/test-ediel-ten-07-scoped-projection.cjs',
}
paths = subprocess.check_output(['git','ls-tree','-r','--name-only',main],cwd=root,text=True).splitlines()
foreign_exact = 0
for path in paths:
    if path not in own_existing:
        assert current(path) == blob(main,path), path + ' foreign path mismatch'
        foreign_exact += 1

coverage_path = 'quality/audits/ediel-masterplan-v2/coverage.json'
mc = json.loads(blob(main,coverage_path))
cc = json.loads(current(coverage_path))
changed = []
for kind in ['rules','acceptance_contracts']:
    assert len(mc[kind]) == len(cc[kind])
    for before,after in zip(mc[kind],cc[kind]):
        assert before['id'] == after['id']
        if before != after:
            assert after['id'] in ['SC-004','SC-006']
            assert after['status'] == 'PASSED'
            assert set(before['evidence']).issubset(after['evidence'])
            changed.append(after['id'])
assert changed == ['SC-004','SC-006'], changed
assert {k:v for k,v in mc.items() if k not in ['rules','acceptance_contracts']} == {k:v for k,v in cc.items() if k not in ['rules','acceptance_contracts']}

migrations = subprocess.check_output(['git','diff','--name-status',old['current_main'],main,'--','supabase/migrations'],cwd=root,text=True).splitlines()
assert all(line.startswith('A\t') for line in migrations)
assert [line.split('\t')[1] for line in migrations] == [
 'supabase/migrations/20261005004623_customer_contact_version_conflict_http409.sql',
 'supabase/migrations/20261005010327_customer_identity_version_conflict_http409.sql',
 'supabase/migrations/20261005020000_ediel_production_contract_ack_confirmation.sql',
]
record = {
 'scope':'SC004/SC006 minimum current-main source carry; independent approval pending',
 'created_at':datetime.now(timezone.utc).isoformat(),
 'main':main,
 'unpublished_prior_main_adoptions':['76d22f0993b2f7204c184dd7324b055323508d10','2d03e646860a208e8f519623ec7473dd904b7290'],
 'historical_carry_sha256':sha(old_path.read_bytes()),
 'historical_capture_scope':'Original run37219122360/artifact11310821113, actual shared-permission testcase391; original ZIP/JUnit remain original-source evidence. No new native run or new source origination is inferred.',
 'asserting_packet':packet,
 'selected_sources':source,
 'selected_sql_bodies':sql,
 'foreign_main_paths_byte_exact':foreign_exact,
 'coverage_only_changed_ids':changed,
 'main_approved_ids':sum(row['status'] in ['VERIFIED','PASSED'] for k in ['rules','acceptance_contracts'] for row in mc[k]),
 'candidate_approved_ids':sum(row['status'] in ['VERIFIED','PASSED'] for k in ['rules','acceptance_contracts'] for row in cc[k]),
 'new_migrations_since_f86':[{'path':line.split('\t')[1],'sha256':sha(current(line.split('\t')[1]))} for line in migrations],
 'denial_delta':'Current main changes only two Error constructions to EdielExecutionFailure subclasses with unchanged messages and unchanged membership/actor/permission queries and predicates. They still throw before end_assignment coordinator/write. EdielExecutionFailure constructor only calls super and names/stores disposition; no writes/transport. Projection path does not import this actor helper.',
 'other_reached_boundaries':'Native test, source fixture and utiltsConsumptionParties helper exact. RuntimeDecision OPS05 new branches are failure-only classification/held registry evidence, outside historical accepted given/read/end. P08 new trigger returns immediately except accepted own outbound PRODAT Z09; E66/beneficiary reader and internal end do not meet that predicate. Staff forward dynamic replacements target only customer contact/identity decision owners and preserve metadata. No new service coordinator/projection/identity trigger or writer added.',
 'limits':'No new whole schema, all-native, source request/Z13 generation, transport/legal/market or release approval. Fresh current mandatory CI and independent carry review remain required.',
}
out = root/'quality/audits/ediel-masterplan-v2/sc004-sc006/current-main-source-carry.json'
out.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'main':main,'asserting_inputs':len(packet),'selected_sources':len(source),'historical_source_equal':sum(x['exact_historical'] for x in source),'selected_sql_bodies_exact':len(sql),'foreign_main_paths_exact':foreign_exact,'coverage_changed':changed,'main_approved':record['main_approved_ids'],'candidate_approved':record['candidate_approved_ids'],'receipt_sha256':sha(out.read_bytes())}))
