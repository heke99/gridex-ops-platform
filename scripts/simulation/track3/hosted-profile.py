"""Explicit hosted bootstrap, not a prepared runtime or native acceptance receipt.

No default allocation. Runtime execution needs a separately authorized private
profile, full producer/backend receipts and a fresh atomic event budget.
"""
import argparse
import base64
import shutil
import time
from datetime import datetime, timedelta, timezone
import fcntl
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile
from types import SimpleNamespace
import urllib.error
import urllib.request
from uuid import UUID

TRACK = Path(__file__).resolve().parent
HARNESS = TRACK.parents[2]
WORKFLOW = '.github/workflows/t3-e03-hosted.yml'
SHA = re.compile('[a-f0-9]{40}')
HASH = re.compile('[a-f0-9]{64}')
NODE_URL = 'https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz'
NODE_HASH = 'f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e'
CLI_URL = 'https://github.com/supabase/cli/releases/download/v2.101.0/supabase_2.101.0_linux_amd64.tar.gz'
CLI_HASH = '285877ef9de845d76487772e0d36019a095ee28b527b9abbd6739eeba4d3dbf9'
PURPOSE_FILES = {'ediel03_physical': 'scenarios/ediel03-03.test.ts',
                 'controlled_issuer_underlay': 'scenarios/issuer-underlay.test.ts'}
FORWARD_PATH = 'supabase/migrations/20261101182158_ediel_utilts_issuer_source_intake.sql'
FORWARD_SHA256 = '63a14b9e00d5846475c0fcfd907244752ea9fbee96674613f1554545b5004bc5'


ROOT_SIGNING_PUBLIC_PEM = '-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAqr2/sEdmG4AbhlwGNOg4\nBLK34RzhqaN8th4JjGbLOZ67FZ54330waY3Ce19WHadRdwwyd/jsgCzAPH/QnX1s\nWNlaW7WG0yfLIALkusHttlYNdVPSIFhWRNLtGaqdqXCSVoKl5u8beVkFNfhJWYLG\n2RIV97beamyCkoWQLg26QgzaQhHBHtzC/DDFWRejJManxzhptMRmnBQND9+FNzwC\nV6ry5m9g08TOFGlHBsQijKrxOuuJVetYksQyHslzTbNappBhBP7FUERpHtFb7ime\ny81GA6+CMADFaYmmfBiP76S330Rp6mvynAG2Bv/wm6B+qBJYhNJGjyCALDVOX0Lo\nnV1Vk8DDc1o2HlGh8FBzDVybVwHH6GB5bj+Wd6VLIh1jLf6vnRqrELEY0zyFEZ4A\nNQYMGJKZONALQeMYuplgF2jELLNEj8vVPD1ajE834Idds0Yg8mNxsTmz3wh/m+BT\nlU4tI6KymTsa5up3T0VkPsvp1qcaybgAyduTP/ohJObhAgMBAAE=\n-----END PUBLIC KEY-----\n'
ROOT_SIGNING_PUBLIC_SHA256 = "d9be7792c4a381476bcb0b58646cb86caf01736d2264cc355333ee0c7ea41704"
REVIEWER_CERT = '-----BEGIN CERTIFICATE-----\nMIIEUDCCArigAwIBAgIUJ5RVAZibuNfhlm7whQN43vaT2TEwDQYJKoZIhvcNAQEL\nBQAwMTEvMC0GA1UEAwwmVDMgY29udHJvbGxlZCB0ZXN0IGV2aWRlbmNlIGVuY3J5\ncHRpb24wHhcNMjYxMTAxMTkwNjU5WhcNMjYxMTA4MTkwNjU5WjAxMS8wLQYDVQQD\nDCZUMyBjb250cm9sbGVkIHRlc3QgZXZpZGVuY2UgZW5jcnlwdGlvbjCCAaIwDQYJ\nKoZIhvcNAQEBBQADggGPADCCAYoCggGBAMTPCODI/Ewv2hMUZt9AsNopKTGancEK\nWCT17O35hh7dUClCr2bAfxWtaLVVFVE7v8OPJAhXT/PvAjQPYyuz7J+mkUc9AYVV\n3RcUC/44ahJmPgkmsnn+/HwxWHaBQftqcoA5Y/l/8gMGds8fnwTm/Z0ZnNizY9oz\npe1eu38gl54dPJZ+gDeGUqYJs2C7kmRSEeVWK6AChl4g3CBFatRIoe3juiasab8L\nexG7BaNgbIBa/s87Rn2TiVH2ab3wyC09Lohc8a7JM7atOCfM4H0Nkq8oQk9ZGzEh\n6roXx6+zlVwEXjzHNRyrmJe8N8f7fTrz5x1ymWsqVWoHTZ+kK/xPjWUd/M8V9R41\nIoNSz9XHSA5LyNBM2QhiGSb9eieSiuzSIZnyWfdn18lKxvzxG18NfVBhfS4q/iOc\nRdIONHi8jlu14oDKXOPnpQXNosuWU+plp1rP6wiM/y9U5Axyh/6ND4h5wx9ZRdQi\nVqmMLS8tb1AkH8vyLfj1giEJ8XCuvNHKkwIDAQABo2AwXjAdBgNVHQ4EFgQUnFAc\nyc/C7EdrNxpqh6NeswFcQBMwHwYDVR0jBBgwFoAUnFAcyc/C7EdrNxpqh6NeswFc\nQBMwDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCBSAwDQYJKoZIhvcNAQELBQAD\nggGBAISR5S6ulAiXCqCXq3N132JAARtB3rrI7m3LTNfne6OQ9iAlgXd2SL/YLo+y\ns6UcMKxt7G8BOmP2a6AtQG5keY+ZgBe+gVT6xH0+bW2pwyauWpVw6GP3TeaV6TrQ\nmfv2NN7pkZcbNGOlUOpC3UC2kLnPW9D+be/nM4Gf3qOV7/GTOLOZ7hWMEZ4gA65u\nOi1ByUCO5+VjsB3qo9GPJ1BwAX/KvPrc/biZBagGmaqfUuKEpMhtv6xnyWkku5wM\nUMYDt7lpBA4OBoXBiTybakzu5h46hsOfsDKfLo11qpppKKInpxNNytAfJixhCwxz\nGY5gm9I3fl7oqWBeka+HJHlhMLAJ9/o+3fHPYEIMk29CiOx/AelB8ocLEi4hs6nk\nEIlmebAsCnE6sQN1vmGqRLCOI9LtJ6y5a15d28AxbjiO5mcdiQC+/BGXlyDBmIjv\nt9VUioZHGQD9SJFk/uzsir7puNCYdNYN6iGQVVpfyMQLH8Gc3ynIl9E2hAEkDphV\n1j2yiA==\n-----END CERTIFICATE-----\n'
REVIEWER_CERT_SHA256 = "e1755b953fd31cec33f21a9ecc0b8b991ea711d25116032d5b3681b5109e1e58"


def need(ok, code):
    if not ok:
        raise ValueError(code)


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), TRACK / (name + '.py'))
    unit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(unit)
    return unit


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def canonical_hash(value):
    return hash_bytes(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode())


def private_named(prepare, home, directory, name, expected):
    need(isinstance(name, str) and re.fullmatch('[A-Za-z0-9_.-]+', name) and name not in ['.', '..']
         and HASH.fullmatch(expected), 'private_original_name_and_hash_required')
    file = prepare.private(Path(home) / directory / name)
    raw = file.read_bytes()
    need(raw and hash_bytes(raw) == expected, 'private_original_bytes_changed')
    return file


def qualify_transport(prepare, recipient):
    probe = b'T3_FINITE_CRYPTO_PROBE_ONLY_NOT_NATIVE_ORIGINALS'
    encrypted = subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-outform', 'DER', str(recipient)],
                               input=probe, capture_output=True, check=True, timeout=15).stdout
    structure = subprocess.run(['openssl', 'cms', '-cmsout', '-print', '-inform', 'DER'],
                               input=encrypted, capture_output=True, check=True, timeout=15).stdout
    need(b'1.2.840.113549.1.9.16.1.23' in structure and b'2.16.840.1.101.3.4.1.46' in structure,
         'actual_cms_authenticated_aes256gcm_required_no_downgrade')
    return {'cipher': 'AES-256-GCM', 'cmsType': 'AuthEnvelopedData', 'opensslVersion': prepare.capture(['openssl', 'version']),
            'recipientSha256': hash_bytes(Path(recipient).read_bytes()), 'probeSha256': hash_bytes(probe),
            'ciphertextSha256': hash_bytes(encrypted), 'scope': 'ENCRYPTED_TRANSPORT_CAPABILITY_NOT_NATIVE_ACCEPTANCE'}


def save(path, value):
    with open(path, 'x', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write('\n')


def hosted_identity(env):
    need(env.get('GITHUB_ACTIONS') == 'true' and env.get('RUNNER_ENVIRONMENT') == 'github-hosted'
         and env.get('RUNNER_OS') == 'Linux' and env.get('RUNNER_ARCH') == 'X64'
         and env.get('GITHUB_EVENT_NAME') in ['workflow_dispatch', 'push'] and env.get('GITHUB_RUN_ATTEMPT') == '1',
         'fresh_github_hosted_dispatch_required')
    need(SHA.fullmatch(env.get('GITHUB_SHA', '')) and re.fullmatch('[1-9][0-9]*', env.get('GITHUB_RUN_ID', ''))
         and re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', env.get('GITHUB_REPOSITORY', '')),
         'actual_github_identity_required')
    os_release = dict(line.rstrip().split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    need(os_release.get('ID', '').strip('"') == 'ubuntu' and os_release.get('VERSION_ID', '').strip('"') == '24.04',
         'ubuntu_24_04_required')
    need(env.get('GITHUB_REF', '').startswith('refs/heads/') and env.get('GITHUB_ACTOR'), 'actual_branch_actor_required')
    if env['GITHUB_EVENT_NAME'] == 'push':
        need(re.fullmatch('refs/heads/codex/t3-native-[A-Za-z0-9_-]+', env['GITHUB_REF']), 'narrow_native_event_branch_required')
        payload = json.loads(Path(env['GITHUB_EVENT_PATH']).read_bytes())
        need(payload.get('created') is True and payload.get('forced') is False and payload.get('deleted') is False
             and payload.get('before') == '0' * 40 and payload.get('after') == env['GITHUB_SHA']
             and payload.get('ref') == env['GITHUB_REF'] and payload.get('repository', {}).get('full_name') == env['GITHUB_REPOSITORY']
             and payload.get('sender', {}).get('login') == env['GITHUB_ACTOR'], 'single_create_only_native_push_required')
    identity = {key: env[key] for key in ['GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
                'GITHUB_WORKFLOW_REF', 'GITHUB_JOB', 'RUNNER_NAME', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_ACTOR']}
    identity['event'] = {'name': env['GITHUB_EVENT_NAME'], 'ref': env['GITHUB_REF'], 'sourceSha': env['GITHUB_SHA'],
                         'createOnly': env['GITHUB_EVENT_NAME'] == 'push', 'triggerActor': env['GITHUB_ACTOR']}
    return identity


def process_inventory():
    found = {}
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            if path.stat().st_uid != os.getuid():
                continue
            fields = (path / 'stat').read_text().rsplit(')', 1)[1].split()
            if fields[0] != 'Z':
                found[path.name] = fields[19]
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    return found


def locked_tools(packet, prepare):
    """Only after budget/capacity. Archive bytes are pinned, not tag resolution."""
    tools = packet.home / 'tools'
    tools.mkdir(mode=0o700)
    def heavy_guard():
        need(datetime.now(timezone.utc) < packet.expires, 'bootstrap_expired_before_heavy_operation')
        prepare.same_host(packet.host, prepare.host_identity())
    for name, url, expected in [('node.tar.xz', NODE_URL, NODE_HASH), ('supabase.tar.gz', CLI_URL, CLI_HASH)]:
        heavy_guard()
        path = tools / name
        with urllib.request.urlopen(url, timeout=60) as response, open(path, 'xb') as stream:
            while chunk := response.read(8 * 1024 * 1024 + 1):
                stream.write(chunk)
        need(hash_bytes(path.read_bytes()) == expected, 'official_tool_archive_hash_differs')
    with tarfile.open(tools / 'node.tar.xz') as archive:
        members = archive.getmembers()
        prefix = 'node-v22.16.0-linux-x64/'
        need(all((m.name == prefix.rstrip('/') or m.name.startswith(prefix)) and '..' not in Path(m.name).parts for m in members), 'unsafe_node_archive')
        archive.extractall(tools, filter='data')
    node = tools / 'node-v22.16.0-linux-x64/bin/node'
    need(str(node) == packet.plan['nodeBin'], 'assigned_locked_node_path_differs')
    # Both official release members must stay co-located. No stop/start shim.
    with tarfile.open(tools / 'supabase.tar.gz') as archive:
        for name in ['supabase', 'supabase-go']:
            member = archive.getmember(name)
            need(member.isfile(), 'regular_official_cli_members_required')
            with archive.extractfile(member) as source, open(node.parent / name, 'xb') as target:
                target.write(source.read())
            os.chmod(node.parent / name, 0o700)
    psql = Path('/usr/lib/postgresql/17/bin/psql')
    need(psql.is_file(), 'hosted_postgres17_client_missing')
    (node.parent / 'psql').symlink_to(psql)
    env = {**prepare.phase_environment(packet.host, str(node)), 'SUPABASE_HOME': str(packet.home / 'supabase-home'),
           'DO_NOT_TRACK': '1', 'SUPABASE_TELEMETRY_DISABLED': '1', 'NEXT_TELEMETRY_DISABLED': '1'}
    (packet.home / 'supabase-home').mkdir(mode=0o700)
    versions = {name: prepare.capture(argv, env=env) for name, argv in [
        ('node', [str(node), '--version']), ('npm', [str(node.parent / 'npm'), '--version']),
        ('supabase', [str(node.parent / 'supabase'), '--version']), ('psql', [str(psql), '--version'])]}
    need(versions['node'] == 'v22.16.0' and versions['supabase'] == '2.101.0'
         and versions['psql'].split()[2].startswith('17.'), 'locked_tool_version_differs')
    save(packet.home / 'toolchain.json', {'versions': versions, 'archives': {'node': NODE_HASH, 'supabase': CLI_HASH},
         'binarySha256': {name: hash_bytes(Path(path).read_bytes()) for name, path in [('node', node),
                         ('supabase', node.parent / 'supabase'), ('supabase-go', node.parent / 'supabase-go'), ('psql', psql)]},
         'telemetryOptOut': {'DO_NOT_TRACK': env['DO_NOT_TRACK'], 'SUPABASE_TELEMETRY_DISABLED': env['SUPABASE_TELEMETRY_DISABLED'],
                            'guard': 'official_v2_101_0_go_source', 'networkAcceptance': 'NOT_CLAIMED'}})
    for label, checkout in [('app', packet.app), ('harness', prepare.HARNESS)]:
        heavy_guard()
        with open(packet.home / (label + '-npm-ci.log'), 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as log:
            subprocess.run([str(node.parent / 'npm'), 'ci', '--no-audit', '--no-fund'], cwd=checkout, env=env,
                           stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
    packet.plan['nodeModulesLockSha256'] = hash_bytes((packet.app / 'node_modules/.package-lock.json').read_bytes())
    prepare.dependencies(packet.app, packet.plan)
    # Pull only the separately reviewed digest, never a mutable image tag.
    need(re.fullmatch('greenmail/standalone@sha256:[a-f0-9]{64}', packet.plan['greenmailImage']), 'locked_mail_image_required')
    heavy_guard()
    with open(packet.home / 'mail-image.log', 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as log:
        subprocess.run(['docker', '--host', 'unix://' + packet.host['socket'], 'pull', packet.plan['greenmailImage']],
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=300)
    image = json.loads(prepare.capture(['docker', '--host', 'unix://' + packet.host['socket'], 'image', 'inspect', packet.plan['greenmailImage']], env=env))
    need(len(image) == 1 and packet.plan['greenmailImage'] in image[0]['RepoDigests'], 'actual_mail_digest_differs')
    save(packet.home / 'mail-image.json', {'id': image[0]['Id'], 'repoDigests': image[0]['RepoDigests']})


class GitHub:
    def __init__(self, repository, token):
        need(re.fullmatch('[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository) and token, 'authenticated_repository_required')
        self.base = 'https://api.github.com/repos/' + repository
        self.token = token
        self.events = []
        self.audit_home = None
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args, **_kwargs):
                raise ValueError('github_redirect_forbidden')
        self.opener = urllib.request.build_opener(NoRedirect)

    def record(self, event):
        self.events.append(event)
        if self.audit_home is not None:
            save(self.audit_home / ('api-' + str(os.getpid()) + '-' + str(len(self.events)) + '.json'), event)

    def call(self, path, method='GET', body=None):
        need('..' not in path and ((method == 'POST' and path in ['/git/refs', '/issues/930/comments']) or (method == 'GET'
             and (path in ['/issues/930', '/rate_limit'] or re.fullmatch(r'/issues/930/comments\?per_page=100&page=[1-9][0-9]*', path) or path.startswith('/git/') or re.fullmatch(r'/actions/runs/[1-9][0-9]*(/attempts/1/jobs)?', path)))),
             'bounded_github_operation_required')
        request = urllib.request.Request(('https://api.github.com/rate_limit' if path == '/rate_limit' else self.base + path), method=method,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'},
            data=None if body is None else json.dumps(body).encode())
        try:
            with self.opener.open(request, timeout=20) as response:
                status, raw = response.status, response.read(8 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            status, raw = error.code, error.read(8 * 1024 * 1024 + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            self.record({'method': method, 'path': path, 'status': 'UNKNOWN', 'exceptionType': type(error).__name__})
            raise ValueError('gitdata_unknown_no_retry') from None
        need(len(raw) <= 8 * 1024 * 1024, 'bounded_github_response_required')
        self.record({'method': method, 'path': path, 'status': status, 'responseSha256': hash_bytes(raw),
                            'response': raw.decode('utf8', errors='replace')})
        need(status == (201 if method == 'POST' else 200), 'gitdata_unknown_or_refused_no_retry')
        return json.loads(raw)


def observed_job(identity, github):
    run = github.call('/actions/runs/' + identity['GITHUB_RUN_ID'])
    need(run.get('id') == int(identity['GITHUB_RUN_ID']) and run.get('head_sha') == identity['GITHUB_SHA']
         and run.get('event') == identity['GITHUB_EVENT_NAME'] and run.get('run_attempt') == 1
         and run.get('path') == WORKFLOW and run.get('status') == 'in_progress'
         and run.get('repository', {}).get('full_name') == identity['GITHUB_REPOSITORY']
         and run.get('head_repository', {}).get('full_name') == identity['GITHUB_REPOSITORY']
         and run.get('actor', {}).get('login') == identity['GITHUB_ACTOR']
         and run.get('triggering_actor', {}).get('login') == identity['GITHUB_ACTOR'], 'actual_hosted_run_source_mismatch')
    need(identity['GITHUB_WORKFLOW_REF'] == identity['GITHUB_REPOSITORY'] + '/' + WORKFLOW + '@refs/heads/' + run['head_branch'],
         'actual_workflow_ref_mismatch')
    jobs = github.call('/actions/runs/' + identity['GITHUB_RUN_ID'] + '/attempts/1/jobs')
    selected = [job for job in jobs.get('jobs', []) if job.get('name') == identity['GITHUB_JOB'] and job.get('status') == 'in_progress'
                and job.get('runner_name') == identity['RUNNER_NAME']]
    need(jobs.get('total_count') == len(jobs.get('jobs', [])) and len(selected) == 1
         and type(selected[0].get('runner_id')) is int and selected[0]['runner_id'] > 0
         and 'ubuntu-24.04' in selected[0].get('labels', []), 'actual_running_hosted_job_required')
    return {'run': run, 'job': selected[0]}


def admit_job_deadline(job, expires):
    started = datetime.fromisoformat(job['job']['started_at'].replace('Z', '+00:00'))
    need(started.utcoffset() is not None and expires.utcoffset() is not None
         and datetime.now(timezone.utc) < expires <= started + timedelta(minutes=90),
         'expiry_must_leave_owned_cleanup_before_hosted_job_deadline')


def validate_authority(receipt, role, plan, identity, expected_agent):
    # Public source-only {base,files,operation} receipts deliberately fail here.
    need(receipt.get('protocol') == 'masterplan-reservation-v1'
         and receipt.get('agent') == expected_agent and receipt.get('epoch') == plan['epoch']
         and receipt.get('source') == plan['appCommit'] and receipt.get('packet') and receipt.get('slot')
         and receipt.get('checkpoint') and receipt.get('branch') == identity['GITHUB_REF'].removeprefix('refs/heads/'),
         'full_v1_runtime_authority_required')
    runtime = receipt.get('runtimeAuthorization')
    need(isinstance(runtime, dict) and role in runtime.get('roles', []) and runtime.get('track') == 'T3'
         and runtime.get('inputEpoch') == plan['inputEpoch'] and runtime.get('attemptBudget') == 1
         and type(runtime.get('attemptBudget')) is int and runtime.get('exclusiveHost') is True
         and runtime.get('workflow') == WORKFLOW and runtime.get('harnessCommit') == plan['harnessCommit']
         and runtime.get('repository') == identity['GITHUB_REPOSITORY']
         and runtime.get('projectId') == plan['projectId'] and runtime.get('execution') == plan['execution']
         and runtime.get('schemaEpoch') == plan['schemaEpoch'] and runtime.get('environment') == plan['environment']
         and runtime.get('environmentId') == plan['environmentId'],
         'exact_runtime_role_scope_required')
    need(runtime.get('ports') == plan['ports'] and runtime.get('greenmailImage') == plan['greenmailImage']
         and runtime.get('reviewerCertificateSha256') == plan['reviewerCertificateSha256']
         and runtime.get('consumer') == plan['consumer'], 'exact_allocated_ports_image_recipient_and_consumer_required')
    need(runtime.get('event') == identity['event'], 'exact_source_event_and_authenticated_publisher_required')
    expiry = datetime.fromisoformat(runtime['expiresAtUtc'].replace('Z', '+00:00'))
    need(expiry.utcoffset() is not None and expiry > datetime.now(timezone.utc)
         and expiry >= datetime.fromisoformat(plan['expiresAtUtc'].replace('Z', '+00:00')), 'runtime_authority_expired')


def private_authority(profile, plan, binding, role, identity, prepare):
    file = private_named(prepare, plan['simHome'], 'authority', binding['capsuleName'], binding['capsuleSha256'])
    capsule = json.loads(file.read_bytes())
    validate_authority(capsule, role, plan, identity, binding['agent'])
    packet_id = UUID(capsule['packet'])
    need(str(packet_id) == capsule['packet'] and packet_id.version == 4
         and capsule['slot'] == 'session-' + capsule['packet'] and capsule.get('ids') == [], 'actual_unique_runtime_session_required')
    if identity['event']['name'] == 'push':
        need(capsule['branch'] == 'codex/t3-native-' + capsule['packet'], 'exact_unique_native_event_branch_required')
    created = datetime.fromisoformat(capsule['createdAt'].replace('Z', '+00:00'))
    need(created.utcoffset() is not None and created <= datetime.now(timezone.utc), 'actual_timezone_bound_authority_birth_required')
    native = capsule['runtimeAuthorization']
    role_refs = {key: entry['ref'] for key, entry in profile['authorities'].items()}
    need(native.get('roles') == ['backend', 'producer'] and native.get('roleRefs') == role_refs
         and role_refs['producer'] != role_refs['backend'], 'both_actual_native_roles_required')
    for key, value in role_refs.items():
        pattern = 'producer-[A-Za-z0-9_-]+' if key == 'producer' else '(?:backend|producer)-[A-Za-z0-9_-]+'
        need(re.fullmatch('refs/tags/agent-claims/masterplan/' + pattern, value), 'native_role_ref_required')
    resources = capsule.get('resources')
    need(isinstance(resources, list) and resources == sorted(set(resources)) and set(role_refs.values()).issubset(resources)
         and 'refs/tags/agent-claims/masterplan/slot-' + capsule['slot'] in resources
         and all(re.fullmatch('refs/tags/agent-claims/masterplan/[A-Za-z0-9_-]+', ref) for ref in resources), 'complete_native_resource_set_required')
    files = capsule.get('files')
    need(isinstance(files, list) and files == sorted(set(files)) and all(isinstance(value, str) and value
         and not Path(value).is_absolute() and '..' not in Path(value).parts for value in files), 'public_exact_source_paths_only')
    mandate = capsule.get('userNativeMandate', {})
    need(mandate.get('scope') == 'T3_CONTROLLED_SYNTHETIC_NATIVE_TESTDATA', 'explicit_user_native_mandate_required')
    private_named(prepare, plan['simHome'], 'authority', mandate['name'], mandate['sha256'])
    reviews, authors = capsule.get('independentReviews'), capsule.get('authors')
    need(isinstance(authors, list) and authors and isinstance(reviews, list) and len(reviews) == 2,
         'two_independent_source_reviews_required')
    agents = set()
    for review in reviews:
        need(isinstance(review.get('agent'), str) and review['agent'] and review['agent'] not in authors
             and review['agent'] not in agents and review.get('decision') == 'APPROVE_SOURCE_ONLY'
             and review.get('source') == {key: plan[key] for key in ['appCommit', 'appTree', 'harnessCommit', 'harnessTree']}
             and review.get('executionSha256') == canonical_hash(plan['execution']), 'current_independent_source_approval_required')
        private_named(prepare, plan['simHome'], 'authority', review['name'], review['sha256'])
        agents.add(review['agent'])
    return capsule


def execution_contract(plan, prepare):
    execution = plan.get('execution')
    need(isinstance(execution, dict) and execution.get('purpose') in PURPOSE_FILES, 'explicit_whitelisted_execution_purpose_required')
    relative = PURPOSE_FILES[execution['purpose']]
    need(execution.get('scenarioFile') == relative and HASH.fullmatch(execution.get('scenarioSha256', '')),
         'fixed_purpose_scenario_required')
    file = prepare.TRACK / relative
    need(hash_bytes(file.read_bytes()) == execution['scenarioSha256']
         and prepare.capture(['git', '-C', str(prepare.HARNESS), 'ls-files', '--error-unmatch', '--',
             'scripts/simulation/track3/' + relative]) == 'scripts/simulation/track3/' + relative, 'reviewed_scenario_source_required')
    need(isinstance(plan.get('schemaEpoch'), str) and plan['schemaEpoch'], 'exact_source_schema_epoch_required')
    if execution['purpose'] == 'ediel03_physical':
        need(set(execution) == {'purpose', 'scenarioFile', 'scenarioSha256'}, 'fixed_physical_pilot_descriptor_required')
        return execution
    need(set(execution) == {'purpose', 'scenarioFile', 'scenarioSha256', 'expectedTestNames', 'evidenceMatrix', 'sourceQualification', 'inputFile', 'inputSha256'},
         'complete_controlled_underlay_contract_required')
    names = execution['expectedTestNames']
    consumer_contract = load('hosted-consumer')
    need(isinstance(names, list) and names and len(set(names)) == len(names)
         and all(isinstance(value, str) and value.strip() == value and value for value in names)
         and names == list(consumer_contract.UNDERLAY_NAMES) and execution['evidenceMatrix'] == consumer_contract.UNDERLAY_MATRIX,
         'frozen_ordered_tests_and_evidence_matrix_required')
    need(plan['environment'] == 'test' and execution.get('inputFile') == 'inputs/issuer-underlay-input.json', 'controlled_test_only_underlay_input_required')
    input_file = private_named(prepare, plan['simHome'], 'inputs', 'issuer-underlay-input.json', execution['inputSha256'])
    need(isinstance(json.loads(input_file.read_bytes()), dict), 'frozen_underlay_parameter_object_required')
    qualification = execution['sourceQualification']
    need(isinstance(qualification, dict) and qualification.get('owner') == 'T4-serial-GEN'
         and qualification.get('appCommit') == plan['appCommit'] and qualification.get('appTree') == plan['appTree']
         and qualification.get('schemaEpoch') == plan['schemaEpoch']
         and qualification.get('schemaSha256') == hash_bytes((Path(plan['appDir']) / 'supabase/schema.sql').read_bytes()),
         'genuine_current_forward_source_qualification_required')
    migration = qualification.get('migrationPath', '')
    need(migration == FORWARD_PATH and qualification.get('migrationSha256') == FORWARD_SHA256
         and hash_bytes((Path(plan['appDir']) / migration).read_bytes()) == FORWARD_SHA256,
         'exact_qualified_forward_migration_required')
    # The separately authorized full runtime receipts bind this complete capsule.
    # Source-only refs are insufficient. Originals still need genuine T4 review;
    # these byte checks do not invent a GEN run, approval or a capture budget.
    originals = qualification.get('originalFiles')
    need(isinstance(originals, list) and len(originals) >= 3, 'retained_t4_qualification_originals_required')
    seen = set()
    for entry in originals:
        need(entry.get('role') in ['qualified-output', 'independent-review-1', 'independent-review-2']
             and entry['role'] not in seen and HASH.fullmatch(entry.get('sha256', '')), 'separate_qualification_originals_required')
        private_named(prepare, plan['simHome'], 'qualification', entry['name'], entry['sha256'])
        seen.add(entry['role'])
    need(seen == {'qualified-output', 'independent-review-1', 'independent-review-2'}, 'two_genuine_t4_output_reviews_required')
    return execution


def read_authorities(profile, plan, identity, github, prepare):
    bindings = profile['authorities']
    need(set(bindings) == {'producer', 'backend'}, 'separate_producer_backend_authority_required')
    need(plan['producerReservation'] == bindings['producer']['sha'] and plan['backendReservation'] == bindings['backend']['sha'],
         'plan_must_bind_actual_role_receipts')
    for role, binding in bindings.items():
        ref, target = binding['ref'], binding['sha']
        need(re.fullmatch('refs/tags/agent-claims/masterplan/(?:producer|backend)-[A-Za-z0-9_-]+', ref)
             and SHA.fullmatch(target), 'exact_producer_role_ref_required')
        need({'ref': ref, 'sha': target} in plan['reservationRefs'], 'ordinary_packet_must_recheck_runtime_role_refs')
        capsule = private_authority(profile, plan, binding, role, identity, prepare)
        capsule_ref = 'refs/tags/agent-claims/masterplan/runtime-authority-' + binding['capsuleSha256']
        need(binding['capsuleRef'] == capsule_ref and {'ref': capsule_ref, 'sha': target} in plan['reservationRefs'],
             'hash_bound_private_native_authority_ref_required')
        need(capsule_ref not in capsule['resources'], 'derived_capsule_ref_must_not_create_hash_cycle')
        observed = github.call('/git/ref/' + ref.removeprefix('refs/'))
        need(observed.get('ref') == ref and observed.get('object', {}).get('type') == 'commit'
             and observed['object']['sha'] == target, 'live_role_authority_changed')
        commit = github.call('/git/commits/' + target)
        receipt = json.loads(commit['message'])
        resources = sorted(capsule['resources'] + [capsule_ref])
        expected = {'base': capsule['base'], 'files': capsule['files'],
            'operation': 'Reserve runtime producer and backend; resources-sha256=' + hash_bytes('\n'.join(resources).encode())}
        need(receipt == expected and len(commit['parents']) == 1 and commit['parents'][0]['sha'] == capsule['base'],
             'neutral_private_native_capsule_binding_required')
        base = github.call('/git/commits/' + capsule['base'])
        need(commit['tree']['sha'] == base['tree']['sha'], 'neutral_receipt_tree_required')
        for resource in resources:
            actual = github.call('/git/ref/' + resource.removeprefix('refs/'))
            need(actual.get('ref') == resource and actual.get('object', {}).get('type') == 'commit'
                 and actual['object']['sha'] == target, 'partial_or_changed_native_authority_set')


def attempt_ref(producer_sha, input_epoch):
    need(SHA.fullmatch(producer_sha) and isinstance(input_epoch, str) and input_epoch, 'exact_attempt_inputs_required')
    return 'refs/tags/agent-claims/masterplan/runtime-attempt-' + hash_bytes(json.dumps([producer_sha, input_epoch], separators=(',', ':')).encode())


def network_binding(row, receipt):
    need(row.get('Id') == receipt['id'] and row.get('Name') == receipt['name'] and row.get('Driver') == 'bridge'
         and row.get('Scope') == 'local' and row.get('Labels') == receipt['labels']
         and row.get('Options', {}).get('com.docker.network.bridge.host_binding_ipv4') == '127.0.0.1'
         and 'com.supabase.cli.project' not in row.get('Labels', {}), 'owned_loopback_network_changed')


def create_network(prepare, packet, identity, profile_hash):
    suffix = attempt_ref(packet.plan['producerReservation'], packet.plan['inputEpoch']).rsplit('-', 1)[1]
    name = 't3-hosted-' + suffix[:24]
    labels = {'sim.track': 'track3', 'sim.worker': 'codex-track3', 'sim.environment': packet.plan['environmentId'],
              'sim.workflow-run': identity['GITHUB_RUN_ID']}
    command = ['docker', '--host', 'unix://' + packet.host['socket']]
    env = prepare.phase_environment(packet.host, packet.node)
    present = prepare.capture(command + ['network', 'ls', '--no-trunc', '-q', '--filter', 'name=^' + name + '$'], env=env)
    need(not present, 'owned_network_name_already_exists')
    save(packet.home / 'network-create-intent.json', {'name': name, 'labels': labels, 'profileSha256': profile_hash})
    args = ['network', 'create', '--driver', 'bridge', '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1']
    for key, value in sorted(labels.items()):
        args += ['--label', key + '=' + value]
    identifier = prepare.capture(command + args + [name], env=env)
    need(HASH.fullmatch(identifier), 'network_create_unknown_no_retry')
    receipt = {'id': identifier, 'name': name, 'labels': labels, 'profileSha256': profile_hash}
    save(packet.home / 'network-create-return.json', receipt)
    inspected = json.loads(prepare.capture(command + ['network', 'inspect', identifier], env=env))
    need(len(inspected) == 1, 'exact_network_inspection_required')
    network_binding(inspected[0], receipt)
    need(inspected[0].get('Containers') == {}, 'new_network_already_attached')
    save(packet.home / 'network-birth.json', {**receipt, 'inspection': inspected[0]})
    return receipt


def cleanup_network(prepare, same, packet, receipt, baseline):
    command = ['docker', '--host', 'unix://' + packet.host['socket']]
    env = prepare.phase_environment(packet.host, packet.node)
    prepare.same_host(packet.host, prepare.host_identity(enforce_capacity=False))
    current = same.docker_resources(prepare, packet)
    need(not current['containers'] and not current['volumes'], 'preserve_unknown_remaining_backend_resources')
    inspected = json.loads(prepare.capture(command + ['network', 'inspect', receipt['id']], env=env))
    need(len(inspected) == 1, 'exact_network_inspection_required')
    network_binding(inspected[0], receipt)
    need(inspected[0].get('Containers') == {}, 'owned_network_still_attached')
    # No discovery-based cleanup, force, project prune or label-only deletion.
    prepare.capture(command + ['network', 'rm', receipt['id']], env=env)
    terminal = same.docker_resources(prepare, packet)
    need(terminal == baseline, 'outer_docker_inventory_not_restored')
    save(packet.home / 'network-cleanup.json', {'id': receipt['id'], 'outerDockerRestored': True, 'inventory': terminal})


def consume_attempt(github, producer_sha, input_epoch):
    ref = attempt_ref(producer_sha, input_epoch)
    # Exactly one mutation. A collision, timeout or failed readback is HOLD;
    # GET-match never converts a failed/ambiguous CREATE into retry permission.
    created = github.call('/git/refs', 'POST', {'ref': ref, 'sha': producer_sha})
    need(created.get('ref') == ref and created.get('object', {}).get('sha') == producer_sha, 'attempt_create_unknown')
    readback = github.call('/git/ref/' + ref.removeprefix('refs/'))
    need(readback.get('ref') == ref and readback.get('object', {}).get('sha') == producer_sha, 'attempt_readback_unknown')
    return ref


def archive_originals(profile, prepare, profile_hash):
    home = prepare.private(profile['plan']['simHome'], True)
    recipient = prepare.private(home / 'reviewer.pem')
    need(hash_bytes(recipient.read_bytes()) == profile['reviewerCertificateSha256'] == profile['plan']['reviewerCertificateSha256'],
         'original_recipient_changed')
    if (home / 'execution-intent.json').exists():
        need(prepare.read_json(home / 'execution-intent.json')['profileSha256'] == profile_hash, 'attempt_profile_changed_before_archive')
    qualify_transport(prepare, recipient)
    archive = home.parent / 't3-hosted-originals.tar'
    encrypted = home.parent / 't3-hosted-originals.cms'
    try:
        with open(archive, 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as output:
            subprocess.run(['tar', '-cf', '-', '-C', str(home.parent), home.name], stdout=output, stderr=subprocess.PIPE, check=True, timeout=120)
        with open(encrypted, 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as output:
            subprocess.run(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-in', str(archive), '-outform', 'DER',
                            str(recipient)], stdout=output, stderr=subprocess.PIPE, check=True, timeout=120)
    finally:
        archive.unlink(missing_ok=True)


def preflight(profile, identity, prepare, same):
    need(profile.get('schema') == 'track3-hosted-bootstrap-v1', 'explicit_hosted_profile_required')
    p = profile['plan']
    need(p.get('environment') in ['test', 'production'] and p['environment'] == profile['environment'], 'explicit_authorized_environment_required')
    need(p.get('schema') == 'track3-runner-plan-v1' and p['harnessCommit'] == identity['GITHUB_SHA'] and p['workerId'] == 'codex-track3'
         and p['attemptBudget'] == 1 and type(p['attemptBudget']) is int and p['exclusiveHost'] is True,
         'source_bound_exclusive_bootstrap_required')
    need(set(p.get('allowedActions', [])) == {'backend', 'replay', 'build', 'up', 'run', 'down', 'cleanup'}, 'exact_actions_required')
    home = prepare.private(p['simHome'], True)
    app = prepare.canonical(p['appDir'])
    prepare.source(app, p['appCommit'], p['appTree'])
    prepare.source(prepare.HARNESS, p['harnessCommit'], p['harnessTree'])
    need(not home.is_relative_to(app) and not home.is_relative_to(prepare.HARNESS), 'private_home_outside_checkouts_required')
    for flag in ['--is-inside-work-tree', '--is-inside-git-dir']:
        check = subprocess.run(['git', '-C', str(home), 'rev-parse', flag], capture_output=True, text=True, timeout=20)
        need(not (check.returncode == 0 and check.stdout.strip() == 'true'), 'private_home_outside_git_required')
    need(re.fullmatch('t3-[A-Za-z0-9-]{5,77}', p.get('environmentId', ''))
         and re.fullmatch('[a-z0-9][a-z0-9_-]{2,62}', p.get('projectId', '')), 'explicit_environment_project_required')
    for key in ['producerReservation', 'backendReservation', 'inputEpoch', 'epoch', 'model']:
        need(isinstance(p.get(key), str) and p[key].strip(), 'explicit_allocation_required')
    need(p.get('reservationRefs') and all(re.fullmatch('refs/tags/agent-claims/masterplan/[A-Za-z0-9_-]+', x['ref'])
         and SHA.fullmatch(x['sha']) for x in p['reservationRefs']), 'exact_source_custody_required')
    for item in p['reservationRefs']:
        need(prepare.capture(['git', '-C', str(prepare.HARNESS), 'ls-remote', 'origin', item['ref']]).split() == [item['sha'], item['ref']],
             'source_custody_changed')
    need(isinstance(p.get('overlayRefs'), list) and all(SHA.fullmatch(value) for value in p['overlayRefs']), 'exact_overlay_commits_required')
    for ref in p['overlayRefs']:
        need(subprocess.run(['git', '-C', str(app), 'merge-base', '--is-ancestor', ref, p['appCommit']], capture_output=True, timeout=20).returncode == 0,
             'overlay_not_in_app_ancestry')
    need(set(p.get('adapters', {})) == {'backend', 'replay', 'cleanup'}, 'explicit_adapter_sources_required')
    need(p.get('consumer', {}).get('path') == 'scripts/simulation/track3/hosted-consumer.py', 'fixed_reviewed_hosted_consumer_required')
    for entry in p['adapters'].values():
        file = prepare.canonical(str(app / entry['path']))
        need(file.is_relative_to(app) and file.suffix == '.py' and hash_bytes(file.read_bytes()) == entry['sha256']
             and prepare.capture(['git', '-C', str(app), 'ls-files', '--error-unmatch', '--', entry['path']]) == entry['path'],
             'tracked_reviewed_adapter_required')
    need(set(p.get('timeouts', {})) == set(p['allowedActions'])
         and all(type(value) is int and 0 < value <= 7200 for value in p['timeouts'].values()), 'bounded_phase_timeouts_required')
    need(p['nodeBin'] == str(home / 'tools/node-v22.16.0-linux-x64/bin/node')
         and Path('/usr/lib/postgresql/17/bin/psql').is_file(), 'locked_node_path_and_hosted_pg17_client_required')
    need(re.fullmatch('greenmail/standalone@sha256:[a-f0-9]{64}', p['greenmailImage']), 'locked_mail_image_required')
    need(p['workflow']['path'] == WORKFLOW and hash_bytes((prepare.HARNESS / WORKFLOW).read_bytes()) == p['workflow']['sha256'],
         'reviewed_workflow_source_required')
    import tomllib
    config_bytes = (app / 'supabase/config.toml').read_bytes()
    overlay = (prepare.TRACK / 'hosted-supabase.toml').read_bytes()
    config = tomllib.loads(config_bytes.decode())
    need(config_bytes == overlay and hash_bytes(overlay) == profile['configOverlaySha256']
         and config['project_id'] == p['projectId'] != 'gridex-ops-platform'
         and config['api']['port'] == p['ports']['api'] and config['db']['port'] == p['ports']['db'] == 54322,
         'qualified_committed_config_overlay_required')
    need(p['ports'].keys() == {'api', 'app', 'control', 'db', 'imapPlain', 'imapTls', 'smtp'}
         and all(type(v) is int and 0 < v < 65536 for v in p['ports'].values()) and len(set(p['ports'].values())) == 7,
         'seven_distinct_ports_required')
    need(not any((app / name).exists() for name in ['.env', '.env.local', '.env.production', '.env.production.local'])
         and not (app / '.next/BUILD_ID').exists(), 'fresh_clean_app_required')
    need(hash_bytes((app / 'package-lock.json').read_bytes()) == p['dependencyLockSha256'], 'reviewed_dependency_lock_required')
    need(hash_bytes((prepare.HARNESS / 'package-lock.json').read_bytes()) == p['dependencyLockSha256'], 'same_qualified_harness_dependency_lock_required')
    execution_contract(p, prepare)
    recipient = prepare.private(home / 'reviewer.pem')
    need(hash_bytes(recipient.read_bytes()) == profile['reviewerCertificateSha256'] == p['reviewerCertificateSha256'], 'explicit_original_recipient_required')
    prepare.capture(['openssl', 'x509', '-in', str(recipient), '-noout', '-checkend', '21600'])
    transport = qualify_transport(prepare, recipient)
    expiry = datetime.fromisoformat(p['expiresAtUtc'].replace('Z', '+00:00'))
    need(expiry.utcoffset() is not None and expiry.utcoffset().total_seconds() == 0, 'utc_plan_expiry_required')
    same.bounded_timeout(p['sameShellTimeoutSeconds'], expiry)
    host = prepare.host_identity()  # Actual DockerRootDir capacity before heavy operations.
    packet = SimpleNamespace(plan=p, app=app, home=home, expires=expiry, host=host, node=p['nodeBin'])
    packet.transport = transport
    replay, script, consumer = same.check_packet(packet, prepare)
    inventory = same.docker_resources(prepare, packet)
    need(not inventory['containers'] and not inventory['volumes'], 'exclusive_empty_docker_required')
    return packet, (replay, script, consumer), inventory


# Adapted from T4 0a06e96a decryptBootstrapAssignment/readBootstrapCarrier.
# Only transport/canonical crypto is reused; T4 bootstrap-zero budgets grant
# no T3 producer authority. Full T3 native capsules remain mandatory afterward.
CRYPTO_PORT = r'''
const c=require('node:crypto'),fs=require('node:fs');
const x=JSON.parse(fs.readFileSync(0,'utf8'));
const need=(v)=>{if(!v)throw Error('private_crypto_hold')};
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'
 ?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
const sha=v=>c.createHash('sha256').update(v).digest('hex');
const b64=(s,max=60000)=>{need(typeof s==='string'&&s.length<=max&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s));return Buffer.from(s,'base64')};
const publicKey=p=>{const k=c.createPublicKey(p);need(k.asymmetricKeyType==='rsa'&&k.asymmetricKeyDetails.modulusLength>=3072);return k};
const encrypt=(bytes,pem)=>{const pub=publicKey(pem),key=c.randomBytes(32),nonce=c.randomBytes(12),cipher=c.createCipheriv('aes-256-gcm',key,nonce);
 const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
 const wrapped=c.publicEncrypt({key:pub,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},key);key.fill(0);
 return {format:'t3_private_evidence_envelope_v1',recipientSha256:sha(pem),algorithm:'AES-256-GCM/RSA-OAEP-SHA256',nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),wrappedKey:wrapped.toString('base64'),ciphertext:ciphertext.toString('base64')}};
let result;
if(x.op==='keygen') {const k=c.generateKeyPairSync('rsa',{modulusLength:3072});result={publicPem:k.publicKey.export({type:'spki',format:'pem'}).toString(),privatePem:k.privateKey.export({type:'pkcs8',format:'pem'}).toString(),nonce:c.randomBytes(32).toString('hex'),nodeVersion:process.version};}
else if(x.op==='canonical')result={canonical:canonical(x.value)};
else if(x.op==='encrypt')result=encrypt(Buffer.from(canonical(x.value)),x.publicPem);
else if(x.op==='encrypt-file') {need(fs.lstatSync(x.sourcePath).isFile()&&!fs.lstatSync(x.sourcePath).isSymbolicLink()&&fs.statSync(x.sourcePath).size<=536870912);const e=encrypt(fs.readFileSync(x.sourcePath),x.publicPem);fs.writeFileSync(x.outputPath,JSON.stringify(e),{flag:'wx',mode:0o600});result={ciphertextSha256:sha(fs.readFileSync(x.outputPath)),recipientSha256:e.recipientSha256};}
else if(x.op==='seal') {need(sha(x.rootPublicPem)===x.rootSha256);const pub=publicKey(x.rootPublicPem),priv=c.createPrivateKey(x.privatePem);
 need(c.createPublicKey(priv).export({type:'spki',format:'pem'}).toString()===pub.export({type:'spki',format:'pem'}).toString());
 const signed={payload:x.payload,signature:c.sign('sha256',Buffer.from(canonical(x.payload)),{key:priv,padding:c.constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64')};result=encrypt(Buffer.from(canonical(signed)),x.publicPem);}
else if(x.op==='open-proof'||x.op==='open-file') {const e=x.envelope;need(e.format==='t3_private_evidence_envelope_v1'&&e.algorithm==='AES-256-GCM/RSA-OAEP-SHA256'&&e.recipientSha256===sha(x.publicPem));
 const nonce=b64(e.nonce),tag=b64(e.tag);need(nonce.length===12&&tag.length===16);const key=c.privateDecrypt({key:x.privatePem,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},b64(e.wrappedKey));need(key.length===32);
 const decipher=c.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAuthTag(tag);const raw=Buffer.concat([decipher.update(b64(e.ciphertext,x.op==='open-file'?715827884:60000)),decipher.final()]);key.fill(0);result=x.op==='open-proof'?JSON.parse(raw):{bytesBase64:raw.toString('base64')};}
else if(x.op==='decrypt') {const e=x.envelope;need(sha(x.rootPublicPem)===x.rootSha256&&e.format==='t3_private_evidence_envelope_v1'&&e.algorithm==='AES-256-GCM/RSA-OAEP-SHA256'&&e.recipientSha256===sha(x.publicPem));
 need(typeof e.ciphertext==='string'&&e.ciphertext.length<=58000);const nonce=b64(e.nonce),tag=b64(e.tag);need(nonce.length===12&&tag.length===16);
 const key=c.privateDecrypt({key:x.privatePem,oaepHash:'sha256',padding:c.constants.RSA_PKCS1_OAEP_PADDING},b64(e.wrappedKey));need(key.length===32);
 const decipher=c.createDecipheriv('aes-256-gcm',key,nonce);decipher.setAuthTag(tag);const raw=Buffer.concat([decipher.update(b64(e.ciphertext)),decipher.final()]);key.fill(0);
 const signed=JSON.parse(raw);need(signed.payload&&c.verify('sha256',Buffer.from(canonical(signed.payload)),{key:publicKey(x.rootPublicPem),padding:c.constants.RSA_PKCS1_PSS_PADDING,saltLength:32},b64(signed.signature)));result=signed.payload;}
else throw Error('unknown_operation');
process.stdout.write(JSON.stringify(result));
'''


def crypto_port(operation, **values):
    # Hosted system Node is bootstrap crypto only, not the locked app toolchain.
    node = shutil.which('node')
    need(node, 'hosted_builtin_crypto_node_required')
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin')}
    version = subprocess.run([node, '--version'], capture_output=True, check=True, timeout=10, env=env).stdout.decode().strip()
    need(re.fullmatch(r'v(?:20|22|24)\.[0-9]+\.[0-9]+', version), 'qualified_builtin_crypto_node_required')
    try:
        result = subprocess.run([node, '-e', CRYPTO_PORT], input=json.dumps({'op': operation, **values}, ensure_ascii=True).encode(),
                                capture_output=True, check=True, timeout=30, env=env)
        need(len(result.stdout) <= (715827900 if operation == 'open-file' else 1048576), 'private_crypto_output_too_large')
        return json.loads(result.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError):
        raise ValueError('private_crypto_hold') from None


def strict_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            need(key not in result, 'duplicate_private_json_key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite_private_json')))


def fresh_private_bytes(path, raw):
    with open(path, 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as stream:
        stream.write(raw)


def proof_payload(proof, profile, files, expires):
    return {'format': 't3_signed_host_assignment_v1', 'repository': proof['repository'], 'issue': 930,
            'workflow': WORKFLOW, 'runId': proof['runId'], 'runAttempt': proof['runAttempt'], 'job': proof['job'],
            'sourceHead': proof['head'], 'sourceTree': proof['tree'], 'bootId': proof['host']['bootId'],
            'proofSha256': proof['proofSha256'], 'nonce': proof['nonce'], 'recipientSha256': hash_bytes(proof['inputPublicKey'].encode()),
            'expiresAt': expires, 'nativeAttemptBudget': 1, 'profile': profile, 'files': files}


def validate_assignment(payload, proof, now=None):
    now = now or datetime.now(timezone.utc)
    need(proof['purpose'] == 't3-hosted-postproof-input' and proof['repository'] == 'heke99/gridex-ops-platform'
         and proof['runAttempt'] == '1', 'actual_t3_host_proof_required')
    expected = proof_payload(proof, payload.get('profile'), payload.get('files'), payload.get('expiresAt'))
    need(payload == expected and type(payload.get('nativeAttemptBudget')) is int, 'fresh_host_assignment_binding_required')
    expires = datetime.fromisoformat(payload['expiresAt'].replace('Z', '+00:00'))
    observed = datetime.fromisoformat(proof['observedAtUtc'].replace('Z', '+00:00'))
    deadline = datetime.fromisoformat(proof['jobDeadlineUtc'].replace('Z', '+00:00'))
    need(expires.utcoffset() is not None and observed.utcoffset() is not None and observed <= now < observed + timedelta(minutes=20)
         and now < expires <= min(observed + timedelta(minutes=90), deadline),
         'host_assignment_expired_or_unbounded')
    profile = payload['profile']; plan = profile['plan']
    home = str(Path(proof['runnerTemp']) / 't3-hosted-private')
    need(profile.get('schema') == 'track3-hosted-bootstrap-v1' and plan['simHome'] == home
         and SHA.fullmatch(plan['appCommit']) and SHA.fullmatch(plan['appTree'])
         and plan['harnessCommit'] == proof['head'] and plan['harnessTree'] == proof['tree']
         and plan['appDir'] == str(Path(proof['workspaceRoot']) / 'app')
         and plan['replayDir'] == str(Path(proof['workspaceRoot']) / 'replay')
         and plan['nodeBin'] == str(Path(home) / 'tools/node-v22.16.0-linux-x64/bin/node')
         and plan['expiresAtUtc'] == payload['expiresAt'] and plan['attemptBudget'] == 1 and type(plan['attemptBudget']) is int,
         'exact_imported_caller_paths_and_budget_required')
    need(profile['reviewerCertificateSha256'] == plan['reviewerCertificateSha256'] == REVIEWER_CERT_SHA256,
         'source_pinned_transport_recipient_required')
    need(isinstance(payload['files'], list) and len(payload['files']) <= 32, 'bounded_private_assignment_files_required')
    seen, decoded, total = set(), [], 0
    for entry in payload['files']:
        need(set(entry) == {'directory', 'name', 'base64Bytes', 'sha256'}
             and entry['directory'] in ['authority', 'qualification', 'inputs']
             and re.fullmatch('[A-Za-z0-9_.-]+', entry['name']) and entry['name'] not in ['.', '..'], 'private_assignment_path_refused')
        key = (entry['directory'], entry['name'])
        need(key not in seen and HASH.fullmatch(entry['sha256']), 'private_assignment_duplicate_or_hash_refused')
        seen.add(key)
        raw = base64.b64decode(entry['base64Bytes'], validate=True); total += len(raw)
        need(total <= 40000 and hash_bytes(raw) == entry['sha256'], 'private_assignment_bytes_refused')
        decoded.append((key, raw))
    return profile, decoded


def materialize_assignment(payload, proof):
    profile, files = validate_assignment(payload, proof)
    home = Path(profile['plan']['simHome'])
    # mkdir exclusive: an interrupted import cannot be adopted/retried.
    home.mkdir(mode=0o700)
    for directory in ['authority', 'qualification', 'inputs']:
        (home / directory).mkdir(mode=0o700)
    for (directory, name), raw in files:
        fresh_private_bytes(home / directory / name, raw)
    fresh_private_bytes(home / 'reviewer.pem', REVIEWER_CERT.encode())
    save(home / 'profile.json', profile)
    save(home / 'host-assignment-import.json', {'proofSha256': proof['proofSha256'], 'sourceHead': proof['head'],
          'scope': 'VERIFIED_TRANSPORT_ONLY_FULL_NATIVE_CAPSULES_STILL_REQUIRED', 'expiresAt': payload['expiresAt']})
    return home


def select_host_carrier(comments, proof):
    candidates = []
    for row in comments:
        body = row['body']
        if 't3-host-assignment-envelope-v1' not in body:
            continue
        need(len(body.encode()) <= 60000, 'assignment_comment_too_large')
        item = strict_json(body)
        if (item.get('kind') == 't3-host-assignment-envelope-v1' and item.get('runId') == proof['runId']
            and item.get('proofSha256') == proof['proofSha256'] and item.get('recipientSha256') == hash_bytes(proof['inputPublicKey'].encode())):
            need(set(item) == {'kind', 'runId', 'proofSha256', 'recipientSha256', 'envelope'}, 'assignment_carrier_fields_refused')
            candidates.append(item['envelope'])
    need(len(candidates) <= 1, 'assignment_carrier_ambiguous')
    return candidates[0] if candidates else None


def read_host_carrier(proof, github, now=None):
    now = now or time.time()
    issue = github.call('/issues/930')
    count = issue.get('comments')
    need(type(count) is int and 0 <= count <= 1000, 'bounded_full_assignment_snapshot_required')
    pages = max(1, (count + 99) // 100); cost = 2 * pages + 4
    core = github.call('/rate_limit').get('resources', {}).get('core', {})
    remaining, limit, reset = (core.get(k) for k in ['remaining', 'limit', 'reset'])
    need(all(type(v) is int for v in [remaining, limit, reset]) and 0 <= remaining <= limit
         and remaining >= cost + 64 and reset > now, 'assignment_api_budget_hold')
    def scan():
        rows, seen, previous = [], set(), 0
        for page in range(1, pages + 1):
            current = github.call(f'/issues/930/comments?per_page=100&page={page}')
            need(isinstance(current, list) and len(current) == min(100, max(0, count - (page - 1) * 100)), 'assignment_snapshot_page_incomplete')
            for row in current:
                need(type(row.get('id')) is int and row['id'] > previous and row['id'] not in seen and isinstance(row.get('body'), str),
                     'assignment_snapshot_ids_invalid')
                previous = row['id']; seen.add(previous)
                rows.append({'id': previous, 'body': row['body'], 'updated_at': row.get('updated_at')})
        need(len(rows) == count, 'assignment_snapshot_count_mismatch')
        return rows
    first = scan(); need(github.call('/issues/930').get('comments') == count, 'assignment_snapshot_count_drift')
    second = scan(); need(github.call('/issues/930').get('comments') == count, 'assignment_snapshot_count_drift')
    need(first == second, 'assignment_snapshot_content_drift')
    return select_host_carrier(second, proof), {'requestCost': cost, 'remainingAfter': remaining - cost, 'reset': reset}


def receive_host_assignment(proof_home, identity, prepare, same, github, sleep=time.sleep, clock=time.time):
    transport_stage('receive-input:proof-binding')
    raw = prepare.private(proof_home / 'host-proof.private.json').read_bytes()
    proof = strict_json(raw); proof['proofSha256'] = hash_bytes(raw)
    need(proof['runId'] == identity['GITHUB_RUN_ID'] and proof['job'] == identity['GITHUB_JOB']
         and proof['head'] == identity['GITHUB_SHA'] and proof['identity'] == identity, 'current_host_proof_required')
    private_key = prepare.private(proof_home / 'ephemeral-input-key.private.pem').read_text()
    # One intent per actual proof; never retry after failed/partial import.
    save(proof_home / 'receive-intent.json', {'proofSha256': proof['proofSha256']})
    deadline = min(datetime.fromisoformat(proof['observedAtUtc']).timestamp() + 1200,
                   datetime.fromisoformat(proof['jobDeadlineUtc']).timestamp())
    while clock() < deadline:
        transport_stage('receive-input:host-inventory')
        current = prepare.host_identity(); prepare.same_host(proof['host'], current)
        inventory = same.docker_resources(prepare, SimpleNamespace(host=current, node=shutil.which('node')))
        need(inventory == proof['inventory'], 'postproof_docker_inventory_changed')
        transport_stage('receive-input:full-snapshot')
        envelope, stats = read_host_carrier(proof, github, clock())
        if envelope is not None:
            transport_stage('receive-input:decrypt-bind')
            payload = crypto_port('decrypt', envelope=envelope, privatePem=private_key, publicPem=proof['inputPublicKey'],
                                  rootPublicPem=ROOT_SIGNING_PUBLIC_PEM, rootSha256=ROOT_SIGNING_PUBLIC_SHA256)
            validate_assignment(payload, proof)
            # Reobserve after remote reads/crypto, before plaintext is committed.
            prepare.same_host(proof['host'], prepare.host_identity())
            need(same.docker_resources(prepare, SimpleNamespace(host=current, node=shutil.which('node'))) == proof['inventory'], 'postimport_inventory_changed')
            transport_stage('receive-input:materialization')
            return materialize_assignment(payload, proof)
        remaining = deadline - clock()
        need(remaining > 0 and stats['remainingAfter'] >= stats['requestCost'] + 64, 'assignment_poll_budget_hold')
        affordable = max(1, (stats['remainingAfter'] - 64) // stats['requestCost'])
        sleep(min(remaining, max(45, remaining / affordable)))
    raise ValueError('postproof_input_deadline_hold')


TRANSPORT_STAGE = 'entry'
TRANSPORT_SAFE_CODES = frozenset(['absolute_path_required', 'actual_branch_actor_required', 'actual_cms_authenticated_aes256gcm_required_no_downgrade', 'actual_github_identity_required', 'actual_hosted_run_source_mismatch', 'actual_mail_digest_differs', 'actual_running_hosted_job_required', 'actual_t3_host_proof_required', 'actual_timezone_bound_authority_birth_required', 'actual_unique_runtime_session_required', 'actual_workflow_ref_mismatch', 'adapter_source_changed', 'all_seventeen_scenario_ids_required', 'ambiguous_evidence_path', 'assigned_database_required', 'assigned_endpoints_required', 'assigned_locked_node_path_differs', 'assigned_mail_chain_required', 'assigned_mail_port_required', 'assignment_api_budget_hold', 'assignment_carrier_ambiguous', 'assignment_carrier_fields_refused', 'assignment_comment_too_large', 'assignment_poll_budget_hold', 'assignment_publication_proof_expired', 'assignment_snapshot_content_drift', 'assignment_snapshot_count_drift', 'assignment_snapshot_count_mismatch', 'assignment_snapshot_ids_invalid', 'assignment_snapshot_page_incomplete', 'attempt_create_unknown', 'attempt_profile_changed_before_archive', 'attempt_readback_unknown', 'authenticated_repository_required', 'backend_assignment_mismatch', 'backend_cleanup_not_verified', 'bootstrap_expired_before_heavy_operation', 'bootstrap_tools_changed_docker_resources', 'both_actual_native_roles_required', 'bounded_assignment_carrier_required', 'bounded_ciphertext_hostproof_required', 'bounded_expiring_timeout_required', 'bounded_full_assignment_snapshot_required', 'bounded_github_operation_required', 'bounded_github_response_required', 'bounded_phase_timeouts_required', 'bounded_private_assignment_files_required', 'bounded_timeout_required', 'canonical_db_port_and_overall_timeout_required', 'canonical_path_required', 'canonical_replay_provenance_required', 'capacity_hierarchy_unknown', 'cgroup_constraint_changed_during_observation', 'cgroup_directory_mount_changed', 'cgroup_membership_ambiguous', 'cgroup_membership_malformed', 'cgroup_membership_missing', 'cgroup_membership_path_unqualified', 'cgroup_namespace_path_not_proc_link', 'cgroup_symlink_or_hidden_directory', 'cgroup_view_changed_during_observation', 'cleanup_source_changed', 'committed_backend_config_overlay_required', 'complete_controlled_underlay_contract_required', 'complete_native_resource_set_required', 'conflicting_docker_context_not_supported', 'controlled_test_only_underlay_input_required', 'controller_inventory_inconsistent', 'controller_parent_inventory_changed', 'cpu_ancestor_control_missing', 'cpu_limit_malformed', 'cpu_limit_not_positive', 'cpu_max_malformed', 'current_host_proof_required', 'current_independent_source_approval_required', 'daemon_identity_missing', 'dedicated_project_required', 'derived_capsule_ref_must_not_create_hash_cycle', 'disabled_controller_interface_unexpected', 'docker_root_free_space_below_floor', 'docker_socket_required', 'duplicate_private_json_key', 'effective_ram_below_8gib', 'effective_ram_not_qualified', 'empty_evidence_manifest', 'environment_id_invalid', 'evidence_bytes_changed', 'evidence_outside_assigned_home', 'exact_actions_required', 'exact_allocated_ports_image_recipient_and_consumer_required', 'exact_attempt_inputs_required', 'exact_ciphertext_hostproof_required', 'exact_host_assignment_carrier_required', 'exact_imported_caller_paths_and_budget_required', 'exact_network_inspection_required', 'exact_overlay_commits_required', 'exact_producer_role_ref_required', 'exact_qualified_forward_migration_required', 'exact_reservation_ref_required', 'exact_runtime_role_scope_required', 'exact_source_custody_required', 'exact_source_event_and_authenticated_publisher_required', 'exact_source_schema_epoch_required', 'exact_tracked_canonical_replay_required', 'exact_unique_native_event_branch_required', 'exclusive_empty_docker_before_hostproof_required', 'exclusive_empty_docker_required', 'expiry_must_leave_owned_cleanup_before_hosted_job_deadline', 'explicit_adapter_sources_required', 'explicit_allocation_required', 'explicit_authorized_environment_required', 'explicit_environment_project_required', 'explicit_environment_required', 'explicit_hosted_profile_required', 'explicit_original_recipient_required', 'explicit_python_consumer_required', 'explicit_single_use_producer_plan_required', 'explicit_user_native_mandate_required', 'explicit_whitelisted_execution_purpose_required', 'fixed_docker_endpoint_required', 'fixed_physical_pilot_descriptor_required', 'fixed_purpose_scenario_required', 'fixed_reviewed_hosted_consumer_required', 'fixed_transport_proof_home_required', 'fresh_build_id_missing', 'fresh_clean_app_required', 'fresh_github_hosted_dispatch_required', 'fresh_host_assignment_binding_required', 'fresh_host_proof_required', 'fresh_offhost_proof_home_required', 'frozen_ordered_tests_and_evidence_matrix_required', 'frozen_underlay_parameter_object_required', 'full_ediel_cohort_28_required', 'full_source_identity_required', 'full_v1_runtime_authority_required', 'future_utc_expiry_required', 'genuine_current_forward_source_qualification_required', 'gitdata_unknown_no_retry', 'gitdata_unknown_or_refused_no_retry', 'github_redirect_forbidden', 'global_cgroup_mount_unproven', 'global_current_proc_view_unproven', 'hash_bound_private_native_authority_ref_required', 'hidden_cgroup_overmount', 'host_assignment_expired_or_unbounded', 'hosted_builtin_crypto_node_required', 'hosted_postgres17_client_missing', 'hostproof_must_leave_import_and_cleanup_time', 'identity_command_failed', 'initial_cgroup_namespace_unproven', 'installed_next_differs_from_lock', 'invalid_docker_inventory', 'invalid_evidence_manifest', 'kernel_filesystem_identity_unreadable', 'kernel_interface_mount_changed', 'kernel_interface_too_large', 'kernel_path_mount_ambiguous', 'kernel_path_mount_missing', 'live_reservation_changed', 'live_reservation_differs', 'live_role_authority_changed', 'local_unix_docker_required', 'locked_dependencies_and_fresh_build_required', 'locked_mail_image_required', 'locked_node_path_and_hosted_pg17_client_required', 'locked_tool_version_differs', 'mail_password_file_differs', 'memory_hierarchy_missing', 'memory_limit_malformed', 'mount_device_malformed', 'mount_inventory_empty', 'mount_inventory_malformed', 'mount_inventory_not_absolute', 'namespace_directory_not_procfs', 'narrow_native_event_branch_required', 'native_role_ref_required', 'network_create_unknown_no_retry', 'neutral_private_native_capsule_binding_required', 'neutral_receipt_tree_required', 'new_network_already_attached', 'node22_required', 'nonfinite_private_json', 'not_expected_kernel_interface', 'official_ledger_differs', 'official_tool_archive_hash_differs', 'ordinary_packet_must_recheck_runtime_role_refs', 'original_host_proof_bytes_changed', 'original_recipient_changed', 'outer_docker_inventory_not_restored', 'overlay_not_in_app_ancestry', 'own_host_proof_required', 'own_t3_repository_required', 'owned_loopback_network_changed', 'owned_network_name_already_exists', 'owned_network_still_attached', 'packet_expired_before_spawn', 'partial_materialization_root_symlink', 'partial_or_changed_native_authority_set', 'partial_schema_fingerprint_invalid', 'partial_startup_requires_exact_recovery', 'phase_failed', 'phase_timed_out_or_interrupted', 'physical_memory_unreadable', 'pinned_mail_image_required', 'plan_changed', 'plan_expired', 'plan_must_bind_actual_role_receipts', 'postimport_inventory_changed', 'postproof_docker_inventory_changed', 'postproof_input_deadline_hold', 'preserve_unknown_remaining_backend_resources', 'private_assignment_bytes_refused', 'private_assignment_duplicate_or_hash_refused', 'private_assignment_path_refused', 'private_crypto_hold', 'private_crypto_output_too_large', 'private_environment_changed_before_fixture', 'private_environment_invalid', 'private_home_outside_checkouts_required', 'private_home_outside_git_required', 'private_inputs_outside_git_required', 'private_original_bytes_changed', 'private_original_name_and_hash_required', 'private_path_required', 'proc_view_changed_before_ancestor_read', 'proc_view_not_current_process', 'producer_receipt_source_mismatch', 'profile_changed', 'psql17_required', 'public_exact_source_paths_only', 'qualified_builtin_crypto_node_required', 'qualified_committed_config_overlay_required', 'qualified_dependency_locks_differ', 'regular_official_cli_members_required', 'required_ancestor_control_missing', 'required_local_credential_missing', 'reservation_epoch_model_required', 'retained_t4_qualification_originals_required', 'reviewed_dependency_lock_required', 'reviewed_scenario_source_required', 'reviewed_workflow_source_required', 'runner_or_daemon_changed', 'runtime_authority_expired', 'same_qualified_harness_dependency_lock_required', 'same_shell_source_changed', 'scenario_evidence_incomplete', 'scenario_report_missing_or_failed', 'scenario_step_not_passed', 'separate_canonical_proof_home_required', 'separate_nonoverlapping_replay_checkout_required', 'separate_producer_backend_authority_required', 'separate_qualification_originals_required', 'seven_distinct_ports_required', 'seven_unique_ports_required', 'shell_or_replay_override_forbidden', 'single_create_only_native_push_required', 'source_bound_exclusive_bootstrap_required', 'source_custody_changed', 'source_not_exact_clean_commit', 'source_pinned_transport_recipient_required', 'stale_build_not_reusable', 'supabase_pin_required', 'threaded_cgroup_not_qualified', 'tracked_reviewed_adapter_required', 'tracked_reviewed_python_adapter_required', 'tracked_reviewed_same_shell_consumer_required', 'transport_evidence_size_hold', 'two_genuine_t4_output_reviews_required', 'two_independent_source_reviews_required', 'ubuntu_24_04_required', 'unassigned_active_outbox_before_fixture', 'unassigned_dotenv_file', 'unknown_docker_driver', 'unknown_environment_key', 'unqualified_kernel_namespace_contract', 'unsafe_node_archive', 'unsupported_kernel_fd_abi', 'utc_plan_expiry_required', 'v1_memory_hierarchy_not_enabled', 'verified_producer_and_backend_reservations_required'])

def transport_stage(stage):
    global TRANSPORT_STAGE
    TRANSPORT_STAGE = stage


def record_transport_failure(error):
    # Called only by actual host-proof/receive CLI. No raw exception detail,
    # payload, key, environment dump or public logging.
    root = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    proof = root / 't3-host-proof'
    if not proof.exists():
        proof.mkdir(mode=0o700)
    load('prepare').private(proof, True)
    code = str(error) if type(error) is ValueError or type(error).__name__ == 'Blocked' else ''
    if code not in TRANSPORT_SAFE_CODES or not re.fullmatch('[a-z0-9_]{1,120}', code):
        code = 'transport_observation_or_import_failed'
    save(proof / ('transport-failure-' + str(os.getpid()) + '.json'),
         {'state': 'HOLD', 'stage': TRANSPORT_STAGE, 'errorType': type(error).__name__, 'reason': code,
          'nativeExecuted': False, 'retryAuthorized': False})


def archive_transport_hold(proof_home, prepare):
    root = prepare.canonical(os.environ['RUNNER_TEMP'])
    need(proof_home == root / 't3-host-proof', 'fixed_transport_proof_home_required')
    prepare.private(proof_home, True)
    # Whitelist originals explicitly. NEVER tar proof_home or include any PEM.
    names = ['host-proof.private.json', 'publish-intent.json', 'receive-intent.json', 'assignment-publish-intent.json']
    selected = []
    for file in sorted(proof_home.iterdir()):
        if file.name in names or re.fullmatch(r'(?:api-[0-9]+-[0-9]+|transport-failure-[0-9]+)\.json', file.name):
            selected.append(prepare.private(file))
    home = root / 't3-hosted-private'
    inventory = []
    if home.exists() or home.is_symlink():
        need(not home.is_symlink(), 'partial_materialization_root_symlink')
        prepare.private(home, True)
        for file in sorted(home.rglob('*')):
            meta = file.lstat()
            row = {'path': str(file.relative_to(home)), 'mode': oct(meta.st_mode & 0o777), 'bytes': meta.st_size}
            if stat.S_ISREG(meta.st_mode) and not file.is_symlink():
                # Inventory only: signed originals stay at their original paths.
                raw = prepare.private(file).read_bytes()
                row.update(kind='regular', sha256=hash_bytes(raw))
            else:
                row['kind'] = 'directory' if stat.S_ISDIR(meta.st_mode) else 'unqualified-preserved'
            inventory.append(row)
    summary = {'schema': 't3-private-transport-hold-v1', 'state': 'HOLD', 'nativeAcceptance': 'NOT_CLAIMED',
               'ephemeralPrivateKeyIncluded': False, 'selectedOriginals': [f.name for f in selected],
               'partialMaterializationInventory': inventory}
    archive = root / 't3-hosted-transport-hold.tar.gz'
    encrypted = root / 't3-hosted-transport-hold.enc.json'
    total = sum(f.stat().st_size for f in selected)
    need(total <= 512 * 1024 * 1024, 'transport_evidence_size_hold')
    try:
        with open(archive, 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as stream:
            with tarfile.open(fileobj=stream, mode='w:gz') as bundle:
                for file in selected:
                    raw = file.read_bytes()
                    # Retain exact bytes even if an interrupted writer left
                    # partial JSON. The filename whitelist excludes key files.
                    info = tarfile.TarInfo('transport/' + file.name); info.size = len(raw); info.mode = 0o600
                    bundle.addfile(info, io.BytesIO(raw))
                raw = json.dumps(summary, sort_keys=True).encode()
                info = tarfile.TarInfo('transport/terminal-hold.json'); info.size = len(raw); info.mode = 0o600
                bundle.addfile(info, io.BytesIO(raw))
        crypto_port('encrypt-file', sourcePath=str(archive), outputPath=str(encrypted), publicPem=REVIEWER_CERT)
    finally:
        archive.unlink(missing_ok=True)
    return encrypted


def postproof_main(argv):
    parser = argparse.ArgumentParser(description='T3 ciphertext-only hostproof transport; never native authority')
    parser.add_argument('mode', choices=['host-proof', 'receive-input', 'open-proof', 'seal-assignment', 'publish-assignment', 'transport-archive'])
    parser.add_argument('--proof-home', required=True)
    parser.add_argument('--profile')
    parser.add_argument('--files')
    parser.add_argument('--signing-key')
    parser.add_argument('--output')
    parser.add_argument('--ciphertext')
    parser.add_argument('--evidence-key')
    args = parser.parse_args(argv)
    prepare, same = load('prepare'), load('same-shell')
    proof_home = Path(args.proof_home)
    if args.mode == 'transport-archive':
        archive_transport_hold(proof_home, prepare)
        return 0
    if args.mode == 'open-proof':
        need(not proof_home.exists() and proof_home.is_absolute(), 'fresh_offhost_proof_home_required')
        item = strict_json(prepare.private(args.ciphertext).read_bytes())
        need(set(item) == {'kind', 'envelope'} and item['kind'] == 't3-host-proof-envelope-v1', 'exact_ciphertext_hostproof_required')
        opened = crypto_port('open-proof', envelope=item['envelope'], privatePem=prepare.private(args.evidence_key).read_text(), publicPem=REVIEWER_CERT)
        raw = base64.b64decode(opened['proofBytesBase64'], validate=True)
        need(hash_bytes(raw) == opened['proofSha256'], 'original_host_proof_bytes_changed')
        proof = strict_json(raw)
        need(proof['format'] == 't3_actual_host_observation_v1' and proof['repository'] == 'heke99/gridex-ops-platform'
             and proof['workflow'] == WORKFLOW and proof['purpose'] == 't3-hosted-postproof-input', 'own_host_proof_required')
        proof_home.mkdir(mode=0o700)
        fresh_private_bytes(proof_home / 'host-proof.private.json', raw)
        return 0
    if args.mode == 'publish-assignment':
        # Explicit offhost publication, separate from sealing. One attempt only.
        raw = prepare.private(proof_home / 'host-proof.private.json').read_bytes()
        proof = strict_json(raw); proof['proofSha256'] = hash_bytes(raw)
        observed = datetime.fromisoformat(proof['observedAtUtc'].replace('Z', '+00:00'))
        need(observed <= datetime.now(timezone.utc) < observed + timedelta(minutes=20), 'assignment_publication_proof_expired')
        carrier_raw = prepare.private(args.ciphertext).read_bytes()
        need(len(carrier_raw) <= 60000, 'bounded_assignment_carrier_required')
        carrier = strict_json(carrier_raw)
        envelope = select_host_carrier([{'body': carrier_raw.decode()}], proof)
        need(envelope is not None and envelope.get('format') == 't3_private_evidence_envelope_v1'
             and len(envelope.get('ciphertext', '')) <= 58000, 'exact_host_assignment_carrier_required')
        save(proof_home / 'assignment-publish-intent.json', {'carrierSha256': hash_bytes(carrier_raw)})
        github = GitHub('heke99/gridex-ops-platform', os.environ.get('GH_TOKEN')); github.audit_home = proof_home
        github.call('/issues/930/comments', 'POST', {'body': json.dumps(carrier, separators=(',', ':'))})
        return 0
    if args.mode == 'seal-assignment':
        # OFF-HOST producer only. Explicit files, no publication or role creation.
        raw = prepare.private(proof_home / 'host-proof.private.json').read_bytes()
        proof = strict_json(raw); proof['proofSha256'] = hash_bytes(raw)
        profile = strict_json(prepare.private(args.profile).read_bytes())
        files = strict_json(prepare.private(args.files).read_bytes())
        payload = proof_payload(proof, profile, files, profile['plan']['expiresAtUtc'])
        validate_assignment(payload, proof)
        envelope = crypto_port('seal', payload=payload, privatePem=prepare.private(args.signing_key).read_text(),
              publicPem=proof['inputPublicKey'], rootPublicPem=ROOT_SIGNING_PUBLIC_PEM, rootSha256=ROOT_SIGNING_PUBLIC_SHA256)
        carrier = {'kind': 't3-host-assignment-envelope-v1', 'runId': proof['runId'], 'proofSha256': proof['proofSha256'],
                   'recipientSha256': hash_bytes(proof['inputPublicKey'].encode()), 'envelope': envelope}
        need(len(json.dumps(carrier).encode()) <= 60000 and len(envelope['ciphertext']) <= 58000, 'bounded_assignment_carrier_required')
        save(args.output, carrier)
        save(str(args.output) + '.sizes.json', {'ciphertextCharacters': len(envelope['ciphertext']),
             'carrierBytes': len(json.dumps(carrier).encode()), 'fileOriginalBytes': sum(len(base64.b64decode(f['base64Bytes'])) for f in files),
             'nativeAuthority': 'SEPARATE_FULL_NATIVE_CAPSULES_REQUIRED_NOT_CREATED_BY_TRANSPORT'})
        return 0
    transport_stage(args.mode + ':identity')
    identity = hosted_identity(os.environ)
    need(identity['GITHUB_REPOSITORY'] == 'heke99/gridex-ops-platform', 'own_t3_repository_required')
    github = GitHub(identity['GITHUB_REPOSITORY'], os.environ.get('GH_TOKEN'))
    runner_temp = prepare.canonical(os.environ['RUNNER_TEMP'])
    need(proof_home == runner_temp / 't3-host-proof' and str(proof_home.resolve()) == str(proof_home), 'separate_canonical_proof_home_required')
    if args.mode == 'receive-input':
        prepare.private(proof_home, True)
        github.audit_home = proof_home
        home = receive_host_assignment(proof_home, identity, prepare, same, github)
        # Fixed .03 uses equal source while preserving three separate checkouts.
        profile = strict_json((home / 'profile.json').read_bytes())
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('appCommit=' + profile['plan']['appCommit'] + '\n')
        return 0
    need(not proof_home.exists(), 'fresh_host_proof_required')
    proof_home.mkdir(mode=0o700)
    github.audit_home = proof_home
    transport_stage('host-proof:actual-job')
    job = observed_job(identity, github)
    need(datetime.now(timezone.utc) < datetime.fromisoformat(job['job']['started_at'].replace('Z', '+00:00')) + timedelta(minutes=70), 'hostproof_must_leave_import_and_cleanup_time')
    transport_stage('host-proof:source')
    tree = prepare.capture(['git', '-C', str(HARNESS), 'rev-parse', 'HEAD^{tree}'])
    prepare.source(HARNESS, identity['GITHUB_SHA'], tree)
    transport_stage('host-proof:host-capacity')
    host = prepare.host_identity()
    transport_stage('host-proof:inventory')
    inventory = same.docker_resources(prepare, SimpleNamespace(host=host, node=shutil.which('node')))
    need(not inventory['containers'] and not inventory['volumes'], 'exclusive_empty_docker_before_hostproof_required')
    transport_stage('host-proof:ephemeral-key')
    keys = crypto_port('keygen')
    fresh_private_bytes(proof_home / 'ephemeral-input-key.private.pem', keys['privatePem'].encode())
    started = datetime.fromisoformat(job['job']['started_at'].replace('Z', '+00:00'))
    proof = {'format': 't3_actual_host_observation_v1', 'purpose': 't3-hosted-postproof-input', 'repository': identity['GITHUB_REPOSITORY'],
          'workflow': WORKFLOW, 'runId': identity['GITHUB_RUN_ID'], 'runAttempt': identity['GITHUB_RUN_ATTEMPT'], 'job': identity['GITHUB_JOB'],
          'head': identity['GITHUB_SHA'], 'tree': tree, 'host': host, 'inventory': inventory, 'identity': identity,
          'inputPublicKey': keys['publicPem'], 'nonce': keys['nonce'], 'observedAtUtc': datetime.now(timezone.utc).isoformat(),
          'jobDeadlineUtc': (started + timedelta(minutes=90)).isoformat(), 'workspaceRoot': str(prepare.canonical(os.environ['GITHUB_WORKSPACE'])),
          'runnerTemp': str(runner_temp), 'observerNode': keys['nodeVersion'], 'backendExecuted': False, 'nativeExecuted': False}
    save(proof_home / 'host-proof.private.json', proof)
    raw = (proof_home / 'host-proof.private.json').read_bytes()
    encrypted = crypto_port('encrypt', value={'proofBytesBase64': base64.b64encode(raw).decode(), 'proofSha256': hash_bytes(raw)}, publicPem=REVIEWER_CERT)
    body = {'kind': 't3-host-proof-envelope-v1', 'envelope': encrypted}
    need(len(json.dumps(body).encode()) <= 60000, 'bounded_ciphertext_hostproof_required')
    save(proof_home / 'host-proof.enc.json', body)
    # One publication attempt; unknown result is HOLD, never post again.
    save(proof_home / 'publish-intent.json', {'ciphertextSha256': hash_bytes(json.dumps(body).encode())})
    transport_stage('host-proof:ciphertext-post')
    github.call('/issues/930/comments', 'POST', {'body': json.dumps(body)})
    return 0



def main(argv=None):
    if (argv or sys.argv[1:]) and (argv or sys.argv[1:])[0] in ["host-proof", "receive-input", "open-proof", "seal-assignment", "publish-assignment", "transport-archive"]:
        try:
            return postproof_main(argv or sys.argv[1:])
        except Exception as error:
            if (argv or sys.argv[1:])[0] in ['host-proof', 'receive-input']:
                record_transport_failure(error)
            raise
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check', 'execute', 'archive'])
    parser.add_argument('--profile', required=True)
    args = parser.parse_args(argv)
    prepare, same = load('prepare'), load('same-shell')
    original = prepare.private(args.profile).read_bytes()
    profile = json.loads(original)
    if args.mode == 'archive':
        archive_originals(profile, prepare, hash_bytes(original))
        return 0
    identity = hosted_identity(os.environ)
    packet, inputs, before = preflight(profile, identity, prepare, same)
    github = GitHub(identity['GITHUB_REPOSITORY'], os.environ.get('GH_TOKEN'))
    try:
        job = observed_job(identity, github)
        admit_job_deadline(job, packet.expires)
        read_authorities(profile, packet.plan, identity, github, prepare)
    finally:
        save(packet.home / (args.mode + '-admission-api.json'), github.events)
    if args.mode == 'check':
        print('T3_HOSTED_BOOTSTRAP_CHECKED_NOT_PROVISIONED')
        return 0
    with open(packet.home / 'producer.lock', 'a', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(prepare.private(args.profile).read_bytes() == original, 'profile_changed')
        prepare.same_host(packet.host, prepare.host_identity())
        same.bounded_timeout(packet.plan['sameShellTimeoutSeconds'], packet.expires)
        save(packet.home / 'execution-intent.json', {'schema': 'track3-hosted-attempt-v1', 'profileSha256': hash_bytes(original),
             'identity': identity, 'observedJob': job, 'host': packet.host, 'transportCapability': packet.transport,
             'dockerBefore': before, 'processesBefore': process_inventory()})
        try:
            consumed = consume_attempt(github, profile['authorities']['producer']['sha'], packet.plan['inputEpoch'])
        finally:
            save(packet.home / 'attempt-api.json', github.events)
        # No download/install/pull/start before actual capacity, authority and event budget.
        locked_tools(packet, prepare)
        prepare.same_host(packet.host, prepare.host_identity())
        read_authorities(profile, packet.plan, identity, github, prepare)
        save(packet.home / 'prespawn-authority-api.json', github.events)
        sources = []
        for label, checkout, commit, tree in [('app', packet.app, packet.plan['appCommit'], packet.plan['appTree']),
            ('replay', inputs[0], packet.plan['appCommit'], packet.plan['appTree']),
            ('harness', prepare.HARNESS, packet.plan['harnessCommit'], packet.plan['harnessTree'])]:
            prepare.source(checkout, commit, tree)
            sources.append({'role': label, 'commit': commit, 'tree': tree,
                'packageLockSha256': hash_bytes((checkout / 'package-lock.json').read_bytes()),
                'canonicalReplaySha256': hash_bytes((checkout / 'scripts/gridex-aud-003-clean-replay.sh').read_bytes())})
        save(packet.home / 'source-receipts.json', sources)
        save(packet.home / 'plan.json', packet.plan)
        need(same.docker_resources(prepare, packet) == before, 'bootstrap_tools_changed_docker_resources')
        same.bounded_timeout(packet.plan['sameShellTimeoutSeconds'], packet.expires)
        network = create_network(prepare, packet, identity, hash_bytes(original))
        cleanup_error = None
        try:
            save(packet.home / 'bootstrap-admission.json', {'schema': 'track3-hosted-bootstrap-admitted-v1',
                 'profileSha256': hash_bytes(original), 'planSha256': hash_bytes((packet.home / 'plan.json').read_bytes()),
                 'identity': identity, 'host': packet.host, 'attemptRef': consumed, 'environment': profile['environment'], 'ownedNetwork': network})
            env = {**prepare.phase_environment(packet.host, packet.node), 'T3_HOSTED_PROFILE': str(Path(args.profile).resolve()),
                   'SUPABASE_HOME': str(packet.home / 'supabase-home'), 'DO_NOT_TRACK': '1', 'SUPABASE_TELEMETRY_DISABLED': '1',
                   'SUPABASE_NETWORK_ID': network['name'], 'SUPABASE_INTERNAL_IMAGE_REGISTRY': 'ghcr.io'}
            shell_args = (*inputs, packet.home / 'plan.json', packet.home / 'same-shell.log', packet.home / 'same-shell-boundaries.log')
            result = same.run_guarded(packet, prepare, shell_args, packet.plan['sameShellTimeoutSeconds'], env)
        except BaseException as error:
            result = {'ok': False, 'supervisorFailure': {'type': type(error).__name__}}
        finally:
            try:
                cleanup_network(prepare, same, packet, network, before)
            except BaseException as error:
                cleanup_error = {'type': type(error).__name__, 'state': 'HOLD_PRESERVE_UNQUALIFIED_RESOURCES'}
                save(packet.home / 'network-cleanup-hold.json', cleanup_error)
        source_restored = True
        try:
            for checkout, commit, tree in [(packet.app, packet.plan['appCommit'], packet.plan['appTree']),
                (inputs[0], packet.plan['appCommit'], packet.plan['appTree']),
                (prepare.HARNESS, packet.plan['harnessCommit'], packet.plan['harnessTree'])]:
                prepare.source(checkout, commit, tree)
            read_authorities(profile, packet.plan, identity, github, prepare)
        except Exception:
            source_restored = False
        save(packet.home / 'terminal-authority-api.json', github.events)
        initial = json.loads((packet.home / 'execution-intent.json').read_bytes())['processesBefore']
        remaining = {pid: ticks for pid, ticks in process_inventory().items() if initial.get(pid) != ticks}
        result.update(newProcessesRemaining=remaining, sourcesRestored=source_restored, networkCleanupFailure=cleanup_error,
                      execution=packet.plan['execution'], wholeSuiteAcceptance='NOT_CLAIMED')
        result['ok'] = result['ok'] and not remaining and source_restored and cleanup_error is None
        save(packet.home / 'hosted-terminal.json', result)
    print('T3_HOSTED_RETURNED_REQUIRES_INDEPENDENT_REVIEW' if result['ok'] else 'T3_HOSTED_HOLD')
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('T3_HOSTED_HOLD_PRIVATE_BOOTSTRAP_OR_EFFECT_FAILURE', file=sys.stderr)
        sys.exit(1)
