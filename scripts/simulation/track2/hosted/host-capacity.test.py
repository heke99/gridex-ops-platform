#!/usr/bin/env python3
"""Finite declared kernel/API ports, no host Docker/proc probing or resources."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('capacity', Path(__file__).with_name('host-capacity.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
CID = 'a' * 64


class Kernel:
    def __init__(self):
        self.files = {'/proc/self/mountinfo': '31 22 0:28 / /sys/fs/cgroup rw - cgroup2 cgroup rw',
                      '/proc/self/cgroup': '0::/runner/job', '/proc/stat': 'btime 1000', '/proc/uptime': '1000 0',
                      '/proc/net/unix': 'Num RefCount Protocol Flags Type St Inode Path\n00: 2 0 00010000 0001 01 777 /run/docker.sock',
                      '/etc/docker/daemon.json': '{}'}
        self.raw = {}
        self.directories = {'/', '/etc', '/etc/docker', '/run', '/var/lib/docker', c.ROOT,
                            c.ROOT + '/runner', c.ROOT + '/runner/job', c.ROOT + '/backend',
                            c.ROOT + '/backend/docker', c.ROOT + '/backend/docker.service'}
        self.pids, self.fd, self.symlinks, self.mutations = ['1', '100'], {}, {}, {}
        self.namespace_inode, self.namespace_type = 0xEFFFFFFB, 0x02000000
        self.peer = {'pid': 100, 'uid': 0, 'gid': 0}
        self.info = {'ID': 'actual-unit-daemon', 'DockerRootDir': '/var/lib/docker', 'ServerVersion': '28.5.2',
                     'Driver': 'overlay2', 'CgroupDriver': 'cgroupfs', 'CgroupVersion': '2',
                     'OSType': 'linux', 'MemTotal': 16 * c.GIB, 'SecurityOptions': []}
        self.st_overrides, self.reads, self.inspects = {}, [], {}
        self.process(1, 'systemd', '/', 0)
        self.process(100, 'dockerd', '/backend/docker.service', 0)
        self.fd[100] = {'3': 'socket:[777]'}
        self.raw['/proc/100/cmdline'] = b'/usr/bin/dockerd\x00--cgroup-parent=/backend/docker\x00'
        self.raw['/proc/100/environ'] = b'PRIVATE_SENTINEL=DO_NOT_PRINT\x00'
        for directory in self.directories - {c.ROOT}:
            if directory.startswith(c.ROOT + '/'):
                self.files[directory + '/memory.max'] = 'max'
                self.files[directory + '/cpu.max'] = 'max 100000'
        self.files[c.ROOT + '/backend/memory.max'] = str(8 * c.GIB)

    def process(self, pid, comm, membership, uid):
        self.files.update({f'/proc/{pid}/comm': comm, f'/proc/{pid}/cgroup': '0::' + membership,
                           f'/proc/{pid}/status': f'Tgid:\t{pid}\nUid:\t{uid}\t{uid}\t{uid}\t{uid}',
                           f'/proc/{pid}/stat': f'{pid} ({comm}) ' + ' '.join(['S'] + ['0'] * 18 + ['10000'] + ['0'] * 8)})
        self.fd[pid] = {}

    def read(self, path, *args, **kwargs):
        key = str(path)
        self.reads.append(key)
        if key in self.mutations:
            return self.mutations[key]()
        if key not in self.files:
            raise FileNotFoundError(key)
        if isinstance(self.files[key], Exception):
            raise self.files[key]
        return self.files[key]

    def bytes(self, path, maximum=1048576):
        if path in self.raw:
            return self.raw[path]
        return self.read(path).encode()

    def meta(self, path):
        path = str(path)
        if path not in self.directories and path not in self.files and path != c.SOCKET:
            raise FileNotFoundError(path)
        mode = stat.S_IFSOCK | 0o660 if path == c.SOCKET else stat.S_IFDIR | 0o755 if path in self.directories else stat.S_IFREG | 0o600
        value = {'device': 1, 'inode': int(hashlib.sha256(path.encode()).hexdigest()[:8], 16),
                 'mode': mode, 'uid': 0, 'gid': 0, 'mtimeNs': 100000000000, 'ctimeNs': 100000000000}
        value.update(self.st_overrides.get(path, {}))
        return value

    def path_stat(self, path, *args, **kwargs):
        v = self.meta(path)
        return types.SimpleNamespace(st_dev=v['device'], st_ino=v['inode'], st_mode=v['mode'])

    def names(self, path):
        if path == '/proc':
            return self.pids
        pid = int(path.split('/')[2])
        return list(self.fd[pid])

    def link(self, path):
        if '/fd/' in path:
            parts = path.split('/')
            return self.fd[int(parts[2])][parts[-1]]
        if '/ns/' in path:
            kind = path.rsplit('/', 1)[1]
            if '/500/' in path:
                return {'mnt': 'mnt:[900]', 'pid': 'pid:[901]', 'net': 'net:[902]'}[kind]
            return {'mnt': 'mnt:[123]', 'pid': 'pid:[4026531836]', 'net': 'net:[456]'}[kind]
        if path.endswith('/exe'):
            return '/usr/bin/' + self.files[path.removesuffix('/exe') + '/comm']
        raise FileNotFoundError(path)

    def install(self, test):
        import fcntl
        patches = [patch.object(c, 'text', side_effect=self.read), patch.object(c, 'binary', side_effect=self.bytes),
                   patch.object(c, 'metadata', side_effect=self.meta), patch.object(c, 'names', side_effect=self.names),
                   patch.object(c, 'link', side_effect=self.link), patch.object(c, 'socket_info', side_effect=lambda: (copy.deepcopy(self.info), dict(self.peer))),
                   patch.object(c, 'container_inspect', side_effect=lambda cid: copy.deepcopy(self.inspects[cid])),
                   patch.object(Path, 'read_text', lambda path, *a, **k: self.read(path)),
                   patch.object(Path, 'read_bytes', lambda path: self.read(path).encode('utf8')),
                   patch.object(Path, 'stat', lambda path, *a, **k: self.path_stat(path)),
                   patch.object(Path, 'resolve', lambda path, *a, **k: Path(self.symlinks.get(str(path), str(path)))),
                   patch.object(c.os, 'open', return_value=555), patch.object(c.os, 'close'),
                   patch.object(c.os, 'fstat', side_effect=lambda fd: types.SimpleNamespace(st_ino=self.namespace_inode)),
                   patch.object(fcntl, 'ioctl', side_effect=lambda *a: self.namespace_type),
                   patch.object(c.os, 'sysconf', side_effect=lambda n: 100 if n == 'SC_CLK_TCK' else 16 * c.GIB // 4096 if n == 'SC_PHYS_PAGES' else 4096),
                   patch.object(c.os, 'uname', return_value=types.SimpleNamespace(release='UNIT_KERNEL')),
                   patch.object(c.time, 'time', return_value=2000)]
        for item in patches:
            item.start()
            test.addCleanup(item.stop)


class Capacity(unittest.TestCase):
    def setUp(self):
        self.k = Kernel()
        self.k.install(self)

    def test_old_worker16_shared2_case_is_held_by_actual_collector(self):
        self.k.files[c.ROOT + '/backend/memory.max'] = str(2 * c.GIB)
        witness = c.collect_daemon()
        self.assertEqual(witness['backend']['effectiveRAMBytes'], 2 * c.GIB)
        self.assertEqual(witness['state'], 'UNKNOWN_HOLD')
        self.assertIn('shared-backend-ram-below-minimum', witness['errors'])
        self.assertEqual(witness['process']['pid'], 100)

    def test_positive_shared8_and_daemon_leaf2_does_not_apply8_to_daemon(self):
        self.k.files[c.ROOT + '/backend/docker.service/memory.max'] = str(2 * c.GIB)
        witness = c.collect_daemon()
        self.assertEqual(witness['state'], 'VERIFIED', witness['errors'])
        self.assertEqual(witness['backend']['effectiveRAMBytes'], 8 * c.GIB)
        self.assertEqual(witness['process']['effectiveRAMBytes'], 2 * c.GIB)

    def test_systemd_socket_activation_uses_dockerd_not_pid1_budget(self):
        self.k.peer['pid'] = 1
        self.k.fd[1]['3'] = 'socket:[777]'
        witness = c.collect_daemon()
        self.assertEqual(witness['state'], 'VERIFIED', witness['errors'])
        self.assertEqual(witness['socket']['activation'], 'systemd')
        self.assertEqual(witness['process']['pid'], 100)

    def test_wrong_fd_pidfile_cannot_authorize_a_daemon(self):
        self.k.files['/var/run/docker.pid'] = '100'
        self.k.fd[100]['3'] = 'socket:[999]'
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_multiple_dockerd_holders_are_ambiguous(self):
        self.k.pids.append('101')
        self.k.process(101, 'dockerd', '/backend/docker.service', 0)
        self.k.fd[101]['3'] = 'socket:[777]'
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_systemd_peer_without_same_listener_fd_is_held(self):
        self.k.peer['pid'] = 1
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_foreign_peer_is_held(self):
        self.k.peer['pid'] = 77
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_unsupported_server_keeps_process_diagnostics(self):
        self.k.info['ServerVersion'] = '29.0.0'
        witness = c.collect_daemon()
        self.assertEqual(witness['state'], 'UNKNOWN_HOLD')
        self.assertEqual(witness['process']['pid'], 100)
        self.assertIn('hierarchy', witness['process'])

    def test_2804_is_supported_without_borrowing_pid1(self):
        self.k.info['ServerVersion'] = '28.0.4'
        self.assertEqual(c.collect_daemon()['state'], 'VERIFIED')

    def test_rootlesskit_presence_is_internal_and_never_output(self):
        self.k.raw['/proc/100/environ'] += b'ROOTLESSKIT_STATE_DIR=PRIVATE_ENV_SENTINEL\x00'
        witness = c.collect_daemon()
        self.assertEqual(witness['state'], 'UNKNOWN_HOLD')
        self.assertNotIn('PRIVATE_ENV_SENTINEL', json.dumps(witness))
        self.assertNotIn('DO_NOT_PRINT', json.dumps(witness))

    def test_duplicate_config_is_held_without_private_exception(self):
        self.k.files['/etc/docker/daemon.json'] = '{"debug":"PRIVATE_CONFIG_SENTINEL","cgroup-parent":"/backend/docker","Cgroup-Parent":"/other"}'
        witness = c.collect_daemon()
        self.assertEqual(witness['state'], 'UNKNOWN_HOLD')
        self.assertNotIn('PRIVATE_CONFIG_SENTINEL', json.dumps(witness))

    def test_changed_after_start_config_is_not_assumed_loaded(self):
        self.k.st_overrides['/etc/docker/daemon.json'] = {'ctimeNs': 1500000000000}
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_config_cli_conflict_and_symlink_are_held(self):
        self.k.files['/etc/docker/daemon.json'] = '{"cgroup-parent":"/backend/docker"}'
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')
        self.k.files['/etc/docker/daemon.json'] = '{}'
        self.k.symlinks['/etc/docker/daemon.json'] = '/other/config'
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_absent_default_config_requires_prebirth_directory_proof(self):
        del self.k.files['/etc/docker/daemon.json']
        self.assertEqual(c.collect_daemon()['state'], 'VERIFIED')
        self.k.st_overrides['/etc/docker'] = {'mtimeNs': 1800000000000}
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_missing_parent_is_not_assumed_unlimited(self):
        self.k.directories.remove(c.ROOT + '/backend/docker')
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_controller_unknown_and_masked_mount_are_held(self):
        self.k.files[c.ROOT + '/backend/memory.max'] = 'MALFORMED'
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')
        self.k.files[c.ROOT + '/backend/memory.max'] = str(8 * c.GIB)
        self.k.files['/proc/self/mountinfo'] += '\n32 31 0:29 / /sys/fs/cgroup/backend rw - tmpfs tmpfs rw'
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_hidden_namespace_is_unknown(self):
        self.k.namespace_inode = 4026532205
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_spaced_worker_membership_never_reads_unspaced_sibling(self):
        actual = c.ROOT + '/runner/job '
        self.k.directories.add(actual)
        self.k.files[actual + '/memory.max'] = str(2 * c.GIB)
        self.k.files[actual + '/cpu.max'] = 'max 100000'
        self.k.files['/proc/self/cgroup'] = '0::/runner/job \n'
        with self.assertRaises(ValueError):
            c.worker_cgroup_capacity(16 * c.GIB)
        self.assertNotIn(c.ROOT + '/runner/job/memory.max', self.k.reads)

    def test_membership_preserves_whitespace_and_removes_only_one_lf(self):
        self.k.files['/proc/self/cgroup'] = '0::/runner/job\n'
        self.assertEqual(c.membership(), '0::/runner/job')
        for raw in ('0::/runner/job\n\n', '0::/runner/job\r\n', '0::/runner/job\t\n', ' 0::/runner/job\n'):
            with self.subTest(raw=raw):
                self.k.files['/proc/self/cgroup'] = raw
                with self.assertRaises(ValueError):
                    c.membership()

    def test_missing_nonroot_controller_is_unknown(self):
        del self.k.files[c.ROOT + '/backend/cpu.max']
        self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_pid_birth_race_is_held(self):
        original = c.process_identity
        calls = 0
        def identity(pid, **kwargs):
            nonlocal calls
            value = original(pid, **kwargs)
            calls += 1
            if calls >= 2 and pid == 100:
                value['startTicks'] += 1
            return value
        with patch.object(c, 'process_identity', side_effect=identity):
            self.assertEqual(c.collect_daemon()['state'], 'UNKNOWN_HOLD')

    def test_systemd_slice_expansion_and_config_mapping(self):
        self.k.info['CgroupDriver'] = 'systemd'
        self.k.raw['/proc/100/cmdline'] = b'/usr/bin/dockerd\x00'
        self.k.files['/etc/docker/daemon.json'] = '{"cgroup-parent":"foo-bar.slice"}'
        for path in [c.ROOT + '/foo.slice', c.ROOT + '/foo.slice/foo-bar.slice']:
            self.k.directories.add(path)
            self.k.files[path + '/memory.max'] = 'max'
            self.k.files[path + '/cpu.max'] = 'max 100000'
        witness = c.collect_daemon()
        self.assertEqual(witness['state'], 'VERIFIED', witness['errors'])
        self.assertEqual(witness['backend']['globalParent'], '/foo.slice/foo-bar.slice')

    def test_owned_container_leaf2_private_namespaces_are_allowed(self):
        daemon = c.collect_daemon()
        path = '/backend/docker/' + CID
        self.k.process(500, 'java', path, 1001)
        self.k.directories.add(c.ROOT + path)
        self.k.files[c.ROOT + path + '/memory.max'] = str(2 * c.GIB)
        self.k.files[c.ROOT + path + '/cpu.max'] = 'max 100000'
        self.k.inspects[CID] = {'Id': CID, 'Name': '/owned', 'Created': 'birth',
                               'Config': {'Labels': {'com.supabase.cli.project': 'sim-t2-unit'}},
                               'State': {'Running': True, 'Pid': 500, 'StartedAt': 'start'}, 'HostConfig': {'CgroupParent': ''}}
        request = {'project': 'sim-t2-unit', 'containers': [{'id': CID, 'name': '/owned', 'created': 'birth'}], 'expectedDaemon': daemon}
        witness = c.collect_containers(request)
        self.assertEqual(witness['state'], 'VERIFIED', witness['errors'])
        self.assertEqual(witness['containers'][0]['individualEffectiveRAMBytes'], 2 * c.GIB)
        self.k.inspects[CID]['HostConfig']['CgroupParent'] = '/foreign'
        self.assertEqual(c.collect_containers(request)['state'], 'UNKNOWN_HOLD')

    def test_stable_mapping_does_not_use_current_free_bytes(self):
        witness = c.collect_daemon()
        other = copy.deepcopy(witness)
        other['currentFreeBytes'] = 1
        self.assertEqual(c.stable_mapping(witness), c.stable_mapping(other))


class PathControls(unittest.TestCase):
    def test_real_file_crlf_is_not_normalized_into_valid_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / 'membership'
            record.write_bytes(b'0::/runner/job\r\n')
            with self.assertRaises(ValueError):
                c.membership(path_factory=lambda _: record)
            record.write_bytes(b'0::/runner/job\n')
            self.assertEqual(c.membership(path_factory=lambda _: record), '0::/runner/job')

    def test_actual_temporary_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target = root / 'real'
            target.mkdir()
            alias = root / 'alias'
            alias.symlink_to(target)
            self.assertEqual(c.canonical_path(str(target)), str(target))
            with self.assertRaises(ValueError):
                c.canonical_path(str(alias))

    def test_old_worker_only_observation_does_not_qualify(self):
        observation = {'driver': 'overlay2', 'effectiveRAMBytes': 16 * c.GIB, 'dockerRootFreeBytes': 50 * c.GIB,
                       'dockerRootDir': '/actual', 'rootNamespaceVerified': True, 'daemonId': 'actual',
                       'socketIdentity': {'inode': 1}, 'cpuQuota': 'max',
                       'cgroupCapacity': {'state': 'VERIFIED_INITIAL_GLOBAL_V2', 'namespace': {'inode': 0xEFFFFFFB, 'type': 0x02000000},
                                          'mountRoot': '/', 'ancestors': [{'path': c.ROOT}]}}
        self.assertIn('backend-capacity-unverified', c.capacity_errors(observation))

    def test_malformed_verified_backend_fails_closed(self):
        witness = {'schema': 'gridex-t2-shared-backend-capacity-v1', 'state': 'VERIFIED', 'backend': None}
        self.assertEqual(c.daemon_capacity_errors(witness), ['insufficient-or-unknown-backend-ram'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
