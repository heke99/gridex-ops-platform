#!/usr/bin/env python3
"""Final SQL admission/rollback transport tests; actual PostgreSQL is separate."""
from pathlib import Path
import tempfile
import json
import copy
import hashlib
import subprocess
import canonical_forward_sources as forward_sources
import canonical_native_forward_runtime as forward_runtime
import canonical_native_historical_prefix as p
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
import canonical_native_final_sql as m

ROOT=Path(__file__).resolve().parents[1]

class FinalSqlTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.retained=m.retain(ROOT)
        cls.forward=forward_sources.retain(ROOT)
    def diagnostic(self, lines, *, raw=None, stage='final_sql_5', state=b'P0001', count=None, code=3):
        stderr=(b'psql:<stdin>:271: ERROR:  P0001: Tenant isolation invariants failed ('
                +str(len(lines) if count is None else count).encode()+b' breach(es)):\n  - '
                +b'\n  - '.join(lines)+b'\nCONTEXT:  private context\nLOCATION:  private location\n')
        return m.invariant_failure_diagnostic(stage, raw or self.retained[-1][1].decode(),
            '00000', [state], subprocess.CompletedProcess([],code,b'private stdout',stderr))

    def test_invariant_diagnostic_identifies_rules_without_exporting_names_or_rows(self):
        lines=[b'F-6: table private_table is not classified in platform_table_classification',
            b'F-6: private_table is reachable by a client role but has no restrictive company guard for command r',
            b'F-6: table private_table has row level security disabled',
            b'F-3: tenant table private_table holds 7 row(s) with no company_id',
            b'F-8/F-10: unique index private_index on tenant table private_table is not scoped by company_id',
            b'F-13: view private_view does not set security_invoker',
            b'F-14: 3 policy/policies target roles with no privileges on their table and are inert',
            b'F-16: private_function(uuid) is executable by authenticated and is reachable as REST RPC',
            b'F-16: SECURITY DEFINER function private_function(uuid) is executable by anon',
            b'F-7: 2 user_role row(s) have an inconsistent platform/company scope']
        result=self.diagnostic(lines)
        self.assertEqual(result['status'],'RECOGNIZED')
        self.assertEqual(result['breachCount'],10)
        self.assertEqual([r['rule'] for r in result['breaches']], [
            'F6_UNCLASSIFIED','F6_COMPANY_GUARD','F6_RLS_DISABLED','F3_TENANT_NULL',
            'F8_F10_UNSCOPED_UNIQUE','F13_VIEW_INVOKER','F14_INERT_POLICY',
            'F16_CLIENT_RESOLVER','F16_ANON_DEFINER','F7_ROLE_SCOPE'])
        self.assertEqual(result['breaches'][0]['objectSha256'],[hashlib.sha256(b'private_table').hexdigest()])
        self.assertEqual(result['breaches'][3]['affectedCount'],7)
        self.assertNotIn('private',json.dumps(result))

    def test_invariant_diagnostic_unknown_injected_or_truncated_stream_never_reports_partial_truth(self):
        valid=b'F-13: view private_view does not set security_invoker'
        for lines,count in (([valid,b'private secret unknown'],None),([valid],2),
                ([valid+b'\nERROR:  42501: private injected'],None),
                ([b'F-14: 999999999999999 policy/policies target roles with no privileges on their table and are inert'],None)):
            with self.subTest(lines=lines):
                self.assertEqual(self.diagnostic(lines,count=count),{'status':'UNRECOGNIZED'})
        for change in ({'raw':'SELECT 1'},{'stage':'final_sql_4'},{'state':b'42501'},{'code':0}):
            self.assertIsNone(self.diagnostic([valid],**change))
    def fixture(self):
        runner=object.__new__(m.timestamp.Runner)
        runner.target=SimpleNamespace(assert_native_owned=Mock(),sql=Mock())
        runner.unchanged=Mock()
        parent=dict(foundationInputsExecuted=144,timestampInputsExecuted=514,
            forwardSources=dict(executed=True,inputsExecuted=len(m.FORWARD_SOURCES),sources=[
                dict(source=path,sourceSha256=digest,executed=True,noOpRepeatVerified=True,rowsPreserved=True)
                for path,digest in m.FORWARD_SOURCES]))
        directory=tempfile.TemporaryDirectory();self.addCleanup(directory.cleanup)
        runner.entries=[None]*(65+514+4);runner.retained=[None]*len(runner.entries)
        parent['historicalTimestampTail']=dict(actualLedgerRows=len(runner.entries))
        for i,(program,receipt) in enumerate(zip(forward_runtime.programs(self.forward),parent['forwardSources']['sources'])):
            path=Path(directory.name)/(f'202609152359{i:02d}_'+program.name+'.sql')
            path.write_bytes(program.sql);path.chmod(0o600);stat=path.stat()
            source=program.sql.decode();fragments=[];start=0
            for token,_,end in p.sql_tokens(source):
                if token==';':
                    fragments.append(source[start:end].rstrip(';').strip());start=end
            if source[start:].strip():fragments.append(source[start:].strip())
            entry=dict(version=path.name[:14],name=program.name,statements=fragments)
            runner.entries.append(entry);runner.retained.append((path,program.sql,(stat.st_dev,stat.st_ino)))
            receipt.update(cliFile=path.name,programSha256=p.sha(program.sql),stage='VERIFIED',
                unchangedEarlierLedger=True,outerTransactionTransferredToCli=True,originalHistoricalVersionMarkedApplied=False,
                ledgerStatementsSha256=p.sha(json.dumps(entry['statements'],separators=(',',':')).encode()),
                cases=[dict(expectedSqlstate=state,programSha256=p.sha(body),catalogAndRowsRestored=True,ledgerUnchanged=True)
                       for state,body in [('PF001',program.sql+forward_runtime.POST),('PF002',program.sql)]])
        parent['forwardSources']['actualLedgerRows']=len(runner.entries)
        return runner,parent
    def test_real_pinned_bytes_are_used_without_reopening_after_admission(self):
        runner,parent=self.fixture()
        with patch.object(Path,'read_bytes',side_effect=AssertionError('reopened')),patch.object(
                m.timestamp,'native_snapshot',return_value=({},[])):
            result=m.execute(runner,self.retained,parent,self.forward)
        self.assertTrue(result['verified']);self.assertFalse(result['schemaAccepted'])
        self.assertFalse(result['generatedTypesVerified'])
        self.assertEqual([c.args[1].encode() for c in runner.target.sql.call_args_list],[raw for _,raw in self.retained])
        self.assertEqual([c.kwargs['transaction'] for c in runner.target.sql.call_args_list],[True,False,False,False,True])
    def test_partial_prefix_unverified_forward_or_duplicate_gate_cannot_reach_sql(self):
        for case in ('partial','unverified','duplicate'):
            runner,parent=self.fixture()
            if case=='partial':parent['timestampInputsExecuted']=513
            elif case=='unverified':parent['forwardSources']['sources'][-1]['noOpRepeatVerified']=False
            else:parent['nativeFinalSql']={}
            with self.assertRaisesRegex(ValueError,'NATIVE_FINAL_SQL_COMPLETE_PREFIX_REQUIRED'):
                m.execute(runner,self.retained,parent,self.forward)
            runner.target.sql.assert_not_called()
    def test_sql_error_or_row_change_stops_later_gates_without_acceptance(self):
        for failure in ('sql','state'):
            runner,parent=self.fixture()
            if failure=='sql':runner.target.sql.side_effect=ValueError('SQL-failed')
            with patch.object(m.timestamp,'native_snapshot',side_effect=[({},[]),({},['changed'])]),self.assertRaises(ValueError):
                m.execute(runner,self.retained,parent,self.forward)
            self.assertFalse(parent['nativeFinalSql']['verified'])
            self.assertEqual(len(parent['nativeFinalSql']['checks']),1)

    def test_final_invariant_error_preserves_current_closed_diagnostic_in_report(self):
        runner,parent=self.fixture()
        runner.target._recent_sql_failure={'stale':'must not escape'}
        diagnostic=dict(stage='OTHER',actual='ASSERTION',tenantInvariants=dict(status='UNRECOGNIZED'))
        def failed(database,sql,stage,**kwargs):
            self.assertIsNone(runner.target._recent_sql_failure)
            if stage=='final_sql_5':
                runner.target._recent_sql_failure=diagnostic
                raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
        runner.target.sql.side_effect=failed
        with patch.object(m.timestamp,'native_snapshot',return_value=({},[])):
            with self.assertRaisesRegex(ValueError,'^NATIVE_TIMESTAMP_SQL_RESULT$'):
                m.execute(runner,self.retained,parent,self.forward)
        report=parent['nativeFinalSql']
        self.assertFalse(report['verified'])
        self.assertFalse(report['schemaAccepted'])
        self.assertFalse(report['generatedTypesVerified'])
        self.assertEqual([x['verified'] for x in report['checks']],[True,True,True,True,False])
        self.assertEqual(report['checks'][-1]['nativeSqlFailure'],diagnostic)
        self.assertNotIn('stale',json.dumps(report))

    def test_psql_rejection_is_projected_into_fifth_check_and_survives_later_diagnostics(self):
        from canonical_native_timestamp_proof import NativeTimestampTarget
        runner,parent=self.fixture()
        target=object.__new__(NativeTimestampTarget)
        target._last_sql_failure=None
        target._recent_sql_failure=None
        target.assert_native_owned=Mock()
        stderr=(b'psql:<stdin>:271: ERROR:  P0001: Tenant isolation invariants failed (1 breach(es)):\n'
                b'  - F-13: view private_view does not set security_invoker\n'
                b'CONTEXT:  private context\nLOCATION:  private location\n')
        target._run=Mock(side_effect=[subprocess.CompletedProcess([],0,b'',b'')]*4+
                        [subprocess.CompletedProcess([],3,b'private stdout',stderr)])
        target.sql=lambda database,sql,stage,**kw: target._execute_sql([],sql,stage,'00000')
        runner.target=target
        with patch.object(m.timestamp,'native_snapshot',return_value=({},[])):
            with self.assertRaisesRegex(ValueError,'^NATIVE_TIMESTAMP_SQL_RESULT$'):
                m.execute(runner,self.retained,parent,self.forward)
        target._recent_sql_failure={'cleanup':'later'}
        report=parent['nativeFinalSql']
        self.assertEqual([x['verified'] for x in report['checks']],[True,True,True,True,False])
        failure=report['checks'][4]['nativeSqlFailure']
        self.assertEqual(failure['actual'],'ASSERTION')
        self.assertEqual(failure['tenantInvariants']['breaches'][0]['rule'],'F13_VIEW_INVOKER')
        self.assertNotIn('private',json.dumps(report))
        self.assertNotIn('cleanup',json.dumps(report))
        self.assertFalse(report['verified'])
    def test_changed_or_missing_sql_is_rejected_before_target_access(self):
        runner,parent=self.fixture()
        for retained in (self.retained[:-1],((self.retained[0][0],b'changed'),*self.retained[1:])):
            with self.assertRaisesRegex(ValueError,'NATIVE_FINAL_SQL_SOURCE_REQUIRED'):
                m.execute(runner,retained,parent,self.forward)
        runner.target.assert_native_owned.assert_not_called()

    def test_forged_forward_completion_cannot_replace_real_ledger_and_private_sources(self):
        for fault in ('missing_ledger','wrong_statements','missing_case','different_file','wrong_body','earlier_changed'):
            runner,parent=self.fixture()
            if fault=='missing_ledger':runner.entries=[];runner.retained=[]
            elif fault=='wrong_statements':runner.entries[-1]['statements']=['SELECT 1']
            elif fault=='missing_case':parent['forwardSources']['sources'][-1]['cases'].pop()
            elif fault=='different_file':runner.retained[-1][0].write_bytes(b'changed')
            elif fault=='wrong_body':parent['forwardSources']['sources'][-1]['programSha256']='0'*64
            else:runner.unchanged.side_effect=ValueError('changed earlier ledger')
            with self.assertRaises(ValueError):m.execute(runner,self.retained,parent,self.forward)
            runner.target.sql.assert_not_called()
            self.assertNotIn('nativeFinalSql',parent)

    def test_separate_cleanup_keeps_complete_forward_prefix_bound_to_real_ledger(self):
        import canonical_native_probe_cleanup as cleanup
        for fault in (None, 'cleanup_body', 'forward_body', 'old_count', 'extra_entry'):
            runner,parent=self.fixture()
            unit=cleanup.program()
            earlier=copy.deepcopy(runner.entries)
            path=runner.retained[-1][0].parent/('20260916000000_'+unit.name+'.sql')
            path.write_bytes(unit.sql);path.chmod(0o600);stat=path.stat()
            entry=dict(version=path.name[:14],name=unit.name,
                statements=[' '.join(tokens) for tokens in p.identity(unit.sql.decode())])
            runner.entries.append(entry);runner.retained.append((path,unit.sql,(stat.st_dev,stat.st_ino)))
            runner.sql=Mock(return_value=True)
            parent['syntheticProbeCleanup']=dict(actualLedgerRows=len(runner.entries),
                priorLedgerRows=len(earlier),priorLedgerSha256=cleanup.ledger_hash(earlier),
                sourcePins=cleanup.PINS,syntheticCleanupEntriesExecuted=1,verified=True,
                probeAbsent=True,allOtherCatalogAndRowsPreserved=True,providerEventsPreserved=True,
                noOpRepeatVerified=True,unchangedEarlierLedger=True,originalHistoricalVersionMarkedApplied=False,
                cliFile=path.name,programSha256=p.sha(unit.sql),
                ledgerStatementsSha256=p.sha(json.dumps(entry['statements'],separators=(',',':')).encode()),
                cases=[dict(expectedSqlstate=state,programSha256=p.sha(body),
                       catalogAndRowsRestored=True,ledgerUnchanged=True)
                       for state,body in [('PC001',unit.sql+cleanup.POST),('PC002',unit.sql)]])
            if fault=='cleanup_body':runner.entries[-1]['statements']=['SELECT 1']
            elif fault=='forward_body':runner.retained[-2][0].write_bytes(b'changed')
            elif fault=='old_count':parent['forwardSources']['actualLedgerRows']+=1
            elif fault=='extra_entry':runner.entries.append(copy.deepcopy(entry));runner.retained.append(runner.retained[-1])
            with self.subTest(fault=fault):
                if fault:
                    with self.assertRaises(ValueError):m.admit_forward(runner,self.forward,parent)
                else:m.admit_forward(runner,self.forward,parent)
            self.assertEqual(parent['historicalTimestampTail']['actualLedgerRows'],65+514+4)

if __name__=='__main__':unittest.main()
