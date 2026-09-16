#!/usr/bin/env python3
"""Offline qualification boundary tests, never actual SQL evidence."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('full_permission',Path(__file__).with_name('canonical-full-permission-clone-qualification.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
    def test_exact_candidate_and_all_sources(self):
        specs=m.function_specs(m.candidate())
        self.assertEqual(tuple(x['name'] for x in specs),m.NAMES)
        self.assertEqual(len(m.retained_inputs()),7)
        self.assertEqual(specs[4]['defaults'],'NULL::uuid')
        self.assertTrue(all(x['definer'] for x in specs))
        with patch.object(m,'CANDIDATE_SHA','0'*64):
            with self.assertRaises(ValueError):m.candidate()
        with patch.dict(m.INPUT_PINS,{'scripts/canonical_changed_function_witness.py':'0'*64}):
            with self.assertRaises(ValueError):m.retained_inputs()

    def snapshots(self):
        before=dict(catalog={'schema/gridex_private':{'acl':None,'owner':'postgres','comment':None}},rows={'public.x':[1,'x']},ledger=[{'version':'1'}])
        after=copy.deepcopy(before)
        for name in m.NAMES:
            key='function/'+name+'(p_id uuid)'
            before['catalog'][key]={'definition':'old'}
            after['catalog'][key]={'definition':'new'}
        return before,after

    def test_full_catalog_delta_is_closed(self):
        before,after=self.snapshots();specs=m.function_specs(m.candidate())
        self.assertEqual(len(m.verify_delta(before,after,specs)),8)
        for defect in ('rows','ledger','table','schema_owner','ninth_function','missing_change','unknown_dependency'):
            bad=copy.deepcopy(after)
            if defect in ('rows','ledger'):bad[defect]={}
            elif defect=='schema_owner':bad['catalog']['schema/gridex_private']['owner']='other'
            elif defect=='missing_change':bad['catalog']['function/'+m.NAMES[0]+'(p_id uuid)']={'definition':'old'}
            elif defect=='unknown_dependency':bad['catalog']['dependency/function '+m.NAMES[0]+'(uuid)/table public.secret/n']='n'
            else:bad['catalog'][defect+'/public.unknown']={}
            with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(ValueError):m.verify_delta(before,bad,specs)

    def test_actual_visible_diagnostic_dependency_hashes_are_exact(self):
        import hashlib
        before,after=self.snapshots();specs=m.function_specs(m.candidate())
        keys={
            'dependency/function canonical_get_platform_user_permission_diagnostic(uuid,uuid)/language plpgsql/n':
                'c79fcb9d391a71b309cde0a934cad8d7468bc7ded65dc8b759a4b4f0b62c64e4',
            'dependency/function canonical_get_platform_user_permission_diagnostic(uuid,uuid)/schema public/n':
                'ca8986564c72532578d1242cd83d7b9e5f988c3e43fa4af30ca961ce9f6d887a'}
        for key,digest in keys.items():
            self.assertEqual(hashlib.sha256(key.encode()).hexdigest(),digest)
            after['catalog'][key]='n'
        self.assertEqual(len(m.verify_delta(before,after,specs)),10)
        for key in keys:
            for badkey in (key.replace('(uuid,uuid)','(text,uuid)'),key.replace('/n','/a'),
                           key.replace('/language plpgsql/','/language sql/').replace('/schema public/','/schema secret/')):
                bad=copy.deepcopy(after);bad['catalog'][badkey]='n'
                with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(ValueError):m.verify_delta(before,bad,specs)
        bad=copy.deepcopy(after);bad['catalog'][next(iter(keys))]='a'
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(ValueError):m.verify_delta(before,bad,specs)

    def test_original24_baseline_and_repaired_must_match(self):
        baseline=['can_override_allow','can_override_deny']
        for failures in (baseline,[]):
            with patch.object(m,'private_sql',return_value=json.dumps(dict(caseCount=24,verified=not failures,failedCases=failures))):
                m.behavior(None,None,m.PARENT,failures)
        for result in ({'caseCount':24,'verified':False,'failedCases':['private SQL']},
                       {'caseCount':23,'verified':True,'failedCases':[]}):
            with patch.object(m,'private_sql',return_value=json.dumps(result)),contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(ValueError):m.behavior(None,None,m.PARENT,[])
            self.assertNotIn('private SQL',output.getvalue())

    def test_exact_function_metadata_and_body_required(self):
        specs=m.function_specs(m.candidate());rows=[dict(s,owner='postgres') for s in specs]
        with patch.object(m,'private_sql',return_value=json.dumps(rows)):m.verify_functions(None,None,specs)
        for field in ('body','owner','definer','arguments','defaults','config'):
            bad=copy.deepcopy(rows);bad[0][field]='private substituted value'
            with patch.object(m,'private_sql',return_value=json.dumps(bad)),contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(ValueError):m.verify_functions(None,None,specs)
            self.assertNotIn('private substituted value',output.getvalue())

    def test_private_transport_preserves_failure_without_stderr(self):
        class Owned:
            def command(self,*args,**kwargs):return ['owned']
            def verify_logging(self):pass
        target=Owned();legacy=SimpleNamespace(OwnedPostgres=Owned,clean_environment=lambda:{},safe_receipt=lambda *args:{'sqlstate':'23514'})
        process=SimpleNamespace(returncode=1,stderr=b'private SQL',stdout=b'private row')
        with patch.object(m.subprocess,'run',return_value=process),contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(ValueError):m.private_sql(target,legacy,m.ATOMIC,'secret','candidate_first')
        self.assertEqual(json.loads(output.getvalue()),dict(stage='permission_clone_sql_failure',phase='candidate_first',sqlstate='23514'))
        with self.assertRaises(ValueError):m.private_sql(target,legacy,'external','sql','candidate_first')
        target.command=lambda *args,**kwargs:['substituted']
        with self.assertRaises(ValueError):m.private_sql(target,legacy,m.ATOMIC,'sql','candidate_first')

    def test_matrix_requires129_terminal_markers_and_every_rollback(self):
        cases={label:'BEGIN; ROLLBACK;' for label in m.fixture.build_cases()}
        first={'catalog':{},'rows':{},'ledger':[]}
        with patch.object(m.full_seed,'build_cases',return_value=cases), \
             patch.object(m,'private_sql',side_effect=['{}']+['PERMISSION_CASE_COMPLETE\n']*129), \
             patch.object(m,'capture',return_value=first) as capture:
            self.assertEqual(m.matrix(None,None,(),first),129)
            self.assertEqual(capture.call_count,129)
        with patch.object(m.full_seed,'build_cases',return_value=cases), \
             patch.object(m,'private_sql',side_effect=['{}','PERMISSION_CASE_COMPLETE\n']), \
             patch.object(m,'capture',return_value={'changed':True}), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(ValueError,'MATRIX_ROLLBACK'):m.matrix(None,None,(),first)
        self.assertEqual(json.loads(output.getvalue()),dict(stage='permission_clone_matrix_failure',case=next(iter(cases))))

    def test_acl_poison_is_only_existing_role_database_local_grants(self):
        statements=[line for line in m.local_acl_poison().splitlines() if line]
        self.assertEqual(len(statements),9)
        self.assertEqual(statements[0],'GRANT USAGE ON SCHEMA gridex_private TO anon;')
        self.assertTrue(all(line.startswith('GRANT EXECUTE ON FUNCTION ') for line in statements[1:]))
        self.assertTrue(all(line.endswith((' TO authenticated, service_role;', ' TO anon, authenticated;', ' TO anon;')) for line in statements[1:]))
        self.assertNotIn('CREATE ROLE',m.local_acl_poison())
        self.assertNotIn('GRANT SELECT',m.local_acl_poison())

    def test_acl_fixture_never_grants_on_domain_objects(self):
        with patch.object(m,'private_sql') as call:m.acl_check(None,None)
        sql=call.call_args.args[3]
        self.assertTrue(sql.startswith('BEGIN; CREATE SCHEMA fixture;'))
        self.assertTrue(sql.endswith('ROLLBACK;'))
        self.assertNotIn('GRANT ',sql.upper())
        self.assertNotIn('TRUNCATE ',sql.upper())

    def test_matrix_error_exposes_only_closed_assertion_labels(self):
        class Owned:
            def command(self,*args,**kwargs):return ['owned']
            def verify_logging(self):pass
        legacy=SimpleNamespace(OwnedPostgres=Owned,clean_environment=lambda:{},safe_receipt=lambda *args:{'sqlstate':'P0001'})
        for label,want in [('full_access_select_roster','full_access_select_roster'),
                           ('access_select_foreign','access_select_foreign'),
                           ('private_customer_identifier',None),
                           ('access_select_foreign private data',None)]:
            process=SimpleNamespace(returncode=1,stderr=('psql:<stdin>:12: ERROR:  P0001: '+label+'\nCONTEXT: private SQL\n').encode(),stdout=b'private row')
            with patch.object(m.subprocess,'run',return_value=process),contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(ValueError):m.private_sql(Owned(),legacy,m.ATOMIC,'private SQL','matrix_case',False)
            result=json.loads(output.getvalue())
            self.assertEqual(want,result.get('assertion'))
            self.assertNotIn('private',output.getvalue())

    def test_matrix_42501_diagnostic_identifies_only_known_denials(self):
        examples={
            'permission denied for schema storage':'schema:storage',
            'permission denied for table objects':'table:objects',
            'permission denied for schema gridex_private':'schema:gridex_private',
            'permission denied for function customer_document_path_allows':'function:customer_document_path_allows',
        }
        for message,label in examples.items():
            for prefix,ending in [('psql:<stdin>:12: ','\n'),('','\r\n')]:
                with self.subTest(message=message,prefix=prefix):
                    raw=(prefix+'ERROR:  42501: '+message+ending+'CONTEXT: private SQL'+ending).encode()
                    self.assertEqual(m.matrix_sql_diagnostic(raw,'matrix_case','42501'),{'deniedObject':label})

    def test_matrix_diagnostic_preserves_all_authored_assertion_labels(self):
        labels={'actor_identity','actor_role_flags','access_select_own','access_select_foreign',
            'full_access_select_roster','full_access_no_global_row','access_no_table_write',
            'access_no_column_write','storage_visible_rows','expected_sqlstate_mismatch',
            'affected_rows','unchanged_multisets'}
        for label in labels:
            with self.subTest(label=label):
                raw=('psql:<stdin>:1: ERROR:  P0001: '+label+'\n').encode()
                self.assertEqual(m.matrix_sql_diagnostic(raw,'matrix_case','P0001'),{'assertion':label})

    def test_matrix_diagnostic_rejects_unknown_names_and_value_suffixes(self):
        messages=[
            'permission denied for table private_customer_identifier',
            'permission denied for table objects private data',
            'permission denied for schema storage; SELECT private_data',
            'permission denied for function arbitrary_function',
            'permission denied for table "objects"',
            'permission denied for table public.objects',
        ]
        for message in messages:
            with self.subTest(message=message):
                raw=('ERROR:  42501: '+message+'\n').encode()
                self.assertEqual(m.matrix_sql_diagnostic(raw,'matrix_case','42501'),{})
        self.assertEqual(m.matrix_sql_diagnostic(b'ERROR: P0001: private_data\n','matrix_case','P0001'),{})

    def test_matrix_diagnostic_rejects_multiple_or_non_stdin_errors(self):
        known=b'psql:<stdin>:12: ERROR:  42501: permission denied for table objects\n'
        ambiguous=[
            known+known,
            known+b'ERROR:  42501: private data\n',
            known+b'psql:/private/file.sql:9: FATAL:  42501: private data\n',
            known.replace(b'<stdin>',b'/private/file.sql'),
            b'CONTEXT: '+known,
            known.replace(b'ERROR:',b'FATAL:'),
            b'ERROR: P0001: access_select_foreign\nERROR: P0001: actor_identity\n',
        ]
        for raw in ambiguous:
            with self.subTest(raw=raw):
                for state in ('P0001','42501'):
                    self.assertEqual(m.matrix_sql_diagnostic(raw,'matrix_case',state),{})

    def test_matrix_diagnostic_is_bounded_and_requires_valid_bytes(self):
        known=b'ERROR:  42501: permission denied for table objects\n'
        for raw in (None,known.decode(),bytearray(known),known+b'\xff',known+b'x'*65536,known+b'\x00'):
            with self.subTest(kind=type(raw).__name__):
                self.assertEqual(m.matrix_sql_diagnostic(raw,'matrix_case','42501'),{})

    def test_matrix_diagnostic_never_applies_outside_its_sqlstate_and_phase(self):
        raw=b'ERROR:  42501: permission denied for table objects\n'
        for stage in ('candidate_first','effective_acl','snapshot_rows','arbitrary'):
            self.assertEqual(m.matrix_sql_diagnostic(raw,stage,'42501'),{})
        for state in ('P0001','00000','23514','XXXXX','42501 private data',None):
            self.assertEqual(m.matrix_sql_diagnostic(raw,'matrix_case',state),{})

    def test_matrix_42501_transport_still_fails_without_leaking_sql(self):
        class Owned:
            def command(self,*args,**kwargs):return ['owned']
            def verify_logging(self):pass
        legacy=SimpleNamespace(OwnedPostgres=Owned,clean_environment=lambda:{},safe_receipt=lambda *args:{'sqlstate':'42501'})
        process=SimpleNamespace(returncode=1,stderr=b'psql:<stdin>:12: ERROR:  42501: permission denied for table objects\nCONTEXT: private SQL\n',stdout=b'private row')
        for stage in ('matrix_case','candidate_first'):
            with patch.object(m.subprocess,'run',return_value=process) as run,contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaisesRegex(ValueError,'^PERMISSION_CLONE_SQL_REQUIRED$'):
                    m.private_sql(Owned(),legacy,m.ATOMIC,'private SQL',stage,False)
            expected={'stage':'permission_clone_sql_failure','phase':stage,'sqlstate':'42501'}
            if stage=='matrix_case':expected['deniedObject']='table:objects'
            self.assertEqual(json.loads(output.getvalue()),expected)
            self.assertNotIn('private',output.getvalue())
            self.assertEqual(run.call_count,1)

if __name__=='__main__':unittest.main()
