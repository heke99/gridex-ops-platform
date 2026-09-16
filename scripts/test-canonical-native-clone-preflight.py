#!/usr/bin/env python3
"""Offline preflight callback controls, not native SQL qualification."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
import canonical_native_timestamp_proof as proof

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('clone_preflight',ROOT/'scripts/canonical-native-clone-preflight.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class PreflightTests(unittest.TestCase):
    def target(self, *, changed_ledger=False, bad_rows=False, leftover=False):
        ledger=[dict(version='20260915120000',name='native_lifecycle_proof',statements=['SELECT 1'])]
        def sql(database,query,stage):
            return json.dumps([] if changed_ledger else ledger) if stage=='clone_preflight_ledger' else json.dumps(not bad_rows)
        return SimpleNamespace(clone=Mock(),drop_clone=Mock(),close=Mock(),sql=Mock(side_effect=sql),
                               _oid=Mock(return_value='123' if leftover else None)),Mock(return_value=ledger)

    def test_success_retains_narrow_scope_and_closes_target(self):
        target,sql=self.target()
        with patch.object(proof,'NativeTimestampTarget',return_value=target):
            result=m.qualify(Mock(),sql,'fixture')
        self.assertTrue(result['cloneDisposed'])
        self.assertFalse(result['completeReplayVerified'])
        self.assertFalse(result['generatedTypesVerified'])
        target.close.assert_called_once()

    def test_changed_clone_missing_row_or_failed_disposal_never_qualifies(self):
        for options in (dict(changed_ledger=True),dict(bad_rows=True),dict(leftover=True)):
            target,sql=self.target(**options)
            with patch.object(proof,'NativeTimestampTarget',return_value=target),self.assertRaisesRegex(
                    ValueError,'NATIVE_TIMESTAMP_CLONE_PREFLIGHT_REQUIRED'):
                m.qualify(Mock(),sql,'fixture')
            target.close.assert_called_once()

    def test_clone_failure_is_preserved_and_target_closed(self):
        target,sql=self.target();target.clone.side_effect=ValueError('NATIVE_TIMESTAMP_CLONE_CREATE_OTHER')
        with patch.object(proof,'NativeTimestampTarget',return_value=target),self.assertRaisesRegex(
                ValueError,'NATIVE_TIMESTAMP_CLONE_CREATE_OTHER'):
            m.qualify(Mock(),sql,'fixture')
        target.close.assert_called_once()
        target.sql.assert_not_called()

if __name__=='__main__':unittest.main()
