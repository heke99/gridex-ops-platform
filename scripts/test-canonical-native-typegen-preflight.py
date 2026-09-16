#!/usr/bin/env python3
"""Negative controls for synthetic CLI output and owned state admission."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import canonical_native_typegen_preflight as m

RAW = b'''export type Json = string | number | null
export type Database = {
  public: {
    Tables: {
      gridex_native_lifecycle_probe: {
        Row: { id: number }
      }
    }
  }
}
'''


class Tests(unittest.TestCase):
    def setup_case(self):
        target = Mock(spec=["snapshot", "assert_native_owned", "close"])
        target.snapshot.return_value = ('catalog', 'rows')
        native = Mock(return_value=SimpleNamespace(returncode=0, stdout=RAW))
        return target, native, Mock(return_value=['actual-ledger'])

    def run_case(self, target, native, sql):
        with patch('canonical_native_timestamp_proof.NativeTimestampTarget', return_value=target):
            return m.qualify(Mock(), native, sql, 'gridex-sb-123456789012-1234567890123456')

    def test_genuine_command_twice_and_preservation(self):
        target, native, sql = self.setup_case()
        result = self.run_case(target, native, sql)
        self.assertTrue(result['genuineCliTypegenExecuted'])
        self.assertFalse(result['generatedTypesVerified'])
        self.assertFalse(result['schemaAccepted'])
        self.assertEqual(native.call_count, 2)
        self.assertEqual(native.call_args.args, ('--network-id', 'gridex-sb-123456789012-1234567890123456-network',
            'gen', 'types', '--local', '--lang', 'typescript', '--schema', 'public'))
        target.close.assert_called_once()

    def test_failed_or_unrelated_output_rejected_and_disposed(self):
        for code, raw in [(1, RAW), (0, b'error'), (0, RAW.replace(b'id: number', b'id: string')),
                          (0, RAW.replace(b'id: number', b'id: number; never_committed: number'))]:
            with self.subTest(code=code, raw=raw):
                target, native, sql = self.setup_case()
                native.return_value = SimpleNamespace(returncode=code, stdout=raw)
                with self.assertRaises(ValueError): self.run_case(target, native, sql)
                target.close.assert_called_once()

    def test_state_ledger_or_repeat_drift_rejected(self):
        for defect in ('schema', 'ledger', 'repeat'):
            with self.subTest(defect=defect):
                target, native, sql = self.setup_case()
                if defect == 'schema': target.snapshot.side_effect = [('catalog','rows'), ('changed','rows')]
                if defect == 'ledger': sql.side_effect = [['actual-ledger'], ['different']]
                if defect == 'repeat': native.side_effect = [SimpleNamespace(returncode=0,stdout=RAW), SimpleNamespace(returncode=0,stdout=RAW+b'\n')]
                with self.assertRaises(ValueError): self.run_case(target, native, sql)
                target.close.assert_called_once()


if __name__ == '__main__': unittest.main()
