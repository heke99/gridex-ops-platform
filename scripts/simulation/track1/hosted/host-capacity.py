#!/usr/bin/env python3
"""Measured Linux/Docker capacity. No allocation, mutations or runtime IO overrides.

Linux v6.18 UAPI nsfs.h/sched.h fixes the initial namespace IDs/ioctl below.
Moby v28.0.4 and v28.5.2 daemon_unix/newCgroupParent/oci define parent mapping.
Only the observer namespace must be initial; container memberships are read from
that global observer. Per-service leaf budgets are evidence, not aggregate floors.
"""
# T1 local successor of a2682f: accepted UNIX streams may share the LISTEN pathname.
# The received T2 archive remains immutable; T1 adaptation is separately reviewed.
import argparse
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import socket
import stat
import struct
import subprocess
import time

GIB = 1024 ** 3
DRIVERS = {'overlay2': 15 * GIB, 'overlayfs': 15 * GIB, 'vfs': 40 * GIB}
ROOT = '/sys/fs/cgroup'
SOCKET = '/run/docker.sock'
SUPPORTED = {'28.0.4', '28.5.2'}


def require(ok, code):
    if not ok:
        raise ValueError(code)


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def safe_code(error, fallback):
    code = error.args[0] if isinstance(error, ValueError) and error.args else None
    return code if isinstance(code, str) and re.fullmatch('[a-z][a-z0-9-]{1,80}', code) else fallback


def positive_integer(value):
    return type(value) is int and value > 0


def text(path):
    return Path(path).read_text().strip()


def binary(path, maximum=1048576):
    with open(path, 'rb') as stream:
        value = stream.read(maximum + 1)
    require(len(value) <= maximum, 'bounded-file-exceeded')
    return value


def names(path):
    return [entry.name for entry in os.scandir(path)]


def link(path):
    return os.readlink(path)


def metadata(path):
    s = Path(path).lstat()
    return {'device': s.st_dev, 'inode': s.st_ino, 'mode': s.st_mode,
            'uid': s.st_uid, 'gid': s.st_gid, 'mtimeNs': s.st_mtime_ns, 'ctimeNs': s.st_ctime_ns}


def canonical_path(value):
    require(isinstance(value, str) and value.startswith('/') and '\x00' not in value
            and str(Path(value)) == value and not set(value.split('/')).intersection({'.', '..'}), 'noncanonical-path')
    require(str(Path(value).resolve(strict=True)) == value, 'symlink-or-missing-path')
    return value


def global_view(path_factory=Path):
    import fcntl
    fd = os.open('/proc/self/ns/cgroup', os.O_RDONLY | os.O_CLOEXEC)
    try:
        namespace = {'inode': os.fstat(fd).st_ino, 'type': fcntl.ioctl(fd, 0xb703)}
    finally:
        os.close(fd)
    require(namespace == {'inode': 0xEFFFFFFB, 'type': 0x02000000}, 'initial-cgroup-namespace-required')
    raw = path_factory('/proc/self/mountinfo').read_text()
    mounts = [line.split() for line in raw.splitlines()]
    require(all(len(m) > 6 and '-' in m for m in mounts), 'mountinfo-malformed')
    selected = [m for m in mounts if m[4] == ROOT]
    require(len(selected) == 1 and selected[0][3] == '/' and selected[0][selected[0].index('-') + 1] == 'cgroup2'
            and not any(m[4].startswith(ROOT + '/') for m in mounts), 'global-cgroup2-mount-required')
    return namespace, raw


def membership(pid='self', path_factory=Path):
    value = path_factory('/proc/' + str(pid) + '/cgroup').read_bytes().decode('utf8').removesuffix('\n')
    require(re.fullmatch(r'0::/(?:[A-Za-z0-9_.:@-]+(?:/[A-Za-z0-9_.:@-]+)*)?', value) is not None
            and not set(value[4:].split('/')).intersection({'.', '..'}), 'unified-cgroup-membership-required')
    return value


def hierarchy(global_path, physical, path_factory=Path):
    require(positive_integer(physical) and (global_path == ROOT or global_path.startswith(ROOT + '/'))
            and str(Path(global_path)) == global_path and not set(global_path.split('/')).intersection({'.', '..'}), 'cgroup-path-invalid')
    namespace, mountinfo = global_view(path_factory)
    current, ancestors, quotas, limits = path_factory(global_path), [], [], [physical]
    while True:
        s = current.stat()
        require(stat.S_ISDIR(s.st_mode), 'cgroup-directory-required')
        identity = {'device': s.st_dev, 'inode': s.st_ino}
        values = {}
        for filename in ('memory.max', 'cpu.max'):
            try:
                raw = (current / filename).read_text().strip()
                require(raw != 'GLOBAL_ROOT_UNLIMITED', 'ancestor-controller-limit-malformed')
            except FileNotFoundError:
                require(str(current) == ROOT, 'ancestor-controller-limit-missing')
                raw = 'GLOBAL_ROOT_UNLIMITED'
            require(raw == 'GLOBAL_ROOT_UNLIMITED'
                    or filename == 'memory.max' and re.fullmatch(r'(max|[0-9]+)', raw) is not None
                    or filename == 'cpu.max' and re.fullmatch(r'(max|[1-9][0-9]*) [1-9][0-9]*', raw) is not None,
                    'ancestor-controller-limit-malformed')
            values[filename] = raw
        after = current.stat()
        require((s.st_dev, s.st_ino) == (after.st_dev, after.st_ino), 'cgroup-directory-changed')
        if values['memory.max'].isdigit():
            limits.append(int(values['memory.max']))
        ancestors.append({'path': str(current), 'identity': identity, 'limits': values})
        quotas.append({'cgroup': str(current), 'quota': values['cpu.max']})
        if str(current) == ROOT:
            break
        current = current.parent
    require(global_view(path_factory) == (namespace, mountinfo), 'cgroup-view-changed')
    for entry in ancestors:
        s = path_factory(entry['path']).stat()
        require(entry['identity'] == {'device': s.st_dev, 'inode': s.st_ino}, 'cgroup-directory-changed')
        for filename, before in entry['limits'].items():
            try:
                after = (path_factory(entry['path']) / filename).read_text().strip()
            except FileNotFoundError:
                after = 'GLOBAL_ROOT_UNLIMITED' if entry['path'] == ROOT else None
            require(after == before, 'cgroup-limit-changed')
    return min(limits), quotas, {'state': 'VERIFIED_INITIAL_GLOBAL_V2', 'namespace': namespace,
                                'mountRoot': '/', 'ancestors': ancestors}


def worker_cgroup_capacity(physical, path_factory=Path):
    before = membership(path_factory=path_factory)
    ram, quotas, proof = hierarchy(ROOT + before[3:].rstrip('/'), physical, path_factory)
    require(membership(path_factory=path_factory) == before, 'worker-membership-changed')
    proof['membership'] = before
    return ram, quotas, proof


def observe_host(worker_collector=None, path_factory=Path):
    physical = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    try:
        effective, quotas, proof = (worker_collector or worker_cgroup_capacity)(physical, path_factory=path_factory)
    except (OSError, ValueError, TypeError, IndexError):
        effective, quotas, proof = None, None, {'state': 'UNKNOWN_HOLD'}
    out = {'schema': 'gridex-t2-host-observation-v1', 'state': 'OBSERVED_NOT_ADMITTED',
           'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'physicalRAMBytes': physical,
           'effectiveRAMBytes': effective, 'cpuQuota': quotas, 'cgroupCapacity': proof,
           'cpuCount': os.cpu_count(), 'rootNamespaceVerified': False}
    try:
        data = json.loads(subprocess.run(['docker', 'info', '--format', '{{json .}}'], capture_output=True,
                                        text=True, timeout=15, check=True).stdout)
        out.update(driver=data.get('Driver'), daemonId=data.get('ID'), dockerRootDir=data.get('DockerRootDir'),
                   serverVersion=data.get('ServerVersion'), dockerMemTotalBytes=data.get('MemTotal'), dockerRootFreeBytes=None)
    except (OSError, ValueError, subprocess.SubprocessError):
        out['dockerObservationError'] = 'docker-info-unavailable'
    try:
        s = path_factory('/var/run/docker.sock').stat()
        out['socketIdentity'] = {'device': s.st_dev, 'inode': s.st_ino}
    except OSError:
        out['socketIdentity'] = None
    out['capacityErrors'] = capacity_errors(out)
    return out


def daemon_capacity_errors(witness):
    if not isinstance(witness, dict) or witness.get('schema') != 'gridex-t2-shared-backend-capacity-v1' or witness.get('state') != 'VERIFIED':
        return ['backend-capacity-unverified']
    backend = witness.get('backend')
    ram = backend.get('effectiveRAMBytes') if isinstance(backend, dict) else None
    return [] if positive_integer(ram) and ram >= 8 * GIB else ['insufficient-or-unknown-backend-ram']


def capacity_errors(observation):
    errors = []
    driver = observation.get('driver')
    if driver not in DRIVERS:
        errors.append('unknown-driver')
    if not positive_integer(observation.get('effectiveRAMBytes')) or observation['effectiveRAMBytes'] < 8 * GIB:
        errors.append('insufficient-or-unknown-ram')
    free = observation.get('dockerRootFreeBytes')
    if not positive_integer(free) or driver in DRIVERS and free < DRIVERS[driver]:
        errors.append('insufficient-or-unknown-docker-root-free')
    if not observation.get('dockerRootDir') or observation.get('rootNamespaceVerified') is not True:
        errors.append('docker-root-namespace-unverified')
    if not observation.get('daemonId') or not observation.get('socketIdentity'):
        errors.append('daemon-or-socket-identity-missing')
    if not observation.get('cpuQuota'):
        errors.append('cpu-quota-unrecorded')
    cg = observation.get('cgroupCapacity', {})
    ancestors = cg.get('ancestors') if isinstance(cg, dict) else None
    if not isinstance(cg, dict) or cg.get('state') != 'VERIFIED_INITIAL_GLOBAL_V2' or cg.get('namespace') != {'inode': 0xEFFFFFFB, 'type': 0x02000000} \
            or cg.get('mountRoot') != '/' or not isinstance(ancestors, list) or not ancestors or not isinstance(ancestors[-1], dict) or ancestors[-1].get('path') != ROOT:
        errors.append('cgroup-capacity-unverified')
    errors.extend(daemon_capacity_errors(observation.get('backendCapacity')))
    return errors


def process_identity(pid, container=False):
    require(type(pid) is int and pid > 0, 'process-pid-invalid')
    fields = text(f'/proc/{pid}/stat')
    ticks = int(fields[fields.rfind(')') + 2:].split()[19])
    status = text(f'/proc/{pid}/status')
    tgid = re.search(r'^Tgid:\s+(\d+)$', status, re.M)
    uid = re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$', status, re.M)
    require(tgid and int(tgid[1]) == pid and uid and len(set(uid.groups())) == 1, 'process-identity-ambiguous')
    namespaces = {kind: link(f'/proc/{pid}/ns/{kind}') for kind in ('mnt', 'pid', 'net')}
    if not container:
        require(all(namespaces[k] == link('/proc/self/ns/' + k) for k in namespaces), 'process-namespace-mismatch')
    require(link('/proc/self/ns/pid') == 'pid:[4026531836]', 'initial-pid-namespace-required')
    return {'pid': pid, 'startTicks': ticks, 'effectiveUID': int(uid[2]), 'comm': text(f'/proc/{pid}/comm'),
            'namespaces': namespaces, 'membership': membership(pid), 'executable': link(f'/proc/{pid}/exe')}


def listener_inode():
    rows = []
    for line in text('/proc/net/unix').splitlines()[1:]:
        row = line.split()
        if len(row) == 8 and row[7] == SOCKET:
            require(re.fullmatch(r'[0-9a-fA-F]{8}', row[3]) and re.fullmatch(r'[0-9a-fA-F]{4}', row[4])
                    and re.fullmatch(r'[0-9a-fA-F]{2}', row[5]) and row[6].isdigit() and int(row[6]) > 0, 'socket-row-malformed')
            if row[3] == '00000000' and row[4] == '0001' and row[5] == '03':
                continue  # Accepted UNIX streams retain the listener pathname.
            require(row[3] == '00010000' and row[4] == '0001' and row[5] == '01', 'socket-not-listening-stream')
            rows.append(int(row[6]))
    require(len(rows) == 1, 'socket-listener-not-unique')
    return rows[0]


def holds_listener(pid, inode):
    fds = names(f'/proc/{pid}/fd')
    require(len(fds) <= 4096, 'process-fd-budget-exceeded')
    return any(link(f'/proc/{pid}/fd/{fd}') == f'socket:[{inode}]' for fd in fds)


def socket_authority():
    canonical_path(SOCKET)
    s = metadata(SOCKET)
    require(stat.S_ISSOCK(s['mode']) and s['uid'] == 0 and not s['mode'] & 0o002, 'socket-filesystem-unqualified')
    inode = listener_inode()
    candidates = names('/proc')
    require(len(candidates) <= 65536, 'process-enumeration-budget-exceeded')
    holders = []
    for candidate in candidates:
        if not candidate.isdigit():
            continue
        try:
            comm = text('/proc/' + candidate + '/comm')
        except FileNotFoundError:
            continue
        if comm == 'dockerd' and holds_listener(int(candidate), inode):
            holders.append(int(candidate))
    require(len(holders) == 1, 'dockerd-listener-holder-not-unique')
    process = process_identity(holders[0])
    require(process['effectiveUID'] == 0, 'rootful-dockerd-required')
    return {'path': SOCKET, 'filesystem': s, 'kernelInode': inode}, process


def socket_request(path):
    # Called only after an active dockerd FD has been proven; never activates an
    # otherwise dormant systemd socket and never connects to a caller URL.
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(10)
        stream.connect(SOCKET)
        pid, uid, gid = struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        stream.sendall(('GET ' + path + ' HTTP/1.0\r\nHost: localhost\r\n\r\n').encode('ascii'))
        response = http.client.HTTPResponse(stream)
        response.begin()
        require(response.status == 200, 'docker-api-info-failed')
        body = response.read(2097153)
        require(len(body) <= 2097152, 'docker-api-info-too-large')
    return json.loads(body), {'pid': pid, 'uid': uid, 'gid': gid}


def socket_info():
    return socket_request('/info')


def peer_authority(peer, process, inode):
    require(peer['uid'] == 0, 'docker-peer-not-root')
    if peer['pid'] == process['pid']:
        return 'direct', None
    require(peer['pid'] == 1, 'docker-peer-not-daemon-or-systemd')
    init = process_identity(1)
    require(init['comm'] == 'systemd' and init['effectiveUID'] == 0 and holds_listener(1, inode), 'systemd-socket-activation-unproven')
    return 'systemd', init


def strict_json(raw):
    def pairs(items):
        out, folded = {}, set()
        for key, value in items:
            require(isinstance(key, str) and key.lower() not in folded, 'config-duplicate-or-case-ambiguous-key')
            folded.add(key.lower())
            require(key not in ('Cgroup-parent', 'Exec-opts', 'Rootless') and (key.lower() not in ('cgroup-parent', 'exec-opts', 'rootless') or key == key.lower()), 'config-critical-key-case-invalid')
            out[key] = value
        return out
    value = json.loads(raw, object_pairs_hook=pairs)
    require(isinstance(value, dict), 'config-object-required')
    return value


def selected_flags(pid):
    argv = binary(f'/proc/{pid}/cmdline').split(b'\x00')
    require(argv and not argv[-1], 'daemon-argv-unqualified')
    argv = [a.decode('utf8') for a in argv[:-1]]
    require(argv and Path(argv[0]).name == 'dockerd', 'daemon-argv-unqualified')
    selected, opts, i = {}, [], 1
    while i < len(argv):
        arg = argv[i]
        key, equal, value = arg.partition('=')
        if key in ('--config-file', '--cgroup-parent', '--exec-opt', '--rootless'):
            if key == '--rootless' and not equal:
                value = 'true'
            elif not equal:
                i += 1
                require(i < len(argv), 'daemon-flag-value-missing')
                value = argv[i]
            if key == '--exec-opt':
                opts.append(value)
            else:
                require(key not in selected, 'daemon-flag-duplicate')
                selected[key] = value
        elif key.lower() in ('--config-file', '--cgroup-parent', '--exec-opt', '--rootless'):
            raise ValueError('daemon-flag-case-invalid')
        i += 1
    require(selected.get('--rootless', 'false') == 'false', 'rootless-daemon-unsupported')
    require(not any(v.startswith(b'ROOTLESSKIT_STATE_DIR=') for v in binary(f'/proc/{pid}/environ').split(b'\x00')),
            'rootlesskit-daemon-unsupported')
    selected['--exec-opt'] = opts
    return selected


def before_birth(m, birth_ns):
    require(m['uid'] == 0 and not m['mode'] & 0o022 and m['ctimeNs'] < birth_ns - 2000000000
            and m['mtimeNs'] < birth_ns - 2000000000, 'config-startup-chronology-unproven')


def configuration(process, driver):
    flags = selected_flags(process['pid'])
    hz = os.sysconf('SC_CLK_TCK')
    btime = re.search(r'^btime (\d+)$', text('/proc/stat'), re.M)
    require(btime and positive_integer(hz), 'boot-clock-unqualified')
    uptime = float(text('/proc/uptime').split()[0])
    require(abs(time.time() - (int(btime[1]) + uptime)) < 2, 'boot-realclock-mismatch')
    birth_ns = int((int(btime[1]) + process['startTicks'] / hz) * 1000000000)
    config_path = flags.get('--config-file', '/etc/docker/daemon.json')
    require(config_path.startswith('/') and str(Path(config_path)) == config_path and not set(config_path.split('/')).intersection({'.', '..'}), 'config-path-noncanonical')
    parent, absent = str(Path(config_path).parent), []
    while True:
        try:
            pm = metadata(parent)
            break
        except FileNotFoundError:
            absent.append(parent)
            require(parent != '/', 'config-parent-unavailable')
            parent = str(Path(parent).parent)
    canonical_path(parent)
    require(stat.S_ISDIR(pm['mode']), 'config-parent-directory-required')
    try:
        cm = metadata(config_path)
    except FileNotFoundError:
        require('--config-file' not in flags, 'explicit-config-missing')
        before_birth(pm, birth_ns)
        config, source = {}, {'kind': 'absent-default', 'path': config_path, 'parentPath': parent,
                              'absentDirectories': absent, 'parentIdentity': pm}
    else:
        canonical_path(config_path)
        require(stat.S_ISREG(cm['mode']), 'config-regular-file-required')
        before_birth(cm, birth_ns)
        raw = binary(config_path)
        config = strict_json(raw)
        require(metadata(config_path) == cm, 'config-changed-during-read')
        source = {'kind': 'file', 'path': config_path, 'identity': cm, 'sha256': hashlib.sha256(raw).hexdigest()}
    require(not config.get('rootless', False), 'rootless-daemon-unsupported')
    require(not ('--cgroup-parent' in flags and 'cgroup-parent' in config)
            and not (flags['--exec-opt'] and 'exec-opts' in config), 'config-cli-conflict')
    options = flags['--exec-opt'] or config.get('exec-opts', [])
    require(isinstance(options, list) and all(isinstance(v, str) for v in options), 'config-exec-options-invalid')
    drivers = [v.split('=', 1)[1] for v in options if v.startswith('native.cgroupdriver=')]
    require(len(drivers) <= 1 and (not drivers or drivers[0] == driver), 'config-driver-ambiguous')
    require(not any(v.lower().startswith('native.cgroupdriver=') and not v.startswith('native.cgroupdriver=') for v in options), 'config-driver-case-invalid')
    setting = flags.get('--cgroup-parent', config.get('cgroup-parent'))
    origin = 'CLI' if '--cgroup-parent' in flags else 'config' if 'cgroup-parent' in config else 'default'
    require(setting is None or isinstance(setting, str) and bool(setting), 'config-parent-setting-invalid')
    setting = setting or ('system.slice' if driver == 'systemd' else '/docker')
    return {'source': source, 'selectedArgumentsSHA256': canonical_hash(flags), 'parentOrigin': origin,
            'parentSetting': setting, 'cgroupDriver': driver}


def parent_path(setting, driver):
    if driver == 'cgroupfs':
        require(setting.startswith('/') and str(Path(setting)) == setting
                and not set(setting.split('/')).intersection({'.', '..'}), 'cgroupfs-parent-noncanonical')
        return setting
    require(driver == 'systemd' and re.fullmatch(r'[A-Za-z0-9_:.-]+\.slice', setting) is not None
            and '/' not in setting and (setting == '-.slice' or not setting.startswith('-')) and '--' not in setting, 'systemd-parent-invalid')
    if setting == '-.slice':
        return '/'
    components = setting[:-6].split('-')
    require(all(components) and '.' not in components and '..' not in components, 'systemd-parent-invalid')
    return '/' + '/'.join('-'.join(components[:i]) + '.slice' for i in range(1, len(components) + 1))


def api_summary(data):
    require(data.get('ServerVersion') in SUPPORTED and data.get('CgroupDriver') in ('systemd', 'cgroupfs')
            and str(data.get('CgroupVersion')) == '2' and data.get('OSType') == 'linux', 'docker-default-semantics-unsupported')
    require(not any('rootless' in str(v).lower() for v in data.get('SecurityOptions', [])), 'rootless-api-unsupported')
    root = canonical_path(data['DockerRootDir'])
    require(stat.S_ISDIR(metadata(root)['mode']) and data.get('ID'), 'docker-api-root-or-id-unqualified')
    return {'id': data['ID'], 'rootDir': root, 'serverVersion': data['ServerVersion'], 'driver': data.get('Driver'),
            'cgroupDriver': data['CgroupDriver'], 'memTotalBytes': data.get('MemTotal')}


def stable_mapping(witness):
    return {k: witness.get(k) for k in ('schema', 'kernelRelease', 'physicalRAMBytes', 'docker', 'socket', 'process', 'configuration', 'backend')}


def collect_daemon():
    out = {'schema': 'gridex-t2-shared-backend-capacity-v1', 'state': 'UNKNOWN_HOLD', 'errors': [],
           'kernelRelease': os.uname().release, 'physicalRAMBytes': os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE'),
           'docker': None, 'socket': None, 'process': None, 'configuration': None, 'backend': None}
    try:
        global_view()
        authority, process = socket_authority()
        out['socket'], out['process'] = dict(authority), dict(process)
        ram, _, cg = hierarchy(ROOT + process['membership'][3:].rstrip('/'), out['physicalRAMBytes'])
        out['process'].update(effectiveRAMBytes=ram, hierarchy=cg)
        data, peer = socket_info()
        activation, init = peer_authority(peer, process, authority['kernelInode'])
        out['socket'].update(peer=peer, activation=activation)
        if init is not None:
            out['socket']['activationProcess'] = init
        out['docker'] = api_summary(data)
        try:
            cfg = configuration(process, out['docker']['cgroupDriver'])
            out['configuration'] = cfg
            global_parent = parent_path(cfg['parentSetting'], out['docker']['cgroupDriver'])
            ram, _, cg = hierarchy(ROOT + global_parent if global_parent != '/' else ROOT, out['physicalRAMBytes'])
            out['backend'] = {'globalParent': global_parent, 'effectiveRAMBytes': ram, 'hierarchy': cg}
            require(ram >= 8 * GIB, 'shared-backend-ram-below-minimum')
        except (OSError, ValueError, TypeError, KeyError) as error:
            out['errors'].append(safe_code(error, 'backend-parent-or-config-unqualified'))
        after_authority, after_process = socket_authority()
        require(after_authority == authority and after_process == process, 'daemon-or-listener-changed')
        again, again_peer = socket_info()
        require(api_summary(again) == out['docker'] and again_peer == peer, 'docker-api-or-peer-changed')
        if init is not None:
            require(process_identity(1) == init and holds_listener(1, authority['kernelInode']), 'socket-activation-changed')
        if out['configuration'] is not None:
            require(configuration(process, out['docker']['cgroupDriver']) == out['configuration'], 'daemon-config-changed')
        require(process_identity(process['pid']) == process, 'daemon-process-changed')
        ram, _, cg = hierarchy(ROOT + process['membership'][3:].rstrip('/'), out['physicalRAMBytes'])
        require(ram == out['process']['effectiveRAMBytes'] and cg == out['process']['hierarchy'], 'daemon-cgroup-budget-changed')
        if out['backend'] is not None:
            parent = out['backend']['globalParent']
            ram, _, cg = hierarchy(ROOT + parent if parent != '/' else ROOT, out['physicalRAMBytes'])
            require({'globalParent': parent, 'effectiveRAMBytes': ram, 'hierarchy': cg} == out['backend'], 'backend-parent-changed')
    except Exception as error:
        out['errors'].append(safe_code(error, 'daemon-authority-or-snapshot-unqualified'))
    out['errors'] = sorted(set(out['errors']))
    out['state'] = 'VERIFIED' if not out['errors'] else 'UNKNOWN_HOLD'
    out['stableMappingSHA256'] = canonical_hash(stable_mapping(out))
    return out


def container_inspect(container_id):
    require(re.fullmatch('[0-9a-f]{64}', container_id) is not None, 'container-id-invalid')
    data, peer = socket_request('/containers/' + container_id + '/json')
    require(peer['uid'] == 0, 'container-api-peer-not-root')
    return data


def collect_containers(request):
    witness = collect_daemon()
    out = {'schema': 'gridex-t2-owned-container-capacity-v1', 'state': 'UNKNOWN_HOLD', 'errors': [], 'daemon': witness, 'containers': []}
    try:
        require(set(request) == {'project', 'containers', 'expectedDaemon'} and isinstance(request['project'], str)
                and re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', request['project']) and isinstance(request['containers'], list)
                and 0 < len(request['containers']) <= 32, 'container-request-invalid')
        require(not daemon_capacity_errors(witness) and stable_mapping(witness) == stable_mapping(request['expectedDaemon']), 'container-daemon-witness-changed')
        seen = set()
        for expected in request['containers']:
            require(set(expected) == {'id', 'name', 'created'} and expected['id'] not in seen, 'container-receipt-invalid')
            seen.add(expected['id'])
            data = container_inspect(expected['id'])
            require(all(data.get(k) == v for k, v in [('Id', expected['id']), ('Name', expected['name']), ('Created', expected['created'])])
                    and data.get('Config', {}).get('Labels', {}).get('com.supabase.cli.project') == request['project']
                    and data['State']['Running'] is True and positive_integer(data['State']['Pid']) and data['State'].get('StartedAt'), 'container-ownership-or-birth-invalid')
            configured = data.get('HostConfig', {}).get('CgroupParent', '')
            require(configured in ('', witness['configuration']['parentSetting']), 'container-parent-override-unqualified')
            process = process_identity(data['State']['Pid'], container=True)
            parent = witness['backend']['globalParent']
            expected_path = (parent.rstrip('/') + '/docker-' + expected['id'] + '.scope' if witness['docker']['cgroupDriver'] == 'systemd'
                             else parent.rstrip('/') + '/' + expected['id'])
            require(process['membership'] == '0::' + expected_path, 'container-global-membership-mismatch')
            ram, _, cg = hierarchy(ROOT + expected_path, witness['physicalRAMBytes'])
            again = container_inspect(expected['id'])
            require(all(again.get(k) == data.get(k) for k in ('Id', 'Name', 'Created', 'State', 'HostConfig'))
                    and process_identity(process['pid'], container=True) == process, 'container-restarted-or-moved')
            out['containers'].append({**expected, 'startedAt': data['State']['StartedAt'], 'pid': process['pid'],
                                      'configuredParent': configured, 'globalParent': parent, 'process': process,
                                      'hierarchy': cg, 'individualEffectiveRAMBytes': ram})
        final = collect_daemon()
        require(not daemon_capacity_errors(final) and stable_mapping(final) == stable_mapping(witness), 'container-daemon-changed-during-read')
    except Exception:
        out['errors'].append('owned-container-capacity-unqualified')
    out['state'] = 'VERIFIED' if not out['errors'] else 'UNKNOWN_HOLD'
    return out


def main():
    import sys
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--daemon', action='store_true')
    mode.add_argument('--containers', action='store_true')
    try:
        args = parser.parse_args()
        if args.daemon:
            result = collect_daemon()
        else:
            raw = sys.stdin.buffer.read(262145)
            require(len(raw) <= 262144, 'container-request-too-large')
            result = collect_containers(strict_json(raw))
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print(json.dumps({'state': 'UNKNOWN_HOLD', 'errors': ['capacity-helper-invocation-unqualified']}))
        return 78


if __name__ == '__main__':
    raise SystemExit(main())
