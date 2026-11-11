import importlib.util
import io
import json
import os
import subprocess
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('snapshots', Path(__file__).with_name('elklart-snapshots.py'))
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
helper_spec = importlib.util.spec_from_file_location('helper', Path(__file__).with_name('elklart-snapshot-helper.py'))
helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helper)


class SafetyTests(unittest.TestCase):
    def archive(self, name, kind=tarfile.REGTYPE):
        temporary = tempfile.NamedTemporaryFile(suffix='.tar')
        with tarfile.open(fileobj=temporary, mode='w') as archive:
            member = tarfile.TarInfo(name)
            member.type = kind
            archive.addfile(member, io.BytesIO())
        temporary.flush()
        return temporary

    def test_traversal_and_special_members_rejected(self):
        for name, kind in [('../escape', tarfile.REGTYPE), ('/escape', tarfile.REGTYPE),
                           ('link', tarfile.SYMTYPE), ('hard', tarfile.LNKTYPE), ('device', tarfile.CHRTYPE)]:
            with self.subTest(name=name), self.archive(name, kind) as archive:
                with self.assertRaises(ValueError):
                    s.check_archive(archive.name)

    def test_regular_archive_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.mkdir()
            (source / 'state').write_bytes(b'fictional auth and queue state')
            archive = root / 'state.tar'
            with tarfile.open(archive, 'w') as stream:
                stream.add(source / 'state', arcname='./state')
            s.check_archive(archive)
            original = s.digest(archive)
            output = root / 'output'
            output.mkdir()
            with tarfile.open(archive) as stream:
                stream.extractall(output, filter='data')
            self.assertEqual((output / 'state').read_bytes(), (source / 'state').read_bytes())
            with archive.open('ab') as stream:
                stream.write(b'tampered')
            self.assertNotEqual(original, s.digest(archive))

    def test_gnu_tar_restore_preserves_storage_user_extended_attributes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, restored = root / 'source', root / 'restored'
            source.mkdir()
            restored.mkdir()
            obj = source / 'storage-object'
            obj.write_bytes(b'fictional storage object')
            os.setxattr(obj, 'user.supabase.contenttype', b'application/octet-stream')
            os.setxattr(obj, 'user.supabase.metadata', b'{"cacheControl":"3600"}')
            archive = root / 'storage.tar'
            flags = ['--numeric-owner', '--xattrs', '--xattrs-include=user.*', '--acls']
            subprocess.run(['tar', *flags, '-cpf', str(archive), '-C', str(source), '.'], check=True)
            s.check_archive(archive)
            # Prove the old extraction loses the metadata despite restoring bytes.
            subprocess.run(['tar', '-xpf', str(archive), '-C', str(restored)], check=True)
            target = restored / 'storage-object'
            self.assertEqual(target.read_bytes(), obj.read_bytes())
            self.assertNotIn('user.supabase.contenttype', os.listxattr(target))
            target.unlink()
            subprocess.run(['tar', *flags, '-xpf', str(archive), '-C', str(restored)], check=True)
            self.assertEqual(target.read_bytes(), obj.read_bytes())
            for name in os.listxattr(obj):
                self.assertEqual(os.getxattr(target, name), os.getxattr(obj, name))

    def test_runtime_symlinks_and_outside_paths_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            root.chmod(0o700)
            with patch.object(s, 'ROOT', root):
                s.private_path(root)
                with self.assertRaises(ValueError):
                    s.private_path(root.parent)
                (root / 'link').symlink_to('/tmp')
                with self.assertRaises(ValueError):
                    s.private_path(root / 'link')
                root.chmod(0o755)
                with self.assertRaises(ValueError):
                    s.private_path(root)

    def test_helpers_cannot_pull_or_connect_and_save_is_readonly(self):
        save = s.helper_args('sha256:pinned', 'owned')
        restore = s.helper_args('sha256:pinned', 'owned', True)
        self.assertIn('--pull=never', save)
        self.assertIn('--network=none', save)
        self.assertIn('type=volume,src=owned,dst=/data,readonly', save)
        self.assertIn('type=volume,src=owned,dst=/data', restore)
        self.assertIn('-i', restore)
        self.assertIn('tar --numeric-owner --xattrs --xattrs-include=user.* --acls -xpf - -C /data', restore[-1])
        for command in (save[-1], restore[-1]):
            self.assertIn('--xattrs', command)
            self.assertIn('--acls', command)
        self.assertNotIn('/workspace', ' '.join(restore))

    def test_helper_capabilities_reject_busybox_and_require_xattrs_acls(self):
        class Docker:
            def __init__(self, output):
                self.output = output
                self.args = None
            def run(self, *args, **kwargs):
                self.args = args
                return type('Result', (), {'stdout': self.output})()
        for output in (b'BusyBox v1.37 tar', b'tar (GNU tar) 1.35 --xattrs', b'tar (GNU tar) 1.35 --acls'):
            with self.assertRaisesRegex(ValueError, 'GNU tar'):
                s.verify_helper(Docker(output), 'sha256:local')
        docker = Docker(b'tar (GNU tar) 1.35 --xattrs --acls')
        s.verify_helper(docker, 'sha256:local')
        self.assertIn('--pull=never', docker.args)
        self.assertIn('--network=none', docker.args)
        self.assertIn('--cap-drop=ALL', docker.args)

    def test_foreign_project_and_missing_projects_rejected(self):
        class Docker:
            def run(self, *args, **kwargs):
                return type('Result', (), {'stdout': b'container'})()
            def json(self, *args):
                return [{'Name': '/supabase_db_elklart-ops-demo', 'Config': {'Labels': {}}, 'Mounts': []}]
        with self.assertRaises(ValueError):
            s.inventory(Docker())

    def test_volume_label_mismatch_rejected(self):
        class Docker:
            def run(self, *args, **kwargs):
                return type('Result', (), {'stdout': b'one two'})()
            def json(self, *args):
                if args[0] == 'volume':
                    return [{'Labels': {s.LABEL: 'foreign'}}]
                return [{'Id': p, 'Name': p, 'Image': 'sha256:image', 'Config': {'Labels': {s.LABEL: p}},
                         'Mounts': [{'Type': 'volume', 'Name': p, 'Destination': '/data', 'RW': True}]}
                        for p in sorted(s.PROJECTS)]
        with self.assertRaisesRegex(ValueError, 'ownership'):
            s.inventory(Docker())


class MailpitBaselineTests(unittest.TestCase):
    def fixture(self, data=None, status=200):
        rows = []
        for project, port in (('elklart-ops-demo', 54324), ('elklart-portal-demo', 55324)):
            binding = {'8025/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]}
            rows.append({'Id': project, 'Name': '/supabase_inbucket_' + project,
                         'Config': {'Labels': {s.LABEL: project}}, 'State': {'Running': True},
                         'HostConfig': {'PortBindings': binding}, 'NetworkSettings': {'Ports': binding}})
        current = {'containers': [{'Id': row['Id'], 'Name': row['Name'][1:]} for row in rows]}
        docker = Mock()
        def inspect(*args):
            if args[:2] == ('image', 'inspect'):
                return [{'Id': 'sha256:helper', 'Config': {'Labels': {
                    'io.elklart.snapshot-helper': 'gnu-tar-v1',
                    'io.elklart.snapshot-helper.owner': 'elklart-demo',
                    'io.elklart.snapshot-helper.source': 'host-local-binaries',
                    'io.elklart.snapshot-helper.provenance': 'hash'}}}]
            return [next(row for row in rows if row['Id'] == args[1])]
        docker.json.side_effect = inspect
        response = Mock(status=status)
        response.read.return_value = json.dumps(data if data is not None else
            {'total': 0, 'unread': 0, 'count': 0, 'messages_count': 0, 'messages': []}).encode()
        connection = Mock()
        connection.getresponse.return_value = response
        return docker, current, rows, connection

    def test_empty_owned_inboxes_verified_with_direct_loopback_requests(self):
        docker, current, _, connection = self.fixture()
        with patch.object(s.http.client, 'HTTPConnection', return_value=connection) as http:
            s.verify_empty_mailpit(docker, current)
        self.assertEqual(http.call_count, 2)
        self.assertEqual([call.args[:2] for call in http.call_args_list],
                         [('127.0.0.1', 54324), ('127.0.0.1', 55324)])
        self.assertEqual(connection.close.call_count, 2)

    def test_foreign_binding_rejected_before_any_http(self):
        docker, current, rows, connection = self.fixture()
        rows[1]['NetworkSettings']['Ports']['8025/tcp'][0]['HostIp'] = '0.0.0.0'
        with patch.object(s.http.client, 'HTTPConnection', return_value=connection) as http:
            with self.assertRaisesRegex(ValueError, 'binding'):
                s.verify_empty_mailpit(docker, current)
            http.assert_not_called()

    def test_empty_configured_hostip_requires_owned_default_loopback_bridge(self):
        docker, current, rows, connection = self.fixture()
        networks = {}
        for row in rows:
            project = row['Id']
            row['HostConfig']['PortBindings'] = {'8025/tcp': [{'HostIp': '', 'HostPort': '54324' if project == 'elklart-ops-demo' else '55324'}]}
            row['NetworkSettings']['Networks'] = {project: {'NetworkID': project + '-network'}}
            networks[project + '-network'] = {'Id': project + '-network', 'Name': project,
                'Driver': 'bridge', 'Scope': 'local',
                'Labels': {'com.gridex.demo': 'elklart-ops' if project == 'elklart-ops-demo' else project},
                'Options': {'com.docker.network.bridge.host_binding_ipv4': '127.0.0.1'}}
        original = docker.json.side_effect
        docker.json.side_effect = lambda *args: [networks[args[2]]] if args[:2] == ('network', 'inspect') else original(*args)
        with patch.object(s.http.client, 'HTTPConnection', return_value=connection):
            s.verify_empty_mailpit(docker, current)  # Existing legacy OPS ownership label.
            networks['elklart-ops-demo-network']['Labels']['com.gridex.demo'] = 'elklart-ops-demo'
            s.verify_empty_mailpit(docker, current)  # Reproducibly provisioned current project label.
            networks['elklart-ops-demo-network']['Labels']['com.gridex.demo'] = 'foreign'
            with self.assertRaisesRegex(ValueError, 'default loopback'):
                s.verify_empty_mailpit(docker, current)
            networks['elklart-ops-demo-network']['Labels']['com.gridex.demo'] = 'elklart-ops-demo'
            networks['elklart-ops-demo-network']['Options']['com.docker.network.bridge.host_binding_ipv4'] = '0.0.0.0'
            with self.assertRaisesRegex(ValueError, 'default loopback'):
                s.verify_empty_mailpit(docker, current)
        rows[0]['HostConfig']['PortBindings']['8025/tcp'][0]['HostIp'] = '0.0.0.0'
        with patch.object(s.http.client, 'HTTPConnection') as http:
            with self.assertRaisesRegex(ValueError, 'configured Mailpit binding'):
                s.verify_empty_mailpit(docker, current)
            http.assert_not_called()

    def test_nonempty_save_never_stops_stack_containers(self):
        docker, current, _, connection = self.fixture({'total': 1, 'unread': 1, 'count': 1,
                                                        'messages_count': 1, 'messages': [{}]})
        with patch.object(s, 'Docker', return_value=docker), patch.object(s, 'inventory', return_value=current), \
                patch.object(s, 'host_inventory', return_value={}), patch.object(s, 'writers_stopped'), \
                patch.object(s, 'private_path', side_effect=lambda path, **kwargs: path), \
                patch.object(s, 'digest', return_value='hash'), patch.object(s, 'verify_helper'), \
                patch.object(s.http.client, 'HTTPConnection', return_value=connection):
            with self.assertRaisesRegex(ValueError, 'inboxes empty'):
                s.checkpoint('save', 'nonempty-test')
        docker.run.assert_not_called()

    def test_restore_does_not_require_empty_postbaseline_inboxes(self):
        docker, current, rows, _ = self.fixture()
        current['volumes'] = {}
        def run(*args, **kwargs):
            if args[0] in ('stop', 'start'):
                for row in rows:
                    row['State']['Running'] = args[0] == 'start'
        docker.run.side_effect = run
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            location = root / 'snapshots' / 'baseline'
            location.mkdir(parents=True)
            (location / 'manifest.json').write_text(json.dumps({'version': 3, 'inventory': current,
                'helperImage': 'sha256:helper', 'archives': {}, 'hostState': {}}))
            with patch.object(s, 'ROOT', root), patch.object(s, 'Docker', return_value=docker), \
                    patch.object(s, 'inventory', return_value=current), patch.object(s, 'host_inventory', return_value={}), \
                    patch.object(s, 'writers_stopped'), patch.object(s, 'private_path', side_effect=lambda path, **kwargs: path), \
                    patch.object(s, 'digest', return_value='hash'), patch.object(s, 'verify_helper'), \
                    patch.object(s, 'verify_host'), patch.object(s, 'restore_host'), \
                    patch.object(s, 'verify_empty_mailpit') as guard, patch('builtins.print'):
                s.checkpoint('restore', 'baseline')
                guard.assert_not_called()
        self.assertTrue(any(call.args[0] == 'stop' for call in docker.run.call_args_list))

    def test_redirect_malformed_and_timeout_fail_closed(self):
        for data, status in (({}, 200), ({'total': '0'}, 200), (None, 302)):
            docker, current, _, connection = self.fixture(data, status)
            with patch.object(s.http.client, 'HTTPConnection', return_value=connection):
                with self.assertRaises(ValueError):
                    s.verify_empty_mailpit(docker, current)
        docker, current, _, connection = self.fixture()
        connection.getresponse.side_effect = TimeoutError('private')
        with patch.object(s.http.client, 'HTTPConnection', return_value=connection):
            with self.assertRaisesRegex(ValueError, 'failed closed'):
                s.verify_empty_mailpit(docker, current)


class HelperBuildIsolationTests(unittest.TestCase):
    def test_overrides_rejected_before_spawn_or_context_mutation(self):
        for name in ('BUILDKIT_HOST', 'BUILDX_BUILDER', 'BUILDX_CONFIG', 'DOCKER_TLS_VERIFY',
                     'DOCKER_CERT_PATH', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_BUILDKIT'):
            with self.subTest(name=name), patch.dict(os.environ, {name: 'foreign'}, clear=True), \
                    patch.object(helper.subprocess, 'run') as run, patch.object(helper, 'checked') as check:
                with self.assertRaises(ValueError):
                    helper.build()
                run.assert_not_called()
                check.assert_not_called()

    def test_clean_child_environment_never_inherits_builder_or_secret_state(self):
        env = helper.build_environment({'HOME': '/foreign', 'SECRET_TOKEN': 'private',
                                        'PATH': '/foreign', 'DOCKER_HOST': 'unix:///var/run/docker.sock'})
        self.assertEqual(set(env), {'PATH', 'DOCKER_HOST', 'BUILDX_CONFIG'})
        self.assertEqual(env['DOCKER_HOST'], 'unix:///var/run/docker.sock')
        self.assertEqual(env['BUILDX_CONFIG'], str(helper.CONTEXT / 'buildx'))
        with self.assertRaises(ValueError):
            helper.build_environment({'DOCKER_HOST': 'tcp://foreign:2375'})


class HostStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root.chmod(0o700)
        self.patch = patch.object(s, 'ROOT', self.root)
        self.patch.start()
        self.snapshot = self.root / 'snapshots' / 'baseline'
        self.snapshot.mkdir(parents=True, mode=0o700)

    def tearDown(self):
        self.patch.stop()
        self.temporary.cleanup()

    def write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_text(content)
        path.chmod(0o600)
        return path

    def test_prebootstrap_snapshot_removes_only_stale_allowlisted_files(self):
        state = s.save_host(self.snapshot)
        stale = self.write('ops/accounts.json', '{"stale":true}')
        retained = self.write('ops/unrelated.json', 'keep')
        s.restore_host(self.snapshot, state)
        self.assertFalse(stale.exists())
        self.assertEqual(retained.read_text(), 'keep')

    def test_provider_and_private_configuration_restored_exactly(self):
        account = self.write('ops/accounts.json', '{"baseline":true}')
        config = self.write('portal/app.env', 'LOCAL_TEST_SECRET=fictional')
        fixture = self.write('provider/data/events.json', '["baseline"]')
        state = s.save_host(self.snapshot)
        account.write_text('{"later":true}')
        config.write_text('changed')
        fixture.write_text('[]')
        stale = self.write('provider/data/new.json', 'stale')
        self.write('provider/other/nested.json', 'stale')
        s.restore_host(self.snapshot, state)
        self.assertEqual(account.read_text(), '{"baseline":true}')
        self.assertEqual(config.read_text(), 'LOCAL_TEST_SECRET=fictional')
        self.assertEqual(fixture.read_text(), '["baseline"]')
        self.assertFalse(stale.exists())
        self.assertFalse((self.root / 'provider/other').exists())
        self.assertEqual(config.stat().st_mode & 0o777, 0o600)

    def test_extended_bootstrap_and_mail_provider_state_restored(self):
        files = ('ops/integration.json', 'ops/app-secrets.json',
                 'portal/customer-assertion-private.pem', 'portal/customer-assertion-registration.json',
                 'provider-mail/state.json', 'provider-mail/api-key',
                 'ops/support-scenario.json', 'ops/manual-mailbox-evidence.json', 'ops/sender-prepared.json',
                 'provider-smtp/credentials.json', 'provider-smtp/receipt.json',
                 'ops/isolation-scenario.json', 'ops/network-scenario.json', 'ops/billing-setup.json',
                 'ops/integration-development-original.json', 'ops/catalogue-readback.json',
                 'portal/development-client-original-scopes.json')
        for relative in files:
            self.write(relative, 'baseline-' + relative)
        state = s.save_host(self.snapshot)
        for relative in files:
            self.write(relative, 'modified')
        stale = self.write('provider-mail/extra.json', 'stale')
        s.restore_host(self.snapshot, state)
        for relative in files:
            self.assertEqual((self.root / relative).read_text(), 'baseline-' + relative)
        self.assertFalse(stale.exists())

    def test_smtp_process_artifacts_excluded_and_preserved(self):
        receipt = self.write('provider-smtp/receipt.json', 'baseline')
        log = self.write('provider-smtp/supervisor.log', 'before')
        pid = self.write('provider-smtp/supervisor.json', 'old-pid')
        state = s.save_host(self.snapshot)
        self.assertNotIn('provider-smtp/supervisor.log', state['entries'])
        self.assertNotIn('provider-smtp/supervisor.json', state['entries'])
        log.write_text('after')
        pid.write_text('new-pid')
        receipt.write_text('changed')
        s.restore_host(self.snapshot, state)
        self.assertEqual(receipt.read_text(), 'baseline')
        self.assertEqual(log.read_text(), 'after')
        self.assertEqual(pid.read_text(), 'new-pid')

    def test_smtp_writer_lock_refused_and_missing_baseline_preserves_logs(self):
        state = s.save_host(self.snapshot)
        log = self.write('provider-smtp/supervisor.log', 'preserve')
        stale = self.write('provider-smtp/credentials.json', 'stale')
        lock = self.root / 'provider-smtp/.writer-lock'
        lock.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'writer lock'):
            s.restore_host(self.snapshot, state)
        lock.rmdir()
        s.restore_host(self.snapshot, state)
        self.assertFalse(stale.exists())
        self.assertEqual(log.read_text(), 'preserve')

    def test_old_allowlist_snapshot_refused_before_host_mutation(self):
        state = s.save_host(self.snapshot)
        del state['scope']
        account = self.write('ops/accounts.json', 'retain-current')
        with self.assertRaisesRegex(ValueError, 'scope differs'):
            s.restore_host(self.snapshot, state)
        self.assertEqual(account.read_text(), 'retain-current')

    def test_corrupt_host_archive_fails_before_state_changes(self):
        account = self.write('ops/accounts.json', 'baseline')
        state = s.save_host(self.snapshot)
        account.write_text('current')
        with (self.snapshot / 'host-state.tar').open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaisesRegex(ValueError, 'hash'):
            s.restore_host(self.snapshot, state)
        self.assertEqual(account.read_text(), 'current')

    def test_host_symlinks_and_public_modes_refused(self):
        (self.root / 'provider').mkdir(mode=0o700)
        (self.root / 'provider/link').symlink_to('/tmp')
        with self.assertRaises(ValueError):
            s.host_inventory()
        (self.root / 'provider/link').unlink()
        path = self.write('ops/accounts.json', 'private')
        path.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private'):
            s.host_inventory()

    def test_missing_baseline_rejects_directory_spoof_at_allowlist_path(self):
        state = s.save_host(self.snapshot)
        (self.root / 'ops').mkdir(mode=0o700)
        (self.root / 'ops/accounts.json').mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'must be a file'):
            s.restore_host(self.snapshot, state)


if __name__ == '__main__':
    unittest.main()
