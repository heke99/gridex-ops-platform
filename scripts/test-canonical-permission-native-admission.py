#!/usr/bin/env python3
"""Dependency-free tests of the bounded source intake. No SQL runtime claims."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('permission_admission', HERE / 'canonical-permission-native-admission.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MANIFEST = json.loads(MODULE.MANIFEST.read_text())


class AdmissionTests(unittest.TestCase):
    def test_actual_all_source_hashes_and_complete_slices(self):
        admitted = MODULE.admit()
        self.assertEqual((len(MANIFEST['sources']), len(admitted)), (33, 82))
        self.assertEqual(sum(row['kind'] == 'function' for row in MANIFEST['slices']), 28)

    def test_parent_source_tamper_rejected_before_slice_admission(self):
        original = Path.read_bytes
        target = MODULE.ROOT / MANIFEST['slices'][0]['source']
        def read(path):
            data = original(path)
            return data + b'\n-- changed parent source\n' if path == target else data
        with patch.object(Path, 'read_bytes', read):
            with self.assertRaisesRegex(MODULE.AdmissionError, '^SOURCE_HASH_MISMATCH$'):
                MODULE.admit()

    def test_slice_tamper_rejected_even_with_original_source(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest['slices'][1]['sha256'] = '0' * 64
        with self.assertRaisesRegex(MODULE.AdmissionError, '^SLICE_HASH_MISMATCH$'):
            MODULE.admit(manifest=manifest)

    def test_duplicate_slice_rejected(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest['slices'].append(manifest['slices'][0])
        with self.assertRaisesRegex(MODULE.AdmissionError, '^SLICE_ID_INVALID_OR_DUPLICATE$'):
            MODULE.admit(manifest=manifest)

    def test_paths_cannot_escape_or_alias_source_roots(self):
        for path in ('/tmp/source.sql', '../source.sql', 'supabase/migrations/../../../x',
                     'supabase/migrations/./x.sql', 'supabase//migrations/x.sql',
                     'app/schema.sql', 'supabase/migrations/../../.agent-memory/current-state.md'):
            with self.subTest(path=path), self.assertRaises(MODULE.AdmissionError):
                MODULE.source_path(MODULE.ROOT, path)

    def test_signature_declaration_drift_rejected(self):
        manifest = copy.deepcopy(MANIFEST)
        row = next(row for row in manifest['slices'] if row['id'] == 'override_writer')
        row['declaration'] = row['declaration'].replace('p_command jsonb', 'p_command text')
        with self.assertRaisesRegex(MODULE.AdmissionError, '^FUNCTION_DECLARATION_MISMATCH$'):
            MODULE.admit(manifest=manifest)

    def test_wrong_function_name_rejected(self):
        manifest = copy.deepcopy(MANIFEST)
        row = next(row for row in manifest['slices'] if row['id'] == 'override_writer')
        row['function_name'] = 'public.handwritten_auth_stub'
        with self.assertRaisesRegex(MODULE.AdmissionError, '^FUNCTION_SIGNATURE_MISMATCH$'):
            MODULE.admit(manifest=manifest)

    def test_truncated_body_rejected_independent_of_hash(self):
        manifest = copy.deepcopy(MANIFEST)
        row = next(row for row in manifest['slices'] if row['id'] == 'override_writer')
        row['end'] -= len('$function$;')
        data = (MODULE.ROOT / row['source']).read_bytes()[row['start']:row['end']]
        row['sha256'] = hashlib.sha256(data).hexdigest()
        with self.assertRaisesRegex(MODULE.AdmissionError, '^FUNCTION_BODY_NOT_COMPLETE$'):
            MODULE.admit(manifest=manifest)

    def test_source_definition_ambiguity_rejected(self):
        manifest = copy.deepcopy(MANIFEST)
        row = next(row for row in manifest['slices'] if row['id'] == 'override_writer')
        target = MODULE.ROOT / row['source']
        original = Path.read_bytes
        data = original(target)
        changed = data + b'\n' + data[row['start']:row['end']] + b'\n'
        manifest['sources'][row['source']] = MODULE.digest(changed)
        def read(path):
            return changed if path == target else original(path)
        with patch.object(Path, 'read_bytes', read):
            with self.assertRaisesRegex(MODULE.AdmissionError, '^SOURCE_FUNCTION_NOT_UNIQUE$'):
                MODULE.admit(manifest=manifest)

    def test_explicit_source_subset_composes_without_read_only_witnesses(self):
        sql = MODULE.compose()
        admitted = MODULE.admit()
        for entry in MANIFEST['slices']:
            if entry.get('read_only_witness'):
                self.assertNotIn(admitted[entry['id']], sql)
            else:
                self.assertIn(admitted[entry['id']], sql)

    def test_unclosed_composition_never_produces_sql(self):
        manifest = copy.deepcopy(MANIFEST)
        manifest['composition_gates'][0]['status'] = 'OPEN'
        with self.assertRaisesRegex(MODULE.AdmissionError, '^SOURCE_COMPOSITION_NOT_ADMITTED$'):
            MODULE.compose(manifest=manifest)

    def test_setting_gate_flags_cannot_execute_read_only_policy_witnesses(self):
        manifest = copy.deepcopy(MANIFEST)
        for gate in manifest['composition_gates']:
            gate['status'] = 'CLOSED'
        manifest['composition_order'] = [row['id'] for row in manifest['slices']]
        with self.assertRaisesRegex(MODULE.AdmissionError, '^SOURCE_COMPOSITION_ORDER_INVALID$'):
            MODULE.compose(manifest=manifest)

    def test_original_command_transaction_and_error_contract_retained(self):
        body = MODULE.admit()['override_writer']
        for fragment in ('pg_advisory_xact_lock', 'canonical_json_sha256(v_request)',
                         'IDEMPOTENCY_KEY_REUSE_MISMATCH', "errcode='23514', message='permission_allow_deny_overlap'",
                         "errcode='22023', message='permission_not_found'", 'canonical_platform_access_audit_events',
                         'canonical_platform_access_command_results', 'company_id is null'):
            self.assertIn(fragment, body)
        self.assertNotIn('p_selected_company_id', body)

    def test_original_context_admission_and_selection_difference_retained(self):
        body = MODULE.admit()['original_context']
        self.assertIn("profile.user_status='active'", body)
        self.assertIn('u.email_confirmed_at is not null', body)
        selection = body[body.index('select company_id into v_selected_company_id'):body.index('limit 1;', body.index('select company_id into v_selected_company_id'))]
        self.assertIn('from public.user_roles user_role', selection)
        self.assertNotIn('join public.roles', selection)
        self.assertIn('join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)', body)
        self.assertNotIn('user_permission_overrides', body)
        self.assertNotIn('user_permissions ', body)

    def test_original_context_rename_and_latest_delegate_retained(self):
        admitted = MODULE.admit()
        self.assertIn('rename to canonical_authenticated_tenant_context_v1_scoped;', admitted['original_context_rename'])
        self.assertIn('from public, anon, authenticated, service_role;', admitted['original_context_rename'])
        self.assertIn('return public.canonical_authenticated_tenant_context_v1_scoped(p_selected_company_id);', admitted['context_delegate'])

    def test_both_scope_triggers_and_real_single_active_constraint_retained(self):
        admitted = MODULE.admit()
        self.assertIn('coalesce(new.role, r.key, r.name)', admitted['text_and_definition_scope_guard'])
        self.assertIn('user_roles_global_platform_scope_guard', admitted['text_and_definition_scope_trigger'])
        self.assertIn('gridex_user_roles_scope_consistent', admitted['definition_scope_trigger'])
        self.assertIn('on public.user_roles(company_id, user_id)', admitted['single_active_company_role'])
        self.assertIn("coalesce(status, 'active') = 'active'", admitted['single_active_company_role'])

    def test_platform_predicate_differences_are_not_rewritten(self):
        admitted = MODULE.admit()
        canonical, current = admitted['canonical_platform_actor'], admitted['platform_actor_current_user']
        self.assertNotIn('email_confirmed_at', canonical)
        self.assertIn('email_confirmed_at is not null', current)
        self.assertNotRegex(canonical, r'(?<![a-z_])r\.is_active')
        self.assertNotRegex(current, r'(?<![a-z_])r\.is_active')
        self.assertIn('create table if not exists public.admin_users', admitted['admin_users_bootstrap'])

    def test_array_acl_and_private_storage_boundary_retained(self):
        admitted = MODULE.admit()
        self.assertIn('gridex_get_user_permissions_in_company(uuid, uuid) from anon, authenticated, public;', admitted['array_and_boolean_acls'])
        private = admitted['storage_private_latest']
        self.assertIn('create schema if not exists gridex_private;', private)
        self.assertIn('revoke all on schema gridex_private from public, anon;', private)
        self.assertIn('to authenticated, service_role;', private)
        self.assertIn('drop function public.gridex_customer_document_path_allows(text, text);', private)

    def test_storage_old_body_and_exact_policy_family_retained(self):
        admitted = MODULE.admit()
        private = admitted['storage_private_latest']
        self.assertIn('array_length(v_parts, 1), 0) <> 7', private)
        self.assertIn('cs.customer_id = v_customer_id', private)
        self.assertIn('cs.company_id = v_company_id', private)
        self.assertEqual(private.count('create policy customer_documents_storage_'), 4)
        self.assertEqual(private.count("bucket_id = 'customer-documents'"), 5)
        self.assertNotIn('gridex_can_write_company', private)
        self.assertIn('customer_documents_storage_service_role_all', admitted['storage_public_predecessor'])

    def test_full_operation_metadata_body_and_explicit_unexercised_branch(self):
        admitted = MODULE.admit()
        body = admitted['operation_metadata']
        for fragment in ('public.companies%rowtype', 'public.company_capabilities%rowtype',
                         'public.integration_api_clients', "c.profile_key = 'tenant_website'",
                         'public.canonical_ediel_production_evidence_readiness(p_company_id)'):
            self.assertIn(fragment, body)
        self.assertEqual(MANIFEST['excluded_runtime_branches'][0]['branch'], 'ediel.production.send')

    def test_access_write_revokes_have_no_fixture_write_grant(self):
        admitted = MODULE.admit()
        for table in ('companies', 'company_memberships', 'user_roles', 'company_invitations'):
            self.assertIn('revoke insert, update, delete on public.' + table + ' from anon, authenticated;', admitted['access_table_write_revokes'])
        self.assertNotIn('grant ', admitted['access_table_write_revokes'])


if __name__ == '__main__':
    unittest.main()
