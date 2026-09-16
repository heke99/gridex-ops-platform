"""Pristine role regression and fail-closed metadata mutation controls."""
import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import canonical_native_provider_role_chain as provider
import canonical_removed_policy_qualification as q
from test_canonical_removed_policy_qualification import metadata_fixture
ROOT=Path(__file__).resolve().parents[1]


def roles():
    """Non-secret pristine role projection; actual SQL is tested separately."""
    base=metadata_fixture(q,q.retain(ROOT))['principals']
    for name in ('authenticator',provider.PROVIDER):
        base.append(dict(oid=88 if name=='authenticator' else 89,rolname=name,
            rolsuper=False,rolbypassrls=False,rolcanlogin=True,
            authenticated_member=False,authenticated_usage=False,anon_descendant=False,
            anon_member=False,service_usage=False,client_entry=True,
            unreviewed_login_member=name==provider.PROVIDER))
    next(p for p in base if p['rolname']=='service_role')['unreviewed_login_member']=True
    return base


class NativeProviderRoleChainTests(unittest.TestCase):
    def test_pristine_chain_fails_without_proof_and_passes_only_with_exact_proof(self):
        with self.assertRaisesRegex(ValueError,'ROLE_GRAPH_REQUIRED'):
            q.validate_role_graph(roles())
        result=q.validate_role_graph(roles(),provider.expected())
        self.assertTrue(result['service_role']['unreviewed_login_member'])

    def test_extra_missing_changed_edges_and_login_origins_are_rejected(self):
        bad_values=[None,True,{},[],{**provider.expected(),'extra':True}]
        for key in provider.expected():
            bad=provider.expected();del bad[key];bad_values.append(bad)
        for key in ('roles','edges','serviceOrigins'):
            for f in (lambda x:x[:-1],lambda x:x+x[:1]):
                bad=provider.expected();bad[key]=f(bad[key]);bad_values.append(bad)
        for i in range(4):
            for field in ('admin','inherit','set'):
                bad=provider.expected();bad['edges'][i][field]=not bad['edges'][i][field];bad_values.append(bad)
            for field in ('role','member','grantor'):
                bad=provider.expected();bad['edges'][i][field]='custom_login';bad_values.append(bad)
        for i in range(3):
            for field in ('rolsuper','rolbypassrls','rolcanlogin','service_usage'):
                bad=provider.expected();bad['roles'][i][field]=not bad['roles'][i][field];bad_values.append(bad)
        bad=provider.expected();bad['serviceOrigins'].append('custom_login');bad_values.append(bad)
        bad=provider.expected();bad['clientCanReachProvider']=True;bad_values.append(bad)
        bad=provider.expected();bad['clientCanReachProvider']=0;bad_values.append(bad)
        bad=provider.expected();bad['edges'][0]['set']=1;bad_values.append(bad)
        for value in bad_values:
            with self.subTest(value=value),self.assertRaisesRegex(ValueError,'PROVIDER_CHAIN_REQUIRED'):
                provider.validate(value)

    def test_client_escalation_stays_rejected_with_valid_provider_evidence(self):
        for name,field in (('service_role','authenticated_member'),('service_role','anon_member'),
                           ('postgres','unreviewed_login_member')):
            bad=roles();next(p for p in bad if p['rolname']==name)[field]=True
            with self.subTest(name=name,field=field),self.assertRaisesRegex(ValueError,'ROLE_GRAPH_REQUIRED'):
                q.validate_role_graph(bad,provider.expected())
        for name in ('authenticator',provider.PROVIDER):
            bad=roles();next(p for p in bad if p['rolname']==name)['service_usage']=True
            with self.assertRaisesRegex(ValueError,'PROVIDER_CHAIN_REQUIRED'):
                q.validate_role_graph(bad,provider.expected())

    def test_policy_witness_keeps_provider_table_column_and_owner_denials(self):
        retained=q.retain(ROOT);base=metadata_fixture(q,retained);base['principals']=roles()
        for name in ('authenticator',provider.PROVIDER):
            for table in q.TABLES:
                base['authority'].append(dict(name=table,rolname=name,rolsuper=False,rolbypassrls=False,
                    owner_member=False,table_privileges=[],column_privileges=[]))
        with patch.object(q,'require_policy_hashes'):
            q.validate_metadata(base,retained,native_provider=provider.expected())
            for field,value in (('table_privileges',['SELECT']),('column_privileges',['UPDATE']),('owner_member',True)):
                bad=copy.deepcopy(base)
                next(r for r in bad['authority'] if r['rolname']==provider.PROVIDER)[field]=value
                with self.subTest(field=field),self.assertRaisesRegex(ValueError,'UNREVIEWED_PRINCIPAL_REQUIRED'):
                    q.validate_metadata(bad,retained,native_provider=provider.expected())

    def test_external_or_portable_target_cannot_supply_native_role_proof(self):
        class External:
            def sql(self,*a,**kw):raise AssertionError('unowned SQL called')
        with self.assertRaises(ValueError):provider.capture(External())
        self.assertIn('BEGIN READ ONLY;',provider.QUERY)
        self.assertNotIn('rolpassword',provider.QUERY)
        for statement in ('GRANT ','REVOKE ','ALTER ','CREATE ','DROP '):
            self.assertNotIn(statement,provider.QUERY)

    def test_native_receipt_requires_the_new_role_proof(self):
        self.assertTrue(q.receipt_contract(native=True)['nativeStorageRoleChainVerified'])
        self.assertFalse(q.receipt_contract(native=False)['nativeStorageRoleChainVerified'])

if __name__=='__main__':unittest.main()
