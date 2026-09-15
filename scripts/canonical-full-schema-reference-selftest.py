#!/usr/bin/env python3
"""Negative controls for full-schema comparison and source admission; no SQL."""
import copy
import contextlib
import io
import importlib.util
import json
from pathlib import Path
import tempfile
import shutil
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('full_reference', ROOT/'scripts/canonical-full-schema-reference.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


def document():
    return {'schemas':['public'], **{key:[] for key in m.KEYS}}


class ReferenceTests(unittest.TestCase):
    def test_identical_projection_is_not_a_release_or_ledger_claim(self):
        result = m.compare(document(), document())
        self.assertTrue(result['publicSnapshotEqual'])
        for field in ('schemaAccepted','ledgerProvenanceVerified','generatedTypesVerified','productionModified'):
            self.assertIs(result[field], False)

    def test_all_existing_parity_sections_are_mandatory(self):
        for section in m.KEYS:
            bad = document(); del bad[section]
            with self.assertRaisesRegex(ValueError, 'COMPLETE_SCHEMA_DOCUMENT_REQUIRED'):
                m.compare(document(), bad)
        bad = document(); bad['schemas'] = []
        with self.assertRaisesRegex(ValueError, 'COMPLETE_SCHEMA_DOCUMENT_REQUIRED'):
            m.compare(document(), bad)

    def test_rls_and_forced_rls_cannot_disappear(self):
        before = document()
        before['relations'] = [{'nspname':'public','relname':'customers','relkind':'r',
                                'relrowsecurity':True,'relforcerowsecurity':False,
                                'reloptions':[],'view_definition':None,'partition_key':None}]
        for field in ('relrowsecurity','relforcerowsecurity'):
            after = copy.deepcopy(before); after['relations'][0][field] = not before['relations'][0][field]
            result = m.compare(before, after)
            self.assertFalse(result['publicSnapshotEqual'])
            self.assertEqual(result['sections']['relations']['changed'][0]['fields'], [field])
        after = document()
        self.assertEqual(len(m.compare(before, after)['sections']['relations']['removed']), 1)

    def test_policy_semantics_and_roles_are_checked_but_not_disclosed(self):
        before = document()
        before['policies'] = [{'nspname':'public','relname':'customers','polname':'tenant',
            'command':'r','permissive':True,'roles':['authenticated'],
            'using_expression':"tenant_id = 'private-test-literal'",'check_expression':''}]
        for field, value in [('using_expression','true'),('check_expression','true'),
                             ('roles',['PUBLIC']),('permissive',False),('command','*')]:
            after = copy.deepcopy(before); after['policies'][0][field] = value
            result = m.compare(before, after)
            self.assertFalse(result['publicSnapshotEqual'])
            self.assertIn(field, result['sections']['policies']['changed'][0]['fields'])
            self.assertNotIn('private-test-literal', json.dumps(result))

    def test_index_semantics_and_grants_cannot_be_silently_accepted(self):
        before = document()
        before['indexes'] = [{'nspname':'public','relname':'customers','indexname':'tenant_idx',
                               'definition':'CREATE INDEX private-test-definition','indisunique':True,'indisprimary':False}]
        after = copy.deepcopy(before); after['indexes'][0]['indisunique'] = False
        result = m.compare(before, after)
        self.assertFalse(result['publicSnapshotEqual'])
        self.assertNotIn('private-test-definition', json.dumps(result))
        after['relation_grants'] = [{'nspname':'public','relname':'customers',
                                    'grantee':'anon','privilege_type':'SELECT','is_grantable':False}]
        self.assertEqual(len(m.compare(before, after)['sections']['relation_grants']['added']), 1)

    def test_duplicate_and_incomplete_rows_fail_closed(self):
        bad = document(); bad['schema_grants'] = [{'nspname':'public','grantee':'anon',
                                                   'privilege_type':'USAGE','is_grantable':False}]*2
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_CATALOG_IDENTITY'):
            m.compare(document(), bad)
        bad = document(); bad['columns'] = [{'nspname':'public'}]
        with self.assertRaisesRegex(ValueError, 'COMPLETE_SCHEMA_DOCUMENT_REQUIRED'):
            m.compare(document(), bad)

    def test_untrusted_identity_controls_cannot_enter_the_report(self):
        for identity in ('bad\nprivate-value', 'bad\x00value', 'x'*1025, None):
            with self.assertRaisesRegex(ValueError, 'CATALOG_IDENTITY_REQUIRED'):
                m.key({'name':identity}, ('name',))

    def test_reference_runtime_is_disposed_before_its_metadata_is_reused(self):
        target = Mock(); target.active = True; target.directory = object()
        context = Mock(); context.__enter__ = Mock(return_value=target)
        def dispose(*_):
            target.active = False; target.directory = None
        context.__exit__ = Mock(side_effect=dispose)
        legacy = Mock(); legacy.OwnedPostgres.return_value = context
        timestamp = Mock()
        def restore(handle, raw):
            self.assertIs(handle, target)
            self.assertTrue(handle.active)
            self.assertEqual(raw, b'exact-reference')
            return document()
        with patch.object(m, 'restore_reference', side_effect=restore):
            value = m.isolated_reference(legacy, timestamp, b'exact-reference')
        self.assertEqual(value, document())
        self.assertFalse(target.active)
        self.assertIsNone(target.directory)
        legacy.OwnedPostgres.assert_called_once_with(postgis=True)
        timestamp.verify_spatial_runtime.assert_called_once_with(target)
        context.__exit__.assert_called_once()

    def test_unverified_reference_disposal_blocks_later_reconstruction(self):
        for active, directory in ((True, None), (False, object())):
            target = Mock(); target.active = active; target.directory = directory
            context = Mock(); context.__enter__ = Mock(return_value=target); context.__exit__ = Mock(return_value=False)
            legacy = Mock(); legacy.OwnedPostgres.return_value = context
            with patch.object(m, 'restore_reference', return_value=document()):
                with self.assertRaisesRegex(ValueError, 'REFERENCE_DISPOSAL_REQUIRED'):
                    m.isolated_reference(legacy, Mock(), b'exact')

    def test_failed_restore_is_not_replaced_by_an_observed_replay_catalog(self):
        context = Mock(); context.__enter__ = Mock(return_value=Mock()); context.__exit__ = Mock(return_value=False)
        legacy = Mock(); legacy.OwnedPostgres.return_value = context
        with patch.object(m, 'restore_reference', side_effect=ValueError('source-failed')):
            with self.assertRaisesRegex(ValueError, 'source-failed'):
                m.isolated_reference(legacy, Mock(), b'exact')
        self.assertEqual(legacy.OwnedPostgres.call_count, 1)
        context.__exit__.assert_called_once()

    def test_reference_comes_from_the_exact_committed_dump(self):
        data = m.pinned()
        self.assertEqual(m.sha(data['supabase/schema.sql']), m.PINS['supabase/schema.sql'])
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'ROOT', Path(directory)):
            root = Path(directory); (root/'supabase').mkdir()
            source = root/'supabase/schema.sql'; source.write_bytes(b'SELECT 1;')
            with self.assertRaisesRegex(ValueError, 'REFERENCE_INPUT_HASH_MISMATCH'):
                m.pinned()
            source.unlink(); source.symlink_to(ROOT/'supabase/schema.sql')
            with self.assertRaisesRegex(ValueError, 'REFERENCE_INPUT_REQUIRED'):
                m.pinned()


class ShellObservationTests(unittest.TestCase):
    def fixture(self):
        dedupe = SimpleNamespace(require_live=Mock(), _STATES={}, fail=None)
        # Match the real controller frame boundary, not an arbitrary callback.
        def shell(h, observer, scope='full', state='executed', applied=True, status=1):
            from canonical_forward_sources import FORWARD_SOURCES
            forward = dict(executed=True, inputsExecuted=5, sources=[dict(source=path,sourceSha256=digest,
                executed=True,positiveAndRepeatVerified=True,rowsPreserved=True) for path,digest in FORWARD_SOURCES])
            import canonical_policy_actor_qualification as actors
            receipt=dict(actors.expected_result(),source=actors.SOURCE,sourceSha256=actors.SOURCE_SHA256,
                completePolicyContextSha256='a'*64,catalogAndRowsPreserved=True,nativeTarget=False,ledgerProvenanceAccepted=False)
            tail = SimpleNamespace(state=state, selected=[('test.sql', 'hash')], forward_receipt=forward, actor_receipt=receipt)
            loop = SimpleNamespace(applied=applied)
            child = SimpleNamespace(poll=lambda:status)
            return observer(h)
        controller = SimpleNamespace(_serve_child=shell, DATABASE='owned', SCOPES={'full':144},
            originals_snapshot=Mock(return_value='original-bytes'),
            load_dedupe=lambda:dedupe, load_repair=lambda:SimpleNamespace(require_owned=Mock()))
        # Real targets are hashable; a plain object with properties models one.
        class Handle:
            active = True
            directory = object()
        target = Handle()
        def dispose(handle):
            self.assertIs(handle, target)
            dedupe._STATES[handle] = 'DISPOSED'
            return 'original-return'
        original = Mock(side_effect=dispose)
        dedupe.fail = original
        result = {}
        return controller, dedupe, target, original, result

    def test_actual_shell_is_used_without_a_second_source_staging_tree(self):
        controller, dedupe, target, original, result = self.fixture()
        def main():
            self.assertEqual(m.sys.argv[1:], ['--owned-compatible'])
            try:
                controller._serve_child(target, dedupe.fail)
                raise RuntimeError('ACTUAL_REPLAY_OR_RESTORATION_FAILED')
            finally:
                target.active = False; target.directory = None
        controller.main = Mock(side_effect=main)
        argv = m.sys.argv
        with patch.object(m, 'capture', return_value=document()) as capture, \
             patch.object(shutil, 'copy2',
                          side_effect=AssertionError('duplicate source copies forbidden')):
            m.observe_actual_shell(controller, document(), 'original-bytes', result)
        controller.main.assert_called_once()
        capture.assert_called_once_with(target, 'owned')
        self.assertIs(dedupe.fail, original)
        self.assertIs(m.sys.argv, argv)
        self.assertIs(result['ordinaryReplaySucceeded'], False)
        self.assertIs(result['privacyVerified'], True)
        self.assertIs(result['cleanupVerified'], True)
        self.assertIs(result['schemaAccepted'], False)
        self.assertEqual(result['timestampApplied'], 1)
        self.assertEqual(result['forwardApplied'], 5)

    def test_capture_must_precede_original_privacy_and_disposal(self):
        controller, dedupe, target, original, result = self.fixture()
        def capture(handle, database):
            self.assertTrue(handle.active)
            original.assert_not_called()
            return document()
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture', side_effect=capture):
            returned = controller._serve_child(target, observer)
        self.assertEqual(returned, 'original-return')
        original.assert_called_once_with(target)
        self.assertTrue(result['privacyVerified'])
        self.assertTrue(result['databaseDisposed'])
        self.assertTrue(target.active)  # owning runtime closes in controller.main
        self.assertNotIn('cleanupVerified', result)

    def test_wrong_scope_incomplete_or_running_shell_never_captures(self):
        for kwargs in ({'scope':'intake77'}, {'state':'running'}, {'state':'failed'},
                       {'applied':False}, {'status':None}, {'status':0}):
            controller, _, target, original, result = self.fixture()
            observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
            with self.subTest(kwargs=kwargs), patch.object(m, 'capture') as capture:
                controller._serve_child(target, observer, **kwargs)
                capture.assert_not_called()
                self.assertNotIn('sections', result)
                original.assert_called_once_with(target)

    def test_arbitrary_call_cannot_claim_an_observed_final_schema(self):
        controller, _, target, original, result = self.fixture()
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture') as capture:
            observer(target)
        capture.assert_not_called()
        original.assert_called_once_with(target)
        self.assertNotIn('privacyVerified', result)

    def test_capture_is_once_only_even_when_controller_reenters_failure(self):
        controller, _, target, original, result = self.fixture()
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture', return_value=document()) as capture:
            controller._serve_child(target, observer)
            controller._serve_child(target, observer)
        self.assertEqual(capture.call_count, 1)
        self.assertEqual(original.call_count, 2)

    def test_missing_original_restoration_still_disposes_but_never_collects(self):
        controller, _, target, original, result = self.fixture()
        controller.originals_snapshot.return_value = 'changed'
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture') as capture:
            controller._serve_child(target, observer)
        capture.assert_not_called()
        original.assert_called_once()
        self.assertNotIn('sections', result)
        self.assertEqual(result['collectionOutcome'], 'EVIDENCE_UNAVAILABLE')

    def test_collection_failure_does_not_replace_original_terminal_error(self):
        controller, _, target, original, result = self.fixture()
        original.side_effect = RuntimeError('original privacy failure')
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture', side_effect=ValueError('private@example.invalid')), \
             contextlib.redirect_stdout(io.StringIO()) as output:
            with self.assertRaisesRegex(RuntimeError, '^original privacy failure$'):
                controller._serve_child(target, observer)
        self.assertNotIn('private@example.invalid', output.getvalue()+json.dumps(result))
        self.assertNotIn('sections', result)
        self.assertNotIn('privacyVerified', result)
        original.assert_called_once()

    def test_privacy_error_blocks_publication_even_with_equal_schema(self):
        controller, _, target, original, result = self.fixture()
        original.side_effect = RuntimeError('SOURCE_LITERAL_IN_PRIVATE_ARTIFACT')
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture', return_value=document()):
            with self.assertRaisesRegex(RuntimeError, 'SOURCE_LITERAL'):
                controller._serve_child(target, observer)
        self.assertNotIn('sections', result)
        self.assertNotIn('privacyVerified', result)

    def test_returning_terminal_handler_without_database_disposal_is_not_verification(self):
        controller, dedupe, target, original, result = self.fixture()
        original.side_effect = lambda handle:dedupe._STATES.update({handle:'TERMINAL'})
        observer = m.terminal_observer(controller, original, document(), 'original-bytes', result)
        with patch.object(m, 'capture', return_value=document()):
            with self.assertRaisesRegex(ValueError, 'OBSERVED_TERMINAL_DISPOSAL_REQUIRED'):
                controller._serve_child(target, observer)
        self.assertNotIn('sections', result)
        self.assertNotIn('privacyVerified', result)

    def test_database_disposal_is_not_owning_runtime_cleanup(self):
        for active, directory in [(True,None),(False,object())]:
            controller, dedupe, target, _, result = self.fixture()
            def incomplete_cleanup():
                controller._serve_child(target, dedupe.fail)
                target.active = active; target.directory = directory
                raise RuntimeError('ACTUAL_REPLAY_OR_RESTORATION_FAILED')
            controller.main = incomplete_cleanup
            with patch.object(m, 'capture', return_value=document()):
                m.observe_actual_shell(controller, document(), 'original-bytes', result)
            self.assertTrue(result['databaseDisposed'])
            self.assertFalse(result['cleanupVerified'])
            self.assertFalse(result['ordinaryReplaySucceeded'])
            self.assertEqual(result['phase'], 'OWNED_RUNTIME_CLEANUP')

    def test_failing_ordinary_shell_cannot_turn_equal_projection_into_green(self):
        result = m.compare(document(), document())
        with tempfile.TemporaryDirectory() as directory, patch.object(m, 'ROOT', Path(directory)), \
             contextlib.redirect_stdout(io.StringIO()):
            result.update(privacyVerified=True, cleanupVerified=True, ordinaryReplaySucceeded=False)
            self.assertEqual(m.publish_result(result), 1)

    def test_early_controller_failure_restores_handler_arguments_and_signals(self):
        controller, dedupe, _, original, result = self.fixture()
        signals = {s:m.signal.getsignal(s) for s in (m.signal.SIGINT,m.signal.SIGTERM)}
        def failed():
            m.signal.signal(m.signal.SIGTERM, lambda *_:None)
            raise RuntimeError('private source text')
        controller.main = failed
        argv = m.sys.argv
        with patch.object(m, 'capture') as capture:
            m.observe_actual_shell(controller, document(), 'original-bytes', result)
        capture.assert_not_called()
        self.assertIs(dedupe.fail, original)
        self.assertIs(m.sys.argv, argv)
        self.assertEqual(signals, {s:m.signal.getsignal(s) for s in signals})
        self.assertNotIn('private source text', json.dumps(result))
        self.assertNotIn('sections', result)


if __name__ == '__main__':
    unittest.main(verbosity=2)
