#!/usr/bin/env python3
"""Offline tests. Simulated CLI calls are NOT native PostgreSQL/CI acceptance."""
import copy
import importlib.util
import os
import json
import signal
from types import SimpleNamespace
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_history_under_test', ROOT/'scripts/canonical_native_historical_prefix.py')
m = importlib.util.module_from_spec(spec);sys.modules[spec.name] = m;spec.loader.exec_module(m)
PROJECT = 'gridex-sb-45c3b5c5b510-0123456789abcdef'


class LexicalTests(unittest.TestCase):
    def test_dollar_bodies_and_quoted_semicolons_are_single_tokens(self):
        text = "DO $body$ BEGIN RAISE NOTICE 'x;y'; END; $body$; SELECT 'x;y',\"x;y\";"
        self.assertEqual(len(m.identity(text)), 2)
        self.assertIn("$body$ BEGIN RAISE NOTICE 'x;y'; END; $body$", m.identity(text)[0])

    def test_nested_comments_and_comment_text_inside_literals(self):
        self.assertEqual(m.identity('/* outer /* nested */ ok */ SELECT 1; -- end'), (('SELECT','1'),))
        self.assertNotEqual(m.identity("SELECT '/* one */';"), m.identity("SELECT '/* two */';"))

    def test_values_and_operator_boundaries_are_not_normalized(self):
        for left,right in [("SELECT 'a  b';","SELECT 'a b';"), ('SELECT a + + b;', 'SELECT a ++ b;'),
                           ('SELECT "Case";', 'SELECT "case";'), ('SELECT a/**/b;', 'SELECT ab;')]:
            self.assertNotEqual(m.identity(left), m.identity(right))

    def test_escaped_quotes_and_doubled_quotes(self):
        for text in [r"SELECT E'a\';b';", "SELECT 'a'';b';", 'SELECT "a"";b";']:
            self.assertEqual(len(m.identity(text)), 1)

    def test_meta_commands_unterminated_literals_and_empty_source_fail_closed(self):
        for text in ['', '/*x', "SELECT 'x", 'DO $x$ x;', '\\i /tmp/file', '-- only comment', 'SELECT\x001;']:
            with self.assertRaises(m.PrefixError): m.identity(text)

    def test_outer_transaction_transfer_is_exact_and_never_changes_body(self):
        raw = b"-- origin\nBEGIN;\nDO $$ BEGIN PERFORM 'COMMIT;'; END; $$;\nCOMMIT;\n"
        result, transferred = m.cli_program(raw)
        self.assertTrue(transferred)
        self.assertEqual(result, b"DO $$ BEGIN PERFORM 'COMMIT;'; END; $$;\n")
        self.assertEqual(m.identity(result.decode()), m.identity(raw.decode())[1:-1])

    def test_unwrapped_sql_bytes_are_preserved(self):
        raw=b"-- source\nSELECT ';';\n"
        self.assertEqual(m.cli_program(raw), (raw, False))

    def test_interior_transactions_server_mutations_and_stale_envelopes_rejected(self):
        for text in ['BEGIN; SELECT 1;', 'SELECT 1; COMMIT;', 'BEGIN; SAVEPOINT x; COMMIT;',
                     'BEGIN; SELECT 1; COMMIT; SELECT 2;', "ALTER SYSTEM SET log_statement='all';",
                     "SET standard_conforming_strings = off;", 'RESET log_min_error_statement;']:
            with self.assertRaises(m.PrefixError): m.cli_program(text.encode())

    def test_non_utf8_rejected(self):
        with self.assertRaises(m.PrefixError): m.cli_program(b'\xff')


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.p = m.Program(1,'migrations/example.sql','0'*64,b"DO $$ BEGIN PERFORM 1; END; $$; SELECT 'literal';",False)
        self.filename = '20260914120000_'+self.p.name+'.sql'
        self.entry = {'version':self.filename[:14], 'name':self.p.name,
                      'statements':["DO $$ BEGIN PERFORM 1; END; $$", "SELECT 'literal'"]}

    def test_full_statement_identity_accepts_only_outer_comments_and_spacing(self):
        m.verify_entry(self.entry,self.filename,self.p)
        self.entry['statements'][1]="/* CLI comment */ SELECT  'literal' ; -- end"
        m.verify_entry(self.entry,self.filename,self.p)

    def test_wrong_missing_reordered_or_extra_statements_rejected(self):
        variants=[[], ['SELECT 1'], list(reversed(self.entry['statements'])),
                  self.entry['statements']+['SELECT 2'], [self.entry['statements'][0]],
                  [*self.entry['statements'][:-1],"SELECT 'changed'"], [None],
                  [';'.join(self.entry['statements'])]]
        for statements in variants:
            with self.assertRaises(m.PrefixError):
                m.verify_entry({**self.entry,'statements':statements},self.filename,self.p)

    def test_wrong_version_name_or_filename_rejected(self):
        for entry in [{**self.entry,'version':'20000101000000'}, {**self.entry,'name':'original_history'}]:
            with self.assertRaises(m.PrefixError): m.verify_entry(entry,self.filename,self.p)
        for name in ['../'+self.filename,'not-a-timestamp_'+self.p.name+'.sql']:
            with self.assertRaises(m.PrefixError): m.verify_entry(self.entry,name,self.p)

    def test_receipt_never_contains_source_literals_or_marks_original_applied(self):
        receipt = self.p.receipt()
        self.assertNotIn('literal',str(receipt)); self.assertNotIn('sql',receipt)
        self.assertEqual(receipt['programSha256'],m.sha(self.p.sql))


class PrivateFileTests(unittest.TestCase):
    def test_real_file_permissions_identity_and_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'program.sql';path.write_bytes(b'')
            physical=m.private_write(path,b'SELECT 1;')
            m.verify_private(path,b'SELECT 1;',physical)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
            path.write_bytes(b'SELECT 2;')
            with self.assertRaises(m.PrefixError): m.verify_private(path,b'SELECT 1;',physical)

    def test_hardlink_rejected_before_truncation(self):
        with tempfile.TemporaryDirectory() as directory:
            original=Path(directory)/'original';original.write_bytes(b'KEEP ORIGINAL')
            linked=Path(directory)/'linked';os.link(original,linked)
            with self.assertRaises(m.PrefixError): m.private_write(linked,b'overwrite')
            self.assertEqual(original.read_bytes(),b'KEEP ORIGINAL')

    def test_symlink_and_shared_parent_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            original=Path(directory)/'original';original.write_bytes(b'KEEP ORIGINAL')
            linked=Path(directory)/'linked';linked.symlink_to(original)
            with self.assertRaises(m.PrefixError): m.private_write(linked,b'overwrite')
            linked.unlink();shared=Path(directory)/'shared';shared.mkdir(mode=0o755)
            path=shared/'program';path.write_bytes(b'')
            with self.assertRaises(m.PrefixError): m.private_write(path,b'SELECT 1;')
            self.assertEqual(original.read_bytes(),b'KEEP ORIGINAL')

    def test_changed_inode_or_permissions_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'program';path.write_bytes(b'')
            physical=m.private_write(path,b'SELECT 1;')
            path.chmod(0o644)
            with self.assertRaises(m.PrefixError): m.verify_private(path,b'SELECT 1;',physical)
            path.chmod(0o600)
            with self.assertRaises(m.PrefixError): m.verify_private(path,b'SELECT 1;',(physical[0],physical[1]+1))


class ExecutionTests(unittest.TestCase):
    def fixture(self, fault=None):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);work=root/'work';migrations=work/'supabase/migrations'
            migrations.mkdir(parents=True,mode=0o700)
            source_dir=root/'supabase/migrations';source_dir.mkdir(parents=True)
            programs=[]
            for ordinal in (1,2,3):
                raw=f'SELECT {ordinal};'.encode();name=f'migrations/source{ordinal}.sql'
                (root/'supabase'/name).write_bytes(raw)
                programs.append(m.Program(ordinal,name,m.sha(raw),raw,False))
            programs=tuple(programs)
            first=migrations/'20260914000000_native_lifecycle_proof.sql'
            first.write_bytes(b'SELECT 0;');first.chmod(0o600)
            ledger=[{'version':first.name[:14],'name':'native_lifecycle_proof','statements':['SELECT 0']}]
            calls=[];created=[];progress={}
            def sql(query):
                self.assertEqual(query,m.LEDGER_SQL)
                return copy.deepcopy(ledger)
            def native(*args,**kwargs):
                calls.append(args)
                if args[:2]==('migration','new'):
                    n=len(created)+1
                    path=migrations/(f'2026091400000{n}_'+args[2]+'.sql')
                    path.write_bytes(b'');created.append(path)
                    if fault=='extra-file': (migrations/'unexpected.sql').write_text('SELECT 99;')
                elif args==('migration','up','--local'):
                    if fault=='failure' or fault=='failed-ledger':
                        if fault=='failed-ledger':ledger.append({'version':'made-up'})
                        return subprocess.CompletedProcess(args,1,b'',b'private SQLSTATE 23503 details')
                    if len(ledger)==len(created):
                        path=created[-1]
                        text=path.read_text()
                        entry={'version':path.name[:14],'name':path.name[15:-4],
                               'statements':[text]}
                        if fault=='statement-change':entry['statements']=['SELECT 999;']
                        if fault=='old-ledger-change':ledger[0]['name']='tampered'
                        ledger.append(entry)
                        if fault=='private-change':path.write_text('SELECT 999;')
                        if fault=='original-change':(root/'supabase'/programs[-1].source).write_text('SELECT 999;')
                else:self.fail('unknown native command')
                return subprocess.CompletedProcess(args,0,b'',b'')
            error=None
            with patch.object(m,'ROOT',root),patch.object(m,'LIMIT',3),patch.object(m,'prepare',return_value=programs), \
                 patch.object(m,'protect_logging') as protect,patch.object(m.time,'sleep'):
                try: m.execute(None,native,sql,work,PROJECT,programs,progress)
                except m.PrefixError as exc:error=str(exc)
                protect.assert_called_once()
            return error,progress,calls,ledger

    def test_all_units_use_real_cli_sequence_and_canonical_ledger_contract(self):
        error,progress,calls,ledger=self.fixture()
        self.assertIsNone(error)
        self.assertEqual(progress['foundationInputsExecuted'],3)
        self.assertTrue(progress['historicalPrefixLedgerVerified'])
        self.assertFalse(progress['completeReplayVerified'])
        self.assertFalse(progress['originalHistoricalVersionsMarkedApplied'])
        self.assertEqual(len(ledger),4)
        self.assertEqual(sum(call==('migration','up','--local') for call in calls),4)
        self.assertNotIn('repair',str(calls))

    def test_failed_migration_stops_immediately_without_recording_success(self):
        error,progress,calls,ledger=self.fixture('failure')
        self.assertEqual(error,'NATIVE_HISTORICAL_SQL_FAILED')
        self.assertEqual(progress['foundationInputsExecuted'],0)
        self.assertEqual(progress['failedSqlstate'],'23503')
        self.assertEqual(len(ledger),1)
        self.assertEqual(sum(call[:2]==('migration','new') for call in calls),1)

    def test_wrong_ledger_private_inputs_and_extra_files_stop(self):
        expected={'failed-ledger':'NATIVE_FAILED_LEDGER_CHANGED',
                  'statement-change':'NATIVE_EXECUTED_STATEMENTS_REQUIRED',
                  'old-ledger-change':'NATIVE_UNEXPECTED_LEDGER_DELTA',
                  'private-change':'NATIVE_PRIVATE_SOURCE_CHANGED',
                  'extra-file':'NATIVE_CLI_CREATED_FILE_REQUIRED',
                  'original-change':'NATIVE_SOURCE_BYTES_REQUIRED'}
        for fault,code in expected.items():
            error,progress,_,_=self.fixture(fault)
            self.assertEqual(error,code,fault)
            self.assertFalse(progress['historicalPrefixLedgerVerified'])
            self.assertFalse(progress['completeReplayVerified'])


class ActualSourceTests(unittest.TestCase):
    def test_complete_real_first43_preserves_originals_and_finite_boundary(self):
        inputs=m.prepare()
        self.assertEqual(len(inputs),43)
        self.assertEqual(inputs[-1].source,'migrations/20260910121054_canonical_auth_provisioning_diagnostics_boundary.sql')
        self.assertEqual(sum(p.outer_transaction_transferred for p in inputs),5)
        for program in inputs:
            source=(ROOT/'supabase'/program.source).read_bytes()
            self.assertEqual(m.sha(source),program.source_sha256)
            self.assertEqual(m.sha(m.cli_program(source)[0]),m.sha(program.sql))
        self.assertNotIn('20260519_company_invite_temp_password_sync.sql',str([p.source for p in inputs]))

    def test_ordinary_entry_cannot_report_a_prefix_as_full_acceptance(self):
        text=(ROOT/'scripts/canonical-auth-provisioning-replay.py').read_text()
        self.assertIn('native.run_guarded(historical_prefix=True)',text)
        self.assertIn("raise RuntimeError('NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED')",text)
        self.assertIn("if sys.argv[1:]:",text)


class NativeLoggingTests(unittest.TestCase):
    def exercise(self, fault=None):
        server={'Id':'known-id','Image':'sha256:known','Name':'/supabase_db_'+PROJECT,
                'Config':{'Image':'public.ecr.aws/supabase/postgres:17.6.1.test',
                          'Labels':{'com.supabase.cli.project':PROJECT}},
                'NetworkSettings':{'Networks':{PROJECT+'-network':{}}}}
        calls=[];inspections=0
        def command(args,**kwargs):
            nonlocal inspections
            calls.append(args);output=b''
            if args[:2]==['docker','inspect']:
                inspections+=1;copy_server=copy.deepcopy(server)
                if fault=='replaced' and inspections>1:copy_server['Id']='another-id'
                if fault=='wrong-owner':copy_server['Config']['Labels']={}
                output=json.dumps([copy_server]).encode()
            elif args[:3]==['docker','network','inspect']:
                output=json.dumps([{'Internal':fault!='public-network',
                                    'Labels':{'gridex.native.owner':PROJECT}}]).encode()
            elif 'psql' in args:
                # Model the provider role separation, not a vanilla superuser.
                self.assertEqual(args, ['docker','exec','-i','supabase_db_'+PROJECT,
                    'psql','-X','-qAt','-w','-h','127.0.0.1','-p','5432',
                    '-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1'])
                payload=kwargs.get('data',b'')
                if payload.startswith(b'SELECT current_user'):
                    self.assertIn(b"inet_client_addr() = '127.0.0.1'::inet",payload)
                    self.assertIn(b"inet_server_addr() = '127.0.0.1'::inet",payload)
                    self.assertIn(b'inet_server_port() = 5432',payload)
                    output=b'f' if fault=='admin-role' else b't'
                else:
                    self.assertIn(payload, {f"ALTER SYSTEM SET {key} = '{value}';".encode()
                                           for key,value in m.SETTINGS.items()})
            elif 'stat' in args:output=b'755' if fault=='permissions' else b'700'
            elif 'pg_isready' in args:output=b'ready'
            return subprocess.CompletedProcess(args,0,output,b'')
        def sql(query):
            if 'data_directory' in query:return '/unexpected' if fault=='data-dir' else '/var/lib/postgresql/data'
            result=copy.deepcopy(m.SETTINGS)
            if fault=='logging':result['logging_collector']='off'
            return result
        error=None
        try:m.protect_logging(command,sql,PROJECT)
        except m.PrefixError as exc:error=str(exc)
        return error,calls

    def test_private_logging_is_verified_after_restart(self):
        error,calls=self.exercise()
        self.assertIsNone(error)
        self.assertIn(['docker','restart','supabase_db_'+PROJECT],calls)
        self.assertEqual(sum('psql' in call for call in calls),len(m.SETTINGS)+1)
        self.assertNotIn('supabase_migrations',str(calls))

    def test_foreign_server_network_data_directory_and_log_changes_fail_closed(self):
        for fault in ('replaced','wrong-owner','public-network','permissions','data-dir','logging','admin-role'):
            error,calls=self.exercise(fault)
            self.assertIsNotNone(error,fault)
            self.assertNotIn('migration',str(calls))


    def test_unverified_admin_is_rejected_before_server_mutation(self):
        error,calls=self.exercise('admin-role')
        self.assertEqual(error,'NATIVE_LOGGING_ADMIN_REQUIRED')
        self.assertEqual(sum('psql' in call for call in calls),1)
        self.assertFalse(any('restart' in call for call in calls))

    def test_infrastructure_role_is_not_used_for_historical_cli_execution(self):
        source=(ROOT/'scripts/canonical-native-supabase-lifecycle.py').read_text()
        # Both parent metadata/ledger queries and the CLI migration lane keep
        # the provider postgres role. No ALTER ROLE or GRANT elevation exists.
        self.assertNotIn('supabase_admin', source[source.index('def run('):])
        self.assertIn("'psql','-X','-qAt','-U','postgres','-d','postgres'",source)
        transport=(ROOT/'scripts/canonical_native_cli_transport.py').read_text()
        self.assertNotIn('supabase_admin',transport)



class NativeLifecycleIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('existing_native_fixture',ROOT/'scripts/canonical-native-supabase-lifecycle-selftest.py')
        cls.fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.fixture)

    def execute(self, fail=False, cleanup=False, legacy_fail=False, repair_fail=False, provider_fail=False, dedupe_fail=False, fixed_fail=False, alignment_fail=False, tail_fail=False):
        native=self.fixture.m
        original=native.run
        prepared=object()
        def apply(command,cli,sql,work,project,programs,progress):
            self.assertIs(programs,prepared)
            self.assertEqual(len(list((work/'supabase/migrations').glob('*.sql'))),1)
            progress.update(foundationInputsExecuted=1 if fail else 43,
                            historicalGridexSourcesExecuted=True,
                            completeReplayVerified=False)
            if fail:raise ValueError('private SQL text must never reach report')
            return progress
        import canonical_native_legacy_envelope as legacy
        def apply_legacy(prefix,cli,sql,work,previous,progress):
            self.assertIs(prefix,helper)
            self.assertEqual(previous['foundationInputsExecuted'],43)
            if legacy_fail:raise ValueError('private legacy SQL must not reach report')
            progress.update(verified=True,foundationInputsExecuted=9,
                            cumulativeFoundationInputsExecuted=52)
        import canonical_native_repair_envelope as repair
        def apply_repair(prefix,cli,sql,work,first43,legacy52,progress,*,provider_bootstrap):
            self.assertEqual(provider_bootstrap,native.provider_events.receipt())
            self.assertEqual(legacy52['cumulativeFoundationInputsExecuted'],52)
            if repair_fail:raise ValueError('private repair SQL must not reach report')
            progress.update(verified=True,foundationInputsExecuted=4,
                            cumulativeFoundationInputsExecuted=56)
        import canonical_native_dedupe57 as dedupe
        def apply_dedupe(prefix,cli,sql,work,first43,legacy52,repair56,progress,*,provider_bootstrap):
            self.assertEqual(repair56['cumulativeFoundationInputsExecuted'],56)
            self.assertEqual(provider_bootstrap,native.provider_events.receipt())
            if dedupe_fail:raise ValueError('private dedupe SQL must not reach report')
            progress.update(verified=True,foundationInputsExecuted=1,cumulativeFoundationInputsExecuted=57)
        import canonical_native_fixed63 as fixed
        def apply_fixed(prefix,cli,sql,work,first43,legacy52,repair56,dedupe57,progress,*,provider_bootstrap):
            self.assertEqual(dedupe57['cumulativeFoundationInputsExecuted'],57)
            self.assertEqual(provider_bootstrap,native.provider_events.receipt())
            if fixed_fail:raise ValueError('private fixed SQL must not reach report')
            progress.update(verified=True,foundationInputsExecuted=6,cumulativeFoundationInputsExecuted=63)
        import canonical_native_alignment68 as alignment
        def apply_alignment(prefix,cli,sql,work,first43,legacy52,repair56,dedupe57,fixed63,progress,*,provider_bootstrap):
            self.assertEqual(fixed63['cumulativeFoundationInputsExecuted'],63)
            self.assertEqual(provider_bootstrap,native.provider_events.receipt())
            if alignment_fail:raise ValueError('private alignment SQL must not reach report')
            progress.update(verified=True,foundationInputsExecuted=5,cumulativeFoundationInputsExecuted=68)
        import canonical_native_operations77 as tail
        def apply_tail(prefix,cli,sql,work,parent):
            self.assertEqual(parent['foundationInputsExecuted'],68)
            parent['historicalOperations77']={'verified':not tail_fail}
            parent['foundationInputsExecuted']=71 if tail_fail else 77
            if tail_fail:raise ValueError('private tail SQL must not reach report')
        import canonical_native_foundation144 as foundation
        def apply_foundation(prefix,cli,sql,work,parent):
            self.assertEqual(parent['foundationInputsExecuted'],77)
            self.assertTrue(parent['historicalOperations77']['verified'])
            parent['historicalFoundation144']={'executed':True, 'fullSourceEffectsAccepted':False}
            parent['foundationInputsExecuted']=144
        helper=SimpleNamespace(prepare=lambda:prepared,execute=apply)
        with patch.object(native,'load_historical_prefix',return_value=helper), \
             patch.object(native.provider_events,'bootstrap',side_effect=ValueError('NATIVE_PROVIDER_EVENT_IMAGE_REQUIRED') if provider_fail else None,return_value=native.provider_events.receipt()), \
             patch.object(legacy,'execute',side_effect=apply_legacy), \
             patch.object(repair,'execute',side_effect=apply_repair), \
             patch.object(dedupe,'execute',side_effect=apply_dedupe), \
             patch.object(fixed,'execute',side_effect=apply_fixed), \
             patch.object(alignment,'execute',side_effect=apply_alignment), \
             patch.object(tail,'execute',side_effect=apply_tail), \
             patch.object(foundation,'execute',side_effect=apply_foundation), \
             patch.object(native,'run',side_effect=lambda:original(historical_prefix=True)):
            return self.fixture.NativeTests().execute_fixture('cleanup' if cleanup else None)

    def test_wrong_provider_image_stops_before_historical_inputs(self):
        status,report=self.execute(provider_fail=True)
        self.assertEqual(status,1)
        self.assertFalse(report['historicalGridexSourcesExecuted'])
        self.assertTrue(report['cleanupVerified'])
        self.assertEqual(report['errorCode'],'NATIVE_PROVIDER_EVENT_IMAGE_REQUIRED')

    def test_bounded_native_success_cannot_certify_full_replay(self):
        status,report=self.execute()
        self.assertEqual(status,0)
        self.assertEqual(report['outcome'],'NATIVE_FOUNDATION144_EXECUTED_NOT_FULL_ACCEPTANCE')
        self.assertEqual(report['foundationInputsExecuted'],144)
        self.assertTrue(report['historicalFoundation144']['executed'])
        self.assertFalse(report['historicalFoundation144']['fullSourceEffectsAccepted'])
        self.assertTrue(report['historicalOperations77']['verified'])
        self.assertTrue(report['historicalAlignment68']['verified'])
        self.assertTrue(report['historicalFixed63']['verified'])
        self.assertTrue(report['historicalDedupe57']['verified'])
        self.assertTrue(report['historicalRepair56']['verified'])
        self.assertTrue(report['historicalLegacy52']['verified'])
        self.assertEqual(report['historicalPrefix']['foundationInputsExecuted'],43)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertFalse(report['generatedTypesVerified'])

    def test_partial_failure_keeps_truthful_progress_and_disposes_inputs(self):
        status,report=self.execute(fail=True)
        self.assertEqual(status,1)
        self.assertTrue(report['historicalGridexSourcesExecuted'])
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertEqual(report['historicalPrefix']['foundationInputsExecuted'],1)
        self.assertNotIn('private SQL text',str(report))
        self.assertFalse(report['completeReplayVerified'])

    def test_later_envelope_failure_cannot_certify_through52(self):
        status,report=self.execute(legacy_fail=True)
        self.assertEqual(status,1)
        self.assertEqual(report['outcome'],'BLOCKED')
        self.assertEqual(report['phase'],'HISTORICAL_LEGACY44_52_NATIVE_LEDGER')
        self.assertNotIn('foundationInputsExecuted',report)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertNotIn('private legacy SQL',str(report))
        self.assertFalse(report['completeReplayVerified'])

    def test_repair_failure_preserves_verified52_without_certifying56(self):
        status,report=self.execute(repair_fail=True)
        self.assertEqual(status,1)
        self.assertEqual(report['outcome'],'BLOCKED')
        self.assertEqual(report['phase'],'HISTORICAL_REPAIR53_56_NATIVE_LEDGER')
        self.assertEqual(report['foundationInputsExecuted'],52)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertNotIn('private repair SQL',str(report))

    def test_dedupe_failure_preserves_verified56_and_disposes_owned_database(self):
        status,report=self.execute(dedupe_fail=True)
        self.assertEqual(status,1)
        self.assertEqual(report['outcome'],'BLOCKED')
        self.assertEqual(report['phase'],'HISTORICAL_DEDUPE57_NATIVE_LEDGER')
        self.assertEqual(report['foundationInputsExecuted'],56)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertNotIn('private dedupe SQL',str(report))

    def test_fixed_failure_preserves_verified57_and_disposes_owned_database(self):
        status,report=self.execute(fixed_fail=True)
        self.assertEqual(status,1)
        self.assertEqual(report['outcome'],'BLOCKED')
        self.assertEqual(report['phase'],'HISTORICAL_FIXED58_63_NATIVE_LEDGER')
        self.assertEqual(report['foundationInputsExecuted'],57)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertNotIn('private fixed SQL',str(report))

    def test_alignment_failure_preserves_verified63_without_accepting68(self):
        status,report=self.execute(alignment_fail=True)
        self.assertEqual(status,1)
        self.assertEqual(report['outcome'],'BLOCKED')
        self.assertEqual(report['phase'],'HISTORICAL_ALIGNMENT64_68_NATIVE_LEDGER')
        self.assertEqual(report['foundationInputsExecuted'],63)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertNotIn('private alignment SQL',str(report))

    def test_partial_tail_failure_keeps_verified71_without_accepting77(self):
        status,report=self.execute(tail_fail=True)
        self.assertEqual(status,1)
        self.assertEqual(report['outcome'],'BLOCKED')
        self.assertEqual(report['phase'],'HISTORICAL_OPERATIONS69_77_NATIVE_LEDGER')
        self.assertEqual(report['foundationInputsExecuted'],71)
        self.assertTrue(report['historicalPrivateInputsDisposed'])
        self.assertFalse(report['completeReplayVerified'])
        self.assertFalse(report['historicalOperations77']['verified'])
        self.assertNotIn('private tail SQL',str(report))

    def test_cleanup_failure_cannot_certify_historical_input_disposal(self):
        status,report=self.execute(cleanup=True)
        self.assertEqual(status,1)
        self.assertFalse(report['historicalPrivateInputsDisposed'])
        self.assertEqual(report['outcome'],'BLOCKED')

    def test_library_entry_restores_signal_handlers_even_on_failure(self):
        native=self.fixture.m
        previous={sig:signal.getsignal(sig) for sig in (signal.SIGTERM,signal.SIGINT)}
        with patch.object(native,'run',side_effect=ValueError('synthetic stop')):
            with self.assertRaises(ValueError):native.run_guarded(historical_prefix=True)
        self.assertEqual(previous,{sig:signal.getsignal(sig) for sig in previous})


def load_tests(loader, tests, pattern):
    spec=importlib.util.spec_from_file_location('native57_tests',ROOT/'scripts/test-canonical-native-dedupe57.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec=importlib.util.spec_from_file_location('native63_tests',ROOT/'scripts/test-canonical-native-fixed63.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec=importlib.util.spec_from_file_location('native68_tests',ROOT/'scripts/test-canonical-native-alignment68.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec=importlib.util.spec_from_file_location('native77_tests',ROOT/'scripts/test-canonical-native-operations77.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    spec=importlib.util.spec_from_file_location('native144_tests',ROOT/'scripts/test-canonical-native-foundation144.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    tests.addTests(loader.loadTestsFromModule(module))
    return tests


if __name__=='__main__': unittest.main(verbosity=2)
