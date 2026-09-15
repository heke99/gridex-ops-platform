#!/usr/bin/env python3
"""Fast fixture orchestration controls; actual PostgreSQL belongs to native CI."""
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import canonical_native_live_sync_preflight as m


class Tests(unittest.TestCase):
    def test_server_crash_markers_are_closed_and_owner_bound(self):
        target=Mock(name='target');target.name='owned-container';target.assert_native_owned=Mock()
        target._run.return_value=SimpleNamespace(returncode=0,stdout=b'',stderr=(
            b'LOG: server process (PID 123) was terminated by signal 11: Segmentation fault\n'
            b'DETAIL: Failed process was running: private SQL and private identity\n'
            b'LOG: terminating any other active server processes\nLOG: reinitializing\n'))
        self.assertEqual(m.server_failure_diagnostic(target),dict(collected=True,
            signals=['OTHER_BACKENDS_TERMINATED','SERVER_REINITIALIZING','SIGNAL_11']))
        target._run.assert_called_once_with(['docker','logs','--tail','200','owned-container'],
                                            timeout=30,allow_failure=True)
        target._run.reset_mock();target.assert_native_owned.side_effect=ValueError('private error')
        self.assertEqual(m.server_failure_diagnostic(target),dict(collected=False,signals=['COLLECTION_FAILED']))
        target._run.assert_not_called()

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

    def test_cleanup_failure_has_separate_closed_diagnostic(self):
        target=self.fixture();parent={}
        primary=dict(stage='LIVE_SYNC_ACL_ANON',actual='NONE')
        secondary=dict(stage='TIMESTAMP_CLONE_IDENTITY',actual='NONE')
        def behavior(*args):
            target._last_sql_failure=primary
            raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
        def close():
            target._recent_sql_failure=secondary
            raise ValueError('NATIVE_TIMESTAMP_SQL_RESULT')
        target.close.side_effect=close
        live=SimpleNamespace(fix=m.proof.load_live_sync().fix,behavior=behavior)
        with patch.object(m.proof,'NativeTimestampTarget',return_value=target), \
             patch.object(m.proof,'load_live_sync',return_value=live), \
             patch.object(m,'ledger',return_value=['actual']), \
             patch.object(m.timestamp,'native_snapshot',return_value='before'):
            with self.assertRaisesRegex(ValueError,'NATIVE_TIMESTAMP_SQL_RESULT'):
                m.verify(Mock(),'owned',parent)
        report=parent['nativeLiveSyncBehavior']
        self.assertEqual(report['nativeSqlFailure'],primary)
        self.assertEqual(report['cloneCleanupFailure'],dict(reason='SQL_RESULT',nativeSqlFailure=secondary))
        self.assertFalse(report['clonesDisposed'])
        self.assertFalse(report['verified'])
        self.assertEqual(m.cleanup_failure(ValueError('private failure'),target)['reason'],'OTHER')

    def test_real_single_synthetic_ledger_required(self):
        target=Mock()
        for rows in ([],[dict(version='20260915000000',name='other',statements=['SELECT 1'])]):
            target.sql.return_value=m.json.dumps(rows)
            with self.assertRaisesRegex(ValueError,'LEDGER'):m.ledger(target)


if __name__=='__main__':unittest.main()
