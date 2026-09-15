#!/usr/bin/env python3
"""Fast fixture orchestration controls; actual PostgreSQL belongs to native CI."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import canonical_native_live_sync_preflight as m


class Tests(unittest.TestCase):
    def test_contract_is_exact_forward_definition_and_hardening_acl(self):
        accepted, pins=m.contract()
        self.assertEqual(accepted['execute'],dict(anon=False,authenticated=True,service_role=True))
        self.assertIn('security definer',accepted['definition'])
        self.assertIn('v_user_id uuid := auth.uid()',accepted['definition'])
        self.assertNotIn('return true;',accepted['definition'].split('v_user_id uuid := auth.uid()')[0])
        self.assertEqual(pins,m.PINS)
        with patch.object(m,'PINS',{**m.PINS,next(iter(m.PINS)):'0'*64}):
            with self.assertRaisesRegex(ValueError,'SOURCE'):m.contract()

    def fixture(self):
        target=object.__new__(m.proof.NativeTimestampTarget)
        target.assert_native_owned=Mock();target.close=Mock();target._owned={}
        target._last_sql_failure=None
        return target

    def test_unchanged_behavior_and_cleanup_required_before_success(self):
        for defect in (None,'state','ledger','cleanup','behavior'):
            with self.subTest(defect=defect):
                target=self.fixture();parent={}
                live=SimpleNamespace(fix=m.proof.load_live_sync().fix,behavior=Mock())
                if defect=='cleanup':target.close.side_effect=ValueError('cleanup failed')
                if defect=='behavior':
                    def fail(*args):
                        target._last_sql_failure=dict(stage='LIVE_SYNC_BEHAVIOR_FIXTURE',expected='SUCCESS',
                            actual='INSUFFICIENT_PRIVILEGE',primaryErrors='ONE',exit='NONZERO')
                        raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
                    live.behavior.side_effect=fail
                with patch.object(m.proof,'NativeTimestampTarget',return_value=target),\
                     patch.object(m.proof,'load_live_sync',return_value=live),\
                     patch.object(m,'ledger',side_effect=[['actual'],['changed' if defect=='ledger' else 'actual']]),\
                     patch.object(m.timestamp,'native_snapshot',side_effect=['before','after' if defect=='state' else 'before']):
                    if defect:
                        with self.assertRaises(ValueError):m.verify(Mock(),'owned',parent)
                        self.assertFalse(parent['nativeLiveSyncBehavior']['verified'])
                    else:
                        result=m.verify(Mock(),'owned',parent)
                        self.assertTrue(result['verified'])
                        self.assertTrue(result['clonesDisposed'])
                        self.assertFalse(result['historicalPrefixVerified'])
                        live.behavior.assert_called_once_with(target,m.contract()[0])
                target.close.assert_called_once()
                if defect=='behavior':self.assertEqual(parent['nativeLiveSyncBehavior']['nativeSqlFailure'],target._last_sql_failure)

    def test_real_single_synthetic_ledger_required(self):
        target=Mock()
        for rows in ([],[dict(version='20260915000000',name='other',statements=['SELECT 1'])]):
            target.sql.return_value=m.json.dumps(rows)
            with self.assertRaisesRegex(ValueError,'LEDGER'):m.ledger(target)


if __name__=='__main__':unittest.main()
