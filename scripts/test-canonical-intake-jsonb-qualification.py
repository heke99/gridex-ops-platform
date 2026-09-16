import copy
import json
from pathlib import Path
import re
import unittest
from unittest.mock import patch
import canonical_intake_jsonb_qualification as q

class IntakeTests(unittest.TestCase):
    def test_exact_source_statements_and_conditional_precedence(self):
        statements=q.contract(q.retain())
        self.assertEqual(len(statements),8)
        self.assertIn('intake_missing_fields jsonb',statements[0])
        self.assertIn('intake_warnings jsonb',statements[2])
        self.assertIn('intake_missing_fields text[]',statements[3])
        self.assertIn('alter table if exists public.customers',statements[5])
        self.assertTrue(all('if not exists' in s for s in statements))
        self.assertFalse(any('alter column' in s.lower() for s in statements))

    def test_every_changed_missing_or_reordered_source_rejected(self):
        retained=q.retain()
        for i in range(len(retained)):
            bad=list(retained);p,h,raw=bad[i];bad[i]=(p,h,raw+b' ')
            with self.assertRaises(ValueError):q.contract(tuple(bad))
        for bad in (None,retained[:-1],retained[::-1]):
            with self.assertRaises(ValueError):q.contract(bad)

    def test_supported_payloads_include_order_duplicates_and_escapes(self):
        sql=q.render(q.retain())
        payloads=json.loads(re.search(r'\$cases\$(.*?)\$cases\$',sql,re.S)[1])
        self.assertEqual(len(payloads),3)
        self.assertEqual(payloads[2]['missing'],['duplicate','duplicate',''])
        self.assertEqual(payloads[2]['warnings'][1:3],['quote"','backslash\\'])
        self.assertTrue(sql.startswith('BEGIN;') and sql.endswith('ROLLBACK;'))
        self.assertIn('jsonb_populate_record(NULL::intake_text',sql)
        self.assertIn('rejected<>4',sql)

    def test_receipt_requires_actual_metadata_behavior_and_preservation(self):
        retained=q.retain()
        for answers,snapshots,ok in [(['t','t'],[{},{}],True),(['f'],[{}],False),(['t','f'],[{}],False),(['t','t'],[{}, {'changed':True}],False)]:
            with patch.object(q.actors,'_admit',return_value=('postgres',True)),patch.object(q.actors,'_snapshot',side_effect=snapshots),patch.object(q,'query',side_effect=answers):
                if ok:
                    receipt=q.execute(object(),retained)
                    self.assertFalse(receipt['schemaAccepted']);self.assertFalse(receipt['postgrestHttpVerified'])
                    self.assertFalse(receipt['nonStringPayloadsQualified'])
                else:
                    with self.assertRaises(ValueError):q.execute(object(),retained)

    def test_only_registered_fresh_owned_instance_uses_standalone_admission(self):
        legacy=q.load_legacy()
        target=legacy.OwnedPostgres.__new__(legacy.OwnedPostgres)
        target.active=True;target.name=target._created_name='gridex-auth-legacy-continuation-123-1'
        target.directory=object()
        with patch.object(q.actors,'_admit',side_effect=ValueError('FULL_PARENT_REFERENCE_REQUIRED')):
            with self.assertRaisesRegex(ValueError,'FULL_PARENT_REFERENCE_REQUIRED'):q.admit(target)
            q._STANDALONE.add(target)
            try:
                self.assertEqual(q.admit(target),(q.DATABASE,False))
                target.active=False
                with self.assertRaises(Exception):q.admit(target)
                target.active=True;target.name='another-target'
                with self.assertRaises(Exception):q.admit(target)
                target.name=target._created_name;target.command=lambda *a,**k:[]
                with self.assertRaises(ValueError):q.admit(target)
            finally:q._STANDALONE.discard(target)
            with self.assertRaisesRegex(ValueError,'FULL_PARENT_REFERENCE_REQUIRED'):q.admit(target)

    def test_parent_receipt_cannot_be_isolated_or_mutated(self):
        receipt=q.parent_receipt(native=True)
        self.assertIs(q.validate_execution_receipt(receipt,native=True),receipt)
        for key,value in [('nativeTarget',False),('verified',1),('ledgerUnchanged',False),('stringArrayCases',4),('extra',True)]:
            bad=copy.deepcopy(receipt);bad[key]=value
            with self.assertRaises(ValueError):q.validate_execution_receipt(bad,native=True)
        with self.assertRaises(ValueError):q.validate_execution_receipt({'scope':'SOURCE_AUTHORED_INTAKE_JSONB_STRING_ARRAYS_ONLY'},native=True)

    def test_parent_requires_exact_columns_and_preservation(self):
        from contextlib import ExitStack
        for change in ('none','ordinal','type','missing','ledger','source','snapshot'):
            rows=q.column_rows(reference=False)
            if change=='ordinal':rows[0]['attnum']+=1
            if change=='type':rows[0]['data_type']='text[]'
            if change=='missing':rows.pop()
            progress={}
            with ExitStack() as stack:
                stack.enter_context(patch.object(q.actors,'_admit',return_value=('postgres',True)))
                stack.enter_context(patch.object(q.actors,'_complete'))
                stack.enter_context(patch.object(q.actors,'_snapshot',side_effect=[{}, {'changed':True} if change=='snapshot' else {}]))
                stack.enter_context(patch.object(q,'parent_ledger',side_effect=[[],[{}] if change=='ledger' else []]))
                stack.enter_context(patch.object(q,'parent_sources_preserved',return_value=change!='source'))
                stack.enter_context(patch.object(q,'query',return_value=json.dumps(rows)))
                behavior=stack.enter_context(patch.object(q,'execute'))
                if change=='none':
                    self.assertTrue(q.execute_parent(object(),q.retain(),progress)['verified'])
                    behavior.assert_called_once()
                else:
                    with self.assertRaises(ValueError):q.execute_parent(object(),q.retain(),progress)
                    self.assertFalse(progress['intakeJsonbSourceWitness']['verified'])

    def test_exact_two_column_decisions_are_source_contract_scoped(self):
        decisions=q.column_decisions()
        self.assertEqual(len(decisions),2)
        self.assertEqual([r['identity'][2] for r in decisions],list(q.COLUMNS))
        self.assertTrue(all(r['fields']==['attnum','column_default','data_type','udt_name'] for r in decisions))
        self.assertTrue(all(r['witness']=='intakeJsonbSourceWitness' for r in decisions))
        self.assertTrue(all(r['decisionSourceSha256']==q.sha(q.PINS) for r in decisions))

    def test_external_target_stops_before_queries(self):
        with patch.object(q,'query') as sql:
            with self.assertRaises(ValueError):q.execute(object(),q.retain())
            sql.assert_not_called()

if __name__=='__main__':unittest.main()
