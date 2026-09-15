#!/usr/bin/env python3
"""Native timestamp ledger admission tests; actual SQL remains an Actions gate."""
import importlib
import copy
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = importlib.import_module('canonical_native_timestamp_runtime')

    def test_view_witness_requires_real_runner_binding_before_and_after_execution(self):
        import canonical_added_view_witness as views
        retained=views.retain(views.ROOT)
        for defect in (None,'before','after','receipt','witness'):
            with self.subTest(defect=defect):
                events=[];parent={};runner=SimpleNamespace(target=object());forward=object()
                def admit(actual, sources, progress):
                    self.assertIs(actual,runner);self.assertIs(sources,forward);self.assertIs(progress,parent)
                    stage='before' if not events else 'after';events.append(stage)
                    if defect==stage:raise ValueError('runner ledger rejected')
                def witness(target, sources, progress):
                    self.assertIs(target,runner.target);self.assertIs(sources,retained)
                    events.append('witness')
                    receipt=views.expected_receipt(views.contract(retained),native=True)
                    if defect=='receipt':receipt['verified']=False
                    parent['addedViewSourceWitness']=receipt
                    if defect=='witness':raise ValueError('view SQL rejected')
                    return receipt
                with patch('canonical_native_final_sql.admit_forward',side_effect=admit), \
                     patch.object(views,'execute',side_effect=witness):
                    if defect:
                        with self.assertRaises(ValueError):self.m.execute_added_views(runner,retained,parent,forward)
                        if 'addedViewSourceWitness' in parent:self.assertFalse(parent['addedViewSourceWitness']['verified'])
                    else:
                        result=self.m.execute_added_views(runner,retained,parent,forward)
                        self.assertTrue(result['verified']);self.assertFalse(result['ledgerProvenanceAccepted'])
                self.assertEqual(events,['before'] if defect=='before' else
                                 ['before','witness'] if defect in ('receipt','witness') else
                                 ['before','witness','after'])

    def test_primary_failure_parser_rejects_ambiguous_or_embedded_messages(self):
        good = b'ERROR: NATIVE_TIMESTAMP_POST_BODY (SQLSTATE PT001)' + b' ' * 322
        self.assertEqual(self.m.failure_state(good), 'PT001')
        for raw in (good + b'\nERROR: second (SQLSTATE PT002)',
                    b'CONTEXT: ERROR: NATIVE_TIMESTAMP_POST_BODY (SQLSTATE PT001)',
                    good + b'\t', b'ERROR: secret@example.invalid (SQLSTATE PT001)'):
            self.assertIsNone(self.m.failure_state(raw))

    def test_failure_program_has_independent_hash_bound_name(self):
        source = SimpleNamespace(name='gridex_native_t0001_p01_' + 'a' * 12,
                                 sql=b'SELECT 1;\n')
        probe = self.m.probe_program(source, b"DO $$ BEGIN RAISE EXCEPTION 'NATIVE_TIMESTAMP_POST_BODY' USING ERRCODE='PT001'; END $$;\n")
        self.assertNotEqual(probe.name, source.name)
        self.assertTrue(probe.sql.startswith(source.sql))
        self.assertTrue(probe.name.endswith(self.m.p.sha(probe.sql)[:12]))

    def test_ledger_guard_checks_exact_program_name_and_no_bypass(self):
        sql = self.m.ledger_guard('gridex_native_t0221_p01_' + 'a' * 12,
                                "current_setting('search_path') = 'public, pg_temp'")
        self.assertIn('BEFORE INSERT ON supabase_migrations.schema_migrations', sql)
        self.assertIn('NEW.name IS DISTINCT FROM', sql)
        self.assertIn('PT002', sql)
        self.assertIn("current_setting('search_path')", sql)
        for name in ('x', "gridex_native_t0221_p01_';drop schema public;--"):
            with self.assertRaises(ValueError): self.m.ledger_guard(name, 'true')

    def test_predecessor_rejects_receipt_only_and_partial_foundation(self):
        with tempfile.TemporaryDirectory() as directory:
            for report in ({}, {'foundationInputsExecuted': 144},
                           {'foundationInputsExecuted': 144,
                            'historicalFoundation144': {'executed': True,
                            'residualInputsExecuted': 5, 'groups': []}}):
                called = []
                with self.assertRaises(ValueError):
                    self.m.predecessor(lambda query: called.append(query), Path(directory), report)
                self.assertEqual(called, [])

    def test_stale_source_hash_cannot_be_admitted_by_verified_receipts(self):
        order, pins = self.m.foundation.source_inventory()
        sources = [dict(ordinal=i, source=path, sourceSha256=pins[path])
                   for i, path in enumerate(order[:77], 1)]
        parent = {'foundationInputsExecuted':144,
                  'historicalPrefix':{'historicalPrefixLedgerVerified':True,
                                      'canonicalExecutionUnits':sources[:43]},
                  'historicalFoundation144':{'executed':True,'cumulativeFoundationInputsExecuted':144,
                    'residualInputsExecuted':7,'groups':[dict(executed=True,transactionControlsVerified=True,
                    noOpRepeatVerified=True) for _ in range(7)]}}
        ranges = (('historicalLegacy52',43,52),('historicalRepair56',52,56),
                  ('historicalDedupe57',56,57),('historicalFixed63',57,63),
                  ('historicalAlignment68',63,68),('historicalOperations77',68,77))
        for key, start, end in ranges:
            parent[key] = dict(verified=True,cumulativeFoundationInputsExecuted=end,sources=sources[start:end])
        parent['historicalOperations77']['groups'] = [{'sources':sources[68:77]}]
        parent['historicalPrefix']['canonicalExecutionUnits'][0]['sourceSha256'] = '0'*64
        sql = Mock(side_effect=AssertionError('must reject before reading database'))
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(
                ValueError, 'NATIVE_TIMESTAMP_FOUNDATION_REQUIRED'):
            self.m.predecessor(sql, Path(directory), parent)
        sql.assert_not_called()

    def fixture_runner(self, directory, *, ledger=None, failure=False, snapshots=None):
        folder = Path(directory)
        folder.chmod(0o700)
        name = 'gridex_native_t0001_p01_'+self.m.p.sha(b'SELECT 1;\n')[:12]
        unit = SimpleNamespace(name=name,sql=b'SELECT 1;\n')
        path = folder / ('20260910000001_'+name+'.sql')
        path.write_bytes(unit.sql)
        path.chmod(0o600)
        meta = path.stat()
        entries = [{'version':'20260910000000','name':'prior','statements':['SELECT 0']}]
        correct = entries + [{'version':'20260910000001','name':name,'statements':['SELECT 1']}]
        runner = self.m.Runner.__new__(self.m.Runner)
        runner.directory, runner.entries, runner.retained = folder, entries, []
        runner.native = Mock(return_value=SimpleNamespace(returncode=1 if failure else 0,
            stderr=b'ERROR: NATIVE_TIMESTAMP_POST_BODY (SQLSTATE PT001)\n'))
        runner.sql = Mock(return_value=correct if ledger is None else ledger(entries,correct))
        runner.target = SimpleNamespace(snapshot=Mock(side_effect=snapshots or [{'rows':'before'}]),
                                        sql=Mock(return_value='[]'))
        runner.create = Mock(return_value=(path,(meta.st_dev,meta.st_ino)))
        return runner, unit

    def test_apply_checks_real_statement_ledger_not_only_success_or_name(self):
        def wrong_statements(prior, correct):
            altered = copy.deepcopy(correct)
            altered[-1]['statements'] = ['SELECT 2']
            return altered
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory,ledger=wrong_statements)
            with self.assertRaisesRegex(ValueError, 'NATIVE_EXECUTED_STATEMENTS_REQUIRED'):
                runner.apply(unit)
            self.assertEqual(len(runner.entries),1)
            self.assertEqual(runner.retained,[])

    def test_apply_rejects_modified_earlier_ledger_even_if_new_statement_matches(self):
        def changed_prior(prior, correct):
            altered = copy.deepcopy(correct)
            altered[0]['statements'] = ['SELECT 99']
            return altered
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory,ledger=changed_prior)
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_LEDGER_REQUIRED'):
                runner.apply(unit)
            self.assertEqual(len(runner.entries),1)

    def test_failed_apply_requires_actual_row_catalog_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory,failure=True,
                ledger=lambda prior,correct:prior,snapshots=[{'rows':'before'},{'rows':'changed'}])
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_FAILED_UNIT_ROLLBACK_REQUIRED'):
                runner.apply(unit)

    def test_failure_control_rejects_changed_earlier_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory,failure=True,
                ledger=lambda prior,correct:[{**prior[0],'statements':['SELECT 99']}])
            # Post-body fault has its own derived name and bytes. Use the real
            # private-file verifier, while replacing only unavailable CLI staging.
            def create(program):
                path = Path(directory)/('20260910000001_'+program.name+'.sql')
                for old in Path(directory).iterdir(): old.unlink()
                path.write_bytes(program.sql);path.chmod(0o600)
                meta=path.stat()
                return path,(meta.st_dev,meta.st_ino)
            runner.create.side_effect=create
            with self.assertRaisesRegex(ValueError, 'NATIVE_TIMESTAMP_EARLIER_LEDGER_CHANGED'):
                runner.qualify_failure(unit)

    def test_successful_apply_retains_exact_program_and_statement_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory)
            receipt = runner.apply(unit)
            self.assertEqual(len(runner.entries),2)
            self.assertEqual(runner.retained[0][1],unit.sql)
            self.assertTrue(receipt['unchangedEarlierLedger'])
            self.assertFalse(receipt['originalHistoricalVersionMarkedApplied'])

    def test_failure_control_rejects_provider_drift_with_unchanged_catalog_and_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory,failure=True,
                ledger=lambda prior,correct:prior,snapshots=[{'rows':'before'},{'rows':'before'}])
            for path in Path(directory).iterdir(): path.unlink()
            def create(program):
                path=Path(directory)/('20260910000001_'+program.name+'.sql')
                path.write_bytes(program.sql);path.chmod(0o600)
                meta=path.stat()
                return path,(meta.st_dev,meta.st_ino)
            runner.create.side_effect=create
            runner.target.sql.side_effect=['[]',json.dumps([{'enabled':'D'}])]
            with self.assertRaisesRegex(ValueError,'NATIVE_TIMESTAMP_ROLLBACK_REQUIRED'):
                runner.qualify_failure(unit)
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_noop_repeat_rejects_provider_drift_even_with_unchanged_statement_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            runner,unit = self.fixture_runner(directory,ledger=lambda prior,correct:prior,
                snapshots=[{'rows':'before'},{'rows':'before'}])
            runner.target.sql.side_effect=['[]',json.dumps([{'enabled':'D'}])]
            with self.assertRaisesRegex(ValueError,'NATIVE_TIMESTAMP_REPEAT_REQUIRED'):
                runner.repeat()


class FoundationReceipt(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m=importlib.import_module('canonical_native_timestamp_runtime')
        cls.groups=cls.m.foundation.prepare()
        cls.end=dict(executed=True,foundationInputsExecuted=67,residualInputsExecuted=7,
                     cumulativeFoundationInputsExecuted=144,supportSha256=dict(cls.m.foundation.SUPPORT_PINS),groups=[])
        for g in cls.groups:
            modes=(('portable','55000'),) if g.index==7 else ()
            modes+=(('mid','P1480'),('post','P1481'),('ledger','P1482'))
            cls.end['groups'].append(dict(index=g.index,kind=g.kind,executed=True,noOpRepeatVerified=True,
                unchangedEarlierLedger=True,canonicalUnitAtomic=True,transactionControlsVerified=True,
                cases=[dict(expectedSqlstate=code,catalogAndRowsRestored=True,ledgerUnchanged=True,
                            programSha256=cls.m.p.sha(cls.m.foundation.render(g,failure=mode).sql))
                       for mode,code in modes],
                programSha256=cls.m.p.sha(cls.m.foundation.render(g).sql),
                sources=[{**s.receipt(),'nativeExecutionBodySha256':cls.m.p.sha(cls.m.foundation.native_body(s)),
                          'nativeEnvironmentAdmissionTransferred':s.source==cls.m.foundation.DB2_PREFLIGHT}
                         for s in g.steps]))

    def test_full_seven_group_receipt_matches_current_programs(self):
        self.m.verify_foundation_end(self.end)

    def test_wrong_control_program_hash_fails_even_with_matching_sqlstate(self):
        for index in range(7):
            value=copy.deepcopy(self.end)
            value['groups'][index]['cases'][0]['programSha256']='0'*64
            with self.subTest(group=index+1):
                with self.assertRaises(ValueError): self.m.verify_foundation_end(value)

    def test_changed_source_receipts_and_support_pins_are_rejected(self):
        for index, group in enumerate(self.end['groups']):
            for offset in range(len(group['sources'])):
                value = copy.deepcopy(self.end)
                value['groups'][index]['sources'][offset]['sourceSha256'] = '0' * 64
                with self.subTest(group=index + 1, source=offset):
                    with self.assertRaises(ValueError): self.m.verify_foundation_end(value)
        value = copy.deepcopy(self.end)
        value['supportSha256'] = {}
        with self.assertRaises(ValueError): self.m.verify_foundation_end(value)

    def test_missing_or_unproved_failure_case_is_rejected(self):
        for index in range(7):
            for field in ('catalogAndRowsRestored', 'ledgerUnchanged'):
                value = copy.deepcopy(self.end)
                value['groups'][index]['cases'][0][field] = False
                with self.assertRaises(ValueError): self.m.verify_foundation_end(value)
            value = copy.deepcopy(self.end)
            value['groups'][index]['cases'].pop()
            with self.assertRaises(ValueError): self.m.verify_foundation_end(value)

    def test_missing_group7_or_incomplete_rollback_evidence_is_rejected(self):
        for field in ('executed','noOpRepeatVerified','unchangedEarlierLedger','canonicalUnitAtomic','transactionControlsVerified'):
            value=copy.deepcopy(self.end);value['groups'][-1][field]=False
            with self.assertRaises(ValueError): self.m.verify_foundation_end(value)
        value=copy.deepcopy(self.end);value['groups'].pop()
        with self.assertRaises(ValueError): self.m.verify_foundation_end(value)


class LedgerReadback(unittest.TestCase):
    def exercise(self, fault=None):
        from datetime import datetime,timedelta
        m=importlib.import_module('canonical_native_timestamp_runtime');p=m.p
        with tempfile.TemporaryDirectory() as root:
            directory=Path(root);directory.chmod(0o700);units=[];entries=[]
            for i in range(65):
                version=(datetime(2026,9,15,12)+timedelta(seconds=i)).strftime('%Y%m%d%H%M%S')
                name=f'prior_{i:02d}';body=f'SELECT {i};'.encode();filename=f'{version}_{name}.sql'
                path=directory/filename;path.write_bytes(body);path.chmod(0o600)
                statements=[f'SELECT {i}']
                units.append(dict(cliFile=filename,programSha256=p.sha(body),
                                  ledgerStatementsSha256=p.sha(json.dumps(statements,separators=(',',':')).encode())))
                entries.append(dict(version=version,name=name,statements=statements))
            target=directory/units[24]['cliFile']
            if fault=='statements':entries[24]['statements']=['SELECT 999']
            if fault=='bytes':target.write_bytes(b'SELECT 999;')
            if fault=='hash':units[24]['programSha256']='0'*64
            if fault=='ledger_hash':units[24]['ledgerStatementsSha256']='0'*64
            if fault=='mode':target.chmod(0o644)
            if fault=='symlink':target.unlink();target.symlink_to(directory/units[0]['cliFile'])
            if fault=='extra':(directory/'unadmitted.sql').write_bytes(b'SELECT 1;')
            if fault=='missing':entries.pop()
            if fault=='order':entries[1],entries[2]=entries[2],entries[1]
            if fault=='duplicate':entries[24]=copy.deepcopy(entries[23])
            if fault=='duplicate_units':
                target.unlink();entries[24]=copy.deepcopy(entries[23]);units[24]=copy.deepcopy(units[23])
            if fault=='short_units':units.pop()
            def sql(query):
                self.assertEqual(query,p.LEDGER_SQL)
                return copy.deepcopy(entries)
            if fault:
                with self.assertRaises(ValueError): m.read_predecessor_ledger(sql,directory,units)
            else:
                actual,retained=m.read_predecessor_ledger(sql,directory,units)
                self.assertEqual(len(retained),65)
                self.assertEqual(actual,entries)
                for item in retained:p.verify_private(*item)

    def test_all65_files_and_statements_are_read_back(self): self.exercise()
    def test_earlier_ledger_or_file_mutations_are_rejected(self):
        for fault in ('statements','bytes','hash','ledger_hash','mode','symlink','extra','missing','order','duplicate','duplicate_units','short_units'):
            with self.subTest(fault=fault): self.exercise(fault)


if __name__ == '__main__': unittest.main()
