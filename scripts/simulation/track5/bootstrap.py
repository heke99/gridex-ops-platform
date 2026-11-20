#!/usr/bin/env python3
"""Check a T5 bootstrap observation contract; never provision or admit a runtime.

Usage: bootstrap.py --assignment /private/assignment.json --observations /private/observations.json
Both inputs must be canonical, owner-only regular files outside Git. The assignment
uses the existing gridex-simulation-runtime-assignment-v1 shell contract. Observations
use gridex-t5-bootstrap-observations-v1 (see the finite behavioral fixture for fields).

All observations and SHA256 receipt references are supplied by a qualified
producer and require independent review. This checks their structure/bindings, not their truth, receipt
contents, signatures, actual allocation, current host, live DNS/TLS or cleanup.
In particular a syntactically complete template can pass this SOURCE check but
cannot become ACTIVE/QUALIFIED through this program. Separate authenticated
custody, producer, live runtime admission and scenario verification remain required.
No input credentials are needed and no private values are printed.
"""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
import pathlib
import re
import stat
import subprocess

PORTS = tuple('SIM_' + name + '_PORT' for name in (
    'API', 'DB', 'SHADOW', 'POOLER', 'STUDIO', 'MAIL_HTTP', 'SMTP', 'APP',
    'COUNTERPART', 'RECEIVER_TLS', 'RECEIVER_CTRL'))
CLEANUP = {'processes', 'descendants', 'containers', 'volumes', 'networks',
           'receiver-routing', 'private-files'}
GIB = 2 ** 30


def require(value, reason):
    if not value:
        raise ValueError('bootstrap_' + reason)


def text(value):
    return isinstance(value, str) and bool(value.strip()) and not any(ord(c) < 32 for c in value)


def digest(value, length=64):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{' + str(length) + '}', value) is not None


def integer(value, minimum=0):
    return type(value) is int and value >= minimum


def absolute(value):
    return text(value) and value.startswith('/') and str(pathlib.PurePosixPath(value)) == value and '..' not in pathlib.PurePosixPath(value).parts


def timestamp(value):
    require(isinstance(value, str), 'time')
    try:
        result = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('bootstrap_time') from None
    require(result.tzinfo is not None, 'time')
    return result


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'duplicate_key')
        result[key] = value
    return result


def parse(raw):
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('bootstrap_nonfinite')))


def validate(assignment_bytes, observations, now=None):
    """Pure contract validation of supplied data, with injectable observation time."""
    now = now or dt.datetime.now(dt.timezone.utc)
    require(now.tzinfo is not None, 'time')
    a, o = parse(assignment_bytes), observations
    require(a['schema'] == 'gridex-simulation-runtime-assignment-v1' and a['worker'] == 'T5'
            and a['state'] == 'ACTIVE', 'assignment')
    require(o['schema'] == 'gridex-t5-bootstrap-observations-v1'
            and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{2,100}', a['environmentId'])
            and o['environmentId'] == a['environmentId'], 'environment')
    require(o['assignmentSha256'] == hashlib.sha256(assignment_bytes).hexdigest(), 'assignment_hash')
    expiry = timestamp(a['expiresAt'])
    require(now < timestamp(o['expiresAt']) <= expiry, 'expired')
    observed = timestamp(o['observedAt'])
    require(observed <= now and observed < timestamp(o['expiresAt']), 'observation_time')
    operations = a['allowedOperations']
    require(isinstance(operations, list) and set(operations) == {'up', 'run', 'down'}
            and len(operations) == 3, 'operations')
    require(absolute(a['runDir']) and absolute(a['simHome'])
            and a['simHome'] != '/' and a['runDir'] != '/'
            and not pathlib.PurePosixPath(a['runDir']).is_relative_to(a['simHome'])
            and not pathlib.PurePosixPath(a['simHome']).is_relative_to(a['runDir']), 'paths')
    require(isinstance(a['projectId'], str) and re.fullmatch(r'[a-z0-9][a-z0-9_-]{2,62}', a['projectId'])
            and a['projectId'] != 'gridex-ops-platform', 'project')
    ports = a['ports']
    require(isinstance(ports, dict) and set(ports) == set(PORTS)
            and all(integer(v, 1024) and v <= 65535 for v in ports.values())
            and len(set(ports.values())) == 11, 'ports')
    source = o['source']
    require(digest(a['sourceCommit'], 40) and source['appCommit'] == a['sourceCommit']
            and source['clean'] is True and digest(source['appTree'], 40) and digest(source['harnessSha256'])
            and digest(source['workflowSha256']), 'source')
    tools = o['tools']
    require(isinstance(tools['node'], str) and re.fullmatch(r'22\.[0-9]+\.[0-9]+', tools['node'])
            and tools['npm'] == '10.9.2' and tools['supabase'] == '2.101.0'
            and isinstance(tools['postgres'], str) and re.fullmatch(r'17\.[0-9]+(?:\.[0-9]+)?', tools['postgres'])
            and isinstance(tools['python'], str) and re.fullmatch(r'3\.[0-9]+\.[0-9]+', tools['python'])
            and int(tools['python'].split('.')[1]) >= 11, 'toolchain')
    # Harness hash is an opaque producer receipt reference, not a per-file custody proof.
    host = o['host']
    require(integer(host['effectiveRamBytes'], 8 * GIB), 'ram')
    require(integer(host['cpuCount'], 1) and (
        (integer(host['cpuQuota'], 1) and integer(host['cpuPeriod'], 1))
        or (host['cpuQuota'] == 'max' and integer(host['cpuPeriod'], 1))
        or (host['cpuQuota'] == 'unavailable' and host['cpuPeriod'] is None)), 'cpu')
    require(host['dockerDriver'] in ('vfs', 'overlay2', 'overlayfs'), 'docker_driver')
    require(absolute(host['dockerRootDir']) and host['dockerRootDir'] != '/'
            and integer(host['dockerFreeBytes'], (40 if host['dockerDriver'] == 'vfs' else 15) * GIB), 'docker_capacity')
    require(text(host['dockerDaemonId']) and integer(host['dockerSocketDevice'])
            and integer(host['dockerSocketInode'], 1), 'docker_identity')
    network, receiver = o['network'], a['receiver']
    require(isinstance(host['networkNamespace'], str) and re.fullmatch(r'net:\[[0-9]+\]', host['networkNamespace'])
            and network['networkNamespace'] == host['networkNamespace'], 'namespace')
    try:
        ip = ipaddress.ip_address(receiver['ip'])
    except ValueError:
        raise ValueError('bootstrap_receiver_ip') from None
    require(isinstance(ip, ipaddress.IPv4Address) and ip.is_global, 'receiver_ip')
    hosts = receiver['hosts']
    require(isinstance(hosts, list) and hosts and all(isinstance(h, str)
            and re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.t5\.sim\.invalid', h) for h in hosts)
            and len(set(hosts)) == len(hosts), 'receiver_hosts')
    require(isinstance(receiver['networkTag'], str)
            and re.fullmatch(r'gridex-sim-t5-[a-z0-9][a-z0-9_-]{2,60}', receiver['networkTag']), 'receiver_tag')
    require(network['receiver'] == {**receiver, 'tlsPort': ports['SIM_RECEIVER_TLS_PORT'],
                                   'controlPort': ports['SIM_RECEIVER_CTRL_PORT']}, 'receiver_binding')
    require(network['mode'] == 'PREPARED_EXTERNALLY' and text(network['preparer']), 'network_preparer')
    require(network['dnsAnswers'] == {h: [str(ip)] for h in hosts}, 'dns')
    require(network['tlsVerificationEnabled'] is True
            and isinstance(network['tlsVerifiedHosts'], list)
            and sorted(network['tlsVerifiedHosts']) == sorted(hosts), 'tls')
    require(network['externalDeliveryBlocked'] is True, 'route')
    require(all(digest(network[k]) for k in ('isolatedRouteSha256', 'dnsObservationSha256', 'tlsObservationSha256')), 'network_evidence')
    lifecycle = o['lifecycle']
    require(text(lifecycle['producer']) and text(lifecycle['inputEpoch'])
            and integer(lifecycle['remainingRuns'], 1), 'budget')
    require(text(lifecycle['cleanupOwner']) and isinstance(lifecycle['cleanupScopes'], list)
            and len(lifecycle['cleanupScopes']) == len(CLEANUP)
            and set(lifecycle['cleanupScopes']) == CLEANUP, 'cleanup')
    require(all(digest(lifecycle[k]) for k in ('backendIdentitySha256', 'replayReceiptSha256',
            'buildReceiptSha256', 'genReceiptSha256', 'ownershipReceiptSha256')), 'lifecycle_evidence')
    return {'state': 'CONTRACT_CHECKED_NOT_RUNTIME_ADMITTED', 'nativeQualified': False, 'wholeScenarioPASS': 0}


def read_private(value):
    path = pathlib.Path(value)
    require(path.is_absolute() and str(path.resolve()) == value, 'private_path')
    for flag in ('--is-inside-work-tree', '--is-inside-git-dir'):
        probe = subprocess.run(['git', '-C', str(path.parent), 'rev-parse', flag], capture_output=True, text=True, check=False)
        require(not (probe.returncode == 0 and probe.stdout.strip() == 'true'), 'input_inside_git')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 1024 * 1024, 'private_file')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            data = stream.read(1024 * 1024 + 1)
        require(len(data) <= 1024 * 1024, 'input_size')
        return data
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assignment', required=True)
    parser.add_argument('--observations', required=True)
    args = parser.parse_args()
    try:
        result = validate(read_private(args.assignment), parse(read_private(args.observations)))
    except (OSError, ValueError, KeyError, TypeError, AttributeError, subprocess.SubprocessError):
        print(json.dumps({'state': 'HOLD', 'error': 'bootstrap_contract_rejected', 'nativeQualified': False}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
