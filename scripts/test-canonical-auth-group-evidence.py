#!/usr/bin/env python3
"""Local subprocess/report tests, not auth SQL or native replay acceptance."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load():
    path = ROOT / 'scripts/canonical_auth_group_evidence.py'
    assert path.is_file(), 'Missing durable, redacted auth-group failure evidence'
    spec = importlib.util.spec_from_file_location('auth_evidence_tests_target', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.m = load()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'scripts/canonical-auth-membership-group.py').write_text('# fixed runner\n')
        self.command = ('python3', 'scripts/canonical-auth-email-selftest.py')
        self.source = self.root / self.command[1]
        self.source.write_text('pass\n')
        self.report = self.m.Evidence(self.root, 'original16', [self.command])

    def document(self):
        return json.loads((self.root / 'artifacts/auth-membership-group.json').read_text())

    def test_failed_real_process_is_recorded_without_leaking_output(self):
        self.source.write_text("import sys\nprint('private@example.invalid password=DO_NOT_EXPORT')\n"
                               "print('ERROR: 42703: private_column', file=sys.stderr)\n"
                               "raise SystemExit(23)\n")
        result = self.report.run(self.command, {})
        self.assertEqual(result.returncode, 23)
        doc = self.document()
        self.assertEqual(doc['status'], 'FAILED')
        self.assertEqual(doc['firstFailedCommand'], 1)
        self.assertEqual(doc['commands'][0]['observedSqlstates'], ['42703'])
        self.assertEqual(doc['commands'][0]['returncode'], 23)
        self.assertEqual(doc['commands'][0]['scriptSha256'], self.m.sha(self.source.read_bytes()))
        self.assertFalse(doc['completeReplayVerified'])
        self.assertFalse(doc['generatedTypesVerified'])
        self.assertNotIn('private', json.dumps(doc))
        self.assertNotIn('DO_NOT_EXPORT', json.dumps(doc))
        self.assertNotIn('password', json.dumps(doc))
        self.assertEqual(doc['commands'][0]['stdoutBytes'], len(b'private@example.invalid password=DO_NOT_EXPORT\n'))

    def test_success_requires_every_selected_command(self):
        other = ('python3', 'scripts/canonical-poa-request-selftest.py')
        (self.root / other[1]).write_text('pass\n')
        report = self.m.Evidence(self.root, 'original16', [self.command, other])
        report.run(self.command, {})
        self.assertEqual(self.document()['status'], 'RUNNING')
        self.assertEqual(self.document()['commands'][1]['status'], 'PENDING')
        report.run(other, {})
        doc = self.document()
        self.assertEqual(doc['status'], 'COMMANDS_PASSED')
        self.assertEqual([c['status'] for c in doc['commands']], ['PASSED', 'PASSED'])
        self.assertFalse(doc['completeReplayVerified'])
        self.assertFalse(doc['sqlRuntimeCertified'])

    def test_unknown_error_does_not_invent_an_sqlstate(self):
        self.source.write_text("raise RuntimeError('private-secret')\n")
        self.report.run(self.command, {})
        doc = self.document()
        self.assertEqual(doc['commands'][0]['observedSqlstates'], [])
        self.assertEqual(doc['commands'][0]['status'], 'FAILED')
        self.assertNotIn('private-secret', json.dumps(doc))

    def test_traceback_frame_binds_existing_source_and_discards_unknown_paths(self):
        self.source.write_text("import sys\nprint('File \"/private/secret.py\", line 1, in secret', file=sys.stderr)\nraise RuntimeError('SECRET')\n")
        self.report.run(self.command, {})
        doc = self.document()
        frames = doc['commands'][0]['checkoutTracebackFrames']
        self.assertEqual(frames, [{'script': self.command[1], 'line': 3,
                                  'scriptSha256': self.m.sha(self.source.read_bytes())}])
        self.assertNotIn('/private/', json.dumps(doc))
        self.assertNotIn('SECRET', json.dumps(doc))

    def test_no_sql_values_from_streams_and_only_known_codes(self):
        self.source.write_text("import sys\nsys.stdout.buffer.write(b'\\xff' + b'x' * 131072 + b' SQLSTATE 42601\\n')\n"
                               "sys.stderr.write('SQLSTATE ABCDE\\nERROR: 23505: private@example.invalid\\n')\n"
                               "raise SystemExit(7)\n")
        self.report.run(self.command, {})
        doc = self.document()
        self.assertEqual(doc['commands'][0]['observedSqlstates'], ['23505', '42601'])
        self.assertNotIn('ABCDE', json.dumps(doc))
        self.assertNotIn('private@example.invalid', json.dumps(doc))
        self.assertGreater(doc['commands'][0]['stdoutBytes'], 131072)
        self.assertLess(len(json.dumps(doc)), 6000)

    def test_spawn_error_is_saved_and_propagated(self):
        with patch.object(self.m.subprocess, 'run', side_effect=OSError('SECRET')):
            with self.assertRaises(OSError):
                self.report.run(self.command, {})
        doc = self.document()
        self.assertEqual(doc['status'], 'ERROR')
        self.assertEqual(doc['commands'][0]['status'], 'ERROR')
        self.assertNotIn('SECRET', json.dumps(doc))

    def test_signal_exit_is_never_marked_passed(self):
        with patch.object(self.m.subprocess, 'run', return_value=subprocess.CompletedProcess(self.command, -15)):
            result = self.report.run(self.command, {})
        self.assertEqual(result.returncode, -15)
        self.assertEqual(self.document()['status'], 'FAILED')

    def test_keyboard_interrupt_keeps_truthful_receipt(self):
        with patch.object(self.m.subprocess, 'run', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt): self.report.run(self.command, {})
        self.assertEqual(self.document()['status'], 'INTERRUPTED')
        self.assertEqual(self.document()['commands'][0]['status'], 'INTERRUPTED')

    def test_unexpected_order_repeat_or_post_failure_execution_rejected(self):
        with self.assertRaises(ValueError): self.report.run(('python3', 'scripts/other.py'), {})
        self.source.write_text('raise SystemExit(2)\n')
        self.report.run(self.command, {})
        with self.assertRaises(ValueError): self.report.run(self.command, {})

    def test_output_symlink_rejected_without_touching_target(self):
        target = self.root / 'external.txt'; target.write_text('preserve')
        path = self.root / 'artifacts/auth-membership-group.json'
        path.parent.mkdir(exist_ok=True); path.symlink_to(target)
        with self.assertRaises(ValueError): self.report.run(self.command, {})
        self.assertEqual(target.read_text(), 'preserve')

    def test_symlink_directory_rejected(self):
        outside = self.root / 'outside'; outside.mkdir()
        (self.root / 'artifacts').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(ValueError): self.report.run(self.command, {})
        self.assertEqual(list(outside.iterdir()), [])

    def test_git_checkout_is_measured_not_taken_from_environment(self):
        subprocess.run(['git', 'init', '-q'], cwd=self.root, check=True)
        subprocess.run(['git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
                        'commit', '--allow-empty', '-qm', 'test'], cwd=self.root, check=True)
        expected = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        with patch.dict(self.m.os.environ, {'GITHUB_SHA': 'f'*40}):
            report = self.m.Evidence(self.root, 'original16', [self.command])
        report.run(self.command, {})
        self.assertEqual(self.document()['checkoutRevision'], expected)

    def test_empty_and_unsafe_commands_rejected(self):
        for commands in ([], [('bash', '-c', 'no')], [('python3', '../outside.py')],
                         [('python3', '/tmp/absolute.py')], [('python3', 'scripts/missing.py')]):
            with self.subTest(commands=commands), self.assertRaises(ValueError):
                self.m.Evidence(self.root, 'original16', commands)

    def test_actual_runner_evidence_mode_stops_at_failure_and_strips_pg_environment(self):
        import os
        import shutil
        runner = ROOT / 'scripts/canonical-auth-membership-group.py'
        spec = importlib.util.spec_from_file_location('fixed_runner_for_evidence_test', runner)
        fixed = importlib.util.module_from_spec(spec); spec.loader.exec_module(fixed)
        for command in fixed.COMMANDS:
            (self.root / command[1]).write_text('pass\n')
        shutil.copy2(runner, self.root / 'scripts' / runner.name)
        shutil.copy2(ROOT / 'scripts/canonical_auth_group_evidence.py', self.root / 'scripts')
        binary = self.root / 'bin'; binary.mkdir()
        shim = binary / 'python3'
        shim.write_text('#!' + sys.executable + '\n' +
                        'import os,sys\n' +
                        "assert not any(k.startswith('PG') for k in os.environ)\n" +
                        "print('password=PRIVATE SQLSTATE 42703', file=sys.stderr)\n" +
                        "raise SystemExit(23 if sys.argv[1:] == ['scripts/canonical-poa-request-selftest.py'] else 0)\n")
        shim.chmod(0o700)
        env = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ.get('PATH', ''),
               'PGPASSWORD': 'do-not-export', 'PGHOST': 'unwanted.example.invalid'}
        result = subprocess.run([sys.executable, str(self.root / 'scripts' / runner.name),
                                 '--partition', 'original16', '--evidence'], cwd=self.root,
                                env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 23, result.stderr)
        doc = self.document()
        self.assertEqual(doc['firstFailedCommand'], 3)
        self.assertEqual([r['status'] for r in doc['commands']][:4],
                         ['PASSED', 'PASSED', 'FAILED', 'PENDING'])
        self.assertEqual(result.stdout.splitlines(), [' '.join(c) for c in fixed.COMMANDS[:3]])
        self.assertNotIn('PRIVATE', result.stdout + result.stderr + json.dumps(doc))
        self.assertNotIn('do-not-export', json.dumps(doc))

    def test_dry_run_cannot_create_execution_evidence(self):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/canonical-auth-membership-group.py'),
                                 '--dry-run', '--evidence'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires actual command execution', result.stderr)

    def test_workflow_uploads_only_redacted_receipt_and_keeps_failure(self):
        text = (ROOT / '.github/workflows/ops-hardening.yml').read_text()
        auth = text.split('  auth-email-source-effects:', 1)[1].split('  auth-provisioning-legacy-proof:', 1)[0]
        self.assertIn('scripts/canonical-auth-membership-group.py --partition original16 --evidence', auth)
        self.assertIn('if: always()', auth)
        self.assertIn('path: artifacts/auth-membership-group.json', auth)
        self.assertNotIn('continue-on-error', auth)
        self.assertNotIn('|| true', auth)
        self.assertNotIn('*.log', auth)


if __name__ == '__main__': unittest.main(verbosity=2)
