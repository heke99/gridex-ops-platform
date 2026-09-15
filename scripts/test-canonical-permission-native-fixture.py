#!/usr/bin/env python3
"""Dependency-free construction checks; native SQL acceptance is separate."""
import importlib.util
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NAME = '20260912052507_canonical_permission_overrides_and_storage_write_guards.sql'
SDD = ROOT / '.superpowers/sdd/2026-09-12-current-and-plan77-85/generated-migrations' / NAME
CI = ROOT / 'scripts/sql/forward-candidates' / NAME

class CandidateTests(unittest.TestCase):
    def test_diagnostic_append_preserves_entire_accepted_candidate(self):
        sql = CI.read_bytes()
        marker = b'-- Task11c: service-only actor-bound permission diagnostic.\n'
        self.assertEqual(sql.count(marker), 1)
        accepted = sql.split(marker)[0] + b'commit;\n'
        self.assertEqual(hashlib.sha256(accepted).hexdigest(),
                         'ac1a2b63476e1eb509b622adbfbab924f8c143c65bac3a046a739df7ea9d4536')

    def test_diagnostic_has_only_canonical_permission_delegate(self):
        sql = CI.read_text()
        self.assertIn('create or replace function public.canonical_get_platform_user_permission_diagnostic(', sql)
        body = sql.split('create or replace function public.canonical_get_platform_user_permission_diagnostic(', 1)[1].split('$function$;', 1)[0]
        self.assertIn('public.gridex_get_user_permissions(p_target_user_id)', body)
        self.assertIn('public.canonical_actor_is_platform_admin(p_actor_user_id)', body)
        self.assertLess(body.index('canonical_actor_is_platform_admin'), body.index('from auth.users'))
        for forbidden in ['user_roles', 'role_permissions', 'user_permission_overrides', 'company_memberships', 'exception when']:
            self.assertNotIn(forbidden, body)

    def test_original_102_native_cases_are_byte_identical(self):
        spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/canonical-permission-native-fixture.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original = {key: value for key, value in module.build_cases().items() if not key.startswith('D')}
        self.assertEqual(len(original), 102)
        self.assertEqual(hashlib.sha256(json.dumps(original, sort_keys=True).encode()).hexdigest(),
                         'e9f942bb0d0b5a4cbeb6bb7a747574a2d7d73c6c39ac6e1135c348087db5d527')

    def test_genuine_candidate_exists_and_ci_copy_matches(self):
        spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/canonical-permission-native-fixture.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertGreater(len(module.candidate()), 1000)
        if SDD.exists():
            self.assertEqual(SDD.read_bytes(), CI.read_bytes())

    def test_candidate_keeps_source_context_except_permission_calculation(self):
        spec = importlib.util.spec_from_file_location('admission', ROOT / 'scripts/canonical-permission-native-admission.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        original = module.admit()['original_context'].replace('public.canonical_authenticated_tenant_context(', 'public.canonical_authenticated_tenant_context_v1_scoped(', 1)
        start = original.index('  select coalesce(jsonb_agg(distinct permission.key)')
        end = original.index('\n  if v_selected_company_id is not null then', start)
        expected = original[:start] + "  if v_platform then\n" + original[start:end] + "  else\n    v_permissions := to_jsonb(gridex_private.effective_company_permissions(\n      v_user_id,v_selected_company_id,now()\n    ));\n  end if;\n" + original[end:]
        self.assertIn(expected, CI.read_text())

    def test_candidate_keeps_exact_path_body_with_only_lifecycle_conjunction(self):
        spec = importlib.util.spec_from_file_location('admission', ROOT / 'scripts/canonical-permission-native-admission.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = module.admit()['storage_private_latest']
        start = source.index('create or replace function gridex_private.')
        end = source.index('$function$;', start) + len('$function$;')
        expected = source[start:end].replace('  return coalesce(v_has_permission, false);', "  return coalesce(v_has_permission, false)\n    and case p_access\n      when 'read' then public.gridex_can_read_company(v_company_id)\n      when 'write' then public.gridex_can_write_company(v_company_id)\n      else false\n    end;")
        self.assertIn(expected, CI.read_text())

    def test_source_composition_contains_real_private_bucket_foundation(self):
        spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/canonical-permission-native-fixture.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        source = module.admission.admit()['storage_bucket_foundation']
        self.assertIn("('customer-documents', 'customer-documents', false,", source)
        self.assertIn(source, module.admission.compose())

    def test_writer_is_full_admitted_source_with_only_two_uuid_casts(self):
        spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/canonical-permission-native-fixture.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        admitted = module.admission.admit()
        original = admitted['override_writer']
        needle = 'select null,v_target_user_id,permission_key'
        self.assertEqual(original.count(needle),2)
        expected = original.replace(needle,'select null::uuid,v_target_user_id,permission_key')
        candidate = module.candidate()
        self.assertEqual(candidate.count(expected),1)
        self.assertIn(admitted['platform_command_acls'],candidate)
        self.assertIn('company_id uuid',admitted['user_permission_overrides_table'])

    def test_replacement_cases_preserve_real_command_and_transaction_contract(self):
        spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/canonical-permission-native-fixture.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        baseline = module.permission_cases(baseline=True)['P07']
        self.assertIn("'42804'",baseline)
        self.assertIn('unchanged_multisets',baseline)
        fixed = module.permission_cases()['P07']
        for token in ['replace-allow','replace-deny','replace-mixed','replace-empty']:
            self.assertIn(token,fixed)
        for label in ['replacement_rows_exact','idempotent_result_stable','local_override_preserved']:
            self.assertIn(label,fixed)
        self.assertIn("'23505'",fixed)
        self.assertIn('unchanged_multisets',fixed)

    def test_private_acl_removes_each_nonowner_grantee(self):
        sql = CI.read_text()
        self.assertIn('aclexplode', sql)
        self.assertIn('acl.grantee <> proc.proowner', sql)
        self.assertIn('revoke all on function %s from %s cascade', sql)

if __name__ == '__main__':
    unittest.main()
