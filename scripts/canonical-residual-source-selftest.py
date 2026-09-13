#!/usr/bin/env python3
"""Source-admission and negative-control tests, not native replay acceptance."""
from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT/'scripts'/(name+'.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


restored = load('canonical-residual-source-restoration')
frontier = load('canonical-foundation-frontier-diagnostic')


class ResidualSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.order, cls.report = frontier.verify_selection(frontier.load_controller())
        cls.selected, _ = frontier.load_timestamp().load_inputs(ROOT, cls.report, cls.order)

    def test_all_four_immutable_sources_selected_once_at_reviewed_boundaries(self):
        restored.validate_selection(self.order)
        restored.validate_timestamp(self.selected)
        rows = {r['path']:r for r in self.report['migrations']}
        for source, (digest, ordinal) in restored.SOURCES.items():
            stage = 'foundation' if source in restored.FOUNDATION_SOURCES else 'timestamp'
            self.assertEqual(rows[source]['classification'], 'FULL_FILE_SELECTED')
            self.assertEqual(rows[source]['sha256'], digest)
            self.assertEqual(rows[source]['execution'], [{'stage':stage,'ordinal':ordinal}])
        self.assertEqual(self.report['selectedInputCounts'], {'foundation':144,'timestamp':514})
        self.assertEqual(self.report['counts'], {'FULL_FILE_SELECTED':589, 'SUBSTITUTED':2,
                                                'UNCLASSIFIED':5, 'EXPLICITLY_EXCLUDED':5})
        self.assertFalse(self.report['sqlExecutionVerified'])
        self.assertFalse(self.report['ledgerProvenanceVerified'])

    def test_misordered_missing_and_duplicate_foundation_source_rejected(self):
        source = next(iter(restored.FOUNDATION_SOURCES))
        for order in ([p for p in self.order if p != source], self.order+[source], list(reversed(self.order))):
            with self.assertRaisesRegex(ValueError, 'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.validate_selection(order)

    def test_guard_source_runs_only_after_both_required_tables_exist_in_history(self):
        source = next(iter(restored.TIMESTAMP_SOURCES))
        index = next(i for i,(p,_) in enumerate(self.selected) if p == source)
        earlier = [p for p,_ in self.selected[:index]]
        self.assertIn('migrations/20260608120000_metering_billing_pricing_engine.sql', earlier)
        self.assertIn('migrations/20260613090000_batch_m_ops_master_legal_readiness.sql', earlier)
        self.assertNotIn(source, self.order)
        self.assertEqual(self.selected[index-1][0], 'migrations/20260614140000_ops_production_multitenant_readiness.sql')
        self.assertEqual(self.selected[index+1][0], 'migrations/20260615090000_batch_o_grid_owner_verification.sql')

    def test_changed_timestamp_hash_order_and_duplicates_rejected(self):
        source = next(iter(restored.TIMESTAMP_SOURCES))
        n = next(i for i,(p,_) in enumerate(self.selected) if p == source)
        wrong_pin = list(self.selected); wrong_pin[n] = (source, '0'*64)
        wrong_order = list(self.selected); wrong_order[n],wrong_order[n-1] = wrong_order[n-1],wrong_order[n]
        for values in (wrong_pin, wrong_order, self.selected+[self.selected[n]], self.selected[:n]+self.selected[n+1:]):
            with self.assertRaisesRegex(ValueError, 'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.validate_timestamp(values)

    def test_mutated_or_symlinked_source_bytes_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root/'supabase/migrations').mkdir(parents=True)
            for source in restored.FOUNDATION_SOURCES:
                (root/'supabase'/source).write_bytes((ROOT/'supabase'/source).read_bytes())
            source = root/'supabase'/next(iter(restored.FOUNDATION_SOURCES))
            source.write_text(source.read_text()+'\n-- changed\n')
            with patch.object(restored,'ROOT',root), self.assertRaisesRegex(ValueError, 'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.validate_selection(self.order)
            source.unlink(); source.symlink_to(ROOT/'supabase'/next(iter(restored.FOUNDATION_SOURCES)))
            with patch.object(restored,'ROOT',root), self.assertRaisesRegex(ValueError, 'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.validate_selection(self.order)

    def test_fail_closed_assertions_and_all_seven_real_guards(self):
        for source in restored.SOURCES:
            self.assertGreaterEqual(len(restored.checks(source)), 11)
            for expression in restored.checks(source):
                self.assertIn('IS DISTINCT FROM true', restored.assertion(expression))
                self.assertIn("ERRCODE='23514'", restored.assertion(expression))
        source = next(iter(restored.TIMESTAMP_SOURCES))
        text = '\n'.join(restored.checks(source))
        self.assertEqual(len(restored.GUARDS), 7)
        for table in restored.GUARDS:
            self.assertIn('gridex_'+table+'_company_guard_tg', text)
        self.assertIn("tgenabled='O'", text)

    def test_unknown_source_has_no_implicit_acceptance(self):
        for method in (restored.checks, restored.negative_sql):
            with self.assertRaisesRegex(ValueError, 'UNREVIEWED_RESIDUAL_SOURCE'):
                method('migrations/unreviewed.sql')

    def test_unknown_target_rejected_before_any_command(self):
        class Target:
            def command(self,*args):
                raise AssertionError('unsafe target reached')
        source = next(iter(restored.SOURCES))
        for database in ('production','postgres','postgresql://example/production'):
            with self.assertRaisesRegex(ValueError, 'RESIDUAL_OWNED_SOURCE_REQUIRED'):
                restored.verify(Target(),database,source,142)

    def test_ack_prerequisite_is_exact_source_column_not_fabricated_business_data(self):
        source = (ROOT/'supabase/migrations/20260529_batch_2_rulebook_hardening_and_systemtest_ui.sql').read_text()
        path = 'bootstrap/20260529_ediel_ack_negative_aperak_prerequisite.sql'
        sql = (ROOT/'supabase'/path).read_text()
        metadata = json.loads((ROOT/'scripts/gridex-aud-003-legacy-foundation.additions.json').read_text())['derivedBootstrap'][path]
        self.assertEqual(hashlib.sha256(sql.encode()).hexdigest(),metadata['artifactSha256'])
        self.assertIn('negative_aperak_on_error boolean not null default true', source)
        self.assertIn('ADD COLUMN negative_aperak_on_error boolean NOT NULL DEFAULT true', sql)
        self.assertIn('EDIEL_ACK_PREREQUISITE_COLUMN_SHAPE_MISMATCH',sql)
        for forbidden in ('INSERT INTO', 'DELETE FROM', 'DROP TABLE', 'DISABLE TRIGGER', 'BYPASSRLS'):
            self.assertNotIn(forbidden,sql.upper())

    def test_rulebook_completion_is_before_the_list_type_conversion(self):
        self.assertEqual(self.order[86], restored.RULEBOOK_COMPLETION)
        self.assertEqual(self.order[87], 'migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql')
        self.assertEqual(restored.SOURCES[restored.RULEBOOK_COMPLETION][1], 87)
        proof = load('canonical-auth-provisioning-diagnostics-selftest')
        for first, second in ((85,86),(86,87),(87,88)):
            order = list(self.order); order[first],order[second] = order[second],order[first]
            with self.assertRaises(AssertionError):
                proof.retained_suffix_digest(order)
        self.assertEqual(proof.retained_suffix_digest(self.order),proof.SUFFIX_SHA)

    def test_all_three_seed_matrices_compare_authored_values(self):
        for table,count in (('ediel_field_rules',13),('ediel_ack_rules',9),('ediel_message_build_rules',5)):
            sql = restored.rulebook_seed_check(table)
            self.assertEqual(sql.count("  ('"),count)
            self.assertIn('WHERE NOT EXISTS',sql)
            self.assertIn('IS NOT DISTINCT FROM',sql)
            self.assertNotIn('on conflict',sql)
        converted = restored.rulebook_seed_check('ediel_field_rules',True)
        self.assertIn('jsonb_array_elements_text(e.allowed_values)',converted)
        self.assertIn('a.allowed_values IS NOT DISTINCT FROM ARRAY(',converted)
        self.assertIn("field_key='transaction_type'",restored.negative_sql(restored.RULEBOOK_COMPLETION))

    def test_seed_oracle_rejects_unreviewed_tables_and_options(self):
        for table,converted in (('customers',False),('ediel_ack_rules',True),('ediel_field_rules',1)):
            with self.assertRaisesRegex(ValueError,'UNREVIEWED_RULEBOOK_SEED'):
                restored.rulebook_seed_check(table,converted)

    def test_seed_oracle_revalidates_immutable_bytes_at_use(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root/'supabase/migrations').mkdir(parents=True)
            path = root/'supabase'/restored.RULEBOOK_COMPLETION
            path.write_bytes((ROOT/'supabase'/restored.RULEBOOK_COMPLETION).read_bytes()+b'\n-- unexpected')
            with patch.object(restored,'ROOT',root), self.assertRaisesRegex(ValueError,'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.rulebook_seed_check('ediel_field_rules')

    def test_conversion_verifier_rejects_other_target_and_boundary(self):
        class Target:
            active=True; name='owned'; _created_name='owned'
            def command(self,*args): raise AssertionError('unexpected command')
        source = 'migrations/20260529_batch_2_rulebook_hardening_sql_fix_v4.sql'
        for database,relative,ordinal in (('production',source,88),('gridex_auth_legacy_replay',source,87),('gridex_auth_legacy_replay','migrations/unknown.sql',88)):
            with self.assertRaisesRegex(ValueError,'RESIDUAL_OWNED_SOURCE_REQUIRED'):
                restored.verify_rulebook_conversion(Target(),database,relative,ordinal)

    def test_retained_selection_and_seed_oracles_never_reopen_originals(self):
        retained=tuple((ROOT/'supabase'/relative).read_bytes() for relative in self.order)
        raw=retained[86]
        expected=restored.rulebook_seed_check('ediel_field_rules',True)
        def no_originals(*args,**kwargs):
            raise AssertionError('original migration was reopened after HOLD staging')
        with patch.object(Path,'read_bytes',no_originals):
            restored.validate_selection(self.order,retained)
            actual=restored.rulebook_seed_check('ediel_field_rules',True,source_bytes=raw)
            self.assertEqual(actual,expected)
            self.assertEqual(len(restored.checks(restored.RULEBOOK_COMPLETION,rulebook_bytes=raw)),13)

    def test_retained_selection_rejects_shape_changes_and_byte_mutation(self):
        retained=tuple((ROOT/'supabase'/relative).read_bytes() for relative in self.order)
        for wrong in (list(retained),retained[:-1],retained+(b'extra',),tuple(str(i) for i in retained)):
            with self.assertRaisesRegex(ValueError,'RESIDUAL_RETAINED_BYTES_MISMATCH'):
                restored.validate_selection(self.order,wrong)
        for relative,(_,ordinal) in restored.FOUNDATION_SOURCES.items():
            wrong=list(retained);wrong[ordinal-1]+=b'\n-- unexpected change'
            with self.assertRaisesRegex(ValueError,'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.validate_selection(self.order,tuple(wrong))

    def test_retained_seed_bytes_reject_wrong_source_type_or_content(self):
        raw=(ROOT/'supabase'/restored.RULEBOOK_COMPLETION).read_bytes()
        for wrong in (b'',raw+b'\n',raw.decode(),bytearray(raw)):
            with self.assertRaisesRegex(ValueError,'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
                restored.rulebook_seed_check('ediel_field_rules',source_bytes=wrong)

    def test_retained_sources_do_not_make_a_changed_order_acceptable(self):
        retained=tuple((ROOT/'supabase'/relative).read_bytes() for relative in self.order)
        order=list(self.order);values=list(retained)
        order[86],order[87]=order[87],order[86]
        values[86],values[87]=values[87],values[86]
        with self.assertRaisesRegex(ValueError,'RESIDUAL_WHOLE_SOURCE_OR_ORDER_MISMATCH'):
            restored.validate_selection(order,tuple(values))

    def test_role_bootstrap_remains_hash_bound_with_no_new_elevated_privileges(self):
        proof = load('canonical-auth-provisioning-diagnostics-selftest')
        data = (ROOT/proof.BOOTSTRAP).read_bytes()
        self.assertEqual(hashlib.sha256(data).hexdigest(),proof.BOOTSTRAP_SHA)
        clause = 'create role supabase_privileged_role nologin inherit nocreaterole nocreatedb noreplication nobypassrls;'
        self.assertEqual(data.decode().count(clause),1)
        self.assertNotEqual(hashlib.sha256(data+b'\n-- mutation').hexdigest(),proof.BOOTSTRAP_SHA)


if __name__=='__main__':
    unittest.main()
