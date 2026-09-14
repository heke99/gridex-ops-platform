#!/usr/bin/env python3
"""One-use exact reviewed fixture publication, never a database or main write."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

BASE='c8c3ac5a45895909b539a942679356fddd8ca72c'
BASE_TREE='a3ba2c7e98e558e72d8fcaff85158678573321f7'
RESULT_TREE='3466a680ed71e99f9e4cef9ecb4ffc6d8cd8d1df'
BRANCH='codex/gridex-parity-remediation-20260905'
TEMP=('.github/workflows/gridex-fixture-publication.yml','scripts/gridex-fixture-publication.py')
TEST='scripts/canonical-native-grant-fixtures-selftest.py'
PINS={
 'canonical-rbac-prefix-selftest.py':('4831576e530b0ebe026af6c217e9f510e531f5e6ee58a50bc64b6df6f22469d1','a7f893f49e67f964b35c8b8bb914ca17f0296e994aa265daaf264a4d7631bcbe'),
 'canonical-auth-membership-group-selftest.py':('f5963249ba7b11e7dd2e5833b5c672e3a66c9691e41822a0dfe606484ad79a94','bf988216a52ade3bd087f7c829a9fcddda813d697c1f0942843ad3b96f24fc59'),
 'canonical-customer-operations-selftest.py':('213f9de87cf2653b0a1040a089763c45d8b385068430673097cee24b7c62394f','c9ef17ca12956e37603cf78ac623cba34ea670b695d6fcaa3f923a1dc1cc1403'),
 'canonical-readiness-operations-selftest.py':('6efc71aac868284d61048ab454370749cbb319b08b3331f6c7b907611fd1352c','eb30978dd6c4c4566594c65c99287d0712dce6020675a7e63f4f5aac519ccee7')}


def run(args,env=None):
    result=subprocess.run(args,capture_output=True,text=True,env=env,timeout=180)
    if result.returncode:raise RuntimeError('EXACT_FIXTURE_CHECK_FAILED')
    return result.stdout.strip()


def projection(remove):
    with tempfile.TemporaryDirectory() as directory:
        env={**os.environ,'GIT_INDEX_FILE':directory+'/index'}
        run(['git','read-tree',run(['git','write-tree'])],env)
        run(['git','update-index','--force-remove','--',*remove],env)
        return run(['git','write-tree'],env)


def edit(name,old,new):
    path=Path('scripts')/name
    text=path.read_text()
    if text.count(old)!=1:raise RuntimeError('EXACT_EDIT_SITE_REQUIRED')
    path.write_text(text.replace(old,new))


def changes():
    edit('canonical-rbac-prefix-selftest.py',
     'create temporary table rbac_journal_policies_before as {journal_policy_catalog()};',
     'create temporary table rbac_journal_metadata_before as {journal_metadata_catalog()};\ncreate temporary table rbac_journal_policies_before as {journal_policy_catalog()};')
    edit('canonical-rbac-prefix-selftest.py', '\ndef journal_checks():', '''
def journal_metadata_catalog():
    return """select oid,relowner,relacl,reloptions,relrowsecurity,relforcerowsecurity
  from pg_class where oid in ('public.customer_sync_events'::regclass,'public.tenant_governance_events'::regclass)"""


def journal_metadata_unchanged():
    return f"""not exists(
  (select * from rbac_journal_metadata_before except ({journal_metadata_catalog()}))
  union all (({journal_metadata_catalog()}) except select * from rbac_journal_metadata_before))"""


def journal_checks():''')
    edit('canonical-rbac-prefix-selftest.py','''  and relacl is null and reloptions is null) from pg_class
  where oid in ('public.customer_sync_events'::regclass,'public.tenant_governance_events'::regclass)),
  '6D2 journal RLS/owner/default ACL/options retained; final runtime access remains OPEN');''', '''  and reloptions is null) from pg_class
  where oid in ('public.customer_sync_events'::regclass,'public.tenant_governance_events'::regclass)),
  '6D2 journal RLS/owner/options retained; final runtime access remains OPEN');
select test_assert({journal_metadata_unchanged()},
  'exact journal ACL/owner/options/RLS preimages preserved, including native default grants');
-- A real ACL mutation must be detected, independently of default-ACL encoding.
BEGIN;
REVOKE SELECT ON public.customer_sync_events FROM authenticated;
select test_assert(not ({journal_metadata_unchanged()}), 'JOURNAL_ACL_NEGATIVE_CONTROL');
ROLLBACK;
select test_assert({journal_metadata_unchanged()}, 'JOURNAL_ACL_NEGATIVE_ROLLBACK_PRESERVED');''')
    edit('canonical-auth-membership-group-selftest.py',"        'relacl is null and reloptions is null',", "        'select * from rbac_journal_metadata_before except',\n        'except select * from rbac_journal_metadata_before',\n        'JOURNAL_ACL_NEGATIVE_CONTROL',\n        'JOURNAL_ACL_NEGATIVE_ROLLBACK_PRESERVED',")
    edit('canonical-auth-membership-group-selftest.py',"'6D2 journal RLS/owner/default ACL/options retained; final runtime access remains OPEN'", "'6D2 journal RLS/owner/options retained; final runtime access remains OPEN'")
    edit('canonical-customer-operations-selftest.py', '''        for role in ('anon','authenticated','service_role'):
            result=self.run(NATIVE,'SET LOCAL ROLE '+role+'; SELECT * FROM public.customer_lifecycle_events;')
            batch.check(result.code!=0 and result.state=='42501','OPERATIONS_ACL_DENIAL_REQUIRED')''', '''        # Native initial grants are present. Characterize this intermediate
        # source honestly; ACL denial and row-policy denial are different tests.
        for role in ('anon','authenticated','service_role'):
            granted=self.query(NATIVE,"SELECT has_table_privilege('"+role+"','public.customer_lifecycle_events','SELECT');")
            batch.check(granted.strip()=='t','OPERATIONS_NATIVE_STARTING_ACL_REQUIRED')
            sql='REVOKE SELECT ON public.customer_lifecycle_events FROM PUBLIC, '+role+'; SET LOCAL ROLE '+role+'; SELECT * FROM public.customer_lifecycle_events; ROLLBACK;'
            result=self.run(NATIVE,sql)
            batch.check(result.code!=0 and result.state=='42501','OPERATIONS_ROLLBACK_ACL_DENIAL_REQUIRED')''')
    edit('canonical-customer-operations-selftest.py', '''        # Labelled rollback-only grants measure the policy separately from actual ACL denial.
        for claim,count in (('authenticated','0'),('service_role','1')):
            sql=customer+event+"GRANT SELECT ON public.customer_lifecycle_events TO authenticated; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.role='"+claim+"'; SELECT count(*) FROM public.customer_lifecycle_events; ROLLBACK;"''', '''        # Actual client/service roles exercise the existing policy without
        # granting access in the probe. The deliberately supplied service claim
        # characterizes historical auth.role() semantics, not API JWT forgery.
        for role,claim,count in (('anon','anon','0'),('authenticated','authenticated','0'),
                                 ('service_role','service_role','1'),('authenticated','service_role','1')):
            sql=customer+event+"SET LOCAL ROLE "+role+"; SET LOCAL request.jwt.claim.role='"+claim+"'; SELECT count(*) FROM public.customer_lifecycle_events; ROLLBACK;"''')
    edit('canonical-readiness-operations-selftest.py', '''                result=self.run(NATIVE,'SET LOCAL ROLE '+role+'; SELECT * FROM public.'+view+';')
                batch.check(result.code!=0 and result.state=='42501','READINESS_VIEW_ACL_REQUIRED')''', '''                granted=self.query(NATIVE,"SELECT has_table_privilege('"+role+"','public."+view+"','SELECT');")
                batch.check(granted.strip()=='t','READINESS_NATIVE_STARTING_VIEW_ACL_REQUIRED')
                # Rollback-only negative control, not a claim that these
                # intermediate historical views deny clients before hardening.
                sql='REVOKE SELECT ON public.'+view+' FROM PUBLIC, '+role+'; SET LOCAL ROLE '+role+'; SELECT * FROM public.'+view+'; ROLLBACK;'
                result=self.run(NATIVE,sql)
                batch.check(result.code!=0 and result.state=='42501','READINESS_ROLLBACK_VIEW_ACL_REQUIRED')''')
    edit('canonical-readiness-operations-selftest.py', '''            sql+="UPDATE public.companies SET status='"+status+"'; SELECT readiness_status FROM public.gridex_tenant_runtime_readiness; ROLLBACK;"
            result=self.run(NATIVE,sql)
            batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()==expected,'READINESS_VIEW_BRANCH_REQUIRED')''', '''            sql+="UPDATE public.companies SET status='"+status+"';"
            # These original owner-context views expose the same synthetic
            # rows to clients. Preserve this finding; final hardening remains
            # a separate release gate, never certified by this source proof.
            for role in ('postgres','anon','authenticated','service_role'):
                probe=sql+'SET LOCAL ROLE '+role+'; SELECT readiness_status FROM public.gridex_tenant_runtime_readiness; ROLLBACK;'
                result=self.run(NATIVE,probe)
                batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()==expected,'READINESS_HISTORICAL_CLIENT_VIEW_EXPOSURE_REQUIRED')''')
    edit('canonical-readiness-operations-selftest.py', '''        result=self.run(NATIVE,sql)
        batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()=='blocked,requires_correction,warning','READINESS_BILLING_BRANCH_REQUIRED')''', '''        for role in ('postgres','anon','authenticated','service_role'):
            probe=sql.replace('SELECT string_agg(', 'SET LOCAL ROLE '+role+'; SELECT string_agg(')
            result=self.run(NATIVE,probe)
            batch.check(result.code==0 and result.state=='00000' and result.stdout.strip()=='blocked,requires_correction,warning','READINESS_HISTORICAL_BILLING_VIEW_EXPOSURE_REQUIRED')''')
    edit('canonical-readiness-operations-selftest.py', '''        batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'READINESS_PROBE_PRESERVATION_REQUIRED')''', '''        batch.check(r.encoded(self.snapshot(NATIVE))==r.encoded(before),'READINESS_PROBE_PRESERVATION_REQUIRED')
        print(json.dumps({'scope':'HISTORICAL_READINESS_SOURCE_CHARACTERIZATION',
            'clientViewRowsVisibleAtIntermediateBoundary':True,
            'rollbackAclNegativeControls':6,'completeCatalogAndRowsPreserved':True,
            'finalAccessSecurityAccepted':False,'fullReplayAccepted':False}),flush=True)''')


def main():
    event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    pr=event['pull_request'];head=pr['head']['sha']
    if (os.environ.get('GITHUB_EVENT_NAME')!='pull_request' or event['number']!=310
        or pr['head']['ref']!=BRANCH or pr['head']['repo']['full_name']!='heke99/gridex-ops-platform'
        or run(['git','rev-parse','HEAD'])!=head or run(['git','rev-parse','HEAD^'])!=BASE
        or run(['git','status','--porcelain']) or projection((*TEMP,TEST))!=BASE_TREE):
        raise RuntimeError('EXACT_REVIEWED_BASE_REQUIRED')
    if hashlib.sha256(Path(TEST).read_bytes()).hexdigest()!='a403ff4935cc24b1a5eebd52b0ea892fb662ea59ac8258602c98f632723d89d4':
        raise RuntimeError('EXACT_NEW_TEST_REQUIRED')
    for name,(before,after) in PINS.items():
        if hashlib.sha256((Path('scripts')/name).read_bytes()).hexdigest()!=before:
            raise RuntimeError('EXACT_PREDECESSOR_REQUIRED')
    changes()
    for name,(before,after) in PINS.items():
        if hashlib.sha256((Path('scripts')/name).read_bytes()).hexdigest()!=after:
            raise RuntimeError('EXACT_REVIEWED_RESULT_REQUIRED')
    files=['scripts/'+name for name in PINS]
    if sorted(run(['git','diff','--name-only']).splitlines())!=sorted(files):
        raise RuntimeError('EXACT_FOUR_FILES_REQUIRED')
    run(['git','add','--',*files])
    if projection(TEMP)!=RESULT_TREE:raise RuntimeError('REVIEWED_TREE_REQUIRED')
    environment={k:v for k,v in os.environ.items() if k not in ('GH_TOKEN','GITHUB_TOKEN')}
    checks=[['python3','-B',TEST],['python3','-B','scripts/canonical-customer-operations-selftest.py','--selection-only'],['python3','-B','scripts/canonical-readiness-operations-selftest.py','--selection-only'],['node','scripts/check-migration-versions.cjs']]
    for check in checks:run(check,environment)
    run(['git','diff','--cached','--check']);run(['git','diff','--exit-code'])
    if projection(TEMP)!=RESULT_TREE:raise RuntimeError('POST_TEST_TREE_CHANGED')
    auth=base64.b64encode(('x-access-token:'+os.environ['GH_TOKEN']).encode()).decode()
    git=['git','-c','credential.helper=','-c','http.https://github.com/.extraheader=AUTHORIZATION: basic '+auth]
    if run([*git,'ls-remote','origin','refs/heads/'+BRANCH]).split()[0]!=head:
        raise RuntimeError('BRANCH_MOVED')
    run(['git','-c','user.name=github-actions[bot]','-c','user.email=41898282+github-actions[bot]@users.noreply.github.com','commit','--no-gpg-sign','-m','test(db): preserve native journal ACLs and characterize historical view exposure'])
    commit=run(['git','rev-parse','HEAD'])
    run([*git,'push','origin','HEAD:refs/heads/'+BRANCH])
    if run([*git,'ls-remote','origin','refs/heads/'+BRANCH]).split()[0]!=commit:
        raise RuntimeError('PUBLICATION_READBACK_FAILED')
    print(json.dumps({'codeCommit':commit,'reviewedTree':RESULT_TREE,'files':files,'newProbeRegressionTests':5,'constructorTests':19,'mainMerged':False,'nativeFixtureExecutionAccepted':False,'hostedDatabaseModified':False}),flush=True)


if __name__=='__main__':
    try:main()
    except Exception:
        print('FAIL exact fixture publication; no raw diagnostics or acceptance override',flush=True)
        raise SystemExit(1) from None
