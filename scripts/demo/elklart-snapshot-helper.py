#!/usr/bin/env python3
"""Prepare/build a local scratch GNU tar helper from checksum-recorded host binaries.

No downloads or package installs. Root runtime owner explicitly runs prepare/build;
all generated context, provenance and build logs remain in the private runtime.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import uuid

ROOT = Path('/workspace/elklart-runtime')
CONTEXT = ROOT / 'snapshot-helper-build'
TAG = 'elklart-snapshot-helper:gnu-tar-v1'
LABELS = {'io.elklart.snapshot-helper': 'gnu-tar-v1',
          'io.elklart.snapshot-helper.owner': 'elklart-demo',
          'io.elklart.snapshot-helper.source': 'host-local-binaries'}
BINARIES = ('/bin/sh', '/usr/bin/tar', '/usr/bin/find', '/usr/bin/rm')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def checked(path, exists=True):
    for item in [path, *path.parents]:
        require(not item.is_symlink(), 'Symlink in private build path')
    if exists:
        info = path.stat()
        require(info.st_uid == os.getuid() and not (stat.S_IMODE(info.st_mode) & 0o077), 'Private owned build path required')
    return path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    checked(ROOT)
    require(not CONTEXT.exists(), 'Build context already exists; preserve provenance, use build directly')
    CONTEXT.mkdir(mode=0o700)
    sources = set(BINARIES)
    for binary in BINARIES:
        result = subprocess.run(['ldd', binary], check=True, capture_output=True, text=True)
        for dependency in re.findall(r'(?<!\S)(/[^\s()]+)', result.stdout):
            require(dependency.startswith(('/lib/', '/lib64/', '/usr/lib/')), 'Unexpected dependency path')
            sources.add(dependency)
    files = {}
    rootfs = CONTEXT / 'rootfs'
    rootfs.mkdir(mode=0o700)
    for source in sorted(sources):
        origin = Path(source)
        require(origin.is_file() and origin.resolve().stat().st_uid in (0, 65534), 'Host binary/dependency must have system/mapped-system owner')
        require(not origin.resolve().stat().st_mode & 0o022, 'Writable host binary refused')
        target = rootfs / source.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copyfile(origin, target)
        target.chmod(0o700 if origin.stat().st_mode & 0o111 else 0o600)
        files[source] = {'resolvedSource': str(origin.resolve()), 'sha256': digest(origin), 'bytes': origin.stat().st_size, 'sourceUid': origin.resolve().stat().st_uid}
    for directory in ('tmp', 'data'):
        (rootfs / directory).mkdir(mode=0o700)
    provenance = CONTEXT / 'provenance.json'
    provenance.write_text(json.dumps({'version': 1, 'tag': TAG, 'files': files}, sort_keys=True, indent=2))
    provenance.chmod(0o600)
    labels = {**LABELS, 'io.elklart.snapshot-helper.provenance': digest(provenance)}
    dockerfile = CONTEXT / 'Dockerfile'
    dockerfile.write_text('FROM scratch\nCOPY rootfs/ /\nENV PATH=/usr/bin:/bin\n' + ''.join(f'LABEL {name}="{value}"\n' for name, value in labels.items()) + 'ENTRYPOINT ["/bin/sh"]\n')
    dockerfile.chmod(0o600)
    # Ensure every generated directory stays private, including intermediate parents.
    for directory, directories, _ in os.walk(CONTEXT):
        Path(directory).chmod(0o700)
    return provenance


def build_environment(source):
    for name, value in source.items():
        if name == 'DOCKER_HOST':
            require(value == 'unix:///var/run/docker.sock', 'Foreign Docker endpoint refused')
        elif name.startswith(('DOCKER_', 'BUILDX_', 'BUILDKIT_')):
            require(False, 'Docker/builder environment overrides refused')
    return {'PATH': '/usr/local/bin:/usr/bin:/bin',
            'DOCKER_HOST': 'unix:///var/run/docker.sock',
            'BUILDX_CONFIG': str(CONTEXT / 'buildx')}


def build():
    environment = build_environment(os.environ)
    checked(CONTEXT)
    provenance = checked(CONTEXT / 'provenance.json')
    metadata = json.loads(provenance.read_text())
    require(metadata['tag'] == TAG, 'Unexpected helper tag')
    for source, entry in metadata['files'].items():
        require(source.startswith('/') and '..' not in Path(source).parts, 'Unsafe provenance path')
        require(digest(checked(CONTEXT / 'rootfs' / source.lstrip('/'))) == entry['sha256'], 'Helper context checksum mismatch')
    checked(CONTEXT / 'Dockerfile')
    buildx = CONTEXT / 'buildx'
    checked(buildx, exists=False)
    buildx.mkdir(mode=0o700, exist_ok=True)
    checked(buildx)
    docker_config = CONTEXT / 'docker-config'
    checked(docker_config, exists=False)
    docker_config.mkdir(mode=0o700, exist_ok=True)
    checked(docker_config)
    with (CONTEXT / ('build-' + uuid.uuid4().hex + '.log')).open('xb') as output:
        os.chmod(output.name, 0o600)
        subprocess.run(['/usr/local/bin/docker', '--config', str(docker_config), '--host', environment['DOCKER_HOST'], 'build', '--builder', 'default', '--network=none', '--pull=false', '-t', TAG, str(CONTEXT)], env=environment, check=True, stdout=output, stderr=subprocess.STDOUT)
    print('Local scratch helper built; perform capability and xattr/ACL qualification before snapshot.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'build'))
    arguments = parser.parse_args()
    try:
        if arguments.action == 'prepare':
            prepare()
            print('Private local-only helper context prepared. Next: run this script with build.')
        else:
            build()
    except (ValueError, OSError, subprocess.CalledProcessError):
        parser.exit(1, 'Helper operation failed; inspect private build context/log. No downloads performed.\n')
