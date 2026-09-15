#!/usr/bin/env python3
"""Offline admission/rollback controls, never claimed as SQL execution proof."""
import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import canonical_changed_function_witness as m


class Tests(unittest.TestCase):
    def test_retained_sources_reject_changed_missing_and_reordered_bytes(self):
        retained = m.retain(m.ROOT)
        for bad in (retained[:-1], tuple(reversed(retained)),
                    ((retained[0][0], retained[0][1]+b'\n'), *retained[1:])):
            with self.assertRaises(ValueError): m.contract(bad)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError): m.retain(Path(directory))

    def test_fixed_sql_covers_exact_cases_without_replacing_auth(self):
        sql = m.render()
        self.assertTrue(sql.startswith('BEGIN;'))
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
        self.assertEqual(sql.count('INSERT INTO changed_function_cases VALUES'),24)
        for label in ('can_override_allow', 'can_override_deny', 'can_override_other_company',
                      'can_override_future', 'can_override_expired', 'cap_other_denied',
                      'can_inactive_membership', 'can_service_no_identity', 'can_delegates'):
            self.assertIn("VALUES ('"+label+"'", sql)
        self.assertIn(m.CAPABILITY_MD5, sql)
        self.assertIn(m.CAN_MD5, sql)
        for prohibited in ('CREATE OR REPLACE FUNCTION', 'GRANT ', 'DISABLE TRIGGER',
                           'DISABLE ROW LEVEL SECURITY', 'session_replication_role'):
            self.assertNotIn(prohibited,sql.upper() if prohibited != 'session_replication_role' else sql)

    def test_receipt_rejects_missing_false_or_fabricated_acceptance(self):
        for native in (False, True):
            receipt = m.expected_receipt(native=native)
            m.validate_execution_receipt(receipt,native=native)
            for key,value in (('caseCount',23),('permissionOverridesVerified',False),
                              ('catalogAndRowsPreserved',False),('schemaAccepted',True),
                              ('sqlSha256','0'*64),('nativeTarget',not native)):
                bad=copy.deepcopy(receipt);bad[key]=value
                with self.assertRaises(ValueError):m.validate_execution_receipt(bad,native=native)

    def test_unknown_target_fails_before_sql(self):
        target=Mock()
        with patch.object(m.actors,'_admit',side_effect=ValueError('unowned')):
            with self.assertRaises(ValueError):m.execute(target,m.retain(m.ROOT),{})
        target.sql.assert_not_called()

    def test_failure_diagnostics_are_finite_case_labels_only(self):
        progress={'changedFunctionBehaviorWitness':{'verified':False}}
        with self.assertRaises(ValueError):
            m.verify_result({'caseCount':24,'verified':False,'failedCases':['can_override_allow']},progress)
        self.assertEqual(progress['changedFunctionBehaviorWitness']['failedCases'],['can_override_allow'])
        for failures in (['secret SQL'],['can_override_allow','can_override_allow'],[1]):
            clean={'changedFunctionBehaviorWitness':{'verified':False}}
            with self.assertRaises(ValueError):m.verify_result({'caseCount':24,'verified':False,'failedCases':failures},clean)
            self.assertNotIn('failedCases',clean['changedFunctionBehaviorWitness'])

    def test_portable_transport_uses_owned_stdin_and_rejects_substitution_or_sql_failure(self):
        class Owned:
            def command(self,database,args,transaction):
                return ['owned-psql',database]
            def verify_logging(self):
                pass
        for defect in (None,'sql','method'):
            target=Owned();target.sql=Mock()
            if defect=='method':target.command=Mock()
            legacy=SimpleNamespace(OwnedPostgres=Owned,clean_environment=lambda:{},
                safe_receipt=lambda *args:{'sqlstate':'P0001' if defect=='sql' else '00000'})
            process=SimpleNamespace(stdout=b'{"verified":true}',stderr=b'',returncode=1 if defect=='sql' else 0)
            with patch.object(m.actors,'_controller',return_value=SimpleNamespace(load_batch=lambda:legacy)), \
                 patch.object(m.actors,'_admit',return_value=('gridex_auth_legacy_replay',False)), \
                 patch.object(m.subprocess,'run',return_value=process) as run:
                if defect:
                    with self.assertRaises(ValueError):m.execute_query(target,'gridex_auth_legacy_replay',False)
                    if defect=='method':run.assert_not_called()
                else:
                    self.assertEqual(m.execute_query(target,'gridex_auth_legacy_replay',False),'{"verified":true}')
                    self.assertEqual(run.call_args.args[0],['owned-psql','gridex_auth_legacy_replay','-f','-'])
                    self.assertEqual(run.call_args.kwargs['input'],m.render().encode())
                target.sql.assert_not_called()

    def test_execution_requires_actual_result_and_unchanged_state(self):
        retained=m.retain(m.ROOT)
        for defect in (None,'sql','rows','ledger','source','result'):
            with self.subTest(defect=defect):
                target=Mock()
                target.sql.return_value=json.dumps({'caseCount':23 if defect=='result' else 24,'verified':True,'failedCases':[]})
                if defect=='sql':target.sql.side_effect=ValueError('CF002')
                progress={}
                with patch.object(m.actors,'_admit',return_value=('postgres',True)), \
                     patch.object(m.actors,'_complete'), \
                     patch.object(m.actors,'_snapshot',side_effect=['before','changed' if defect=='rows' else 'before']), \
                     patch.object(m.added,'ledger',side_effect=[[],[1] if defect=='ledger' else []]), \
                     patch.object(m,'sources_preserved',return_value=defect!='source'):
                    if defect:
                        with self.assertRaises(ValueError):m.execute(target,retained,progress)
                        self.assertFalse(progress['changedFunctionBehaviorWitness']['verified'])
                    else:
                        receipt=m.execute(target,retained,progress)
                        self.assertTrue(receipt['verified'])
                        self.assertFalse(receipt['schemaAccepted'])


if __name__=='__main__':unittest.main()
