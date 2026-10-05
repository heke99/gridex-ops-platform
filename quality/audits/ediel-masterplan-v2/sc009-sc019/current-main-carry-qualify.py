import hashlib, json, re, subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[4]
base = '56192d16d1eac7fb0e716a3e2770bac8e58be115'
approved = '7bd40bd0179a5929b00875911a9744aace14470c'
main = '3dff03dd8bb8c251b1613d35ce6fc7e66e6ee686'
out = Path(__file__).parent
def blob(ref,path):
    return subprocess.check_output(['git','show',ref+':'+path],cwd=root)
def sha(data):
    return hashlib.sha256(data).hexdigest()
def current(path):
    return (root/path).read_bytes()
tests = ['__tests__/tenant-ediel-identity-completeness.test.ts','__tests__/billing-canonical-gate.test.ts','__tests__/ediel-beneficiary-projection-provenance.test.ts']
for path in tests:
    assert current(path) == blob(approved,path), path
paths = [
 'lib/actor-registry/parseActorRegistryXml.ts','lib/actor-registry/normalizeActor.ts','lib/actor-registry/types.ts',
 'lib/ediel/tenant/tenantEdielIdentity.ts','lib/ediel/tenant/tenantEdielIdentityEvidence.ts','lib/ediel/tenant/inboundRouteSemantics.ts','lib/ediel/tenant/resolveInboundTenant.ts',
 'lib/ediel/services/projection.ts','lib/ediel/services/types.ts','lib/ediel/services/authorization.ts',
 'lib/ediel/core/failureDisposition.ts','lib/billing/billingGate.ts','lib/billing/sourceBasis.ts','lib/billing/underlayEngine.ts',
 'lib/billing/consumptionEstimate.ts','lib/billing/historyRequest.ts','lib/pricing/types.ts','lib/time/stockholm.ts','lib/ediel/utilts/exactDecimal.ts',
 'scripts/ediel-service-evidence-native.test.ts','scripts/fixtures/ediel-service-evidence-native.ts','scripts/helpers/utiltsConsumptionParties.ts',
 'scripts/ediel-billing-source-sql-regression.mjs',
]
sources=[]
changed=[]
for path in paths:
    now=current(path)
    assert now==blob(main,path),path
    before=blob(base,path)
    exact=now==before
    if not exact:
        changed.append(path)
    sources.append({'path':path,'sha256':sha(now),'exact_main':True,'exact_approved_base':exact})
assert sorted(changed)==sorted(['lib/ediel/tenant/resolveInboundTenant.ts','lib/ediel/services/authorization.ts','lib/billing/underlayEngine.ts']),changed
underlay=blob(base,'lib/billing/underlayEngine.ts').replace(b'function estimatedItems(',b'export function estimatedItems(').replace(b'function estimatePayload(',b'export function estimatePayload(')
assert underlay==current('lib/billing/underlayEngine.ts')

def functions(data):
    text=data.decode()
    result={}
    pattern=re.compile(r'^CREATE FUNCTION ([a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*)\((.*?)\) RETURNS .*?\bAS (\$\w*\$)(.*?)\3;',re.M|re.S)
    for match in pattern.finditer(text):
        key=match.group(1)+'('+match.group(2)+')'
        assert key not in result,key
        result[key]=(match.group(1),match.group(4).strip())
    return result
old_fn=functions(blob(base,'supabase/schema.sql'))
new_fn=functions(current('supabase/schema.sql'))
names={
 'public.gridex_store_billing_underlay','public.gridex_store_billing_underlay_batch','public.gridex_read_billing_source_values_v1','public.gridex_read_billing_underlay_source_basis_v1',
 'gridex_received_sources.billing_supply_basis_v1',
 'public.ediel_beneficiary_series_page_v1','gridex_ediel_ack_replay.beneficiary_series_page_filtered_v2','gridex_ediel_ack_replay.require_current_source_role_v2','gridex_ediel_ack_replay.lock_current_graph_v2',
 'public.ediel_service_assignment_assessment_v1','gridex_ediel_services.assignment_assessment_basis_v1','gridex_ediel_services.evidence_basis_v1',
}
selected=[]
for key,(name,body) in new_fn.items():
    if name.startswith('gridex_billing_source.') or name in names:
        assert key in old_fn,key
        assert body==old_fn[key][1],key
        selected.append({'signature':key,'body_sha256':sha(body.encode()),'exact_original_qualified_base':True})
assert names.issubset({new_fn[key][0] for key in new_fn})
store=next(body for name,body in new_fn.values() if name=='public.gridex_store_billing_underlay')
assert store.index("'billing_underlay_supply_contract_price_basis_required'") < store.index('legal_basis:=gridex_received_sources.billing_supply_basis_v1') < store.index('basis:=gridex_billing_source.basis_v1')

own=set(tests+['.agent-memory/masterplan-sc009-sc019-checkpoint.md','quality/audits/ediel-masterplan-v2/coverage.json'])
foreign=0
for path in subprocess.check_output(['git','ls-tree','-r','--name-only',main],cwd=root,text=True).splitlines():
    if path not in own:
        assert current(path)==blob(main,path),path+' foreign main preservation'
        foreign+=1
ledger_path='quality/audits/ediel-masterplan-v2/coverage.json'
before=json.loads(blob(main,ledger_path));after=json.loads(current(ledger_path))
delta=[]
for kind in ['rules','acceptance_contracts']:
    assert len(before[kind])==len(after[kind])
    for a,b in zip(before[kind],after[kind]):
        assert a['id']==b['id']
        if a!=b:
            assert b['id'] in ['SC-009','SC-019'] and b['status']=='PASSED'
            assert set(a['evidence']).issubset(b['evidence'])
            delta.append(b['id'])
assert delta==['SC-009','SC-019'],delta
assert {k:v for k,v in before.items() if k not in ['rules','acceptance_contracts']}=={k:v for k,v in after.items() if k not in ['rules','acceptance_contracts']}
migrations=subprocess.check_output(['git','diff','--name-status',base,main,'--','supabase/migrations'],cwd=root,text=True).splitlines()
assert all(line.startswith('A\t') for line in migrations)
record={
 'scope':'SC009/SC019 minimum current-main carry; final independent recommendation pending',
 'created_at':datetime.now(timezone.utc).isoformat(),'approved_head':approved,'approved_tree':'6055b354ca97ba1e0002cfe80da2957283734b85','original_base':base,'main':main,
 'original_whole_approval':'https://github.com/heke99/gridex-ops-platform/pull/491#issuecomment-5985411226',
 'original_tests_byte_exact':[{'path':p,'sha256':sha(current(p))} for p in tests],
 'selected_sources':sources,'selected_sql_bodies':selected,
 'foreign_main_paths_exact':foreign,'coverage_only_delta':delta,
 'main_approved':sum(x['status'] in ['VERIFIED','PASSED'] for k in ['rules','acceptance_contracts'] for x in before[k]),
 'candidate_approved':sum(x['status'] in ['VERIFIED','PASSED'] for k in ['rules','acceptance_contracts'] for x in after[k]),
 'added_migrations':[{'path':line.split('\t')[1],'sha256':sha(current(line.split('\t')[1]))} for line in migrations],
 'changed_source_bounds':{
  'resolveInboundTenant':'TEN06 adds a physical-family helper and removes implicit UNB fallback when legal receiver is absent for PRODAT/UTILTS. The original SC009 chain supplies explicit legal62110 and technical82150, so its normalizeInput values are identical and delegation checks unchanged. Fresh five connected contrasts execute the current complete module, preserving positive delegated identity and missing/expired/ambiguous/wrong-transport refusal.',
  'underlayEngine':'Only existing estimatedItems and estimatePayload receive export modifiers, bodies byte-exact. BillingGate/sourceBasis/decimal/calendar and selected final-store source/price/period ordering unchanged.',
  'authorization':'Only two unchanged actor/membership/permission predicates now throw EdielExecutionFailure(Error subclass), same messages and no writes. The three actual-module TS suites do not extract this body or mock an invented class; no missing binding or test adaptation is established. Current native success/read effects are separately historical and selected-owner qualified.',
 },
 'sql_stage_order':'Complete store body and all selected source/underlay bodies equal original qualified561. Current owned supply/contract/locked price and qualified legal supply are still examined before per-item physical DGI refusal; no positive DGI invoice entitlement or DDQ rewrite is claimed.',
 'migration_bounds':'Seven new forwards since561 only: request_access resolver timing, DSN encoded transport identity, staff retention prerequisite, support quarantine MIME, contact/identity PT409, P08 own-outbound-PRODAT-Z09 positive ACK confirmation. No historical migration edited; no selected billing/projection/assignment assessment body replaced. Accepted E66/read/billing/internal grant branches do not invoke new request-access/DSN/staff/support producers; P08 trigger rejects other family/code/direction before lookup.',
 'historical_native':'Reuse original #511 run37231850192/job111523098655/artifact11315805392 ZIP f4c6de14b2ea27e730becd249e03df66daa13341f5d14c9fd438bcf3f1646744 and its three reviewed V/VH/current-grant/DGI derivative cases only. Original public491 whole review carries their custody and finite synthetic-analysis/external issuer boundaries. No new native execution, source setup/Z13 send, authentic legal/custody/market or positive native invoice proof is inferred.',
 'verification_policy':'Only necessary current three-suite execution, frozen integrity, tests types, scoped lint and one supported full tag check. No duplicate50SQL/full-native/browser/whole-plan proof.',
}
extra=[]
for path in ['lib/ediel/utilts/consumptionPreparation.ts','lib/ediel/utilts/resolution.ts','lib/ediel/utilts/timezone.ts','__tests__/helpers/utiltsObservationHandoff.ts','__tests__/helpers/utiltsNativeSourceFixture.ts','__tests__/helpers/utiltsErrGatewayFixture.ts']:
    data=current(path)
    assert data==blob(main,path),path
    extra.append({'path':path,'sha256':sha(data),'exact_original_base':data==blob(base,path)})
assert all(row['exact_original_base'] for row in extra[3:])
record['upstream_native_scope_qualification']=extra
record['upstream_calendar_delta']='Read actual consumptionPreparation/resolution/timezone changes: fixed-offset local representation preserves absolute endpoints for selected linear15-minute source; new calendar month/year stepping follows declared wall time. Selected ESCO energy fixture emits DTM35415:806 with declared+0200 and one15-minute physical observation. Three wire-generator helpers are exact original561. Original selected native evidence remains old-source custody, not fresh entire current setup. Old7bd clean failure was Z06 monthly next-day interval and current source owns the declared-offset correction; Z06 fixture/test bytes themselves were unchanged.'
(out/'current-main-source-carry.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'main':main,'sources':len(sources),'source_exact_original':sum(x['exact_approved_base'] for x in sources),'selected_sql_exact':len(selected),'foreign_paths':foreign,'coverage_delta':delta,'main_approved':record['main_approved'],'candidate_approved':record['candidate_approved'],'receipt_sha256':sha((out/'current-main-source-carry.json').read_bytes())}))
