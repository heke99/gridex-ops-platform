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
        self.assertEqual(len(m.retained_inputs()),6)
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

if __name__=='__main__':unittest.main()
