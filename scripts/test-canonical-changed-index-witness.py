"""Closed source/runtime controls; actual PostgreSQL execution is a separate gate."""
import copy
import json
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import canonical_changed_index_witness as w

class Tests(unittest.TestCase):
    def test_exact_five_sources_and_transactional_witness(self):
        specs=w.contract(w.retain(w.ROOT))
        self.assertEqual(len(specs),5)
        self.assertEqual([s['unique'] for s in specs],[False]*4+[True])
        for s in specs:
            self.assertEqual(w.sha(s['expectedRow']),s['observedSha256'])
            self.assertNotEqual(s['referenceSha256'],s['observedSha256'])
        sql=w.render(specs)
        self.assertEqual(sql.count('CREATE TEMP TABLE '),5)
        self.assertEqual(sum(line.startswith('CREATE UNIQUE INDEX ') for line in sql.splitlines()),1)
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
        self.assertIn('indisvalid',sql)
        self.assertIn('EXCEPTION WHEN unique_violation',sql)
        self.assertIn('cases<>12 OR rejected<>4 OR allowed<>8',sql)
        self.assertNotIn('INSERT INTO public.',sql)
        self.assertNotIn('ALTER TABLE public.',sql)
        self.assertNotEqual(sql,w.render(specs))

    def test_case_expression_is_parenthesized_inside_plpgsql_if(self):
        # PL/pgSQL IF terminates its SQL expression at an unparenthesized THEN.
        # The CASE's THEN must stay inside parentheses rather than ending IF.
        sql=w.behavior_sql('synthetic_index_fixture')
        self.assertIn('<>(CASE WHEN included THEN 1 ELSE 2 END)\n',sql)
        self.assertNotIn('<>CASE WHEN included THEN',sql)
        self.assertIn('cases<>12 OR rejected<>4 OR allowed<>8',sql)

    def test_temporary_index_prefix_uses_postgresql_temp_alias_only(self):
        spec=w.contract(w.retain(w.ROOT))[0]
        row,state=w.capture(spec,'synthetic_index',temporary=True)
        self.assertIn("CASE WHEN n.oid=pg_my_temp_schema() THEN 'pg_temp' ELSE n.nspname END",row)
        self.assertIn('left(pg_get_indexdef(i.indexrelid),length(',row)
        self.assertIn('substr(pg_get_indexdef(i.indexrelid),length(',row)
        self.assertNotIn('regexp_replace',row)
        self.assertIn("to_regclass('pg_temp.synthetic_index')",row)
        live,_=w.capture(spec,'ignored',temporary=False)
        self.assertNotIn('pg_my_temp_schema()',live)
        self.assertIn("'definition',pg_get_indexdef(i.indexrelid)",live)

    def test_sources_order_missing_duplicates_and_mutation_rejected(self):
        retained=w.retain(w.ROOT)
        for bad in ((),retained[:-1],retained[::-1],retained+(retained[0],),
                    ((retained[0][0],retained[0][1]+b'\n'),)+retained[1:]):
            with self.assertRaises(ValueError):w.contract(bad)

    def rows(self,specs):
        return [dict(ordinal=s['ordinal'],actual=copy.deepcopy(s['expectedRow']),
            witness=copy.deepcopy(s['expectedRow']),actualState=dict(valid=True,ready=True,live=True),
            witnessState=dict(valid=True,ready=True,live=True),behaviorCases=12 if s['unique'] else 0)
            for s in specs]

    def test_catalog_validity_and_behavior_are_all_required(self):
        specs=w.contract(w.retain(w.ROOT));rows=self.rows(specs)
        w.verify_rows(rows,specs)
        for side in ('actual','witness'):
            for field,value in [('definition','private SQL'),('indisunique',True),('indexname','other'),('extra',0)]:
                bad=copy.deepcopy(rows);bad[0][side][field]=value
                with self.assertRaises(ValueError):w.verify_rows(bad,specs)
            for flag in ('valid','ready','live'):
                bad=copy.deepcopy(rows);bad[0][side+'State'][flag]=False
                with self.assertRaises(ValueError):w.verify_rows(bad,specs)
        for bad in (rows[:-1],rows[::-1],rows+[rows[0]]):
            with self.assertRaises(ValueError):w.verify_rows(bad,specs)
        bad=copy.deepcopy(rows);bad[-1]['behaviorCases']=11
        with self.assertRaises(ValueError):w.verify_rows(bad,specs)

    def test_diagnostics_hash_private_definitions_without_disclosure(self):
        specs=w.contract(w.retain(w.ROOT));rows=self.rows(specs)
        rows[-1]['witness']['definition']='private SQL text'
        with patch('builtins.print') as output:
            w.diagnose(rows,specs)
        result=json.loads(output.call_args.args[0])
        self.assertEqual(result['differences'][0]['ordinal'],5)
        self.assertEqual(len(result['differences']),1)
        self.assertNotIn('private',str(result))
        self.assertNotIn(specs[-1]['name'],str(result))

    def test_receipt_is_closed_and_not_schema_acceptance(self):
        specs=w.contract(w.retain(w.ROOT))
        for native in (True,False):
            receipt=w.expected_receipt(specs,native=native)
            w.validate_execution_receipt(receipt,native=native)
            self.assertFalse(receipt['schemaAccepted'])
            for key,value in [('verified',1),('predicateCases',11),('extra',True),('schemaAccepted',True)]:
                with self.assertRaises(ValueError):w.validate_execution_receipt(dict(receipt,**{key:value}),native=native)

    def progress(self,native=False):
        from canonical_forward_sources import FORWARD_SOURCES
        flag='noOpRepeatVerified' if native else 'positiveAndRepeatVerified'
        return {('foundationInputsExecuted' if native else 'foundationApplied'):144,
                ('timestampInputsExecuted' if native else 'timestampApplied'):514,
                'forwardSources':dict(executed=True,inputsExecuted=len(FORWARD_SOURCES),sources=[dict(source=p,sourceSha256=h,
                 executed=True,rowsPreserved=True,**{flag:True}) for p,h in FORWARD_SOURCES])}

    def test_unowned_or_incomplete_targets_do_not_execute_witness(self):
        target=Mock()
        with self.assertRaisesRegex(ValueError,'OWNED_TARGET_REQUIRED'):w.execute(target,w.retain(w.ROOT),{})
        target.sql.assert_not_called()
        for native in (False,True):
            for defect in ('missing','last_source','last_repeat'):
                progress=self.progress(native)
                if defect=='missing':progress={}
                elif defect=='last_source':progress['forwardSources']['sources'][-1]['sourceSha256']='0'*64
                else:progress['forwardSources']['sources'][-1]['noOpRepeatVerified' if native else 'positiveAndRepeatVerified']=False
                with patch.object(w.actors,'_admit',return_value=('owned',native)):
                    with self.assertRaisesRegex(ValueError,'COMPLETE_REPLAY_REQUIRED'):w.execute(target,w.retain(w.ROOT),progress)
        target.sql.assert_not_called()
        for native in (False,True):
            progress=self.progress(native);progress['changedIndexSourceWitness']={}
            with patch.object(w.actors,'_admit',return_value=('owned',native)):
                with self.assertRaisesRegex(ValueError,'ONCE_REQUIRED'):w.execute(target,w.retain(w.ROOT),progress)
        target.sql.assert_not_called()

    def test_execution_preservation_privacy_and_closed_receipt(self):
        retained=w.retain(w.ROOT)
        for native in (False,True):
            for defect in (None,'sql','json','hash','snapshot','ledger','source','owner'):
                with self.subTest(native=native,defect=defect):
                    target=Mock();target.sql.return_value='[]';progress=self.progress(native)
                    query=Mock(return_value='[]')
                    if defect=='sql':query.side_effect=RuntimeError('private query and connection details')
                    if defect=='json':query.return_value='private bad JSON'
                    admit=[('owned',native),('owned',native)]
                    if defect=='owner':admit[-1]=ValueError('private ownership detail')
                    with patch.object(w.actors,'_admit',side_effect=admit),\
                         patch.object(w.actors,'_snapshot',side_effect=['before','changed' if defect=='snapshot' else 'before']),\
                         patch.object(w,'ledger',side_effect=[['before'],['changed' if defect=='ledger' else 'before']]),\
                         patch.object(w,'execute_query',query),\
                         patch.object(w,'verify_rows',side_effect=ValueError('row mismatch') if defect=='hash' else None),\
                         patch.object(w,'sources_preserved',return_value=defect!='source'):
                        if defect:
                            with self.assertRaisesRegex(ValueError,'CHANGED_INDEX_WITNESS_') as error:w.execute(target,retained,progress)
                            self.assertNotIn('private',str(error.exception))
                            self.assertFalse(progress['changedIndexSourceWitness']['verified'])
                        else:
                            result=w.execute(target,retained,progress)
                            w.validate_execution_receipt(result,native=native)
                            self.assertTrue(result['verified']);self.assertFalse(result['schemaAccepted'])
                            for key,value in [('verified',1),('temporaryObjectsRolledBack',False),('actorAccessAccepted',True),('extra',True)]:
                                with self.assertRaises(ValueError):w.validate_execution_receipt(dict(result,**{key:value}),native=native)
                    query.assert_called_once_with(target,retained,progress,native=native)

    def test_portable_derived_query_uses_owned_stdin_without_any_file_writer(self):
        class Owner:
            def command(self,database,files,transaction):
                self.arguments=(database,files,transaction)
                return ['docker','exec','-i','owned','psql','-U','postgres','-d',database]
            def verify_logging(self):self.logging_checks+=1
            def private(self,*args):raise AssertionError('derived SQL written to disk')
            def sql(self,*args,**kwargs):raise AssertionError('file-backed SQL path used')
        target=Owner();target.logging_checks=0
        legacy=SimpleNamespace(OwnedPostgres=Owner,clean_environment=lambda:{},
            safe_receipt=lambda *args:dict(sqlstate='00000'))
        controller=SimpleNamespace(load_batch=lambda:legacy)
        retained=w.retain(w.ROOT);progress=self.progress(False)
        process=SimpleNamespace(returncode=0,stdout=b'[]',stderr=b'')
        with patch.object(w.actors,'_admit',return_value=('owned',False)),\
             patch.object(w.actors,'_controller',return_value=controller),\
             patch.object(w.subprocess,'run',return_value=process) as run:
            self.assertEqual(w.execute_query(target,retained,progress,native=False),'[]')
            self.assertEqual(run.call_args.args[0][-2:],['-f','-'])
            self.assertIn(b'CREATE TEMP TABLE',run.call_args.kwargs['input'])
            self.assertTrue(run.call_args.kwargs['capture_output'])
            self.assertEqual(target.arguments,('owned',(),False))
            self.assertEqual(target.logging_checks,2)
            process.returncode=3;process.stderr=b'private SQL error'
            with self.assertRaisesRegex(ValueError,'CHANGED_INDEX_WITNESS_EXECUTION_REQUIRED'):
                w.execute_query(target,retained,progress,native=False)
            run.reset_mock();target.command=Mock()
            with self.assertRaisesRegex(ValueError,'OWNED_TARGET_REQUIRED'):
                w.execute_query(target,retained,progress,native=False)
            run.assert_not_called()

if __name__=='__main__':unittest.main()
