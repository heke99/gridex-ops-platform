"""Finite fake-canonical scripts only; no replay, Docker, database or native proof."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from datetime import datetime, timezone, timedelta

SOURCE = Path(__file__).with_name('same-shell.py')


def load():
    spec = importlib.util.spec_from_file_location('t3_same_shell', SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SameShellTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.trace = self.root / 'trace'
        self.plan = self.root / 'plan.json'
        self.plan.write_text('{}')
        self.replay = self.root / 'canonical.sh'
        self.consumer = self.root / 'consumer.py'
        self.log = self.root / 'operation.log'
        self.boundaries = self.root / 'boundaries'
        self.header = '''ROOT=canonical-root
HOLD=canonical-hold
cleanup(){ code=$?; printf 'cleanup:%s:%s:%s\\n' "$code" "$ROOT" "$HOLD" >> "$TRACE"; }
trap cleanup EXIT
printf 'replay\\n' >> "$TRACE"
'''
        self.replay.write_text(self.header)
        self.consumer.write_text("import os\nwith open(os.environ['TRACE'],'a') as stream: stream.write('consumer\\n')\n")
        self.env = {'PATH': '/usr/bin:/bin', 'TRACE': str(self.trace)}

    def tearDown(self):
        self.temporary.cleanup()

    def run_fake(self, timeout=3):
        return load().run_shell(self.root, self.replay, self.consumer, self.plan, self.log,
                                self.boundaries, timeout, self.env, sys.executable, grace=1)

    def lines(self):
        return self.trace.read_text().splitlines() if self.trace.exists() else []

    def test_success_sources_replay_then_consumer_and_original_cleanup_once(self):
        result = self.run_fake()
        self.assertTrue(result['ok'])
        self.assertEqual(result['shellExit'], 0)
        self.assertEqual(self.lines(), ['replay', 'consumer', 'cleanup:0:canonical-root:canonical-hold'])
        self.assertEqual(self.log.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.boundaries.stat().st_mode & 0o777, 0o600)
        self.assertEqual(result['cleanupAcceptance'], 'NOT_ATTESTED_BY_SUPERVISOR')

    def test_unconditional_source_preserves_errexit_and_skips_consumer(self):
        self.replay.write_text(self.header + "false\nprintf 'must-not-run\\n' >> \"$TRACE\"\n")
        result = self.run_fake()
        self.assertFalse(result['ok'])
        self.assertEqual(result['shellExit'], 1)
        self.assertEqual(self.lines(), ['replay', 'cleanup:1:canonical-root:canonical-hold'])
        self.assertEqual(result['boundaries'], ['replay-entered'])

    def test_source_receives_no_supervisor_positional_arguments(self):
        self.replay.write_text(self.header + 'test "$#" -eq 0\n')
        result = self.run_fake()
        self.assertTrue(result['ok'])
        self.assertIn('consumer', self.lines())

    def test_consumer_failure_retains_original_exit_and_cleanup(self):
        self.consumer.write_text(self.consumer.read_text() + 'raise SystemExit(37)\n')
        result = self.run_fake()
        self.assertFalse(result['ok'])
        self.assertEqual(result['shellExit'], 37)
        self.assertEqual(self.lines(), ['replay', 'consumer', 'cleanup:37:canonical-root:canonical-hold'])
        self.assertEqual(result['boundaries'], ['replay-entered', 'replay-returned', 'consumer-entered'])

    def test_replay_exit_zero_is_not_a_completed_consumer(self):
        self.replay.write_text(self.header + 'exit 0\n')
        result = self.run_fake()
        self.assertFalse(result['ok'])
        self.assertEqual(result['shellExit'], 0)
        self.assertNotIn('consumer', self.lines())

    def test_timeout_stops_only_the_launched_group_and_preserves_exit_cleanup(self):
        self.consumer.write_text(self.consumer.read_text() + 'import time\ntime.sleep(30)\n')
        control = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)'], start_new_session=True)
        try:
            result = self.run_fake(timeout=0.3)
            self.assertFalse(result['ok'])
            self.assertTrue(result['timedOut'])
            self.assertNotEqual(result['shellExit'], 0)
            self.assertIsNone(control.poll())
            self.assertEqual(len([x for x in self.lines() if x.startswith('cleanup:')]), 1)
        finally:
            control.terminate()
            control.wait(timeout=2)

    def test_does_not_label_cleanup_override_as_separately_observed_primary_exit(self):
        self.replay.write_text(self.header + "cleanup(){ printf 'cleanup-override\\n' >> \"$TRACE\"; exit 9; }; trap cleanup EXIT\n")
        self.consumer.write_text(self.consumer.read_text() + 'raise SystemExit(37)\n')
        result = self.run_fake()
        self.assertFalse(result['ok'])
        self.assertEqual(result['shellExit'], 9)
        self.assertFalse(result['originalFailureExitSeparatelyObserved'])
        self.assertEqual(self.lines(), ['replay', 'consumer', 'cleanup-override'])

    def test_signal_is_forwarded_to_own_group_and_cleanup_observed(self):
        self.consumer.write_text(self.consumer.read_text() + 'import time\ntime.sleep(30)\n')
        child_code = '''import importlib.util,json,sys
from pathlib import Path
s=importlib.util.spec_from_file_location('same_shell',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=Path(sys.argv[2]);r=m.run_shell(p,p/'canonical.sh',p/'consumer.py',p/'plan.json',p/'operation.log',p/'boundaries',5,{'PATH':'/usr/bin:/bin','TRACE':str(p/'trace')},sys.executable,grace=1)
(p/'result.json').write_text(json.dumps(r))
raise SystemExit(0 if r['ok'] else 1)
'''
        child = subprocess.Popen([sys.executable, '-B', '-c', child_code, str(SOURCE), str(self.root)], start_new_session=True)
        try:
            deadline = time.monotonic() + 3
            while 'consumer' not in self.lines() and time.monotonic() < deadline:
                if child.poll() is not None:
                    self.fail('fake supervisor exited before the controlled consumer')
                time.sleep(0.01)
            self.assertIn('consumer', self.lines())
            child.send_signal(signal.SIGTERM)
            child.wait(timeout=3)
            self.assertNotEqual(child.returncode, 0)
            result = json.loads((self.root / 'result.json').read_text())
            self.assertFalse(result['ok'])
            self.assertEqual(result['signal'], signal.SIGTERM)
            self.assertEqual(len([x for x in self.lines() if x.startswith('cleanup:')]), 1)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=2)

    def test_ignoring_consumer_is_killed_by_first_signal_deadline(self):
        self.consumer.write_text("import os,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nopen(os.environ['TRACE'],'a').write('consumer\\n')\nopen(os.environ['TRACE']+'.pid','w').write(str(os.getpid()))\ntime.sleep(30)\n")
        code = """import importlib.util,json,sys
from pathlib import Path
s=importlib.util.spec_from_file_location('unit',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=Path(sys.argv[2]);r=m.run_shell(p,p/'canonical.sh',p/'consumer.py',p/'plan.json',p/'operation.log',p/'boundaries',20,{'PATH':'/usr/bin:/bin','TRACE':str(p/'trace')},sys.executable,grace=.3)
(p/'result.json').write_text(json.dumps(r))
"""
        child = subprocess.Popen([sys.executable, '-B', '-c', code, str(SOURCE), str(self.root)])
        try:
            deadline = time.monotonic() + 3
            while not Path(str(self.trace)+'.pid').exists() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(Path(str(self.trace)+'.pid').exists())
            started = time.monotonic()
            child.send_signal(signal.SIGTERM)
            time.sleep(.15)
            child.send_signal(signal.SIGTERM)
            child.wait(timeout=1)
            self.assertLess(time.monotonic()-started, 1)
            result = json.loads((self.root/'result.json').read_text())
            self.assertTrue(result['forcedKill'])
            self.assertFalse(result['ok'])
            self.assertEqual(result['signal'], signal.SIGTERM)
        finally:
            pidfile = Path(str(self.trace)+'.pid')
            if pidfile.exists():
                pid = int(pidfile.read_text())
                try:
                    if str(self.consumer).encode() in Path(f'/proc/{pid}/cmdline').read_bytes():
                        os.kill(pid, signal.SIGKILL)
                except FileNotFoundError:
                    pass
            if child.poll() is None:
                child.kill(); child.wait(timeout=2)

    def test_supervisor_exception_retains_group_until_ignoring_consumer_killed(self):
        self.consumer.write_text("import os,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nopen(os.environ['TRACE']+'.pid','w').write(str(os.getpid()))\ntime.sleep(30)\n")
        unit = load()
        original_waitid = os.waitid
        pidfile = Path(str(self.trace)+'.pid')
        def failing_waitid(*args):
            if pidfile.exists():
                raise OSError('finite injected supervisor observation failure')
            return original_waitid(*args)
        try:
            with patch.object(unit.os, 'waitid', side_effect=failing_waitid):
                with self.assertRaisesRegex(OSError, 'finite injected'):
                    unit.run_shell(self.root, self.replay, self.consumer, self.plan, self.log,
                                   self.boundaries, 3, self.env, sys.executable, grace=.15)
            self.assertTrue(pidfile.exists())
            pid = int(pidfile.read_text())
            command = Path(f'/proc/{pid}/cmdline')
            deadline = time.monotonic()+.5
            while command.exists() and str(self.consumer).encode() in command.read_bytes() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(command.exists() and str(self.consumer).encode() in command.read_bytes(),
                             'ignoring consumer survived exception cleanup')
        finally:
            if pidfile.exists():
                pid = int(pidfile.read_text())
                try:
                    if str(self.consumer).encode() in Path(f'/proc/{pid}/cmdline').read_bytes():
                        os.kill(pid, signal.SIGKILL)
                except FileNotFoundError:
                    pass

    def test_existing_private_log_is_not_overwritten_or_retried(self):
        self.log.write_text('original evidence')
        with self.assertRaises(FileExistsError):
            self.run_fake()
        self.assertEqual(self.log.read_text(), 'original evidence')
        self.assertEqual(self.lines(), [])

    def test_inherited_shell_startup_or_external_replay_overrides_are_refused(self):
        for key in ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'GRIDEX_REPLAY_DB_URL', 'T3_SS_CONSUMER', 'BASH_FUNC_source%%']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                load().run_shell(self.root, self.replay, self.consumer, self.plan, self.log,
                                 self.boundaries, 3, {**self.env, key: 'unassigned'}, sys.executable)
        self.assertEqual(self.lines(), [])


class PacketBindingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.module = load()
        self.harness = self.root / 'harness'
        self.app = self.root / 'app'
        self.replay = self.root / 'replay'
        self.home = self.root / 'private'
        for directory in [self.harness, self.app, self.replay, self.home]:
            directory.mkdir()
        self.script = self.replay / 'scripts/gridex-aud-003-clean-replay.sh'
        self.script.parent.mkdir()
        self.script.write_text('exit 0\n')
        self.consumer = self.harness / 'consumer.py'
        self.consumer.write_text('raise SystemExit(0)\n')
        self.track = self.harness / 'track'
        self.track.mkdir()
        (self.track / 'prepare.py').write_text('raise SystemExit(0)\n')
        self.plan = {'replayDir': str(self.replay), 'appCommit': 'a' * 40, 'appTree': 'b' * 40,
                     'replayScriptSha256': self.module.sha(self.script), 'ports': {'db': 54322},
                     'sameShellTimeoutSeconds': 300,
                     'consumer': {'path': 'consumer.py', 'sha256': self.module.sha(self.consumer)}}
        self.packet = SimpleNamespace(plan=self.plan, app=self.app, home=self.home)
        self.observed = []
        self.prepare = SimpleNamespace(HARNESS=self.harness, TRACK=self.track,
            canonical=lambda value: Path(value).resolve(strict=True),
            source=lambda *values: self.observed.append(values),
            capture=lambda argv: argv[-1])

    def tearDown(self):
        self.temporary.cleanup()

    def test_extends_source_preflight_with_same_app_commit_tree(self):
        self.assertEqual(self.module.check_packet(self.packet, self.prepare), (self.replay, self.script, self.consumer))
        self.assertEqual(self.observed, [(self.replay, 'a' * 40, 'b' * 40)])

    def test_refuses_app_or_harness_as_dirty_replay_workspace(self):
        for path in [self.app, self.harness, self.home]:
            self.plan['replayDir'] = str(path)
            with self.assertRaises(ValueError):
                self.module.check_packet(self.packet, self.prepare)

    def test_refuses_changed_canonical_or_consumer_source(self):
        self.script.write_text('changed canonical source\n')
        with self.assertRaises(ValueError):
            self.module.check_packet(self.packet, self.prepare)
        self.plan['replayScriptSha256'] = self.module.sha(self.script)
        self.consumer.write_text('changed consumer source\n')
        with self.assertRaises(ValueError):
            self.module.check_packet(self.packet, self.prepare)

    def test_rejects_prepare_execute_as_the_consumer_even_with_matching_hash(self):
        self.plan['consumer'] = {'path': 'track/prepare.py', 'sha256': self.module.sha(self.track / 'prepare.py')}
        with self.assertRaises(ValueError):
            self.module.check_packet(self.packet, self.prepare)

    def test_refuses_untracked_consumer_and_wrong_db_port(self):
        self.prepare.capture = lambda _argv: ''
        with self.assertRaises(ValueError):
            self.module.check_packet(self.packet, self.prepare)
        self.prepare.capture = lambda argv: argv[-1]
        self.plan['ports']['db'] = 54323
        with self.assertRaises(ValueError):
            self.module.check_packet(self.packet, self.prepare)

class AdmissionTests(unittest.TestCase):
    def test_timeout_clamps_to_expiry_and_rejects_expired(self):
        unit = load()
        now = datetime.now(timezone.utc)
        self.assertEqual(unit.bounded_timeout(300, now+timedelta(seconds=2), now), 2)
        self.assertEqual(unit.bounded_timeout(1, now+timedelta(seconds=2), now), 1)
        for expiry in [now, now-timedelta(seconds=1), now.replace(tzinfo=None)]:
            with self.assertRaises(ValueError):
                unit.bounded_timeout(300, expiry, now)

    def test_fake_cli_dirty_daemon_stops_before_spawn_and_leftovers_hold(self):
        unit = load()
        packet = SimpleNamespace(host={'socket':'/private/docker.sock'}, node=Path('/node'), expires=datetime.now(timezone.utc)+timedelta(seconds=30))
        for dirty in [{'containers':['a'*64], 'volumes':[], 'networks':['b'*64]},
                      {'containers':[], 'volumes':['foreign'], 'networks':['b'*64]}]:
            with patch.object(unit, 'docker_resources', return_value=dirty), patch.object(unit, 'run_shell') as run:
                with self.assertRaises(ValueError):
                    unit.run_guarded(packet, SimpleNamespace(), (), 1, {})
                run.assert_not_called()
        clean = {'containers':[], 'volumes':[], 'networks':['b'*64]}
        for after in [dict(clean, volumes=['leftover']), dict(clean, networks=['c'*64])]:
            prepare = SimpleNamespace(same_host=lambda *_:None, host_identity=lambda **_:packet.host)
            with patch.object(unit, 'docker_resources', side_effect=[clean, after]), patch.object(unit, 'run_shell', return_value={'ok':True, 'cleanupAcceptance':'NOT_ATTESTED_BY_SUPERVISOR'}):
                result = unit.run_guarded(packet, prepare, (), 1, {})
                self.assertFalse(result['ok'])
                self.assertFalse(result['resultDockerRestored'])
                self.assertEqual(result['cleanupAcceptance'], 'NOT_ATTESTED_BY_SUPERVISOR')

    def test_expired_packet_rejected_before_spawn_after_inventory(self):
        unit = load()
        packet = SimpleNamespace(expires=datetime.now(timezone.utc)-timedelta(seconds=1))
        with patch.object(unit, 'docker_resources', return_value={'containers':[], 'volumes':[], 'networks':[]}), patch.object(unit, 'run_shell') as run:
            with self.assertRaises(ValueError):
                unit.run_guarded(packet, SimpleNamespace(), (), 1, {})
            run.assert_not_called()

    def test_inventory_uses_explicit_fixed_endpoint_and_validates_ids(self):
        unit = load()
        packet = SimpleNamespace(host={'socket':'/private/docker.sock'}, node=Path('/node'))
        calls = []
        def capture(argv, env):
            calls.append((argv, env))
            return 'b'*64 if 'network' in argv else ''
        prepare = SimpleNamespace(phase_environment=lambda *_:{'DOCKER_HOST':'unix:///private/docker.sock'}, capture=capture)
        self.assertEqual(unit.docker_resources(prepare, packet), {'containers':[], 'volumes':[], 'networks':['b'*64]})
        self.assertEqual(len(calls), 3)
        for argv, env in calls:
            self.assertEqual(argv[:3], ['docker', '--host', 'unix:///private/docker.sock'])
            self.assertEqual(env['DOCKER_HOST'], argv[2])
        prepare.capture = lambda *_, **__: 'truncated'
        with self.assertRaises(ValueError):
            unit.docker_resources(prepare, packet)

if __name__ == '__main__':
    unittest.main()
