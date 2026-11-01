#!/usr/bin/env python3
"""Owned GreenMail TLS service; never grants app mailbox or scenario acceptance.

Call `start` only after qualify-runtime authorize(up), inside its owned cgroup.
Signed assignment pilotMailbox: {image: IMAGE, containerName: projectId +
'-pilot-mailbox', ports: {smtps: int, imaps: int}, mailboxAddress: local@t2.sim.invalid}.
Extra ports must differ from all nine runtime ports. Resources use the existing
exact Docker inventory/cleanup; this module never removes a container.

Private SIM_HOME/pilot-mailbox/descriptor.json: schema
gridex-t2-pilot-mailbox-service-v1, state SERVICE_READY, assignmentSha256,
sourceCommit, environmentId, smtp/imap {host,port,secure,user,password},
mailboxAddress, tlsCaPath, nodeExtraCaPath, resourceReceiptSha256.
Consumers must validate bindings and receipt before use; readiness proves only
TLS/auth to the synthetic service, not app catalog/actor permission or acceptance.

GreenMail 2.1.3 documented properties: greenmail.{smtps,imaps}.{hostname,port},
greenmail.users/login, greenmail.tls.keystore.file/password; PKCS12 supported.
Reference https://greenmail-mail-test.github.io/greenmail/ (properties table).
No auth-disabled, trust-all, plaintext listener or management API is configured.
"""
import argparse
import hashlib
import imaplib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import smtplib
import socket
import ssl
import stat
import subprocess
import time

IMAGE = 'greenmail/standalone@sha256:beb3cfe6ec697592164a60515d7bd9164f3f29170b02e83e8defabdfe3da2c1d'
LABEL = 'com.supabase.cli.project'


def require(ok, code):
    if not ok:
        raise ValueError(code)


def helper_module():
    spec = importlib.util.spec_from_file_location('t2_qualification', Path(__file__).with_name('qualify-runtime.py'))
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    return helper


def run(argv, *, stdin=None):
    # Captured errors are never copied into a receipt, exception or console.
    try:
        return subprocess.run(argv, input=stdin, capture_output=True, text=True,
                              check=True, timeout=120).stdout.strip()
    except (subprocess.SubprocessError, OSError):
        raise ValueError('mailbox-command-failed') from None


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def private_dir(path):
    s = path.lstat()
    require(not path.is_symlink() and path.is_dir() and s.st_uid == os.getuid()
            and stat.S_IMODE(s.st_mode) == 0o700, 'mailbox-private-directory-required')


def private_file(path):
    s = path.lstat()
    require(not path.is_symlink() and path.is_file() and s.st_uid == os.getuid()
            and stat.S_IMODE(s.st_mode) == 0o600, 'mailbox-private-file-required')
    return path


def write(path, data):
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(data)


def record(path, data):
    write(path, json.dumps(data, sort_keys=True) + '\n')


def load(path):
    return json.loads(private_file(path).read_text())


def admission(helper):
    a, home, app = helper.authenticate('up')
    helper.validate_attempt(a, home)
    group = helper.owned_cgroup(a, home)
    require(helper.read_text('/proc/self/cgroup').splitlines() == ['0::/' + group.name],
            'mailbox-outside-owned-cgroup')
    assignment_hash = helper.digest(os.environ['SIM_RUNTIME_ASSIGNMENT_FILE'])
    require(helper.load_private(home / 'up-consumed.json')['assignment'] == assignment_hash,
            'mailbox-up-admission-required')
    require(os.getuid() != 0, 'mailbox-nonroot-owner-required')
    relative = 'scripts/simulation/track2/hosted/imap-mailbox.py'
    require(a['sourceFiles'].get(relative) == sha(Path(__file__)), 'mailbox-source-unbound')
    private_dir(home)
    cfg = a['pilotMailbox']
    require(cfg['image'] == IMAGE and cfg['containerName'] == a['projectId'] + '-pilot-mailbox'
            and re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', a['projectId']) is not None,
            'mailbox-resource-assignment-invalid')
    require(set(cfg['ports']) == {'smtps', 'imaps'} and all(type(p) is int and 1024 <= p <= 65535
            for p in cfg['ports'].values()) and len(set(cfg['ports'].values())) == 2
            and not set(cfg['ports'].values()).intersection(a['ports'].values()), 'mailbox-ports-invalid')
    require(re.fullmatch(r'[a-z0-9][a-z0-9.-]{0,63}@t2\.sim\.invalid', cfg['mailboxAddress']) is not None,
            'mailbox-synthetic-address-required')
    return a, home, app, assignment_hash


def certificates(directory, password):
    """Real OpenSSL private CA and SAN leaf; secrets use files/stdin, never argv."""
    write(directory / 'keystore.password', password + '\n')
    write(directory / 'leaf.ext', 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n')
    # Precreate every output at 0600; OpenSSL truncates only these owned files.
    for name in ('ca.key', 'ca.pem', 'server.key', 'server.csr', 'server.pem', 'server.p12'):
        write(directory / name, '')
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
         '-subj', '/CN=T2 synthetic mailbox CA', '-addext', 'basicConstraints=critical,CA:TRUE',
         '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', str(directory / 'ca.key'),
         '-out', str(directory / 'ca.pem')])
    run(['openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=localhost',
         '-keyout', str(directory / 'server.key'), '-out', str(directory / 'server.csr')])
    run(['openssl', 'x509', '-req', '-in', str(directory / 'server.csr'), '-CA', str(directory / 'ca.pem'),
         '-CAkey', str(directory / 'ca.key'), '-set_serial', str(secrets.randbits(128)), '-days', '2',
         '-extfile', str(directory / 'leaf.ext'), '-out', str(directory / 'server.pem')])
    run(['openssl', 'pkcs12', '-export', '-name', 'greenmail', '-inkey', str(directory / 'server.key'),
         '-in', str(directory / 'server.pem'), '-certfile', str(directory / 'ca.pem'),
         '-out', str(directory / 'server.p12'), '-passout', 'file:' + str(directory / 'keystore.password')])
    run(['openssl', 'verify', '-CAfile', str(directory / 'ca.pem'), '-verify_ip', '127.0.0.1', str(directory / 'server.pem')])
    for path in directory.iterdir():
        private_file(path)


def merge_ca(directory, previous):
    prefix = b''
    if previous:
        original = Path(previous)
        require(original.is_absolute() and original.is_file() and not original.is_symlink(), 'mailbox-prior-node-ca-invalid')
        prefix = original.read_bytes()
        require(bool(prefix), 'mailbox-prior-node-ca-empty')
    path = directory / 'node-extra-ca.pem'
    write(path, (prefix + b'\n' + (directory / 'ca.pem').read_bytes()).decode('ascii'))
    # Parse the entire merged trust store; invalid prior trust is not discarded.
    ssl.create_default_context(cafile=str(path))
    return path


def validate_container(data, cfg, project, image_id, mount):
    require(re.fullmatch('[0-9a-f]{64}', data.get('Id', '')) is not None
            and data.get('Name') == '/' + cfg['containerName']
            and data.get('Created') and data.get('Image') == image_id
            and data.get('Config', {}).get('Image') == IMAGE
            and data['Config'].get('Labels', {}).get(LABEL) == project, 'mailbox-container-identity-invalid')
    expected = {str(internal) + '/tcp': [{'HostIp': '127.0.0.1', 'HostPort': str(cfg['ports'][key])}]
                for key, internal in (('smtps', 3465), ('imaps', 3993))}
    require(data.get('HostConfig', {}).get('PortBindings') == expected, 'mailbox-container-bindings-invalid')
    require(data['HostConfig'].get('NetworkMode') == 'bridge', 'mailbox-container-network-invalid')
    if data.get('State', {}).get('Running') is True:
        require({k: v for k, v in data.get('NetworkSettings', {}).get('Ports', {}).items() if v} == expected,
                'mailbox-live-bindings-invalid')
    mounts = data.get('Mounts', [])
    require(len(mounts) == 1 and mounts[0].get('Type') == 'bind' and mounts[0].get('Source') == str(mount)
            and mounts[0].get('Destination') == '/t2/server.p12' and mounts[0].get('RW') is False,
            'mailbox-container-mount-invalid')
    return {'kind': 'container', 'id': data['Id'], 'name': data['Name'], 'created': data['Created'],
            'project': project, 'image': IMAGE, 'imageId': image_id, 'portBindings': expected,
            'keystoreSHA256': sha(mount)}


def tls_auth(cfg, password, ca):
    context = ssl.create_default_context(cafile=str(ca))
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    with smtplib.SMTP_SSL('127.0.0.1', cfg['ports']['smtps'], context=context, timeout=5) as smtp:
        smtp.login(cfg['mailboxAddress'], password)
    with imaplib.IMAP4_SSL('127.0.0.1', cfg['ports']['imaps'], ssl_context=context, timeout=5) as imap:
        require(imap.login(cfg['mailboxAddress'], password)[0] == 'OK', 'mailbox-imap-auth-failed')


def start(helper=None):
    helper = helper or helper_module()
    a, home, app, assignment_hash = admission(helper)
    cfg = a['pilotMailbox']
    helper.daemon_identity(capacity=True)  # before certificates, image pull or create
    resources = helper.docker_resources(a['projectId'])
    require(not any(r['kind'] == 'container' and r['name'] == '/' + cfg['containerName'] for r in resources),
            'mailbox-existing-resource')
    # Finite check on the two additional signed ports. No server is started here.
    listeners = []
    try:
        for port in cfg['ports'].values():
            listener = socket.socket()
            listeners.append(listener)
            listener.bind(('127.0.0.1', port))
    finally:
        for listener in listeners:
            listener.close()
    directory = home / 'pilot-mailbox'
    directory.mkdir(mode=0o700)  # no reuse or overwrite of an ambiguous attempt
    private_dir(directory)
    password, keystore_password = secrets.token_hex(24), secrets.token_hex(24)
    record(directory / 'intent.json', {'assignmentSha256': assignment_hash, 'sourceCommit': a['sourceCommit'],
           'environmentId': a['environmentId'], 'project': a['projectId'], 'image': IMAGE,
           'containerName': cfg['containerName'], 'ports': cfg['ports']})
    certificates(directory, keystore_password)
    bundle = merge_ca(directory, os.environ.get('NODE_EXTRA_CA_CERTS'))
    options = ' '.join(['-Dgreenmail.smtps.hostname=0.0.0.0', '-Dgreenmail.smtps.port=3465',
                       '-Dgreenmail.imaps.hostname=0.0.0.0', '-Dgreenmail.imaps.port=3993',
                       '-Dgreenmail.users.login=email', '-Dgreenmail.users=' + cfg['mailboxAddress'].split('@')[0] + ':' + password + '@t2.sim.invalid',
                       '-Dgreenmail.tls.keystore.file=/t2/server.p12', '-Dgreenmail.tls.keystore.password=' + keystore_password])
    write(directory / 'container.env', 'GREENMAIL_OPTS=' + options + '\n')
    run(['docker', 'pull', '--platform', 'linux/amd64', IMAGE])
    image = json.loads(run(['docker', 'image', 'inspect', IMAGE]))[0]
    require(IMAGE in image.get('RepoDigests', []) and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64'
            and re.fullmatch('sha256:[0-9a-f]{64}', image.get('Id', '')), 'mailbox-image-identity-invalid')
    # cidfile remains private even if the create response is lost. Outer existing
    # project inventory records partial creates; no blind retry or auto-delete.
    run(['docker', 'create', '--pull=never', '--platform', 'linux/amd64', '--name', cfg['containerName'],
         '--label', LABEL + '=' + a['projectId'], '--network', 'bridge', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
         '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--user', f'{os.getuid()}:{os.getgid()}',
         '--cidfile', str(directory / 'container.id'), '--env-file', str(directory / 'container.env'),
         '--mount', 'type=bind,src=' + str(directory / 'server.p12') + ',dst=/t2/server.p12,readonly',
         '-p', f"127.0.0.1:{cfg['ports']['smtps']}:3465", '-p', f"127.0.0.1:{cfg['ports']['imaps']}:3993", IMAGE])
    # Docker creates cidfile according to process umask; caller must not expose it.
    os.chmod(directory / 'container.id', 0o600)
    container_id = private_file(directory / 'container.id').read_text().strip()
    require(re.fullmatch('[0-9a-f]{64}', container_id), 'mailbox-container-id-invalid')
    data = json.loads(run(['docker', 'inspect', container_id]))[0]
    receipt = validate_container(data, cfg, a['projectId'], image['Id'], directory / 'server.p12')
    require(receipt['id'] == container_id, 'mailbox-container-id-mismatch')
    identity = dict(receipt)
    receipt.update(assignmentSha256=assignment_hash, sourceCommit=a['sourceCommit'], environmentId=a['environmentId'],
                   caSHA256=sha(directory / 'ca.pem'), nodeExtraCaSHA256=sha(bundle), user=cfg['mailboxAddress'])
    record(directory / 'resource.json', receipt)  # exact ID/birth before start
    helper.inventory(a, home)
    run(['docker', 'start', container_id])
    ready = False
    for _ in range(30):
        try:
            tls_auth(cfg, password, directory / 'ca.pem')
            ready = True
            break
        except (OSError, ssl.SSLError, smtplib.SMTPException, imaplib.IMAP4.error):
            time.sleep(1)
    require(ready, 'mailbox-tls-auth-not-ready')
    current = json.loads(run(['docker', 'inspect', container_id]))[0]
    require(validate_container(current, cfg, a['projectId'], image['Id'], directory / 'server.p12') == identity
            and current.get('State', {}).get('Running') is True, 'mailbox-not-running')
    fresh, fresh_home, _, fresh_hash = admission(helper)
    require(fresh == a and fresh_home == home and fresh_hash == assignment_hash,
            'mailbox-admission-changed-before-ready')
    descriptor = {'schema': 'gridex-t2-pilot-mailbox-service-v1', 'state': 'SERVICE_READY',
                  'assignmentSha256': assignment_hash, 'sourceCommit': a['sourceCommit'], 'environmentId': a['environmentId'],
                  'mailboxAddress': cfg['mailboxAddress'], 'tlsCaPath': str(directory / 'ca.pem'), 'nodeExtraCaPath': str(bundle),
                  'resourceReceiptSha256': sha(directory / 'resource.json')}
    for protocol, key in (('smtp', 'smtps'), ('imap', 'imaps')):
        descriptor[protocol] = {'host': '127.0.0.1', 'port': cfg['ports'][key], 'secure': True,
                                'user': cfg['mailboxAddress'], 'password': password}
    record(directory / 'descriptor.json', descriptor)
    helper.inventory(a, home)
    return directory / 'descriptor.json'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('operation', choices=['start'])
    parser.parse_args()
    try:
        start()
        print(json.dumps({'state': 'SERVICE_READY', 'scope': 'SYNTHETIC_TLS_SERVICE_ONLY'}))
    except Exception:
        # No exception details, subprocess output, assignment or credentials.
        print(json.dumps({'state': 'HOLD', 'errors': ['mailbox-start-not-qualified']}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
