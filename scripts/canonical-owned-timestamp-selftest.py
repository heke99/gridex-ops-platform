#!/usr/bin/env python3
"""Controller state/transport regressions; native SQL remains a separate CI gate."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from canonical_forward_sources import FORWARD_SOURCES

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('owned_tail_test_controller', ROOT/'scripts/canonical-auth-provisioning-replay.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class OwnedTimestampTests(unittest.TestCase):
    def fixture(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root/'supabase/migrations').mkdir(parents=True)
        current = patch.object(m, 'ROOT', root)
        current.start()
        self.addCleanup(current.stop)
        target = object()
        loop = SimpleNamespace(scope='full', target=target, validated=True, applied=True,
                               residual_receipt={'residualApplied': ['fixture-only']},
                               repair=SimpleNamespace(require_owned=Mock()),
                               dedupe=SimpleNamespace(require_live=Mock()))
        tail = object.__new__(m.OwnedTimestampTail)
        tail.target, tail.state = target, 'prepared'
        tail.selected, tail.prerequisites, tail.retained = [('fixture', 'sha')], {}, object()
        tail.forward_retained = object()
        tail.actor_retained = object()
        tail.view_retained = object()
        import canonical_added_view_witness as views
        view_receipt=views.expected_receipt(views.contract(views.retain(ROOT)),native=False)
        def witness(actual, retained, progress):
            self.assertIs(actual,target)
            self.assertIs(retained,tail.view_retained)
            self.assertTrue(progress['policyActorQualification']['verified'])
            return view_receipt
        view_patch=patch('canonical_added_view_witness.execute',side_effect=witness)
        tail.view_execute=view_patch.start()
        self.addCleanup(view_patch.stop)
        import canonical_policy_actor_qualification as actors
        actor_receipt = dict(actors.expected_result(), source=actors.SOURCE, sourceSha256=actors.SOURCE_SHA256,
            completePolicyContextSha256='a'*64,catalogAndRowsPreserved=True,nativeTarget=False,ledgerProvenanceAccepted=False)
        def actor(actual, retained, progress):
            self.assertIs(actual,target)
            self.assertIs(retained,tail.actor_retained)
            self.assertEqual(progress['forwardSources']['inputsExecuted'],len(FORWARD_SOURCES))
            return actor_receipt
        actor_patch = patch('canonical_policy_actor_qualification.execute',side_effect=actor)
        tail.actor_execute=actor_patch.start()
        self.addCleanup(actor_patch.stop)
        def forward(actual, retained, progress):
            self.assertIs(actual, target)
            self.assertIs(retained, tail.forward_retained)
            self.assertEqual(progress['timestampApplied'], len(tail.selected))
            progress['forwardSources'] = dict(executed=True, inputsExecuted=len(FORWARD_SOURCES))
        patched = patch('canonical_forward_portable.execute', side_effect=forward)
        tail.forward_execute = patched.start()
        self.addCleanup(patched.stop)
        def execute(root, actual, database, selected, prerequisites, progress, *, retained):
            self.assertIs(actual, target)
            self.assertIs(retained, tail.retained)
            progress['timestampApplied'] = len(selected)
        tail.driver = SimpleNamespace(execute_tail=Mock(side_effect=execute))
        return root, loop, tail, {'operation': 'timestamp_tail', 'scope': 'full'}

    def test_once_only_full_continuation_preserves_false_acceptance_flags(self):
        root, loop, tail, payload = self.fixture()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(tail.execute(loop, payload), '')
        self.assertEqual(tail.state, 'executed')
        tail.actor_execute.assert_called_once()
        tail.view_execute.assert_called_once()
        result = json.loads(output.getvalue())
        self.assertIs(result['originalsAbsentDuringTimestamp'], True)
        for field in ('completeReplayVerified', 'ledgerProvenanceVerified', 'generatedTypesVerified'):
            self.assertIs(result[field], False)
        loop.repair.require_owned.assert_called_once_with(tail.target, reference=True)
        loop.dedupe.require_live.assert_called_once_with(tail.target)
        with self.assertRaisesRegex(RuntimeError, 'BOUNDARY_REQUIRED'):
            tail.execute(loop, payload)
        self.assertEqual(tail.driver.execute_tail.call_count, 1)

    def test_view_failure_or_invalid_receipt_never_completes(self):
        for fail in (True,False):
            _,loop,tail,payload=self.fixture()
            if fail:tail.view_execute.side_effect=ValueError('view witness rejected')
            else:
                tail.view_execute.side_effect=None
                tail.view_execute.return_value={}
            with contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(ValueError):tail.execute(loop,payload)
            self.assertEqual(tail.state,'failed')
            self.assertEqual(output.getvalue(),'')

    def test_actor_failure_or_invalid_receipt_never_completes(self):
        for fail in (True,False):
            _,loop,tail,payload=self.fixture()
            if fail: tail.actor_execute.side_effect=ValueError('actor SQL rejected')
            else:
                tail.actor_execute.side_effect=None
                tail.actor_execute.return_value={}
            with contextlib.redirect_stdout(io.StringIO()) as output:
                with self.assertRaises(ValueError): tail.execute(loop,payload)
            self.assertEqual(tail.state,'failed')
            self.assertEqual(output.getvalue(),'')

    def test_forward_failure_is_terminal_without_completion_receipt(self):
        _, loop, tail, payload = self.fixture()
        tail.forward_execute.side_effect = RuntimeError('forward source rejected')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(RuntimeError, 'forward source rejected'):
                tail.execute(loop, payload)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(tail.state, 'failed')
        with self.assertRaisesRegex(RuntimeError, 'BOUNDARY_REQUIRED'):
            tail.execute(loop, payload)

    def test_partial_forward_or_source_recreation_cannot_complete(self):
        for recreate in (False, True):
            root, loop, tail, payload = self.fixture()
            def partial(actual, retained, progress):
                progress['forwardSources'] = dict(executed=recreate, inputsExecuted=len(FORWARD_SOURCES) if recreate else 1)
                if recreate:
                    (root/'supabase/migrations/recreated.sql').write_text('-- invalid')
            tail.forward_execute.side_effect = partial
            with self.assertRaisesRegex(RuntimeError, 'FORWARD_COMPLETION_REQUIRED'):
                tail.execute(loop, payload)
            self.assertEqual(tail.state, 'failed')

    def test_payload_cannot_supply_sql_paths_or_target(self):
        _, loop, tail, payload = self.fixture()
        for invalid in ({}, {'scope':'full'}, dict(payload, sql='SELECT 1'),
                        dict(payload, hold='/tmp/other'), dict(payload, target='external'),
                        dict(payload, scope='intake77')):
            with self.subTest(payload=invalid), self.assertRaisesRegex(RuntimeError, 'BOUNDARY_REQUIRED'):
                tail.execute(loop, invalid)
        tail.driver.execute_tail.assert_not_called()

    def test_missing_or_wrong_foundation_boundary_is_rejected(self):
        _, loop, tail, payload = self.fixture()
        for key, value in (('scope','intake77'), ('target',object()), ('validated',False),
                           ('validated',1), ('applied',False), ('applied',1)):
            original = getattr(loop, key)
            setattr(loop, key, value)
            try:
                with self.subTest(key=key, value=value), self.assertRaisesRegex(RuntimeError, 'BOUNDARY_REQUIRED'):
                    tail.execute(loop, payload)
            finally:
                setattr(loop, key, original)
        del loop.residual_receipt
        with self.assertRaisesRegex(RuntimeError, 'BOUNDARY_REQUIRED'):
            tail.execute(loop, payload)
        tail.driver.execute_tail.assert_not_called()

    def test_original_files_present_are_rejected_before_sql(self):
        root, loop, tail, payload = self.fixture()
        (root/'supabase/migrations/unmoved.sql').write_text('-- original')
        with self.assertRaisesRegex(RuntimeError, 'ORIGINALS_MUST_BE_ABSENT'):
            tail.execute(loop, payload)
        tail.driver.execute_tail.assert_not_called()

    def test_ownership_or_reference_failure_never_executes_tail(self):
        _, loop, tail, payload = self.fixture()
        for check in (loop.repair.require_owned, loop.dedupe.require_live):
            check.side_effect = RuntimeError('test boundary revoked')
            with self.assertRaisesRegex(RuntimeError, 'boundary revoked'):
                tail.execute(loop, payload)
            check.side_effect = None
        tail.driver.execute_tail.assert_not_called()

    def test_native_failure_is_terminal_and_does_not_emit_success(self):
        _, loop, tail, payload = self.fixture()
        tail.driver.execute_tail.side_effect = RuntimeError('private diagnostic')
        with contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(RuntimeError, 'private diagnostic'):
                tail.execute(loop, payload)
        self.assertEqual(output.getvalue(), '')
        self.assertEqual(tail.state, 'failed')
        with self.assertRaisesRegex(RuntimeError, 'BOUNDARY_REQUIRED'):
            tail.execute(loop, payload)
        self.assertEqual(tail.driver.execute_tail.call_count, 1)

    def test_incomplete_driver_does_not_claim_completion(self):
        _, loop, tail, payload = self.fixture()
        tail.driver.execute_tail.side_effect = None
        with self.assertRaisesRegex(RuntimeError, 'COMPLETION_REQUIRED'):
            tail.execute(loop, payload)
        self.assertEqual(tail.state, 'failed')

    def test_source_recreation_during_tail_fails(self):
        root, loop, tail, payload = self.fixture()
        def recreate(*args, **kwargs):
            args[5]['timestampApplied'] = 1
            (root/'supabase/migrations/recreated.sql').write_text('-- wrong')
        tail.driver.execute_tail.side_effect = recreate
        with self.assertRaisesRegex(RuntimeError, 'COMPLETION_REQUIRED'):
            tail.execute(loop, payload)
        self.assertEqual(tail.state, 'failed')

    def test_cli_rejects_tail_override_or_nonfull_scope(self):
        for flags in (['--timestamp-tail','--owned-compatible'],
                      ['--timestamp-tail','--foundation-prefix-proof'],
                      ['--timestamp-tail','--context'], ['--timestamp-tail','--hold','/tmp'],
                      ['--timestamp-tail','--foundation','/tmp/list'],
                      ['--timestamp-tail','--validate-foundation']):
            result = subprocess.run([sys.executable,str(ROOT/'scripts/canonical-auth-provisioning-replay.py'),*flags],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 2, flags)
            self.assertIn('requires only the existing full owned context', result.stderr)

    def test_cli_tail_requires_an_existing_socket_context(self):
        with patch.dict(m.os.environ, {}, clear=True), patch.object(sys,'argv',['replay','--timestamp-tail']):
            with self.assertRaisesRegex(RuntimeError, 'OWNED_CONTEXT_REQUIRED'):
                m.main()

    def test_incomplete_canonical_accounting_blocks_before_startup(self):
        batch = m.load_batch()
        result = SimpleNamespace(returncode=1, stdout=b'{}')
        with patch.object(m.subprocess,'run',return_value=result) as run, \
             patch.object(batch,'OwnedPostgres') as start, \
             patch.object(sys,'argv',['replay','--owned-compatible']):
            with self.assertRaisesRegex(batch.BoundaryError, 'FULL_EFFECTS_INCOMPLETE'):
                m.main()
        start.assert_not_called()
        self.assertIn(str(ROOT/'scripts/gridex-replay-complete-accounting.py'), run.call_args.args[0])
        self.assertIn('--require-canonical-sources', run.call_args.args[0])

    def test_full_scope_selects_postgis_after_successful_preflight(self):
        batch = m.load_batch()
        with patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'{}')), \
             patch.object(batch,'OwnedPostgres',side_effect=RuntimeError('stop before container')) as start, \
             patch.object(sys,'argv',['replay','--owned-compatible']):
            with self.assertRaisesRegex(RuntimeError, 'stop before container'):
                m.main()
        start.assert_called_once_with(postgis=True)

    def test_shell_uses_shared_tail_before_unchanged_schema_and_ledger_guards(self):
        shell = (ROOT/'scripts/gridex-aud-003-clean-replay.sh').read_text()
        tail = shell.index('--timestamp-tail')
        self.assertLess(tail, shell.index('gridex-replay-required-checks.py'))
        self.assertLess(tail, shell.index('ACTUAL_FINGERPRINT='))
        self.assertIn('NO ledger provenance', shell)
        self.assertIn('supabase_migrations.schema_migrations', shell)
        self.assertNotIn('while IFS= read -r file; do', shell)
        self.assertIn('schema fingerprint mismatch', shell)
        self.assertNotIn('continue-on-error', shell)


if __name__ == '__main__':
    unittest.main(verbosity=2)
