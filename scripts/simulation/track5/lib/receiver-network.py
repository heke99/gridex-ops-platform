#!/usr/bin/env python3
"""Scoped primitives for a PRECREATED disposable T5 network/mount/PID namespace.

--prepare, --verify or --cleanup requires --assignment and --grant, private0600
regular JSON files outside Git, owned by root (the runtime actor for this profile).
The grant schema/fields are illustrated by the finite behavioral test. Its exact
assignmentSha256, sourceCommit and transportSha256 bind the frozen clean app.
Both current and host net/mnt/pid namespace identities must be explicitly bound
and distinct; root mount propagation must already be private. Only loopback and
no default routes are accepted, so prepare/probe precede Docker bridge creation.

Prepare creates private TLS files and owns only one loopback address, two exact
OUTPUT rules and a read-only hosts bind. Verify requires the qualified producer
to start the actual owned webhook receiver first; it calls the ACTUAL frozen
postPublicWebhook export for ALL assigned hosts and reads actual receiver control
effects. Start/stop of that receiver, namespace creation/destruction, Docker and
backend admission belong to the outer producer. This does not emit ACTIVE or a
runtime qualification. Interrupted preparation is HOLD: destroy the outer owned
namespace; do not use broad rule flushes or arbitrary process cleanup.
CA, server certificate and server-key hashes remain in the private journal and
must stay unchanged for verification/cleanup. Disabled inherited Node TLS
verification is rejected; it is never silently carried into the product probe.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import shlex
import stat
import subprocess
import tempfile

PORTS = tuple('SIM_' + k + '_PORT' for k in ('API', 'DB', 'SHADOW', 'POOLER', 'STUDIO',
    'MAIL_HTTP', 'SMTP', 'APP', 'COUNTERPART', 'RECEIVER_TLS', 'RECEIVER_CTRL'))


def need(value, code):
    if not value:
        raise ValueError('receiver_' + code)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def unique(pairs):
    result = {}
    for k, v in pairs:
        need(k not in result, 'duplicate_json')
        result[k] = v
    return result


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique)


def future(value):
    stamp = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    return stamp.tzinfo is not None and stamp > dt.datetime.now(dt.timezone.utc)


def authorize(raw, grant, current, operation):
    a, g, c = parse(raw), grant, current
    need(g['schema'] == 'gridex-t5-receiver-network-grant-v1' and g['worker'] == 'T5'
         and g['state'] == 'GRANTED' and operation in g['allowedOperations']
         and future(g['expiresAt']) and isinstance(g['producer'], str) and g['producer'], 'grant')
    need(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T5'
         and a['state'] == 'ACTIVE' and g['assignmentSha256'] == sha(raw)
         and g['environmentId'] == a['environmentId'] and future(a['expiresAt']), 'assignment')
    need(c['uid'] == 0, 'uid')
    need(c.get('tlsRejectUnauthorized') != '0', 'tls_disabled')
    need(set(g['namespaces']) == set(g['hostNamespaces']) == {'net', 'mnt', 'pid'}
         and c['namespaces'] == g['namespaces']
         and all(re.fullmatch(k + r':\[[0-9]+\]', g['namespaces'][k])
                 and re.fullmatch(k + r':\[[0-9]+\]', g['hostNamespaces'][k])
                 and g['namespaces'][k] != g['hostNamespaces'][k] for k in g['namespaces']), 'namespace')
    need(c['interfaces'] == ['lo'], 'interfaces')
    need(not c['defaultRoutes'], 'routes')
    need(c['rootPropagation'] == 'private', 'propagation')
    need(re.fullmatch('[0-9a-f]{40}', a['sourceCommit']) and a['sourceCommit'] == g['sourceCommit'] == c['sourceCommit']
         and c['sourceClean'] is True and re.fullmatch('[0-9a-f]{64}', g['transportSha256'])
         and g['transportSha256'] == c['transportSha256'], 'source')
    p = a['ports']
    need(set(p) == set(PORTS) and all(type(v) is int and 1024 <= v <= 65535 for v in p.values())
         and len(set(p.values())) == 11, 'ports')
    if operation == 'prepare':
        need(not set(p.values()).intersection(c['busyPorts']), 'port_busy')
    r = a['receiver']
    ip = ipaddress.ip_address(r['ip'])
    need(isinstance(ip, ipaddress.IPv4Address) and ip.is_global
         and isinstance(r['hosts'], list) and r['hosts'] and len(set(r['hosts'])) == len(r['hosts'])
         and all(isinstance(h, str) and re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.t5\.sim\.invalid', h) for h in r['hosts'])
         and re.fullmatch(r'gridex-sim-t5-[a-z0-9][a-z0-9_-]{2,60}', r['networkTag']), 'receiver')
    for name in ('runDir', 'simHome'):
        path = pathlib.Path(a[name])
        need(path.is_absolute() and str(path.resolve()) == str(path) and str(path) != '/', 'paths')
    need(not pathlib.Path(a['simHome']).is_relative_to(a['runDir'])
         and not pathlib.Path(a['runDir']).is_relative_to(a['simHome']), 'paths')
    return a


def network_commands(a):
    r, p = a['receiver'], a['ports']
    comment = ['-m', 'comment', '--comment', r['networkTag']]
    return [
        ['ip', 'address', 'add', r['ip'] + '/32', 'dev', 'lo'],
        ['iptables', '-w', '-t', 'nat', '-A', 'OUTPUT', '-d', r['ip'] + '/32', '-p', 'tcp',
         '--dport', '443', *comment, '-j', 'DNAT', '--to-destination', '127.0.0.1:' + str(p['SIM_RECEIVER_TLS_PORT'])],
        ['iptables', '-w', '-t', 'filter', '-A', 'OUTPUT', '-d', r['ip'] + '/32', *comment, '-j', 'REJECT'],
    ]


def hosts_bytes(original, a):
    existing = [line.split('#', 1)[0].split()[1:] for line in original.decode().splitlines()]
    need(not any(set(names).intersection(a['receiver']['hosts']) for names in existing), 'hosts_collision')
    return original.rstrip(b'\n') + ('\n' + a['receiver']['ip'] + ' ' + ' '.join(a['receiver']['hosts'])
                                   + ' # ' + a['receiver']['networkTag'] + '\n').encode()


class Commands:
    def __call__(self, argv, **kwargs):
        return subprocess.run(argv, check=True, text=True, capture_output=True, timeout=60, **kwargs).stdout


def outside_git(path, command):
    for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
        probe = subprocess.run(['git', '-C', str(path), 'rev-parse', flag], capture_output=True, text=True, check=False)
        need(not (probe.returncode == 0 and probe.stdout.strip() == 'true'), 'private_inside_git')


def private_file(path):
    path = pathlib.Path(path)
    need(path.is_absolute() and str(path.resolve()) == str(path), 'private_path')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
             and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 1024 * 1024, 'private_file')
        data = os.read(fd, 1024 * 1024 + 1)
        need(len(data) <= 1024 * 1024, 'private_file')
        return data
    finally:
        os.close(fd)


def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)


def observe(a, command):
    routes = [*parse(command(['ip', '-j', '-4', 'route', 'show', 'table', 'all'])),
              *parse(command(['ip', '-j', '-6', 'route', 'show', 'table', 'all']))]
    listeners = command(['ss', '-H', '-ltn']).splitlines()
    return {'uid': os.getuid(), 'namespaces': {k: os.readlink('/proc/self/ns/' + k) for k in ('net', 'mnt', 'pid')},
        'interfaces': sorted(x['ifname'] for x in parse(command(['ip', '-j', 'link', 'show']))),
        'defaultRoutes': [x for x in routes if x.get('dst') == 'default'],
        'rootPropagation': command(['findmnt', '-n', '-o', 'PROPAGATION', '/']).strip(),
        'sourceCommit': command(['git', '-C', a['runDir'], 'rev-parse', 'HEAD']).strip(),
        'sourceClean': not command(['git', '-C', a['runDir'], 'status', '--porcelain', '--untracked-files=normal']).strip(),
        'tlsRejectUnauthorized': os.environ.get('NODE_TLS_REJECT_UNAUTHORIZED'),
        'transportSha256': sha((pathlib.Path(a['runDir']) / 'lib/integrations/publicWebhookTransport.ts').read_bytes()),
        'busyPorts': [int(m.group(1)) for line in listeners if (m := re.search(r':([0-9]+)\s', line))]}


def tls_files(directory, a, command):
    """Fresh TLS material or full existing trio verified, never ca.pem-only reuse."""
    trio = [directory / name for name in ('ca.pem', 'server.pem', 'server.key')]
    exists = [p.exists() or p.is_symlink() for p in trio]
    need(not any(exists) or all(exists), 'tls_partial')
    if not any(exists):
        need(not (directory / 'ca.key').exists(), 'tls_partial')
        with tempfile.TemporaryDirectory(prefix='.tls-', dir=directory) as name:
            tmp = pathlib.Path(name)
            command(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-nodes', '-days', '7',
                     '-subj', '/CN=gridex-sim-t5-ca', '-keyout', str(tmp / 'ca.key'), '-out', str(tmp / 'ca.pem')])
            command(['openssl', 'req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=' + a['receiver']['hosts'][0],
                     '-keyout', str(tmp / 'server.key'), '-out', str(tmp / 'server.csr')])
            write_new(tmp / 'san.ext', ('subjectAltName=' + ','.join('DNS:' + h for h in a['receiver']['hosts']) + '\n').encode())
            command(['openssl', 'x509', '-req', '-sha256', '-in', str(tmp / 'server.csr'), '-CA', str(tmp / 'ca.pem'),
                     '-CAkey', str(tmp / 'ca.key'), '-CAcreateserial', '-days', '7', '-extfile', str(tmp / 'san.ext'), '-out', str(tmp / 'server.pem')])
            for filename in ('ca.key', 'ca.pem', 'server.key', 'server.pem'):
                os.chmod(tmp / filename, 0o600)
                os.link(tmp / filename, directory / filename, follow_symlinks=False)
    for path in trio:
        private_file(path)
    seconds = max(1, int((dt.datetime.fromisoformat(a['expiresAt'].replace('Z', '+00:00')) - dt.datetime.now(dt.timezone.utc)).total_seconds()))
    for cert in trio[:2]:
        command(['openssl', 'x509', '-in', str(cert), '-noout', '-checkend', str(seconds)])
    for host in a['receiver']['hosts']:
        command(['openssl', 'verify', '-CAfile', str(trio[0]), '-verify_hostname', host, str(trio[1])])
    need(command(['openssl', 'pkey', '-in', str(trio[2]), '-pubout']).strip()
         == command(['openssl', 'x509', '-in', str(trio[1]), '-pubkey', '-noout']).strip(), 'tls_key_match')


def tls_fingerprints(directory):
    """Private fingerprints only: never print or publish the server-key digest."""
    return {name: sha(private_file(directory / name)) for name in ('ca.pem', 'server.pem', 'server.key')}


def require_tls_fingerprints(directory, recorded):
    need(isinstance(recorded, dict) and tls_fingerprints(directory) == recorded, 'tls_fingerprint_changed')


PROBE = r"""
import {lookup} from 'node:dns/promises';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const a=JSON.parse(process.argv[1]), transport=await import(pathToFileURL(process.argv[2]).href);
const name='__qualification_'+randomUUID(),body=JSON.stringify({probe:name}),hash=createHash('sha256').update(body).digest('hex');
for(const host of a.receiver.hosts){
 const addresses=await lookup(host,{all:true,verbatim:true});
 if(!addresses.length||addresses.some(x=>x.address!==a.receiver.ip||x.family!==4))throw Error('probe_dns');
 const r=await transport.postPublicWebhook({url:`https://${host}/hook/${name}`,headers:new Headers({'content-type':'application/json'}),body,signal:AbortSignal.timeout(5000)});
 if(r.status!==200||!r.ok)throw Error('probe_transport');
}
const control=await fetch(`http://127.0.0.1:${a.ports.SIM_RECEIVER_CTRL_PORT}/__requests?name=${name}`,{signal:AbortSignal.timeout(5000)});
if(!control.ok)throw Error('probe_control');
const rows=await control.json();
if(!Array.isArray(rows)||rows.length!==a.receiver.hosts.length||a.receiver.hosts.some(host=>rows.filter(r=>r.host===host&&r.method==='POST'&&r.path===`/hook/${name}`&&r.sha256===hash&&r.bodyBase64===Buffer.from(body).toString('base64')).length!==1))throw Error('probe_effect');
console.log(JSON.stringify({hostsVerified:a.receiver.hosts.length,actualProductTransport:true}));
"""


def rules_present(a, command):
    for rule in network_commands(a)[1:]:
        table = rule[rule.index('-t') + 1]
        listing = command(['iptables', '-w', '-t', table, '-S', 'OUTPUT'])
        tagged = [shlex.split(line) for line in listing.splitlines() if a['receiver']['networkTag'] in shlex.split(line)]
        need(len(tagged) == 1, 'rule_ownership')
        check = rule.copy()
        check[check.index('-A')] = '-C'
        command(check)


def probe(a, command, directory):
    need(os.environ.get('NODE_TLS_REJECT_UNAUTHORIZED') != '0', 'tls_disabled')
    transport = str(pathlib.Path(a['runDir']) / 'lib/integrations/publicWebhookTransport.ts')
    need(re.fullmatch(r'v22\.[0-9]+\.[0-9]+', command(['node', '--version']).strip()), 'node_version')
    environment = {**os.environ, 'NODE_EXTRA_CA_CERTS': str(directory / 'ca.pem')}
    result = parse(command(['node', '--experimental-strip-types', '--input-type=module', '-e', PROBE, json.dumps(a), transport], env=environment))
    need(result == {'hostsVerified': len(a['receiver']['hosts']), 'actualProductTransport': True}, 'probe')


def cleanup_commands(a):
    commands = [['umount', '/etc/hosts']]
    for argv in reversed(network_commands(a)[1:]):
        delete = argv.copy()
        delete[delete.index('-A')] = '-D'
        commands.append(delete)
    commands.append(['ip', 'address', 'delete', a['receiver']['ip'] + '/32', 'dev', 'lo'])
    return commands


def execute(a, grant, command, operation):
    home = pathlib.Path(a['simHome'])
    outside_git(home.parent, command)
    if not home.exists():
        home.mkdir(mode=0o700)
    need(home.stat().st_uid == os.getuid() and stat.S_IMODE(home.stat().st_mode) == 0o700, 'home')
    directory = home / 'receiver'
    if not directory.exists():
        directory.mkdir(mode=0o700)
    need(not directory.is_symlink() and directory.stat().st_uid == os.getuid()
         and stat.S_IMODE(directory.stat().st_mode) == 0o700, 'directory')
    journal = home / 'receiver-network.private.json'
    binding = {'assignmentSha256': grant['assignmentSha256'], 'namespaces': grant['namespaces'],
               'grantSha256': sha(json.dumps(grant, sort_keys=True, separators=(',', ':')).encode()),
               'transportSha256': grant['transportSha256']}
    hosts = directory / 'hosts.private'
    if operation == 'prepare':
        need(not journal.exists(), 'journal_exists')
        for table in ('nat', 'filter'):
            need(a['receiver']['networkTag'] not in command(['iptables', '-w', '-t', table, '-S']), 'rule_collision')
        # O_EXCL journal is retained even after a partial failure; no blind retries.
        write_new(journal, json.dumps({'state': 'PREPARE_STARTED', **binding}).encode())
        tls_files(directory, a, command)
        binding['tlsSha256'] = tls_fingerprints(directory)
        write_new(hosts, hosts_bytes(pathlib.Path('/etc/hosts').read_bytes(), a))
        for argv in network_commands(a):
            command(argv)
        command(['mount', '--bind', str(hosts), '/etc/hosts'])
        command(['mount', '-o', 'remount,bind,ro', '/etc/hosts'])
        binding['hostsSha256'] = sha(private_file(hosts))
        state = 'NETWORK_PREPARED_NOT_RUNTIME_ADMITTED'
    else:
        record = parse(private_file(journal))
        need(all(record[k] == v for k, v in binding.items())
             and record['state'] in ('NETWORK_PREPARED_NOT_RUNTIME_ADMITTED', 'NETWORK_PROBED_NOT_RUNTIME_ADMITTED'), 'journal_binding')
        need(record['hostsSha256'] == sha(private_file(hosts)), 'hosts_bytes_changed')
        binding['hostsSha256'] = record['hostsSha256']
        require_tls_fingerprints(directory, record['tlsSha256'])
        binding['tlsSha256'] = record['tlsSha256']
        need(os.stat('/etc/hosts').st_ino == hosts.stat().st_ino
             and os.stat('/etc/hosts').st_dev == hosts.stat().st_dev, 'hosts_mount_identity')
        rules_present(a, command)
        if operation == 'verify':
            tls_files(directory, a, command)
            probe(a, command, directory)
            require_tls_fingerprints(directory, binding['tlsSha256'])
            state = 'NETWORK_PROBED_NOT_RUNTIME_ADMITTED'
        else:
            for argv in cleanup_commands(a):
                command(argv)
            # Private TLS/evidence deletion is deliberately the outer owner's job.
            state = 'NETWORK_RULES_REMOVED_PRIVATE_ARTIFACTS_RETAINED'
    # Existing owned journal only; O_NOFOLLOW never follows a replacement symlink.
    require_tls_fingerprints(directory, binding['tlsSha256'])
    private_file(journal)
    fd = os.open(journal, os.O_WRONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'w') as stream:
        json.dump({'state': state, **binding}, stream)
        stream.truncate()
    return {'state': state, 'nativeQualified': False, 'wholeScenarioPASS': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    for name in ('prepare', 'verify', 'cleanup'):
        mode.add_argument('--' + name, action='store_true')
    parser.add_argument('--assignment', required=True)
    parser.add_argument('--grant', required=True)
    args = parser.parse_args()
    command = Commands()
    lock = None
    try:
        for path in (args.assignment, args.grant):
            outside_git(pathlib.Path(path).parent, command)
        raw, grant = private_file(args.assignment), parse(private_file(args.grant))
        a = parse(raw)
        operation = next(k for k in ('prepare', 'verify', 'cleanup') if getattr(args, k))
        authorize(raw, grant, observe(a, command), operation)
        home = pathlib.Path(a['simHome'])
        outside_git(home.parent, command)
        if not home.exists():
            home.mkdir(mode=0o700)
        need(home.stat().st_uid == os.getuid() and stat.S_IMODE(home.stat().st_mode) == 0o700, 'home')
        lock = os.open(home / 'receiver-network.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        info = os.fstat(lock)
        need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600, 'lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        authorize(raw, grant, observe(a, command), operation)
        result = execute(a, grant, command, operation)
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError):
        print(json.dumps({'state': 'HOLD', 'error': 'receiver_network_rejected', 'nativeQualified': False}))
        return 1
    finally:
        if lock is not None:
            os.close(lock)
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
