#!/usr/bin/env python3
"""Offline boundaries for owned Storage initialization, not SQL acceptance."""
import copy
import hashlib
import importlib.util
import sys
from unittest.mock import patch
import canonical_storage_bootstrap as m
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RoutingTests(unittest.TestCase):
    def test_full_clone_initializes_storage_before_any_foundation_source(self):
        source = (ROOT/'scripts/canonical-full-permission-clone-qualification.py').read_text()
        self.assertTrue('target.bootstrap_sql()' in source)
        self.assertLess(source.index('target.bootstrap_sql()'), source.index('loop.run(str(hold), paths)'))
        self.assertNotIn('GRANT SELECT', source[source.index('def matrix('):source.index('def qualify(')])


class RuntimeProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT/'scripts/canonical-auth-provisioning-legacy-batch.py'
        spec = importlib.util.spec_from_file_location('storage_profile_legacy',path)
        cls.legacy = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.legacy
        spec.loader.exec_module(cls.legacy)

    def test_profile_is_explicit_and_default_bytes_stay_unchanged(self):
        original = (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_bytes()
        default = self.legacy.OwnedPostgres()
        selected = self.legacy.OwnedPostgres(storage_dml=True)
        self.assertEqual(default.bootstrap_sql(),original.decode())
        self.assertEqual(selected.bootstrap_sql(),m.render(original))
        for value in (None,1,'true',{},[]):
            with self.assertRaises(self.legacy.BoundaryError):
                self.legacy.OwnedPostgres(storage_dml=value)

    def test_changed_profile_cannot_be_used_after_construction(self):
        target = self.legacy.OwnedPostgres(storage_dml=True)
        target._storage_dml = False
        with self.assertRaisesRegex(self.legacy.BoundaryError,'OWNED_PROFILE_REQUIRED'):
            target.bootstrap_sql()

    def test_independent_prefix_uses_the_same_selected_bootstrap(self):
        target = self.legacy.OwnedPostgres(storage_dml=True)
        originals = self.legacy.verified_prefix()
        seen = []
        def private(name,raw):
            seen.append((name,raw))
            return name
        with patch.object(target,'reset'),patch.object(target,'private',side_effect=private), \
             patch.object(target,'run_files') as run:
            target.prefix('gridex_auth_legacy_reference')
        self.assertEqual(seen[0],('bootstrap.sql',target.bootstrap_sql()))
        self.assertEqual([raw for _,raw in seen[2:]],[raw for _,raw in originals])
        self.assertEqual(run.call_args.kwargs,{'transaction':False})
        self.assertEqual(len(seen),45)

    def test_full_clone_selects_profile_before_independent_reference_creation(self):
        source = (ROOT/'scripts/canonical-full-permission-clone-qualification.py').read_text()
        self.assertTrue('with legacy.OwnedPostgres(postgis=True, storage_dml=True) as target:' in source)
        self.assertLess(source.index('storage_dml=True'),source.index('prepare_reference(target'))
        self.assertIn('target.bootstrap_sql()',source)


class ContractTests(unittest.TestCase):
    def profile(self, allowed=True):
        return [{'object_name': table, 'role_name': role, 'privilege_name': privilege,
                 'allowed': allowed, 'rls_enabled': True}
                for table, role, privilege in sorted(m.KEYS)]

    def test_original_bootstrap_bytes_and_all_migration_authority_are_preserved(self):
        original = (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_bytes()
        result = m.render(original)
        self.assertTrue(result.encode().startswith(original))
        self.assertEqual(result.encode()[len(original):],m.INITIALIZE.encode())
        self.assertEqual(hashlib.sha256(original).hexdigest(),m.BOOTSTRAP_SHA)
        for bad in (original+b'\n', original.decode(), b'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;'):
            with self.assertRaisesRegex(ValueError,'EXACT_STORAGE_BOOTSTRAP_SOURCE_REQUIRED'):
                m.render(bad)

    def test_only_finite_platform_dml_on_pristine_owned_storage_is_added(self):
        grants = [line.strip() for line in m.INITIALIZE.splitlines() if line.strip().startswith('GRANT ')]
        self.assertEqual(grants,['GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO anon, authenticated, service_role;'])
        self.assertLess(m.INITIALIZE.index('GRANT SELECT'),m.INITIALIZE.index('END\n$storage_bootstrap$;'))
        for required in ('current_database()', 'public.companies', 'public.company_memberships',
                         'EXISTS (SELECT FROM storage.buckets)', 'EXISTS (SELECT FROM storage.objects)',
                         'relrowsecurity', 'pg_policy', "ERRCODE='42501'"):
            self.assertIn(required,m.INITIALIZE)
        for forbidden in ('DISABLE ROW LEVEL SECURITY', 'CREATE POLICY', 'ALTER ROLE',
                          'GRANT ALL', 'TRUNCATE', 'BYPASSRLS', 'SECURITY DEFINER'):
            self.assertNotIn(forbidden,m.INITIALIZE)

    def test_complete_native_and_missing_grant_negative_profiles(self):
        for allowed in (True,False):
            self.assertEqual(len(m.validate(self.profile(allowed),allowed=allowed)),24)
            with self.assertRaises(ValueError):m.validate(self.profile(allowed),allowed=not allowed)

    def test_unknown_duplicate_or_incomplete_profile_never_passes(self):
        original = self.profile()
        for bad in ([],original[:-1],original+[original[0]],original[:-1]+[original[0]],{},None):
            with self.assertRaises(ValueError):m.validate(bad,allowed=True)
        for field,value in (('allowed',1),('rls_enabled',False),('rls_enabled',1),
                            ('role_name','arbitrary'),('object_name','public.customer_data'),
                            ('privilege_name','TRUNCATE'),('role_name',[])):
            bad = copy.deepcopy(original);bad[0][field]=value
            with self.assertRaises(ValueError):m.validate(bad,allowed=True)
        bad = copy.deepcopy(original);bad[0]['private']='not a receipt'
        with self.assertRaises(ValueError):m.validate(bad,allowed=True)

    def test_profile_is_read_only_fixed_metadata_without_application_rows(self):
        for forbidden in ('UPDATE ', 'INSERT INTO', 'DELETE FROM', 'GRANT ', 'public.', 'auth.users', '*'):
            self.assertNotIn(forbidden,m.CAPTURE)
        self.assertIn('has_table_privilege',m.CAPTURE)
        self.assertIn('c.relrowsecurity',m.CAPTURE)


if __name__ == '__main__':
    unittest.main(verbosity=2)
