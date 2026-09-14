#!/usr/bin/env python3
"""Exact source/transaction regressions; offline tests are not native execution."""
import copy
import importlib.util
from pathlib import Path
import sys
import subprocess
import tempfile
from unittest.mock import patch
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import canonical_native_historical_prefix as prefix
import canonical_native_lock_boundary as boundary

ROOT = Path(__file__).resolve().parents[1]
LOCK_SOURCES = {27: 1, 28: 1, 29: 2, 43: 2}
TAG = '$gridex_native_lock$'


class LockAdapterTests(unittest.TestCase):
    def test_every_known_top_level_lock_gets_an_atomic_invoker_context(self):
        programs = prefix.prepare()
        for program in programs:
            original = (ROOT/'supabase'/program.source).read_bytes()
            self.assertEqual(prefix.sha(original), program.source_sha256)
            top = prefix.statements(program.sql.decode())
            self.assertFalse(any(s[0][0].upper() == 'LOCK' for s in top), program.source)
            self.assertEqual(program.sql.count(TAG.encode()), 2 * LOCK_SOURCES.get(program.ordinal, 0))

    def test_only_lock_context_changes_not_timeouts_names_modes_or_order(self):
        for program in prefix.prepare():
            raw = (ROOT/'supabase'/program.source).read_text()
            old = prefix.statements(raw)
            if program.outer_transaction_transferred:
                raw = raw[old[1][0][1]:old[-2][-1][2]]+';\n'
            # Remove exactly our context wrapper; source bytes must be identical.
            restored = program.sql.decode().replace('DO '+TAG+'\nBEGIN\n', '').replace('\nEND\n'+TAG+';', '')
            self.assertEqual(restored, raw, program.source)
            self.assertNotIn('SECURITY DEFINER', program.sql.decode())

    def test_unknown_or_changed_lock_source_is_not_admitted(self):
        program = prefix.prepare()[26]
        raw = (ROOT/'supabase'/program.source).read_bytes()
        for changed in (raw+b'\n', raw.replace(b'access exclusive', b'share'),
                        b'BEGIN; LOCK TABLE public.anything; SELECT 1; COMMIT;'):
            with self.assertRaises(prefix.PrefixError):
                prefix.cli_program(changed)

    def test_ledger_cannot_claim_original_top_level_lock_for_adapted_unit(self):
        p = prefix.prepare()[26]
        text = p.sql.decode()
        parts = []
        start = 0
        for token, _, end in prefix.sql_tokens(text):
            if token == ';':
                parts.append(text[start:end].rstrip(';').strip()); start = end
        if text[start:].strip(): parts.append(text[start:].strip())
        filename = '20260914150000_'+p.name+'.sql'
        entry = {'version': filename[:14], 'name': p.name, 'statements': parts}
        prefix.verify_entry(entry, filename, p)
        changed = copy.deepcopy(entry)
        changed['statements'] = [s.replace('DO '+TAG+'\nBEGIN\n', '').replace('\nEND\n'+TAG, '') for s in parts]
        with self.assertRaises(prefix.PrefixError):
            prefix.verify_entry(changed, filename, p)


class NativeProofControlTests(unittest.TestCase):
    def exercise(self, fault=None):
        program = prefix.prepare()[26]
        state = {'trigger': False, 'runs': 0}
        ledger = [{'version': '20260914000000', 'name': 'existing', 'statements': ['SELECT 0']}]
        expected = copy.deepcopy(ledger)
        initial = {'temporarySchema': False, 'temporaryTrigger': False, 'rows': [1]}
        report = {}
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            migrations = work/'supabase/migrations'
            migrations.mkdir(parents=True, mode=0o700)
            first = migrations/'20260914000000_existing.sql'
            first.write_bytes(b'')
            inode = prefix.private_write(first, b'SELECT 0;')
            retained = [(first, b'SELECT 0;', inode)]
            def sql(query):
                if query == prefix.LEDGER_SQL:
                    return copy.deepcopy(ledger)
                if query == boundary.SNAPSHOT:
                    value = copy.deepcopy(initial)
                    value['temporarySchema'] = value['temporaryTrigger'] = state['trigger']
                    if fault == 'schema' and state['runs']:
                        value['rows'] = [1, 999]
                    return value
                if query == boundary.DROP_TRIGGER:
                    self.assertTrue(state['trigger'])
                    state['trigger'] = False
                    return True
                self.assertIn('CREATE TRIGGER gridex_native_tx27_guard', query)
                self.assertIn("mode='AccessExclusiveLock' AND granted", query)
                self.assertIn("current_setting('lock_timeout') <> '5s'", query)
                self.assertIn("current_setting('statement_timeout') <> '30s'", query)
                self.assertIn("ERRCODE='P2728'", query)
                self.assertNotIn('SECURITY DEFINER', query)
                state['trigger'] = True
                return True
            def native(*args, **kwargs):
                if args[:2] == ('migration', 'new'):
                    self.assertRegex(args[2], r'^gridex_native_f0027_[a-f0-9]{12}$')
                    p = migrations/(f"2026091400000{state['runs']+1}_"+args[2]+'.sql')
                    p.write_bytes(b'')
                    return subprocess.CompletedProcess(args, 0, b'', b'')
                self.assertEqual(args, ('migration', 'up', '--local'))
                self.assertTrue(kwargs['allow_failure'])
                p = next(p for p in migrations.iterdir() if p != first)
                raw = p.read_bytes()
                expected_state = '25P01' if state['runs'] == 0 else ('P2728' if state['trigger'] else 'P2727')
                self.assertEqual(raw.count(boundary.OPEN.encode()), 0 if state['runs'] == 0 else 1)
                state['runs'] += 1
                if fault == 'ledger': ledger.append({'version': 'forged'})
                if fault == 'file': p.write_bytes(b'SELECT 999;')
                code = 'P2700' if fault == 'sqlstate' else expected_state
                return subprocess.CompletedProcess(args, 0 if fault == 'unexpected-success' else 1,
                                                   b'', ('private SQLSTATE '+code+' private').encode())
            with patch.object(boundary.time, 'sleep'):
                try:
                    boundary.qualify(prefix, native, sql, work, program, expected, retained, report)
                except prefix.PrefixError as error:
                    return error.args[0], report, state
            self.assertEqual(list(migrations.iterdir()), [first])
            self.assertEqual(ledger, expected)
        return None, report, state

    def test_real_callbacks_require_three_failures_and_exact_restoration(self):
        error, report, state = self.exercise()
        self.assertIsNone(error)
        self.assertTrue(report['verified'])
        self.assertEqual([r['expectedSqlstate'] for r in report['cases']], ['25P01', 'P2727', 'P2728'])
        self.assertFalse(state['trigger'])
        self.assertTrue(report['lockHeldAtLedgerInsert'])
        self.assertNotIn('private', str(report))

    def test_success_wrong_error_ledger_schema_and_private_file_mutations_reject(self):
        for fault in ('unexpected-success', 'sqlstate', 'ledger', 'schema', 'file'):
            with self.subTest(fault=fault):
                error, report, state = self.exercise(fault)
                self.assertIsNotNone(error)
                self.assertFalse(report['verified'])
                self.assertEqual(state['runs'], 1)

    def test_adapter_rejects_changed_body_even_with_original_hash(self):
        p = prefix.prepare()[26]
        raw = (ROOT/'supabase'/p.source).read_bytes()
        with self.assertRaises(prefix.PrefixError):
            boundary.adapt(raw, b'LOCK TABLE public.someone_else;', prefix.statements, prefix.PrefixError)

    def test_boundary_is_mandatory_in_ordinary_entry_and_no_full_acceptance(self):
        text = (ROOT/'scripts/canonical_native_historical_prefix.py').read_text()
        self.assertIn('if program.ordinal == 27:', text)
        self.assertIn('qualify_lock_boundary(sys.modules[__name__]', text)
        self.assertIn("raise RuntimeError('NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED')",
                      (ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
