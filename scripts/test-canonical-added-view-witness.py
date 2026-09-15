"""Offline source/admission/preservation controls; no PostgreSQL claim."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

import canonical_added_view_witness as v


class Tests(unittest.TestCase):
    def test_exact_source_queries_include_wrapped_and_quoted_semicolons(self):
        retained=v.retain(v.ROOT); specs=v.contract(retained)
        self.assertEqual(len(specs),31)
        self.assertEqual(len({r['name'] for r in specs}),31)
        by_name={r['name']:r for r in specs}
        self.assertIn("where coalesce(bu.readiness_status",by_name['billing_readiness_flags']['query'])
        self.assertNotIn('$view$',by_name['billing_readiness_flags']['query'])
        self.assertIn('explicit user_id; this is owner-provided data.',by_name['gridex_db2b_preflight_v']['query'])
        self.assertTrue(by_name['gridex_db2b_preflight_v']['query'].rstrip().endswith('from public.gridex_db2b_superadmin_target_v'))
        self.assertTrue(by_name['gridex_debug_batch2_rbac_v']['source'].endswith('20260526_debug_step1_2c_full_schema_code_alignment.sql'))
        self.assertIn('array_agg',by_name['gridex_debug_batch2_rbac_v']['query'])
        self.assertIn("('customer_import_batches')",by_name['gridex_debug_step1_2_schema_alignment_v']['query'])
        sql=v.render(specs)
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
        self.assertEqual(sql.count('CREATE TEMP VIEW '),31)
        self.assertNotIn('CREATE OR REPLACE VIEW public.',sql)
        self.assertIn('pg_get_viewdef(c.oid, true)',sql)
        self.assertIn('SET LOCAL search_path=public,extensions;',sql)
        self.assertNotEqual(sql,v.render(specs))

    def test_source_changes_duplicates_order_and_symlink_fail_closed(self):
        retained=v.retain(v.ROOT)
        bads=[(),retained[:-1],retained[::-1],retained+(retained[0],),
              ((retained[0][0],retained[0][1]+b'\n'),)+retained[1:]]
        for bad in bads:
            with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_SOURCE_REQUIRED'):v.contract(bad)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_SOURCE_REQUIRED'):v.retain(root)
            path=root/v.SELECTION;path.parent.mkdir(parents=True);path.symlink_to(v.ROOT/v.SELECTION)
            with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_SOURCE_REQUIRED'):v.retain(root)

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
                with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_RELATION_REQUIRED'):v.verify_rows(bad,expected)
        for bad in (rows[:-1],rows[::-1],rows+[rows[0]],'private result'):
                with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_RELATION_REQUIRED'):v.verify_rows(bad,expected)

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
                    if defect=='sql':target.sql.side_effect=RuntimeError('private query and connection details')
                    if defect=='json':target.sql.return_value='private bad JSON'
                    admit=[('owned',native),('owned',native)]
                    if defect=='owner':admit[-1]=ValueError('private ownership detail')
                    with patch.object(v.actors,'_admit',side_effect=admit),\
                         patch.object(v.actors,'_snapshot',side_effect=['before','changed' if defect=='snapshot' else 'before']),\
                         patch.object(v,'ledger',side_effect=[['before'],['changed' if defect=='ledger' else 'before']]),\
                         patch.object(v,'verify_rows',side_effect=ValueError('row mismatch') if defect=='hash' else None),\
                         patch.object(v,'sources_preserved',return_value=defect!='source'):
                        if defect:
                            with self.assertRaisesRegex(ValueError,'ADDED_VIEW_WITNESS_') as error:v.execute(target,retained,progress)
                            self.assertNotIn('private',str(error.exception))
                            self.assertFalse(progress['addedViewSourceWitness']['verified'])
                        else:
                            result=v.execute(target,retained,progress)
                            v.validate_execution_receipt(result,native=native)
                            self.assertTrue(result['verified']);self.assertFalse(result['schemaAccepted'])
                            for key,value in [('verified',1),('temporaryViewsRolledBack',False),('actorAccessAccepted',True),('extra',True)]:
                                with self.assertRaises(ValueError):v.validate_execution_receipt(dict(result,**{key:value}),native=native)
                    target.sql.assert_called_once()
                    self.assertFalse(target.sql.call_args.kwargs['transaction'])


if __name__=='__main__':unittest.main()
