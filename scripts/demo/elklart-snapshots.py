#!/usr/bin/env python3
"""Offline, full-volume checkpoints of the two explicitly owned local demo stacks.

Requires runtime/apps-stopped.json containing {"appsStopped": true}; callers must
stop their application writers first. Container environments are never inspected or logged. Explicit allowlisted host
bootstrap/provider secrets are restored privately alongside Auth and volume data.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import socket
import stat
import subprocess
import tarfile

ROOT = Path('/workspace/elklart-runtime')
PROJECTS = {'elklart-ops-demo', 'elklart-portal-demo'}
LABEL = 'com.supabase.cli.project'
ENDPOINT = 'unix:///var/run/docker.sock'
IMAGE = 'elklart-snapshot-helper:gnu-tar-v1'
HOST_FILES = tuple(f'{project}/{name}' for project, names in (
    ('ops', ('accounts.json', 'tenant.json', 'app.env', 'fixtures.json', 'status.json', 'integration.json', 'app-secrets.json', 'support-scenario.json', 'manual-mailbox-evidence.json', 'sender-prepared.json', 'isolation-scenario.json', 'network-scenario.json', 'billing-setup.json', 'integration-development-original.json', 'catalogue-readback.json')),
    ('portal', ('accounts.json', 'app.env', 'fixtures.json', 'status.json', 'customer-assertion-private.pem', 'customer-assertion-registration.json', 'karin-support-account.json', 'development-client-original-scopes.json'))) for name in names)
HOST_TREES = ('provider', 'provider-mail', 'provider-smtp')
HOST_EPHEMERAL = ('provider-smtp/supervisor.json', 'provider-smtp/supervisor.log')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def private_path(path, exists=True):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts, 'Unsafe path')
    require(path == ROOT or ROOT in path.parents, 'Path outside runtime')
    for parent in [path, *path.parents]:
        require(not parent.is_symlink(), 'Symlink in runtime path')
    require(ROOT.is_dir(), 'Runtime root missing')
    require(ROOT.stat().st_uid == os.getuid(), 'Runtime owner mismatch')
    require(stat.S_IMODE(ROOT.stat().st_mode) == 0o700, 'Runtime must have mode 0700')
    if exists:
        require(path.exists(), 'Missing runtime file')
    return path


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def check_archive(path):
    with tarfile.open(path, 'r:') as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            require(not name.is_absolute() and '..' not in name.parts,
                    'Archive traversal')
            require(member.isfile() or member.isdir(), 'Archive links or special files refused')


def host_inventory():
    """Validate all host state before any volume or host mutation."""
    entries = {}
    def inspect(path):
        private_path(path)
        info = path.lstat()
        require(info.st_uid == os.getuid(), 'Foreign host state owner')
        require(stat.S_IMODE(info.st_mode) & 0o7077 == 0, 'Host state must be private')
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'Special host state refused')
        kind = 'directory' if path.is_dir() else 'file'
        entries[str(path.relative_to(ROOT))] = {'kind': kind, 'mode': stat.S_IMODE(info.st_mode),
                                               **({'sha256': digest(path)} if kind == 'file' else {})}
    for relative in HOST_FILES:
        path = private_path(ROOT / relative, exists=False)
        if path.parent.exists():
            # Parent metadata is validated, but parent directories are never restored/deleted.
            info = path.parent.stat()
            require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) & 0o7077 == 0,
                    'Unsafe host state parent')
        if path.exists():
            inspect(path)
            require(entries[relative]['kind'] == 'file', 'Allowlisted host state must be a file')
    for tree in HOST_TREES:
        provider = private_path(ROOT / tree, exists=False)
        if provider.exists():
            require(not (provider / '.writer-lock').exists(), 'Provider writer lock present; stop provider first')
            inspect(provider)
            require(provider.is_dir(), 'Provider must be a directory')
            for directory, directories, files in os.walk(provider, followlinks=False):
                for name in directories + files:
                    item = Path(directory) / name
                    inspect(item)
                    if str(item.relative_to(ROOT)) in HOST_EPHEMERAL:
                        require(item.is_file(), 'Ephemeral provider state must be a file')
                        del entries[str(item.relative_to(ROOT))]
    # An otherwise empty SMTP root may remain solely to hold excluded process logs.
    if 'provider-smtp' in entries and not any(key.startswith('provider-smtp/') for key in entries):
        del entries['provider-smtp']
    return entries


def save_host(location):
    entries = host_inventory()
    target = private_path(location / 'host-state.tar', exists=False)
    with target.open('xb') as output:
        os.chmod(target, 0o600)
        with tarfile.open(fileobj=output, mode='w') as archive:
            for relative in sorted(entries):
                archive.add(ROOT / relative, arcname=relative, recursive=False)
    state = {'sha256': digest(target), 'entries': entries,
             'scope': {'files': list(HOST_FILES), 'trees': list(HOST_TREES), 'ephemeral': list(HOST_EPHEMERAL)}}
    verify_host(location, state)
    return state


def verify_host(location, state):
    """Validate archive and current deletion targets without modifying either."""
    require(state.get('scope') == {'files': list(HOST_FILES), 'trees': list(HOST_TREES), 'ephemeral': list(HOST_EPHEMERAL)},
            'Snapshot host scope differs from current explicit allowlist; save a fresh complete baseline')
    host_inventory()
    target = private_path(location / 'host-state.tar')
    require(digest(target) == state['sha256'], 'Host state hash mismatch')
    check_archive(target)
    seen = set()
    with tarfile.open(target) as archive:
        for member in archive:
            relative = member.name.rstrip('/')
            require(relative not in seen, 'Duplicate host archive member')
            seen.add(relative)
            require(relative not in HOST_EPHEMERAL and (relative in HOST_FILES or any(relative == tree or relative.startswith(tree + '/') for tree in HOST_TREES)),
                    'Foreign host archive path')
            require(relative in state['entries'], 'Unexpected host archive member')
            entry = state['entries'][relative]
            require(member.uid == os.getuid() and member.mode & 0o7077 == 0,
                    'Unsafe archived host ownership/mode')
            require(entry['mode'] == member.mode, 'Host mode mismatch')
            require((entry['kind'] == 'directory' and member.isdir()) or
                    (entry['kind'] == 'file' and member.isfile()), 'Host type mismatch')
            if member.isfile():
                require(hashlib.sha256(archive.extractfile(member).read()).hexdigest() == entry['sha256'],
                        'Host member hash mismatch')
    require(seen == set(state['entries']), 'Incomplete host archive')
    # Every provider child must have an archived directory parent.
    for relative in seen:
        if any(relative.startswith(tree + '/') for tree in HOST_TREES):
            parent = str(PurePosixPath(relative).parent)
            require(parent in seen and state['entries'][parent]['kind'] == 'directory',
                    'Missing provider archive parent')


def restore_host(location, state):
    verify_host(location, state)
    current = host_inventory()
    # Only explicit allowlist files and validated provider members may be deleted.
    for relative in sorted(current, key=lambda key: (key.count('/'), key), reverse=True):
        if relative in state['entries'] and not any(relative == tree or relative.startswith(tree + '/') for tree in HOST_TREES):
            continue
        path = private_path(ROOT / relative)
        if current[relative]['kind'] == 'file':
            path.unlink()
        else:
            if relative in HOST_TREES and any((ROOT / item).exists() for item in HOST_EPHEMERAL if item.startswith(relative + '/')):
                continue
            path.rmdir()
    with tarfile.open(location / 'host-state.tar') as archive:
        members = sorted(archive.getmembers(), key=lambda member: (member.name.count('/'), member.name))
        for member in members:
            path = private_path(ROOT / member.name, exists=False)
            if member.isdir():
                path.mkdir(mode=member.mode, exist_ok=True)
            else:
                if not path.parent.exists():
                    # Only the two fixed bootstrap parent directories may be created here.
                    require(path.parent in (ROOT / 'ops', ROOT / 'portal'), 'Missing restore parent')
                    path.parent.mkdir(mode=0o700)
                with path.open('wb') as output:
                    os.chmod(path, member.mode)
                    with archive.extractfile(member) as source:
                        for block in iter(lambda: source.read(1024 * 1024), b''):
                            output.write(block)
    require(host_inventory() == state['entries'], 'Restored host state mismatch')


class Docker:
    def __init__(self):
        require(os.environ.get('DOCKER_HOST', ENDPOINT) == ENDPOINT,
                'Only the fixed local Docker socket is allowed')
        require(not os.environ.get('DOCKER_CONTEXT'), 'DOCKER_CONTEXT override refused')
        endpoint = Path('/var/run/docker.sock')
        require(endpoint.exists() and stat.S_ISSOCK(endpoint.stat().st_mode), 'Local Docker socket missing')

    def run(self, *args, **kwargs):
        return subprocess.run(['docker', '--host', ENDPOINT, *args], check=True,
                              stderr=subprocess.PIPE, **kwargs)

    def json(self, *args):
        return json.loads(self.run(*args, stdout=subprocess.PIPE).stdout)


def inventory(docker):
    ids = docker.run('ps', '-aq', stdout=subprocess.PIPE).stdout.decode().split()
    require(ids, 'No demo containers')
    containers = docker.json('inspect', *ids)
    owned = [c for c in containers if c['Config'].get('Labels', {}).get(LABEL) in PROJECTS]
    require({c['Config']['Labels'][LABEL] for c in owned} == PROJECTS,
            'Both exact demo projects must exist')
    volumes = {}
    records = []
    for c in containers:
        project = c['Config'].get('Labels', {}).get(LABEL)
        name = c['Name'].lstrip('/')
        if c not in owned:
            require(not any(p in name for p in PROJECTS), 'Foreign container spoofs demo name')
            continue
        mounts = []
        for m in c['Mounts']:
            if m['Type'] == 'bind':
                # Immutable local CLI configuration only; never restore arbitrary host paths.
                source = private_path(m['Source'])
                require(not m['RW'] and source.is_file(), 'Only readonly runtime file binds allowed')
                mounts.append({'Type': 'bind', 'Source': str(source),
                               'Destination': m['Destination'], 'sha256': digest(source)})
                continue
            require(m['Type'] == 'volume' and m.get('Name'), 'Non-owned/anonymous mount refused')
            v = docker.json('volume', 'inspect', m['Name'])[0]
            require(v.get('Labels', {}).get(LABEL) == project, 'Volume ownership label mismatch')
            require(v.get('Driver') == 'local' and not v.get('Options'), 'Nonstandard volume refused')
            volumes[m['Name']] = {'Name': m['Name'], 'Labels': v['Labels'],
                                  'Mountpoint': v['Mountpoint'], 'CreatedAt': v.get('CreatedAt')}
            mounts.append({'Type': 'volume', 'Name': m['Name'], 'Destination': m['Destination'], 'RW': m['RW']})
        records.append({'Id': c['Id'], 'Name': name, 'Labels': c['Config']['Labels'],
                        'Image': c['Image'], 'Mounts': mounts})
    # No other container may access one of these volumes.
    for c in containers:
        if c not in owned:
            require(not any(m.get('Name') in volumes for m in c['Mounts']), 'Foreign volume consumer')
    all_names = docker.run('volume', 'ls', '-q', stdout=subprocess.PIPE).stdout.decode().split()
    if all_names:
        for volume in docker.json('volume', 'inspect', *all_names):
            if volume.get('Labels', {}).get(LABEL) in PROJECTS:
                require(volume['Name'] in volumes, 'Unattached owned volume: refusing incomplete snapshot')
    require(volumes, 'No owned persistent volumes')
    return {'containers': sorted(records, key=lambda r: r['Id']), 'volumes': volumes}


def writers_stopped():
    marker = private_path(ROOT / 'apps-stopped.json')
    require(json.loads(marker.read_text()).get('appsStopped') is True, 'Apps must be explicitly stopped')
    for port in (3000, 3001, 38480, 38481, 38482):
        for family, address in ((socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1')):
            try:
                with socket.socket(family) as connection:
                    connection.settimeout(0.2)
                    require(connection.connect_ex((address, port)) != 0,
                            'Application writer port still listening')
            except OSError:
                require(family == socket.AF_INET6, 'Cannot check application writer port')


def helper_args(image, volume, restore=False):
    command = ['run', '--rm', '--pull=never', '--network=none', '--read-only',
               '--cap-drop=ALL', '--cap-add=DAC_OVERRIDE', '--cap-add=CHOWN', '--cap-add=FOWNER',
               '--security-opt=no-new-privileges', '--mount',
               f'type=volume,src={volume},dst=/data' + ('' if restore else ',readonly'),
               '--entrypoint', '/bin/sh']
    if restore:
        command += ['-i']
    command += [image, '-ec',
                'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar --numeric-owner --xattrs --xattrs-include=user.* --acls -xpf - -C /data'
                if restore else 'tar --numeric-owner --xattrs --xattrs-include=user.* --acls -cpf - -C /data .']
    return command


def verify_empty_mailpit(docker, current):
    """Mailpit is transient: a saved baseline must have no inbox contents to lose."""
    targets = []
    for project, port in (('elklart-ops-demo', 54324), ('elklart-portal-demo', 55324)):
        name = 'supabase_inbucket_' + project
        matches = [c for c in current['containers'] if c['Name'] == name]
        require(len(matches) == 1, 'Exact owned Mailpit container missing or ambiguous')
        container = docker.json('inspect', matches[0]['Id'])[0]
        require(container['Id'] == matches[0]['Id'] and container['Name'] == '/' + name
                and container.get('Config', {}).get('Labels', {}).get(LABEL) == project
                and container.get('State', {}).get('Running') is True,
                'Mailpit container identity/ownership mismatch')
        expected = {'8025/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(port)}]}
        actual = container.get('NetworkSettings', {}).get('Ports', {})
        require({key: value for key, value in actual.items() if value} == expected,
                'Mailpit must have only the exact actual loopback HTTP binding')
        configured = {key: value for key, value in container.get('HostConfig', {}).get('PortBindings', {}).items() if value}
        require(set(configured) == {'8025/tcp'} and len(configured['8025/tcp']) == 1,
                'Unexpected configured Mailpit binding')
        binding = configured['8025/tcp'][0]
        require(binding.get('HostPort') == str(port) and binding.get('HostIp') in ('', '127.0.0.1'),
                'Unsafe configured Mailpit binding')
        if binding['HostIp'] == '':
            # Docker can leave configured HostIp empty when the owned bridge's
            # default binding supplies loopback. The actual binding above is
            # still mandatory, and the exact attached bridge must prove this.
            networks = container.get('NetworkSettings', {}).get('Networks', {})
            require(set(networks) == {project}, 'Unexpected Mailpit network attachment')
            network_id = networks[project].get('NetworkID')
            require(isinstance(network_id, str) and network_id, 'Mailpit network identity missing')
            network = docker.json('network', 'inspect', network_id)[0]
            expected_labels = {project, 'elklart-ops'} if project == 'elklart-ops-demo' else {project}
            require(network.get('Id') == network_id and network.get('Name') == project
                    and network.get('Driver') == 'bridge' and network.get('Scope') == 'local'
                    and network.get('Labels', {}).get('com.gridex.demo') in expected_labels
                    and network.get('Options', {}).get('com.docker.network.bridge.host_binding_ipv4') == '127.0.0.1',
                    'Owned Mailpit bridge must prove default loopback binding')
        targets.append(port)
    # http.client makes direct loopback requests: no environment proxies and no
    # automatic redirects. All identities/bindings have been checked first.
    for port in targets:
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
        try:
            connection.request('GET', '/api/v1/messages', headers={'Accept': 'application/json'})
            response = connection.getresponse()
            require(response.status == 200, 'Mailpit inbox read failed or redirected')
            raw = response.read(65537)
            require(len(raw) <= 65536, 'Mailpit inbox response too large')
            data = json.loads(raw)
            require(isinstance(data, dict), 'Malformed Mailpit inbox response')
            require(all(type(data.get(key)) is int and data[key] == 0
                        for key in ('total', 'unread', 'count', 'messages_count'))
                    and data.get('messages') == [],
                    'Save requires both Mailpit inboxes empty; nonempty inboxes cannot be snapshotted')
        except (OSError, http.client.HTTPException) as error:
            raise ValueError('Mailpit inbox verification failed closed') from error
        finally:
            connection.close()


def verify_helper(docker, image):
    """Capability checks run before stopping any stack; never pull a helper."""
    result = docker.run('run', '--rm', '--pull=never', '--network=none', '--read-only',
                        '--cap-drop=ALL', '--security-opt=no-new-privileges',
                        '--entrypoint', '/bin/sh', image, '-ec',
                        'tar --version; tar --help', stdout=subprocess.PIPE)
    output = result.stdout.decode('utf8', errors='replace')
    require('tar (GNU tar)' in output and '--xattrs' in output and '--acls' in output,
            'Helper requires verified GNU tar with xattrs/ACL support; BusyBox tar refused')


def checkpoint(action, name):
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', name), 'Invalid checkpoint name')
    private_path(ROOT)
    writers_stopped()
    docker = Docker()
    current = inventory(docker)
    host_inventory()
    # Resolve immutable, locally present image ID; never pull on either path.
    helper = docker.json('image', 'inspect', IMAGE)[0]
    labels = helper.get('Config', {}).get('Labels', {}) or {}
    require(helper.get('Config', {}).get('User', '') in ('', '0', 'root'), 'Snapshot helper must run as root with restricted capabilities')
    provenance = private_path(ROOT / 'snapshot-helper-build' / 'provenance.json')
    require(labels.get('io.elklart.snapshot-helper') == 'gnu-tar-v1'
            and labels.get('io.elklart.snapshot-helper.owner') == 'elklart-demo'
            and labels.get('io.elklart.snapshot-helper.source') == 'host-local-binaries'
            and labels.get('io.elklart.snapshot-helper.provenance') == digest(provenance),
            'Local helper ownership/provenance mismatch')
    image = helper['Id']
    verify_helper(docker, image)
    location = private_path(ROOT / 'snapshots' / name, exists=False)
    if action == 'save':
        verify_empty_mailpit(docker, current)
        require(not location.exists(), 'Checkpoint already exists')
        location.mkdir(parents=True, mode=0o700)
        expected = current
    else:
        private_path(location)
        meta_path = private_path(location / 'manifest.json')
        expected = json.loads(meta_path.read_text())
        require(expected.get('version') == 3, 'Snapshot predates required Storage extended-attribute preservation; save a fresh baseline')
        require(expected['inventory'] == current, 'Runtime identities/mounts changed since snapshot')
        require(expected['helperImage'] == image, 'Helper image changed')
        for volume, checksum in expected['archives'].items():
            require(volume in current['volumes'], 'Foreign archive volume')
            archive = private_path(location / (volume + '.tar'))
            require(digest(archive) == checksum, 'Archive hash mismatch')
            check_archive(archive)
        require(set(expected['archives']) == set(current['volumes']), 'Incomplete volume archives')
        verify_host(location, expected['hostState'])
    ids = [c['Id'] for c in current['containers']]
    running = docker.json('inspect', *ids)
    require(all(c['State']['Running'] for c in running), 'All stack containers must be running before checkpoint')
    stopped = False
    restore_started = False
    restore_complete = False
    try:
        stopped = True
        docker.run('stop', '--time', '60', *ids, stdout=subprocess.PIPE)
        require(all(not c['State']['Running'] for c in docker.json('inspect', *ids)), 'Stack did not stop')
        require(inventory(docker) == current, 'Ownership changed while stopping')
        if action == 'save':
            hashes = {}
            for volume in current['volumes']:
                require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]+', volume), 'Unsafe volume name')
                archive = private_path(location / (volume + '.tar'), exists=False)
                with archive.open('xb') as stream:
                    os.chmod(archive, 0o600)
                    docker.run(*helper_args(image, volume), stdout=stream)
                check_archive(archive)
                hashes[volume] = digest(archive)
            host_state = save_host(location)
            manifest = {'version': 3, 'inventory': current, 'helperImage': image,
                        'archives': hashes, 'hostState': host_state}
            target = location / 'manifest.json'
            with target.open('x') as stream:
                os.chmod(target, 0o600)
                json.dump(manifest, stream, indent=2)
        else:
            verify_host(location, expected['hostState'])
            restore_started = True
            for volume in current['volumes']:
                with (location / (volume + '.tar')).open('rb') as stream:
                    docker.run(*helper_args(image, volume, restore=True), stdin=stream, stdout=subprocess.PIPE)
            restore_host(location, expected['hostState'])
            restore_complete = True
    finally:
        # A partial restore stays stopped so inconsistent data cannot be served.
        if stopped and (not restore_started or restore_complete):
            docker.run('start', *ids, stdout=subprocess.PIPE)
    print(f'{action}: {name}; all owned persistent volumes processed; stack containers restarted')
    print('Mailpit transient inbox is cleared by container restart; applications remain stopped.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['save', 'restore'])
    parser.add_argument('name')
    args = parser.parse_args()
    try:
        checkpoint(args.action, args.name)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        # Docker stderr may contain runtime configuration; keep it private.
        parser.exit(1, f'Checkpoint refused or failed: {type(error).__name__}: {str(error) if not isinstance(error, subprocess.CalledProcessError) else "Docker operation failed"}\n')
