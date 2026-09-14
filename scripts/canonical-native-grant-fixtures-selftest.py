#!/usr/bin/env python3
"""Offline regression controls for historical probes with native default ACLs.

Executes the real probe methods with a strict fake SQL transport. SQL behavior
is independently verified by the existing native OPS jobs, not by this file.
"""
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class NativeGrantFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rbac = load('canonical-rbac-prefix-selftest')
        cls.ops = load('canonical-customer-operations-selftest')
        cls.ready = load('canonical-readiness-operations-selftest')

    def test_journal_preimage_records_acl_owner_options_and_rls(self):
        baseline = self.rbac.prefix_baseline()
        check = self.rbac.journal_checks()
        self.assertIn('create temporary table rbac_journal_metadata_before as', baseline)
        self.assertIn('select oid,relowner,relacl,reloptions,relrowsecurity,relforcerowsecurity', baseline)
        self.assertIn('select * from rbac_journal_metadata_before except', check)
        self.assertIn('except select * from rbac_journal_metadata_before', check)
        self.assertNotIn('relacl is null', check)
        self.assertIn('JOURNAL_ACL_NEGATIVE_CONTROL', check)
        self.assertIn('REVOKE SELECT ON public.customer_sync_events FROM authenticated', check)
        self.assertIn('ROLLBACK', check)
        self.assertIn('count(*)=2 and bool_and(relrowsecurity and not relforcerowsecurity', check)

    def fixture(self, module, failure=None):
        proof = module.Proof.__new__(module.Proof)
        observations = []; state = ({'schema': 'preserved'}, [])
        proof.snapshot = Mock(side_effect=lambda *_: copy.deepcopy(state))
        def query(database, sql):
            observations.append(('query', sql))
            if 'missing_select_policy' in sql:
                return 't|t|t'
            if 'has_table_privilege' in sql:
                return 'f' if failure == 'grant' else 't'
            raise AssertionError('Unexpected query in real historical access probe')
        def run(database, sql):
            observations.append(('run', sql))
            if 'REVOKE SELECT' in sql:
                self.assertIn('FROM PUBLIC,', sql)
                self.assertIn('SET LOCAL ROLE', sql)
                self.assertIn('ROLLBACK;', sql)
                return SimpleNamespace(code=0 if failure == 'denial' else 3,
                                       state='00000' if failure == 'denial' else '42501', stdout='')
            if 'customer_lifecycle_events' in sql:
                if "'invalid'" in sql:
                    return SimpleNamespace(code=3, state='23514', stdout='')
                if 'INSERT INTO public.customers' not in sql:
                    return SimpleNamespace(code=3, state='23503', stdout='')
                self.assertIn('ROLLBACK;', sql)
                if 'DELETE FROM public.customers' in sql:
                    value='0'
                elif "request.jwt.claim.role='service_role'" in sql:
                    value='1'
                else:
                    value='0'
                if failure == 'visibility' and 'SET LOCAL ROLE' in sql:
                    value='unexpected'
                return SimpleNamespace(code=0, state='00000', stdout=value)
            if 'gridex_tenant_runtime_readiness' in sql:
                self.assertIn('ROLLBACK;', sql)
                if "status='deleted_test_only'" in sql: value=''
                elif "status='paused'" in sql: value='blocked_company_status'
                elif "'Readiness route'" in sql: value='ready'
                elif "'Readiness actor'" in sql:
                    value='missing_route' if ',false,' in sql else 'ready'
                elif 'ediel_id=NULL' in sql: value='missing_actor_profile'
                else: value='missing_route'
            elif 'billing_readiness_flags' in sql:
                self.assertIn('ROLLBACK;', sql)
                value='blocked,requires_correction,warning'
            else:
                raise AssertionError('Unexpected SQL in real historical access probe')
            if failure == 'visibility' and 'SET LOCAL ROLE' in sql: value='unexpected'
            return SimpleNamespace(code=0, state='00000', stdout=value)
        proof.query=query; proof.run=run
        return proof, observations

    def test_operations_asserts_native_grants_negative_acl_and_real_role_rls(self):
        proof, calls = self.fixture(self.ops)
        proof.privileges()
        grants=[s for kind,s in calls if kind=='query' and 'has_table_privilege' in s]
        negative=[s for kind,s in calls if 'REVOKE SELECT' in s]
        roles=[s for kind,s in calls if 'SET LOCAL ROLE' in s and 'REVOKE SELECT' not in s]
        self.assertEqual(len(grants),3)
        self.assertEqual(len(negative),3)
        self.assertEqual(len(roles),4)
        for role in ('anon','authenticated','service_role'):
            self.assertTrue(any('SET LOCAL ROLE '+role+';' in s for s in roles))
        self.assertFalse(any('GRANT SELECT' in s for _,s in calls))
        self.assertEqual(proof.snapshot.call_count,2)

    def test_operations_does_not_accept_missing_grants_ineffective_denial_or_rls_leak(self):
        for failure in ('grant','denial','visibility'):
            with self.subTest(failure=failure):
                proof,_=self.fixture(self.ops,failure)
                with self.assertRaises(self.ops.batch.BoundaryError): proof.privileges()

    def test_readiness_records_historical_client_exposure_not_fictitious_acl_denial(self):
        proof,calls=self.fixture(self.ready)
        proof.view_probes()
        self.assertEqual(len([s for kind,s in calls if kind=='query' and 'has_table_privilege' in s]),6)
        self.assertEqual(len([s for _,s in calls if 'REVOKE SELECT' in s]),6)
        for role in ('anon','authenticated','service_role'):
            for view in ('billing_readiness_flags','gridex_tenant_runtime_readiness'):
                self.assertTrue(any('SET LOCAL ROLE '+role+';' in s and view in s and
                                    'REVOKE SELECT' not in s for _,s in calls))
        self.assertFalse(any('GRANT SELECT' in s for _,s in calls))
        self.assertEqual(proof.snapshot.call_count,2)

    def test_readiness_requires_actual_view_results_and_effective_negative_denials(self):
        for failure in ('grant','denial','visibility'):
            with self.subTest(failure=failure):
                proof,_=self.fixture(self.ready,failure)
                with self.assertRaises(self.ready.batch.BoundaryError): proof.view_probes()


if __name__ == '__main__':
    unittest.main(verbosity=2)
