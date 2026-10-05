"""Bounded source/effect and ledger carry; no native or external custody claim."""
import hashlib, json, pathlib, re, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[4]
MAIN = 'cfcee6877f57c4ff52265cafc6a8a1fa5692a714'
PRIOR = '0befb0046906b7109d9366655be328831e3139bc'
OLD = 'f2081c55c86061ec3feb1cff0f93789da89f84cc'
QUALIFICATION = ROOT / 'quality/audits/ediel-masterplan-v2/sc015-sc016/source-manifest.json'
sha = lambda value: hashlib.sha256(value).hexdigest()
def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])
def blob(ref, path):
    return git('show', ref + ':' + path)
def rows(data):
    return {r['id']: r for key in ['rules', 'acceptance_contracts'] for r in data[key]}
main_ledger = json.loads(blob(MAIN, 'quality/audits/ediel-masterplan-v2/coverage.json'))
current_ledger = json.loads((ROOT / 'quality/audits/ediel-masterplan-v2/coverage.json').read_bytes())
main_rows, current_rows = rows(main_ledger), rows(current_ledger)
assert len(main_rows) == len(current_rows) == 352
delta = sorted(k for k in main_rows if main_rows[k] != current_rows[k])
assert delta == ['SC-015', 'SC-016'], delta
assert all(current_rows[k]['status'] == 'PASSED' for k in delta)
assert {k:v for k,v in main_ledger.items() if k not in ['rules','acceptance_contracts']} == {k:v for k,v in current_ledger.items() if k not in ['rules','acceptance_contracts']}
old_line = " const auth=functionConsumers('lib/ediel/services/authorization.ts',['assertEdielTenantActor'],{supabaseService:sdk}).assertEdielTenantActor"
new_block = " const auth=moduleConsumers('lib/ediel/services/authorization.ts',{\n  '@/lib/supabase/service':{supabaseService:sdk},\n  '@/lib/ediel/core/failureDisposition':moduleConsumers('lib/ediel/core/failureDisposition.ts',{}),\n }).assertEdielTenantActor"
probe_path = 'scripts/ediel-sc-016-approved-object-sql-regression.mjs'
prior_probe = blob(PRIOR, probe_path).decode()
current_probe = (ROOT / probe_path).read_text()
assert prior_probe.count(old_line) == current_probe.count(new_block) == 1
assert current_probe.replace(new_block, old_line) == prior_probe
current_paths = {p for p in git('ls-tree','-r','--name-only',MAIN).decode().splitlines()}
exact = []
for path in sorted(current_paths):
    if path == 'quality/audits/ediel-masterplan-v2/coverage.json': continue
    assert (ROOT / path).read_bytes() == blob(MAIN, path), path
    exact.append(path)
receipt = json.loads(QUALIFICATION.read_bytes())
inputs = []
for item in receipt['inputs']:
    path = item['path']
    data = (ROOT / path).read_bytes()
    inputs.append({'path':path,'currentSha256':sha(data),'equalOriginal':sha(data)==item['sha256']})
old_schema = blob(OLD, 'supabase/schema.sql').decode()
current_schema = (ROOT / 'supabase/schema.sql').read_text()
sql_names = sorted(set(re.findall(r'(?:public|gridex_[a-z_]+)\.[a-z_]+_v[12]', old_schema)))
# Scope selected owners/dependencies from the previously qualified execution.
owners = ['public.ediel_coordinate_service_permission_v1','public.ediel_resolve_service_permission_command_v1','gridex_service_permission.current_request_timing_v1','gridex_service_permission.lock_request_writer_v1','gridex_service_administration.require_manual_actor_v1','gridex_service_permission.resolve_before_request_timing_v1','gridex_service_administration.coordinate_before_source_timing_v1','public.ediel_apply_permission_source_v1','public.ediel_permission_source_is_current_v1','public.ediel_service_administration_command_v1','gridex_service_administration.permission_matches_assignment_v1','gridex_received_sources.apply_permission_group_v1','gridex_received_sources.permission_partition_wire_v1','gridex_received_sources.committed_permission_effects_v1','gridex_received_sources.wire_tokens_bounded_v1','gridex_received_sources.closure_wire_tokens_v2','gridex_received_sources.permission_time_v1','gridex_received_sources.permission_date_v1','gridex_received_sources.validate_prodat_application_v1','gridex_ediel_services.lock_evidence_graph_v1','gridex_ediel_services.assignment_assessment_basis_v1','public.ediel_service_assignment_assessment_v1','gridex_ediel_services.review_current_v1','public.ediel_archive_service_evidence_v1','public.ediel_review_service_evidence_v1']
bodies = []
for name in owners:
    pattern = r'CREATE(?: OR REPLACE)? FUNCTION '+re.escape(name)+r'\(.*?\bAS (\$[^$]*\$)(.*?)\1;'
    before = [m.group(2).encode() for m in re.finditer(pattern,old_schema,re.S|re.I)]
    after = [m.group(2).encode() for m in re.finditer(pattern,current_schema,re.S|re.I)]
    assert len(before) == len(after) == 1, name
    assert before == after, name
    bodies.append({'name':name,'bodySha256':sha(after[0]),'byteEqualOriginal':True})
print(json.dumps({'scope':'Bounded whole-card code-effect carry at declared finite ports; historical native provenance retained only at original source; no current full-schema/native/market claim','main':MAIN,'priorHead':PRIOR,'priorWholeReviewHead':OLD,'foreignMainPathsExact':len(exact),'foreignLedgerRowsExact':350,'onlyLedgerDelta':delta,'assertionsAndSqlScriptBodyByteExactAfterDependencyBindingNormalization':True,'technicalInputs':inputs,'selectedCurrentSqlBodies':bodies,'allGlobalGeneratedArtifactsAndCapturesExactMain':True},indent=2))
