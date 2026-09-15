"""Offline source/admission/preservation controls; no PostgreSQL claim."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import canonical_changed_view_witness as v


class Tests(unittest.TestCase):
    def test_customer_projection_diagnostic_is_fixed_identifiers_hashed_not_query_text(self):
        entry=dict(actual={'view_definition':' WITH evidence AS ( SELECT c.id, c.company_id, c.new_field, ( SELECT private_payload)'},
                   witness={'view_definition':' WITH evidence AS ( SELECT c.company_id, c.id, c.old_field, ( SELECT private_payload)'})
        with patch('builtins.print') as emit:
            v.projection_diagnostic(entry)
            result=json.loads(emit.call_args.args[0])
            self.assertEqual(result['actualOnly'],[v.sha(b'new_field')])
            self.assertEqual(result['witnessOnly'],[v.sha(b'old_field')])
            self.assertEqual([r['actualPosition'] for r in result['reordered']],[2,1])
            for private in ('private_payload','company_id','new_field','old_field'):
                self.assertNotIn(private,str(result))
            for malformed in ('WITH unknown AS (SELECT c.id, (', 'WITH evidence AS (SELECT c.id,c.id,('):
                emit.reset_mock();entry['actual']['view_definition']=malformed
                v.projection_diagnostic(entry);emit.assert_not_called()

    def test_witness_freezes_creation_time_columns_without_changing_source_queries_or_hashes(self):
        specs=v.contract(v.retain(v.ROOT))
        self.assertEqual(specs[0]['query'],specs[0]['witnessQuery'])
        for spec in specs[1:]:
            self.assertEqual(v.sha(spec['query'].encode()),spec['querySha256'])
            self.assertNotEqual(spec['query'],spec['witnessQuery'])
        customer=specs[1]['witnessQuery']
        self.assertNotIn('c.*',customer)
        self.assertIn('c.lifecycle_stage,',customer)
        self.assertNotIn('c.billing_eligible_at',customer)
        self.assertNotIn('c.quote_reference',customer)
        self.assertIn('c.website_application_id, c.legal_bundle_id, c.price_book_id, c.snapshot_quality, c.snapshot_hash, c.billing_blocked_reason, c.customer_number, c.external_customer_id, c.public_contract_offer_id',customer)
        actor=specs[2]['witnessQuery']
        self.assertNotIn('eas.*',actor)
        # The original outer signature is 28 columns; the historical inner
        # query already saw 37 at the explicitly restored foundation boundary.
        self.assertIn('eas.operations_contact_email,',actor)
        self.assertNotIn('eas.legal_name',actor)
        self.assertNotIn('ranked.operations_contact_email',actor)
        unresolved=specs[3]['witnessQuery']
        self.assertNotIn('*',unresolved)
        self.assertIn('raw_sender, raw_receiver, raw_interchange_reference',unresolved)
        self.assertNotIn('inbound_quarantine_id',unresolved)
        platform=specs[4]['witnessQuery']
        self.assertNotIn('select *',platform)
        self.assertIn('a.receiver_message_subaddress from public.ediel_actor_settings',platform)
        self.assertNotIn('brp.is_active',platform)
        document=v.historical_columns(dict(v.retain(v.ROOT))[v.HISTORICAL_COLUMNS])
        self.assertEqual([len(r['columns']) for r in document['expansions']],[135,37,31,53,16])
        self.assertEqual(len(document['sources']),24)
        sql=v.render(specs)
        for spec in specs:self.assertIn(spec['witnessQuery'],sql)

    def test_historical_column_register_and_each_declaration_source_are_immutable(self):
        retained=v.retain(v.ROOT)
        sources=dict(retained)
        for name in (v.HISTORICAL_COLUMNS,*v.historical_columns(sources[v.HISTORICAL_COLUMNS])['sources']):
            changed=tuple((path,raw+b'\n' if path==name else raw) for path,raw in retained)
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_SOURCE_REQUIRED'):
                v.contract(changed)
        specs=v.contract(retained)
        # A missing or duplicated exact star must fail rather than expanding
        # some unrelated SQL expression.
        for query in (specs[1]['query'].replace('c.*','c.id'),specs[1]['query']+' c.*'):
            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_SOURCE_REQUIRED'):
                v.expand_historical_stars(query,2,sources)
        import canonical_native_timestamp_sources as timestamps
        for module,key in ((v.p,'ORDER_SHA'),(timestamps,'SELECTION_SHA')):
            with patch.object(module,key,'0'*64),self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_SOURCE_REQUIRED'):
                v.contract(retained)

    def test_exact_source_queries_include_wrapped_and_quoted_semicolons(self):
        retained=v.retain(v.ROOT); specs=v.contract(retained)
        self.assertEqual(len(specs),5)
        self.assertEqual(len({r['name'] for r in specs}),5)
        by_name={r['name']:r for r in specs}
        actor=by_name['ediel_active_actor_settings_v']['query']
        self.assertIn('ranked.company_id,',actor)
        self.assertIn('eas.*,',actor)
        self.assertIn('where ranked.runtime_rank = 1',actor)
        self.assertEqual(by_name['ediel_unresolved_messages']['query'],
                         'select * from public.ediel_unresolved_items')
        for spec in specs:
            self.assertEqual(spec['query'],spec['sourceQuery']['query'])
            self.assertNotEqual(spec['referenceSha256'],spec['observedRelationSha256'])
        sql=v.render(specs)
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
        self.assertEqual(sql.count('CREATE TEMP VIEW '),5)
        self.assertNotIn('CREATE OR REPLACE VIEW public.',sql)
        self.assertIn('pg_get_viewdef(c.oid, true)',sql)
        self.assertIn('SET LOCAL search_path=public,extensions;',sql)
        self.assertNotEqual(sql,v.render(specs))

    def test_source_changes_duplicates_order_and_symlink_fail_closed(self):
        retained=v.retain(v.ROOT)
        bads=[(),retained[:-1],retained[::-1],retained+(retained[0],),
              ((retained[0][0],retained[0][1]+b'\n'),)+retained[1:]]
        for bad in bads:
            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_SOURCE_REQUIRED'):v.contract(bad)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_SOURCE_REQUIRED'):v.retain(root)
            path=root/v.SELECTION;path.parent.mkdir(parents=True);path.symlink_to(v.ROOT/v.SELECTION)
            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_SOURCE_REQUIRED'):v.retain(root)

    def test_full_relation_row_hash_required_on_witness_and_current(self):
        specs=v.contract(v.retain(v.ROOT))
        rows=[];expected=[]
        for spec in specs:
            row=dict(nspname='public',relname=spec['name'],relkind='v',relrowsecurity=False,
                     relforcerowsecurity=False,reloptions=['security_invoker=true'],
                     view_definition=' SELECT 1;',partition_key=None)
            expected.append(dict(spec,observedRelationSha256=v.sha(row)))
            rows.append(dict(ordinal=spec['ordinal'],actual=row,witness=copy.deepcopy(row)))
        v.verify_rows(rows,expected)
        for field,value in [('reloptions',[]),('relrowsecurity',True),('view_definition',' SELECT 2;'),
                            ('relname','foreign'),('nspname','pg_temp'),('extra',True)]:
            for side in ('actual','witness'):
                bad=copy.deepcopy(rows);bad[-1][side][field]=value
                with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_RELATION_REQUIRED'):v.verify_rows(bad,expected)
        for bad in (rows[:-1],rows[::-1],rows+[rows[0]],'private result'):
                with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_RELATION_REQUIRED'):v.verify_rows(bad,expected)

    def test_diagnostics_emit_only_fixed_ordinals_and_hashes(self):
        specs=v.contract(v.retain(v.ROOT))
        rows=[dict(ordinal=s['ordinal'], actual=dict(nspname='public',relname=s['name'],
            relkind='v',relrowsecurity=False,relforcerowsecurity=False,
            reloptions=['security_invoker=true'],view_definition='private literal',partition_key=None),
            witness=dict(nspname='public',relname=s['name'],relkind='v',relrowsecurity=False,
            relforcerowsecurity=False,reloptions=['security_invoker=true'],
            view_definition='private query',partition_key=None)) for s in specs]
        with patch('builtins.print') as emit:
            v.diagnose(rows,specs)
            result=json.loads(emit.call_args.args[0])
            self.assertEqual(result['selectionSha256'],v.SELECTION_SHA)
            self.assertEqual([r['ordinal'] for r in result['differences']],[1,2,3,4,5])
            self.assertNotIn('private',str(result))
            self.assertNotIn(specs[0]['name'],str(result))
            emit.reset_mock()
            rows[0]['ordinal']='private ordinal'
            v.diagnose(rows,specs)
            emit.assert_not_called()

    def test_portable_postcheck_requires_staged_away_originals_and_pinned_other_inputs(self):
        retained=v.retain(v.ROOT)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'supabase/migrations').mkdir(parents=True)
            for name,raw in retained:
                if name.startswith('supabase/migrations/'):continue
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            with patch.object(v,'ROOT',root):
                self.assertTrue(v.sources_preserved(retained,native=False))
                receipt=v.expected_receipt(v.contract(retained),native=False)
                v.validate_execution_receipt(receipt,native=False)
                with self.assertRaises(ValueError):v.sources_preserved(retained,native=True)
                original=root/'supabase/migrations/unexpected.sql';original.write_text('-- recreated')
                self.assertFalse(v.sources_preserved(retained,native=False));original.unlink()
                (root/v.COMPARATOR).write_text('-- changed')
                self.assertFalse(v.sources_preserved(retained,native=False))

    def progress(self,native=False):
        from canonical_forward_sources import FORWARD_SOURCES
        flag='noOpRepeatVerified' if native else 'positiveAndRepeatVerified'
        return {('foundationInputsExecuted' if native else 'foundationApplied'):144,
                ('timestampInputsExecuted' if native else 'timestampApplied'):514,
                'forwardSources':dict(executed=True,inputsExecuted=len(FORWARD_SOURCES),sources=[dict(source=p,sourceSha256=h,
                 executed=True,rowsPreserved=True,**{flag:True}) for p,h in FORWARD_SOURCES])}

    def test_unowned_or_incomplete_targets_do_not_execute_witness(self):
        target=Mock()
        with self.assertRaisesRegex(ValueError,'OWNED_TARGET_REQUIRED'):v.execute(target,v.retain(v.ROOT),{})
        target.sql.assert_not_called()
        for native in (False,True):
            for defect in ('missing','last_source','last_repeat'):
                progress=self.progress(native)
                if defect=='missing':progress={}
                elif defect=='last_source':progress['forwardSources']['sources'][-1]['sourceSha256']='0'*64
                else:progress['forwardSources']['sources'][-1]['noOpRepeatVerified' if native else 'positiveAndRepeatVerified']=False
                with patch.object(v.actors,'_admit',return_value=('owned',native)):
                    with self.assertRaisesRegex(ValueError,'COMPLETE_REPLAY_REQUIRED'):v.execute(target,v.retain(v.ROOT),progress)
        target.sql.assert_not_called()

    def test_execution_preservation_privacy_and_closed_receipt(self):
        retained=v.retain(v.ROOT)
        for native in (False,True):
            for defect in (None,'sql','json','hash','snapshot','ledger','source','owner'):
                with self.subTest(native=native,defect=defect):
                    target=Mock();target.sql.return_value='[]';progress=self.progress(native)
                    query=Mock(return_value='[]')
                    if defect=='sql':query.side_effect=RuntimeError('private query and connection details')
                    if defect=='json':query.return_value='private bad JSON'
                    admit=[('owned',native),('owned',native)]
                    if defect=='owner':admit[-1]=ValueError('private ownership detail')
                    with patch.object(v.actors,'_admit',side_effect=admit),\
                         patch.object(v.actors,'_snapshot',side_effect=['before','changed' if defect=='snapshot' else 'before']),\
                         patch.object(v,'ledger',side_effect=[['before'],['changed' if defect=='ledger' else 'before']]),\
                         patch.object(v,'execute_query',query),\
                         patch.object(v,'verify_rows',side_effect=ValueError('row mismatch') if defect=='hash' else None),\
                         patch.object(v,'sources_preserved',return_value=defect!='source'):
                        if defect:
                            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_') as error:v.execute(target,retained,progress)
                            self.assertNotIn('private',str(error.exception))
                            self.assertFalse(progress['changedViewSourceWitness']['verified'])
                        else:
                            result=v.execute(target,retained,progress)
                            v.validate_execution_receipt(result,native=native)
                            self.assertTrue(result['verified']);self.assertFalse(result['schemaAccepted'])
                            for key,value in [('verified',1),('temporaryViewsRolledBack',False),('actorAccessAccepted',True),('extra',True)]:
                                with self.assertRaises(ValueError):v.validate_execution_receipt(dict(result,**{key:value}),native=native)
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
        retained=v.retain(v.ROOT);progress=self.progress(False)
        process=SimpleNamespace(returncode=0,stdout=b'[]',stderr=b'')
        with patch.object(v.actors,'_admit',return_value=('owned',False)),\
             patch.object(v.actors,'_controller',return_value=controller),\
             patch.object(v.subprocess,'run',return_value=process) as run:
            self.assertEqual(v.execute_query(target,retained,progress,native=False),'[]')
            self.assertEqual(run.call_args.args[0][-2:],['-f','-'])
            self.assertIn(b'CREATE TEMP VIEW',run.call_args.kwargs['input'])
            self.assertTrue(run.call_args.kwargs['capture_output'])
            self.assertEqual(target.arguments,('owned',(),False))
            self.assertEqual(target.logging_checks,2)
            process.returncode=3;process.stderr=b'private SQL error'
            with self.assertRaisesRegex(ValueError,'CHANGED_VIEW_WITNESS_EXECUTION_REQUIRED'):
                v.execute_query(target,retained,progress,native=False)
            run.reset_mock();target.command=Mock()
            with self.assertRaisesRegex(ValueError,'OWNED_TARGET_REQUIRED'):
                v.execute_query(target,retained,progress,native=False)
            run.assert_not_called()


if __name__=='__main__':unittest.main()
