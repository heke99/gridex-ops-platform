#!/usr/bin/env python3
"""Portable diagnostic admission/privacy tests; SQL execution remains a CI gate."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('portable_invariants', ROOT/'scripts/canonical-portable-invariants-diagnostic.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.retained = m.final_sql.retain(ROOT)
        self.target = Mock()
        self.target.command.return_value = ['owned-command']
        self.legacy = Mock()
        self.legacy.clean_environment.return_value = {'FIXED': 'value'}
        self.progress = dict(foundationApplied=144, timestampApplied=514,
                            forwardSources=dict(executed=True, inputsExecuted=len(m.forward_sources.FORWARD_SOURCES)))

    def execute(self, results, snapshots=None):
        with patch.object(m.subprocess, 'run', side_effect=results) as run, patch.object(
                m.forward_portable, 'snapshot', side_effect=snapshots, return_value=('catalog','rows')):
            m.execute_final(self.target, self.legacy, self.retained, self.progress)
            return run

    def test_same_five_pinned_inputs_and_transaction_boundaries(self):
        run = self.execute([subprocess.CompletedProcess([],0,b'private output',b'')]*5)
        self.assertEqual([c.kwargs['input'] for c in run.call_args_list], [raw for _,raw in self.retained])
        self.assertEqual([c.kwargs['transaction'] for c in self.target.command.call_args_list], [True,False,False,False,True])
        self.assertTrue(all(c['verified'] for c in self.progress['finalChecks']))
        receipt=m.receipt('PORTABLE_FINAL_SQL_PASSED_NOT_CERTIFIED','PINNED_FINAL_SQL',self.progress)
        for key in ('completeReplayVerified','schemaAccepted','ledgerProvenanceVerified','generatedTypesVerified','productionModified'):
            self.assertIs(receipt[key],False)
        self.assertNotIn('private output',json.dumps(receipt))

    def test_workflow_owner_is_admitted_by_real_private_input_boundary(self):
        workflow=(ROOT/'.github/workflows/gridex-portable-invariants.yml').read_text()
        owner_line=next(line for line in workflow.splitlines() if 'GRIDEX_LEGACY_CONTAINER_NAME:' in line)
        owner=owner_line.split(':',1)[1].strip().replace('${{ github.run_id }}','35000914570').replace('${{ github.run_attempt }}','1')
        controller=m.frontier.load_controller()
        with patch.dict('os.environ', {'GRIDEX_LEGACY_CONTAINER_NAME': owner}):
            target=controller.load_batch().OwnedPostgres(postgis=True)
        with tempfile.TemporaryDirectory() as directory:
            from types import SimpleNamespace
            target.directory=SimpleNamespace(name=directory)
            target.active=True
            with controller.load_private().AcceptedInputs(target) as admission:
                self.assertTrue(admission.active)
            self.assertTrue(admission.closed)
            # Original unadmitted prefix must still be rejected by the guard.
            target.name=target._created_name='gridex-auth-legacy-portable-invariants-35000914570-1'
            with self.assertRaisesRegex(controller.load_batch().BoundaryError,'FRESH_FIXED_PREPARATION_REQUIRED'):
                with controller.load_private().AcceptedInputs(target):
                    self.fail('unadmitted owner accepted')

    def test_real_owned_command_uses_explicit_stdin_script_for_transaction(self):
        legacy = m.frontier.load_controller().load_batch()
        target = legacy.OwnedPostgres(postgis=True)
        # No docker process: exercise the real command ownership admission.
        target.active = True
        self.target = target
        run = self.execute([subprocess.CompletedProcess([],0,b'',b'')]*5)
        for index, call in enumerate(run.call_args_list):
            argv = call.args[0]
            self.assertEqual(argv[:3], ['docker', 'exec', '-i'])
            self.assertIn(target.name, argv)
            self.assertEqual(argv[-2:], ['-f', '-'])
            self.assertEqual('--single-transaction' in argv, index in (0,4))
            self.assertEqual(call.kwargs['input'], self.retained[index][1])
        target.active = False
        with self.assertRaisesRegex(legacy.BoundaryError, 'OWNED_TARGET_REQUIRED'):
            self.execute([])

    def test_recognized_fifth_error_is_diagnostic_and_still_failure(self):
        stderr=(b'ERROR:  P0001: Tenant isolation invariants failed (1 breach(es)):\n'
                b'  - F-13: view private_view does not set security_invoker\n'
                b'CONTEXT:  private context\nLOCATION:  private location\n')
        with self.assertRaisesRegex(ValueError,'PORTABLE_FINAL_SQL_REJECTED'):
            self.execute([subprocess.CompletedProcess([],0,b'',b'')]*4+[subprocess.CompletedProcess([],3,b'private',stderr)])
        last=self.progress['finalChecks'][-1]
        self.assertFalse(last['verified'])
        self.assertEqual(last['tenantInvariants']['breaches'][0]['rule'],'F13_VIEW_INVOKER')
        self.assertNotIn('private',json.dumps(self.progress))

    def test_unknown_error_zero_exit_with_error_and_nonzero_without_error_reject(self):
        for code,stderr in ((0,b'ERROR:  42501: private\n'),(3,b'private'),(3,b'ERROR:  42501: private\n')):
            with self.subTest(code=code,stderr=stderr), self.assertRaisesRegex(ValueError,'PORTABLE_FINAL_SQL_REJECTED'):
                self.execute([subprocess.CompletedProcess([],code,b'private output',stderr)])
            self.assertNotIn('private',json.dumps(self.progress))

    def test_f14_hash_projection_is_bounded_count_matched_and_state_preserving(self):
        diagnostic=dict(status='RECOGNIZED', breaches=[dict(rule='F14_INERT_POLICY', affectedCount=1)])
        row=dict(tableSha256='a'*64, policySha256='b'*64)
        self.target.sql.return_value=json.dumps([row])
        with patch.object(m.forward_portable,'snapshot',return_value=('catalog','rows')):
            self.assertEqual(m.inert_policy_hashes(self.target,diagnostic),dict(count=1,objects=[row]))
            for invalid in ([dict(row, name='private')],[],[dict(row,tableSha256='private')], [row,row]):
                self.target.sql.return_value=json.dumps(invalid)
                with self.assertRaisesRegex(ValueError,'INERT_POLICY_DIAGNOSTIC_PROJECTION_REQUIRED'):
                    m.inert_policy_hashes(self.target,diagnostic)
        self.target.sql.return_value=json.dumps([row])
        with patch.object(m.forward_portable,'snapshot',side_effect=['before','after']):
            with self.assertRaisesRegex(ValueError,'INERT_POLICY_DIAGNOSTIC_STATE_CHANGED'):
                m.inert_policy_hashes(self.target,diagnostic)

    def test_f14_supplement_never_turns_original_rejection_into_success(self):
        stderr=(b'ERROR:  P0001: Tenant isolation invariants failed (1 breach(es)):\n'
                b'  - F-14: 24 policy/policies target roles with no privileges on their table and are inert\n'
                b'CONTEXT:  private context\nLOCATION:  private location\n')
        self.target.sql.return_value='[]'
        with self.assertRaisesRegex(ValueError,'INERT_POLICY_DIAGNOSTIC_PROJECTION_REQUIRED'):
            self.execute([subprocess.CompletedProcess([],0,b'',b'')]*4+[subprocess.CompletedProcess([],3,b'',stderr)])
        item=self.progress['finalChecks'][-1]
        self.assertFalse(item['verified'])
        self.assertEqual(item['tenantInvariants']['breaches'][0]['affectedCount'],24)
        self.assertNotIn('inertPolicyHashes',item)

    def test_changed_state_rejects(self):
        with self.assertRaisesRegex(ValueError,'PORTABLE_FINAL_STATE_CHANGED'):
            self.execute([subprocess.CompletedProcess([],0,b'',b'')], snapshots=[('before',()),('after',())])
        self.assertFalse(self.progress['finalChecks'][-1]['verified'])

    def test_incomplete_prefix_and_changed_sql_reject_before_command(self):
        self.progress['timestampApplied']=513
        with self.assertRaisesRegex(ValueError,'PORTABLE_FINAL_PREFIX_REQUIRED'):
            self.execute([])
        self.progress['timestampApplied']=514
        self.retained=self.retained[:-1]+((self.retained[-1][0],b'SELECT 1;'),)
        with self.assertRaisesRegex(ValueError,'NATIVE_FINAL_SQL_SOURCE_REQUIRED'):
            self.execute([])
        self.target.command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
