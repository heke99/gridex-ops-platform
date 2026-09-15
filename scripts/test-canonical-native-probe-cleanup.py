#!/usr/bin/env python3
"""Offline admission, exact deletion and failure controls; no PG17 claim."""
import copy
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import canonical_native_probe_cleanup as m


class Tests(unittest.TestCase):
    def snapshot(self):
        keys = list(m.BASE_KEYS) + [m.POLICY_KEY]
        catalog = {key: {'fixture': key} for key in keys}
        catalog['relation/public.real_application_table'] = {'owner': 'postgres'}
        rows = {m.TABLE: [1, m.ROW_HASH], 'public.real_application_table': [2, 'unchanged']}
        return ((catalog, rows), ['provider-event']), keys

    def test_exact_removal_rejects_other_rows_catalog_provider_or_missing_probe(self):
        before, keys = self.snapshot()
        expected = m.expected_after(before, keys)
        self.assertEqual(expected, (({'relation/public.real_application_table': {'owner': 'postgres'}},
                                    {'public.real_application_table': [2, 'unchanged']}), ['provider-event']))
        for defect in ('row', 'key', 'extra', 'unrelated'):
            value = copy.deepcopy(before)
            removed = keys[:]
            if defect == 'row': value[0][1][m.TABLE][0] = 2
            if defect == 'key': removed.pop()
            if defect == 'extra': value[0][0]['trigger/'+m.TABLE+'/unrecognized'] = {}
            if defect == 'unrelated': removed.append('relation/public.real_application_table')
            with self.subTest(defect=defect), self.assertRaises(ValueError):
                m.expected_after(value, removed)

    def test_program_pins_policy_evolution_and_only_fixed_restrict_drop(self):
        program = m.program()
        self.assertEqual(program.name, 'gridex_native_probe_cleanup_'+m.p.sha(program.sql)[:12])
        text = program.sql.decode()
        self.assertIn('DROP TABLE public.gridex_native_lifecycle_probe RESTRICT;', text)
        self.assertNotIn('CASCADE', text)
        self.assertIn('CREATE TEMP TABLE gridex_native_cleanup_shape', text)
        self.assertIn('(select auth.uid())', text)
        self.assertIn('NATIVE_CLEANUP_DEPENDENCY', text)
        with patch.object(m, 'PINS', {**m.PINS, next(iter(m.PINS)): '0'*64}):
            with self.assertRaisesRegex(ValueError, 'SOURCE'): m.program()

    def test_negative_control_requires_exact_error_and_full_restoration(self):
        for ledger, wrong_error, changed in ((False,False,False),(True,False,False),(False,True,False),
                                            (True,True,False),(False,False,True),(True,False,True)):
            with self.subTest(ledger=ledger, wrong_error=wrong_error, changed=changed), tempfile.TemporaryDirectory() as tmp:
                directory=Path(tmp); program=m.program()
                runner=SimpleNamespace(directory=directory, target=Mock(), unchanged=Mock(), sql=Mock(return_value=True))
                runner.native=Mock(return_value=SimpleNamespace(returncode=1,
                    stderr=b'ERROR: wrong (SQLSTATE PC001)\n' if wrong_error else
                           (m.LEDGER_ERROR if ledger else m.POST_ERROR)+b'\n'))
                def create(unit):
                    path=directory/('20260915000000_'+unit.name+'.sql')
                    path.touch(mode=0o600)
                    physical=m.p.private_write(path, unit.sql)
                    return path, physical
                runner.create=create
                with patch.object(m.timestamp, 'native_snapshot', side_effect=['same','changed' if changed else 'same']):
                    if wrong_error or changed:
                        with self.assertRaises(ValueError): m.negative(runner, program, ledger=ledger)
                    else:
                        result=m.negative(runner, program, ledger=ledger)
                        self.assertTrue(result['catalogAndRowsRestored'])
                self.assertEqual(list(directory.iterdir()), [])
                if ledger: self.assertEqual(runner.sql.call_args.args, (m.GUARD_DROP,))

    def test_final_sql_and_real_forward_admission_precede_any_creation(self):
        runner=SimpleNamespace(create=Mock())
        with patch('canonical_native_final_sql.admit_forward') as admit:
            with self.assertRaisesRegex(ValueError, 'FINAL_SQL'):
                m.execute(runner, (), {})
        admit.assert_called_once_with(runner, (), {})
        runner.create.assert_not_called()

    def test_success_binds_real_file_ledger_and_rejects_other_state_changes(self):
        from canonical_native_final_sql import PINS
        for mutation in (None,'catalog','rows','provider','earlier_ledger'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as tmp:
                program=m.program()
                before,keys=self.snapshot(); after=copy.deepcopy(m.expected_after(before,keys))
                if mutation=='catalog': after[0][0]['relation/public.real_application_table']['owner']='wrong'
                if mutation=='rows': after[0][1]['public.real_application_table']=[3,'wrong']
                if mutation=='provider': after[1].append('unexpected')
                runner=object.__new__(m.timestamp.Runner)
                runner.entries=[dict(version='20260914000000', name='earlier',statements=['SELECT 1'])]
                runner.retained=[('earlier','bytes','physical')]
                runner.target=Mock(assert_native_owned=Mock()); runner.unchanged=Mock(); runner.repeat=Mock()
                runner.sql=Mock(side_effect=lambda sql: [] if sql==m.DEPENDENCIES else True)
                def apply(unit):
                    path=Path(tmp)/('20260915000000_'+unit.name+'.sql');path.touch(mode=0o600)
                    physical=m.p.private_write(path,unit.sql)
                    statements=[' '.join(tokens) for tokens in m.p.identity(unit.sql.decode())]
                    runner.entries.append(dict(version=path.name[:14],name=unit.name,statements=statements))
                    runner.retained.append((path,unit.sql,physical))
                    if mutation=='earlier_ledger': runner.entries[0]['name']='changed'
                    return dict(cliFile=path.name,programSha256=m.p.sha(unit.sql),unchangedEarlierLedger=True,
                        originalHistoricalVersionMarkedApplied=False,ledgerStatementsSha256=m.p.sha(
                            m.json.dumps(statements,separators=(',',':')).encode()))
                runner.apply=apply
                parent=dict(nativeFinalSql=dict(verified=True,checks=[dict(source=path,sourceSha256=sha,
                    verified=True,catalogAndRowsPreserved=True,ledgerUnchanged=True) for path,sha in PINS.items()]))
                def negative(runner,unit,*,ledger):
                    return dict(expectedSqlstate='PC002' if ledger else 'PC001',
                        programSha256=m.p.sha(unit.sql if ledger else unit.sql+m.POST),
                        catalogAndRowsRestored=True,ledgerUnchanged=True)
                with patch('canonical_native_final_sql.admit_forward'), patch.object(m,'negative',side_effect=negative),\
                     patch.object(m.timestamp,'native_snapshot',side_effect=[before,after]):
                    if mutation:
                        with self.assertRaisesRegex(ValueError,'EXACT_STATE'): m.execute(runner,(),parent)
                        runner.repeat.assert_not_called()
                    else:
                        result=m.execute(runner,(),parent)
                        self.assertTrue(result['verified'])
                        self.assertEqual(result['actualLedgerRows'],2)
                        runner.repeat.assert_called_once()
                        runner.entries[0]['statements']=['SELECT 2']
                        with self.assertRaisesRegex(ValueError,'RECEIPT'): m.admit_completed(runner,parent)


if __name__ == '__main__': unittest.main()
