"""Closed supplemental evidence admission; live SQL requires a full owned target."""
import copy
from dataclasses import replace
import importlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


def load():
    assert (ROOT/'scripts/canonical_removed_policy_qualification.py').is_file(), 'supplemental helper missing'
    return importlib.import_module('canonical_removed_policy_qualification')


def metadata_fixture(q,retained):
    """Synthetic metadata isolates authority checks; policy hashes tested separately."""
    register=__import__('json').loads(retained.register)
    full={tuple(x['identity']):x['row'] for x in register['replacementPolicies'] if x['row'] is not None}
    policies=q.reference_guard_rows(retained)
    for key,_ in q.ADDED_POLICY_HASHES:
        policies.append(full.get(key,dict(nspname=key[0],relname=key[1],polname=key[2],command='r',
            permissive=True,roles=['service_role'],using_expression='true',check_expression='')))
    principals=[]
    for i,name in enumerate(('authenticated','anon','service_role','postgres','pg_read_all_data','pg_write_all_data','pg_maintain'),1):
        principals.append(dict(oid=i,rolname=name,rolsuper=name=='postgres',rolbypassrls=name in ('postgres','service_role'),
            rolcanlogin=name=='postgres',authenticated_member=name=='authenticated',authenticated_usage=name=='authenticated',
            anon_descendant=name in ('anon','postgres'),anon_member=name=='anon',service_usage=name in ('service_role','postgres'),client_entry=name=='postgres',unreviewed_login_member=False))
    authority=[]
    all_privileges={'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'}
    for t in q.TABLES:
        for p in principals:
            name=p['rolname'];privs=set(all_privileges) if name in ('authenticated','service_role','postgres') else set()
            if name=='authenticated' and t in ('company_invitations','user_roles'):privs-={'INSERT','UPDATE','DELETE'}
            if name=='authenticated' and t=='ediel_send_locks':privs={'SELECT'}
            if name=='pg_read_all_data':privs={'SELECT'}
            if name=='pg_write_all_data':privs={'INSERT','UPDATE','DELETE'}
            if name=='pg_maintain':privs={'MAINTAIN'}
            authority.append(dict(name=t,rolname=name,rolsuper=p['rolsuper'],rolbypassrls=p['rolbypassrls'],
                owner_member=name=='postgres',table_privileges=sorted(privs),column_privileges=sorted(privs&{'SELECT','INSERT','UPDATE','REFERENCES'})))
    routines=[dict(signature=name,**row,executable_by=['postgres','service_role']+([] if name.startswith('canonical_') else ['authenticated']))
              for name,row in q.expected_routines(retained).items()]
    return dict(scope='REMOVED_POLICY_READ_ONLY_METADATA',postgres17=True,readOnly=True,policies=policies,
        relations=[dict(name=t,kind='r',rls=True,force=False,owner='postgres') for t in q.TABLES],
        principals=principals,authority=authority,routines=routines)


class RemovedPolicyQualificationTests(unittest.TestCase):
    def test_retained_sql_register_and_source_bytes_are_closed(self):
        q=load(); retained=q.retain(ROOT)
        self.assertEqual(q.validate_retained(retained),retained)
        for bad in (replace(retained,sql=retained.sql+b'\n'),replace(retained,register=retained.register+b'\n'),
                    replace(retained,evidence=retained.evidence[:-1])):
            with self.assertRaises(ValueError):q.validate_retained(bad)
        for bad in (None,(),b'sql'):
            with self.assertRaises(ValueError):q.validate_retained(bad)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):q.retain(Path(directory))
        self.assertEqual(len(q.expected_policies(retained)),267)

    def test_six_exact_forward_receipts_are_required(self):
        q=load()
        sixth=(q.SIXTH_SOURCE,q.SIXTH_SHA)
        sources=(*q.FIRST_FIVE,sixth)
        good=dict(foundationApplied=144,timestampApplied=514,forwardSources=dict(executed=True,inputsExecuted=6,
            sources=[dict(source=p,sourceSha256=h,executed=True,positiveAndRepeatVerified=True,rowsPreserved=True)
                     for p,h in sources]))
        with patch('canonical_forward_sources.FORWARD_SOURCES',sources):
            q.complete(good,False)
            for key,value in [('inputsExecuted',5),('executed',False)]:
                bad=copy.deepcopy(good);bad['forwardSources'][key]=value
                with self.assertRaises(ValueError):q.complete(bad,False)
            for mutation in ('missing','hash','order','repeat'):
                bad=copy.deepcopy(good);rows=bad['forwardSources']['sources']
                if mutation=='missing':rows.pop()
                if mutation=='hash':rows[-1]['sourceSha256']='0'*64
                if mutation=='order':rows[0],rows[1]=rows[1],rows[0]
                if mutation=='repeat':rows[-1]['positiveAndRepeatVerified']=False
                with self.assertRaises(ValueError):q.complete(bad,False)
        with patch('canonical_forward_sources.FORWARD_SOURCES',q.FIRST_FIVE):
            with self.assertRaises(ValueError):q.complete(good,False)

    def test_external_target_never_runs_sql(self):
        q=load()
        class External:
            def sql(self,*args,**kwargs):raise AssertionError('external SQL executed')
        with self.assertRaises(ValueError):q.execute(External(),q.retain(ROOT),{}, {})

    def test_closed_policy_set_and_hashes_reject_drift(self):
        q=load();r=q.retain(ROOT);expected=q.expected_policies(r)
        rows=q.reference_guard_rows(r)
        self.assertEqual(len(rows),95)
        # Complete rows may be live; their admitted hash map must be exact.
        q.require_policy_hashes(expected,expected)
        for bad in (dict(list(expected.items())[1:]), {**expected,('public','extra','policy'):'0'*64},
                    {**expected,next(iter(expected)):'0'*64}):
            with self.assertRaises(ValueError):q.require_policy_hashes(bad,expected)

    def test_effective_authority_and_rpc_body_mutations_fail_closed(self):
        q=load();retained=q.retain(ROOT);base=metadata_fixture(q,retained)
        # Unreachable predefined capability roles legitimately possess global
        # privileges; they are not client roles unless login/SET entry exists.
        with patch.object(q,'require_policy_hashes'):
            self.assertEqual(q.validate_metadata(base,retained)['sendLockNonSelectPrivilegesDenied'],7)
            # Existing PostgREST authenticator may SET service_role; this named
            # entry does not authorize arbitrary custom LOGIN role escalation.
            routed=copy.deepcopy(base)
            routed['principals'].append(dict(oid=88,rolname='authenticator',rolsuper=False,rolbypassrls=False,
                rolcanlogin=True,authenticated_member=False,authenticated_usage=False,anon_descendant=False,
                anon_member=False,service_usage=False,client_entry=True,unreviewed_login_member=False))
            for table in q.TABLES:
                routed['authority'].append(dict(name=table,rolname='authenticator',rolsuper=False,rolbypassrls=False,
                    owner_member=False,table_privileges=[],column_privileges=[]))
            next(x for x in routed['principals'] if x['rolname']=='service_role')['client_entry']=True
            self.assertEqual(q.validate_metadata(routed,retained)['sendLockNonSelectPrivilegesDenied'],7)
            for mutation in ('anon_column','inherited_write','set_owner','sendlock_truncate','rpc_execute','rpc_body','extra_login','anon_set_bypass','anon_set_column','custom_login_set_capability','custom_login_set_owner','custom_login_set_service'):
                bad=copy.deepcopy(base)
                def auth(table,role):return next(x for x in bad['authority'] if x['name']==table and x['rolname']==role)
                if mutation=='anon_column':auth('auth_email_events','anon')['column_privileges'].append('SELECT')
                if mutation in ('anon_set_bypass','anon_set_column'):
                    # Custom NOLOGIN role, reachable from anon through SET-only
                    # membership; no reverse descendant edge or inherited use.
                    bypass=mutation=='anon_set_bypass'
                    bad['principals'].append(dict(oid=99,rolname='custom_anon_set_role',rolsuper=False,
                        rolbypassrls=bypass,rolcanlogin=False,authenticated_member=False,authenticated_usage=False,
                        anon_descendant=False,anon_member=True,service_usage=False,client_entry=False,unreviewed_login_member=False))
                    for table in q.TABLES:
                        bad['authority'].append(dict(name=table,rolname='custom_anon_set_role',rolsuper=False,
                            rolbypassrls=bypass,owner_member=False,table_privileges=[],
                            column_privileges=['SELECT'] if not bypass and table=='auth_email_events' else []))
                if mutation in ('custom_login_set_capability','custom_login_set_owner','custom_login_set_service'):
                    # The fixed SQL measures MEMBER reachability from every
                    # non-bypass LOGIN entry, including NOINHERIT/SET-only edges.
                    for i,name in enumerate(('custom_login','custom_capability'),90):
                        bad['principals'].append(dict(oid=i,rolname=name,rolsuper=False,rolbypassrls=False,
                            rolcanlogin=name=='custom_login',authenticated_member=False,authenticated_usage=False,
                            anon_descendant=False,anon_member=False,service_usage=False,client_entry=True,unreviewed_login_member=True))
                        for table in q.TABLES:
                            bad['authority'].append(dict(name=table,rolname=name,rolsuper=False,rolbypassrls=False,
                                owner_member=mutation=='custom_login_set_owner' and name=='custom_capability',table_privileges=[],
                                column_privileges=['INSERT'] if mutation=='custom_login_set_capability' and name=='custom_capability' and table=='ediel_send_locks' else []))
                    if mutation=='custom_login_set_service':
                        next(x for x in bad['principals'] if x['rolname']=='service_role')['unreviewed_login_member']=True
                if mutation=='inherited_write':
                    next(x for x in bad['principals'] if x['rolname']=='pg_write_all_data')['authenticated_member']=True
                if mutation=='set_owner':auth('audit_logs','authenticated')['owner_member']=True
                if mutation=='sendlock_truncate':auth('ediel_send_locks','authenticated')['table_privileges'].append('TRUNCATE')
                if mutation=='rpc_execute':next(x for x in bad['routines'] if x['signature'].startswith('canonical_restore'))['executable_by'].append('authenticated')
                if mutation=='rpc_body':bad['routines'][0]['prosrc']+=' -- changed'
                if mutation=='extra_login':next(x for x in bad['principals'] if x['rolname']=='pg_read_all_data')['client_entry']=True
                with self.subTest(mutation=mutation), self.assertRaises(ValueError):q.validate_metadata(bad,retained)

    def test_original_files_may_be_staged_away_after_retention(self):
        q=load();retained=q.retain(ROOT)
        with patch.object(Path,'read_bytes',side_effect=AssertionError('retained work must not reread source')):
            q.validate_retained(retained)
            self.assertEqual(len(q.expected_policies(retained)),267)
            self.assertEqual(len(q.expected_routines(retained)),12)

    def test_receipt_requires_formula_metadata_and_snapshot_preservation(self):
        q=load();retained=q.retain(ROOT);metadata=metadata_fixture(q,retained)
        actor=dict(q.actors.expected_result(),source=q.actors.SOURCE,sourceSha256=q.actors.SOURCE_SHA256,
            completePolicyContextSha256='a'*64,catalogAndRowsPreserved=True,nativeTarget=False,ledgerProvenanceAccepted=False)
        class Target:
            def sql(self,database,sql,label,transaction):
                self.last_sql=sql
                return __import__('json').dumps(metadata)
        target=Target()
        with patch.object(q.actors,'_admit',return_value=('gridex_auth_legacy_replay',False)), \
             patch.object(q,'complete'), patch.object(q,'require_policy_hashes'), \
             patch.object(q.actors,'_policy_context',return_value='a'*64), \
             patch.object(q.actors,'_snapshot',return_value={'unchanged':True}):
            receipt=q.execute(target,retained,{},actor)
            self.assertEqual(receipt['compositionCount'],55)
            self.assertEqual(receipt['formulaComponentsProved'],75)
            self.assertEqual(receipt['formulaProofSha256'],q.FORMULA_PROOF_SHA)
            self.assertIn('BEGIN READ ONLY;',target.last_sql)
            q.validate_execution_receipt(receipt,native=False)
            for key,value in [('schemaAccepted',True),('nativeTarget',True),('formulaComponentsProved',74),
                              ('policyCount',266),('verified',1),('reusedActorReceiptSha256','missing')]:
                with self.subTest(key=key),self.assertRaises(ValueError):
                    q.validate_execution_receipt({**receipt,key:value},native=False)
            with self.assertRaises(ValueError):q.validate_execution_receipt({**receipt,'extra':False},native=False)
            with patch.object(q.actors,'_snapshot',side_effect=[{'unchanged':True},{'unchanged':False}]):
                with self.assertRaisesRegex(ValueError,'STATE_PRESERVATION_REQUIRED'):q.execute(target,retained,{},actor)


if __name__=='__main__':unittest.main()
