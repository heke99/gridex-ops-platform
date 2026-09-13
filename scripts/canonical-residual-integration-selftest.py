#!/usr/bin/env python3
"""Residual integration admission and retained-source regressions; no SQL claims."""
import importlib.util
import json
from pathlib import Path
from types import MappingProxyType
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(filename):
    spec = importlib.util.spec_from_file_location('residual_integration_test_module', ROOT/'scripts'/filename)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Target:
    active = True
    name = _created_name = 'unit-test-owner'
    def command(self, database):
        if database != 'gridex_auth_legacy_replay':
            raise AssertionError('wrong fixed test target')


class IntegrationTests(unittest.TestCase):
    maxDiff = 1000

    def setUp(self):
        self.m = load('canonical-residual-replay.py')
        self.raw = {p: (ROOT/'supabase'/p).read_bytes() for p in self.m.source_pins()}
        self.order = json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']

    def prepared(self):
        return self.m.prepare(ROOT, self.raw.__getitem__)

    def test_each_source_is_read_once_and_retained_without_io_fallback(self):
        reads = []
        def read(p):
            reads.append(p)
            return self.raw[p]
        prepared = self.m.prepare(ROOT,read)
        self.assertIsInstance(prepared,MappingProxyType)
        self.assertEqual(len(reads),9)
        self.assertEqual(set(reads),set(self.raw))
        with patch.object(Path,'read_bytes',side_effect=AssertionError('source reopened')):
            runtime = self.m.ResidualReplay(Target(),prepared,self.order)
        self.assertEqual(runtime.prepared[1][runtime.prepared[0].LOCKS], self.raw[runtime.prepared[0].LOCKS])
        self.assertEqual(len(runtime.db2_prepared[1]),2)
        with self.assertRaises(TypeError):
            prepared[reads[0]] = b'changed'

    def test_changed_source_or_authority_rejected_before_database_use(self):
        for p in self.raw:
            for value in (self.raw[p]+b'\n', self.raw[p].decode(), bytearray(self.raw[p])):
                with self.subTest(source=p,type=type(value).__name__):
                    changed = dict(self.raw); changed[p] = value
                    with self.assertRaisesRegex(ValueError,'RESIDUAL_RETAINED_SOURCE_MISMATCH'):
                        self.m.prepare(ROOT,changed.__getitem__)

    def test_missing_retained_source_does_not_reopen_existing_original(self):
        for p in self.raw:
            changed = dict(self.raw);del changed[p]
            with self.assertRaises(KeyError):
                self.m.prepare(ROOT,changed.__getitem__)

    def test_wrong_order_or_incomplete_bundle_rejected(self):
        order = list(self.order);order[98],order[99]=order[99],order[98]
        with self.assertRaisesRegex(ValueError,'RESIDUAL_FOUNDATION_ORDER_MISMATCH'):
            self.m.ResidualReplay(Target(),self.prepared(),order)
        for data in (dict(self.prepared()), MappingProxyType({}), MappingProxyType({**self.raw,'migrations/new.sql':b''})):
            with self.assertRaisesRegex(ValueError,'RESIDUAL_RETAINED_SOURCE_MISMATCH'):
                self.m.ResidualReplay(Target(),data,self.order)

    def test_remote_and_inactive_targets_rejected(self):
        class Inactive(Target):
            active=False
        class Rebound(Target):
            name='production'
        for target in (object(),'postgresql://example/production',Inactive(),Rebound()):
            with self.assertRaisesRegex(ValueError,'RESIDUAL_OWNED_TARGET_REQUIRED'):
                self.m.ResidualReplay(target,self.prepared(),self.order)

    def test_boundary_skip_or_reorder_permanently_poisons_runtime(self):
        for ordinal,relative in ((79,self.order[78]),(78,self.order[79]),(True,self.order[77])):
            runtime=self.m.ResidualReplay(Target(),self.prepared(),self.order)
            with patch.object(self.m,'apply_prefix'):
                runtime.after_prefix()
                with self.assertRaisesRegex(ValueError,'RESIDUAL_BOUNDARY_SEQUENCE_MISMATCH'):
                    runtime.before_source(ordinal,relative)
                self.assertEqual(runtime.state,'FAILED')
                with self.assertRaisesRegex(ValueError,'RESIDUAL_BOUNDARY_SEQUENCE_MISMATCH'):
                    runtime.after_prefix()

    def test_prefix_failure_and_reentry_are_terminal(self):
        runtime=self.m.ResidualReplay(Target(),self.prepared(),self.order)
        with patch.object(self.m,'apply_prefix',side_effect=RuntimeError('injected')):
            with self.assertRaisesRegex(RuntimeError,'injected'):
                runtime.after_prefix()
        self.assertEqual(runtime.state,'FAILED')
        with self.assertRaisesRegex(ValueError,'RESIDUAL_BOUNDARY_SEQUENCE_MISMATCH'):
            runtime.after_prefix()

    def test_finish_without_every_boundary_cannot_publish_a_receipt(self):
        runtime=self.m.ResidualReplay(Target(),self.prepared(),self.order)
        with self.assertRaisesRegex(ValueError,'RESIDUAL_FOUNDATION_INCOMPLETE'):
            runtime.finish()
        self.assertEqual(runtime.state,'FAILED')

    def test_native_prefix_sql_is_unchanged_from_verified_candidate(self):
        import ast
        old=ast.parse((ROOT/'scripts/canonical-residual-transition-native.py').read_text())
        new=ast.parse((ROOT/'scripts/canonical-residual-replay.py').read_text())
        labels=('residual_intake_policy_bindings','residual_two_tenant_seven_predicate_cases')
        def statements(tree):
            return {n.args[2].value:n.args[1].value for n in ast.walk(tree)
                if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='sql'
                and len(n.args)>2 and isinstance(n.args[2],ast.Constant) and n.args[2].value in labels}
        self.assertEqual(set(statements(new)),set(labels))
        self.assertEqual(statements(old),statements(new))

    def test_full_foundation_uses_shared_residual_executor(self):
        text = (ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text()
        self.assertIn('load_residual_replay().prepare', text)
        self.assertIn('residual.after_prefix()', text)
        self.assertIn('residual.before_source(ordinal,relative)', text)
        self.assertIn('residual.after_source(ordinal,relative)', text)
        self.assertIn('residual.finish()', text)

    def test_shared_module_exists(self):
        self.assertTrue((ROOT/'scripts/canonical-residual-replay.py').is_file())


if __name__ == '__main__':
    unittest.main()
