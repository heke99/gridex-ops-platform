"""Consume the actual live canonical backend; run only the complete E03.03 pilot.

This is called by the original replay shell, whose EXIT trap remains owner of
backend cleanup. No standalone backend start, stop shim or replay substitute.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
import urllib.request

TRACK = Path(__file__).resolve().parent
EXPECTED_NAMES = {
    'EDIEL03 deadlines, retry och återhämtning EDIEL03.03 drop-after-data -> klass unknown, delivery_uncertain, drain processed:0, exakt 1 kopia, ingen blind retry',
    'EDIEL03 deadlines, retry och återhämtning EDIEL03.03 hang (hangMs 6 s) -> samma oracle',
}
UNDERLAY_NAMES = (
    'Controlled TEST issuer underlay IU01 actual actors and denied access are independently observed',
    'Controlled TEST issuer underlay IU02 separate unapproved physical challenge stays held and is never retrofitted',
    'Controlled TEST issuer underlay IU03 independent birth creates only a new controlled TEST epoch',
    'Controlled TEST issuer underlay IU04 two registered applications issue distinct retained originals',
    'Controlled TEST issuer underlay IU05 exact issued MIME reaches ordinary physical source admission',
    'Controlled TEST issuer underlay IU06 independent checkpoint and source history qualify the exact admitted issuance',
    'Controlled TEST issuer underlay IU07 replay retains issuance while equal-payload new issuance preserves collisions',
    'Controlled TEST issuer underlay IU08 correction and tombstone retention preserve prior identifiers',
    'Controlled TEST issuer underlay IU09 revocation holds subsequent operations without rewriting originals',
    'Controlled TEST issuer underlay IU10 actual outputs and private evidence remain complete and unchanged',
)
UNDERLAY_MATRIX = {
    'schema': 'controlled-test-issuer-underlay-matrix-v1', 'purpose': 'controlled_issuer_underlay', 'environment': 'test',
    'assurance': 'controlled_test_only', 'marketActivationGranted': False, 'productionAuthorityGranted': False,
    'requiredEvidence': ['actual_auth_actor_and_own_permission_foundation', 'denied_actor_http_and_unchanged_authority',
        'separate_unapproved_physical_challenge_hold_and_no_retrofit', 'new_birth_originals_and_independent_review',
        'two_application_inventory_and_issuance_journal', 'issued_mime_tls_append_and_ordinary_source_binding',
        'independent_checkpoint_and_exact_source_history', 'replay_identity_and_equal_payload_distinct_issuance',
        'correction_tombstone_retention_identifier_preservation', 'revocation_future_hold_and_immutable_originals',
        'actual_effect_ids_hashes_and_complete_private_manifest'],
    'nativeAcceptance': 'requires_independent_actual_output_reviews',
}


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), TRACK / (name + '.py'))
    unit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(unit)
    return unit


def need(ok, code):
    if not ok:
        raise ValueError(code)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def validate_pilot(report, assignment_hash):
    need(report.get('exit') == 0 and isinstance(report.get('scenarios'), list) and len(report['scenarios']) == 1,
         'one_complete_pilot_report_required')
    item = report['scenarios'][0]
    v, steps = item.get('vitest') or {}, item.get('steps') or []
    need(item.get('scenario') == 'ediel03-03' and item.get('file') == 'scenarios/ediel03-03.test.ts'
         and item.get('exit') == 0 and item.get('harnessError') is None and v.get('success') is True
         and v.get('numTotalTests') == 2 and v.get('numPassedTests') == 2
         and all(v.get(key) == 0 for key in ['numFailedTests', 'numPendingTests', 'numTodoTests'])
         and item.get('identity', {}).get('assignmentSha256') == assignment_hash
         and len(steps) == 2 and {s.get('name') for s in steps} == EXPECTED_NAMES
         and all(s.get('scenarioId') == 'EDIEL03.03' and s.get('status') == 'passed' for s in steps)
         and item.get('evidenceManifest'), 'complete_both_variant_physical_pilot_required')
    return {'scope': ['EDIEL03.03'], 'variants': ['drop-after-data', 'hang'], 'wholeSuiteAcceptance': 'NOT_CLAIMED'}


def validate_underlay(report, assignment_hash, execution):
    need(execution.get('purpose') == 'controlled_issuer_underlay'
         and execution.get('scenarioFile') == 'scenarios/issuer-underlay.test.ts', 'fixed_controlled_underlay_purpose_required')
    need(report.get('exit') == 0 and isinstance(report.get('scenarios'), list) and len(report['scenarios']) == 1,
         'one_underlay_report_required')
    item = report['scenarios'][0]
    names = execution['expectedTestNames']
    steps, v = item.get('steps') or [], item.get('vitest') or {}
    need(names == list(UNDERLAY_NAMES) and execution.get('evidenceMatrix') == UNDERLAY_MATRIX
         and item.get('scenario') == 'issuer-underlay' and item.get('file') == execution['scenarioFile']
         and item.get('exit') == 0 and item.get('harnessError') is None and v.get('success') is True
         and type(v.get('numTotalTests')) is int and type(v.get('numPassedTests')) is int
         and v.get('numTotalTests') == len(names) and v.get('numPassedTests') == len(names)
         and all(v.get(key) == 0 for key in ['numFailedTests', 'numPendingTests', 'numTodoTests'])
         and item.get('identity', {}).get('assignmentSha256') == assignment_hash
         and [step.get('name') for step in steps] == names and all(step.get('status') == 'passed' for step in steps)
         and item.get('observations', {}).get('evidenceMatrix') == execution['evidenceMatrix']
         and item.get('evidenceManifest'), 'exact_ordered_underlay_and_evidence_matrix_required')
    return {'scope': 'controlled_issuer_underlay', 'originals': 'REQUIRES_INDEPENDENT_REVIEW',
            'wholeSuiteAcceptance': 'NOT_CLAIMED', 'issuerAuthorityAcceptance': 'NOT_CLAIMED'}


def inspect_backend(prepare, plan):
    project = plan['projectId']
    env = prepare.phase_environment(plan['_host'], plan['nodeBin'])
    endpoint = 'unix://' + plan['_host']['socket']
    network = plan['_network']
    rows = json.loads(prepare.capture(['docker', '--host', endpoint, 'network', 'inspect', network['id']], env=env))
    need(len(rows) == 1, 'exact_owned_network_required')
    load('hosted-profile').network_binding(rows[0], network)
    def inspect(name):
        rows = json.loads(prepare.capture(['docker', '--host', endpoint, 'inspect', '--type', 'container', name], env=env))
        need(len(rows) == 1, 'exact_backend_container_required')
        c = rows[0]
        need(c['State']['Running'] is True and c['Config']['Labels'].get('com.supabase.cli.project') == project,
             'canonical_project_container_required')
        return c
    db, api, storage = [inspect('supabase_' + service + '_' + project) for service in ['db', 'kong', 'storage']]
    for c, inner, port in [(db, '5432/tcp', plan['ports']['db']), (api, '8000/tcp', plan['ports']['api'])]:
        need(c['NetworkSettings']['Ports'].get(inner) == [{'HostIp': '127.0.0.1', 'HostPort': str(port)}],
             'actual_loopback_binding_required')
    identity = json.loads(prepare.capture(['psql', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1',
        '-c', "SET default_transaction_read_only=on; SELECT jsonb_build_object('systemIdentifier',(pg_control_system()).system_identifier::text,'major',current_setting('server_version_num')::int/10000,'database',current_database())"], env=env))
    need(identity['major'] == 17 and identity['database'] == 'postgres' and identity['systemIdentifier'].isdigit(), 'actual_pg17_identity_required')
    generated = prepare.capture(['docker', '--host', endpoint, 'container', 'ls', '-aq', '--no-trunc'], env=env).splitlines()
    import re
    need(generated and all(re.fullmatch('[a-f0-9]{64}', value) for value in generated), 'complete_canonical_container_inventory_required')
    observations = json.loads(prepare.capture(['docker', '--host', endpoint, 'inspect', '--type', 'container', *generated], env=env))
    need(len(observations) == len(generated) and {c['Id'] for c in observations} == set(generated)
         and all(c['Config']['Labels'].get('com.supabase.cli.project') == project
                 and set(c['NetworkSettings']['Networks']) == {network['name']}
                 and c['NetworkSettings']['Networks'][network['name']]['NetworkID'] == network['id'] for c in observations),
         'unassigned_canonical_resources')
    images = json.loads(prepare.capture(['docker', '--host', endpoint, 'image', 'inspect', *sorted({c['Image'] for c in observations})], env=env))
    image_receipts = [{'id': item['Id'], 'repoDigests': item.get('RepoDigests', []), 'architecture': item['Architecture'], 'os': item['Os']} for item in images]
    resources = {'containers': [{'id': c['Id'], 'name': c['Name'], 'imageId': c['Image'], 'imageRef': c['Config']['Image'],
                 'labels': c['Config']['Labels'], 'ports': c['NetworkSettings']['Ports'], 'running': c['State']['Running']} for c in observations],
                 'images': image_receipts}
    return {'version': 1, 'workerId': 'T3', 'environmentId': plan['environmentId'], 'projectId': project,
            'host': '127.0.0.1', 'port': plan['ports']['db'], 'database': 'postgres', 'containerId': db['Id'],
            'systemIdentifier': identity['systemIdentifier']}, api['Id'], storage['Id'], resources


def environment_from_status(status, plan, environment, home):
    ports = plan['ports']
    need(environment in ['test', 'production'] and status.get('API_URL') == 'http://127.0.0.1:' + str(ports['api'])
         and status.get('DB_URL') == 'postgresql://postgres:postgres@127.0.0.1:' + str(ports['db']) + '/postgres'
         and status.get('ANON_KEY') and status.get('SERVICE_ROLE_KEY'), 'actual_local_status_required')
    password = secrets.token_hex(24)
    return {'T3_MODE': environment, 'T3_SIM_HOME': str(home), 'T3_APP_PORT': str(ports['app']),
        'T3_APP_URL': 'http://127.0.0.1:' + str(ports['app']), 'T3_CONTROL_PORT': str(ports['control']),
        'T3_SMTP_PORT': str(ports['smtp']), 'T3_IMAP_TLS_PORT': str(ports['imapTls']), 'T3_IMAP_PLAIN_PORT': str(ports['imapPlain']),
        'T3_DB_URL': status['DB_URL'], 'NEXT_PUBLIC_SUPABASE_URL': status['API_URL'], 'SUPABASE_URL': status['API_URL'],
        'NEXT_PUBLIC_SUPABASE_ANON_KEY': status['ANON_KEY'], 'SUPABASE_SERVICE_ROLE_KEY': status['SERVICE_ROLE_KEY'],
        'NODE_EXTRA_CA_CERTS': str(home / 'ca/ca.pem'), 'EDIEL_EMAIL_PROVIDER': 'strato',
        'EDIEL_SMTP_HOST': '127.0.0.1', 'EDIEL_SMTP_PORT': str(ports['smtp']), 'EDIEL_SMTP_SECURE': 'true',
        'EDIEL_SMTP_USER': 'ediel@t3.sim.invalid', 'EDIEL_SMTP_PASS': password, 'EDIEL_SMTP_FROM': 'ediel@t3.sim.invalid',
        'EDIEL_SHARED_MAILBOX_ADDRESS': 'ediel@t3.sim.invalid', 'EDIEL_MESSAGE_ID_DOMAIN': 't3.sim.invalid',
        'EDIEL_IMAP_HOST': '127.0.0.1', 'EDIEL_IMAP_PORT': str(ports['imapTls']), 'EDIEL_IMAP_USER': 'ediel',
        'EDIEL_IMAP_PASS': password, 'T3_IMAP_USER': 'ediel', 'T3_IMAP_PASS': password, 'T3_MAILBOX_ADDRESS': 'ediel@t3.sim.invalid',
        'EDIEL_CRON_SECRET': secrets.token_hex(32), 'EDIEL_INBOUND_CRON_SECRET': secrets.token_hex(32), 'NEXT_TELEMETRY_DISABLED': '1', 'T3_E01_N': '28'}


def create_private_mail_inputs(home, values, prepare):
    for directory in ['ca', 'secrets', 'env']:
        (home / directory).mkdir(mode=0o700)
    ca = home / 'ca'
    for argv in [
        ['openssl', 'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-keyout', str(ca / 'ca.key'), '-out', str(ca / 'ca.pem'), '-days', '2', '-subj', '/CN=T3 disposable local CA'],
        ['openssl', 'req', '-newkey', 'rsa:3072', '-nodes', '-keyout', str(ca / 'server.key'), '-out', str(ca / 'server.csr'), '-subj', '/CN=localhost'],
    ]:
        prepare.capture(argv)
    (ca / 'extensions').write_text('subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n')
    prepare.capture(['openssl', 'x509', '-req', '-in', str(ca / 'server.csr'), '-CA', str(ca / 'ca.pem'), '-CAkey', str(ca / 'ca.key'),
                     '-CAcreateserial', '-out', str(ca / 'server.pem'), '-days', '2', '-extfile', str(ca / 'extensions')])
    for file in ca.iterdir():
        os.chmod(file, 0o600)
    with open(home / 'secrets/smtp-pass', 'x', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as stream:
        stream.write(values['EDIEL_SMTP_PASS'] + '\n')
    prepare.save(home / 'env/track3.json', values)


class Cancelled(BaseException):
    pass


def owned_command(packet, prepare, name, argv, env):
    """Do not abandon a phase's process group on a consumer cancellation."""
    child = None
    with open(packet.home / ('runner-' + name + '.log'), 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as log:
        try:
            remaining = packet.plan['timeouts'].get(name, 120)
            if name != 'down':
                remaining = min(remaining, (packet.expires - datetime.now(timezone.utc)).total_seconds())
            need(remaining > 0, 'consumer_phase_expired')
            child = subprocess.Popen(argv, cwd=packet.app, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            deadline = time.monotonic() + remaining
            while True:
                observed = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                if observed is not None:
                    code = child.wait()
                    break
                need(time.monotonic() < deadline, 'consumer_phase_timeout')
                time.sleep(.02)
        finally:
            if child is not None and child.returncode is None:
                previous = {s: signal.signal(s, signal.SIG_IGN) for s in [signal.SIGINT, signal.SIGTERM]}
                try:
                    try:
                        os.killpg(child.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    # Keep the unreaped owned leader through escalation.
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        time.sleep(.02)
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.wait()
                finally:
                    for number, handler in previous.items():
                        signal.signal(number, handler)
    if code != 0:
        raise prepare.Blocked('phase_failed', exit_code=code)


def pilot_command(packet, prepare):
    packet.fresh()
    execution = load('hosted-profile').execution_contract(packet.plan, prepare)
    env = {**prepare.phase_environment(packet.host, packet.node), 'SIM_HOME': str(packet.home), 'SIM_RUN_DIR': str(packet.app),
        'T3_APP_COMMIT': packet.plan['appCommit'], 'T3_DB_URL': packet.env['T3_DB_URL'],
        'T3_RUNTIME_ASSIGNMENT_FILE': str(packet.home / 'runtime-assignment.json'),
        'T3_BACKEND_ASSIGNMENT_FILE': str(packet.home / 'backend-assignment.json'),
        'T3_CLEANUP_ASSIGNMENT_FILE': str(packet.home / 'cleanup-assignment.json'), 'SIM_REPORT': str(packet.home / 'pilot-report.json')}
    packet.execute_command('run', ['bash', str(TRACK / 'run.sh'), execution['scenarioFile']], env)
    report = prepare.read_json(packet.home / 'pilot-report.json')
    assignment_hash = sha((packet.home / 'runtime-assignment.json').read_bytes())
    result = (validate_pilot(report, assignment_hash) if execution['purpose'] == 'ediel03_physical'
              else validate_underlay(report, assignment_hash, execution))
    prepare.verify_manifest(Path(report['scenarios'][0]['evidenceManifest']), packet.home / 'evidence')
    return result


def seal_execution(packet, prepare):
    packet.fresh()
    home = packet.home
    profile_path = prepare.private(os.environ['T3_HOSTED_PROFILE'])
    profile = json.loads(profile_path.read_bytes())
    bootstrap = prepare.read_json(home / 'bootstrap-admission.json')
    need(bootstrap['profileSha256'] == sha(profile_path.read_bytes()) and bootstrap['planSha256'] == sha(packet.original),
         'actual_bootstrap_plan_binding_required')
    profile_unit = load('hosted-profile')
    execution = profile_unit.execution_contract(packet.plan, prepare)
    for role, binding in profile['authorities'].items():
        profile_unit.private_authority(profile, packet.plan, binding, role, bootstrap['identity'], prepare)
    assignment = prepare.private(home / 'runtime-assignment.json').read_bytes()
    prepared = prepare.private(home / 'prepared-runtime.json').read_bytes()
    preparation = prepare.private(home / 'preparation-run.json').read_bytes()
    need(json.loads(assignment)['preparedReceiptSha256'] == sha(prepared)
         and json.loads(prepared)['preparationRunSha256'] == sha(preparation)
         and json.loads(preparation)['planSha256'] == sha(packet.original), 'real_preparation_execution_hash_chain_required')
    prepare.save(home / 'authorized-execution.json', {'schema': 'track3-authorized-execution-v1',
        'execution': execution, 'executionSha256': profile_unit.canonical_hash(execution), 'planSha256': sha(packet.original),
        'profileSha256': sha(profile_path.read_bytes()), 'nativeAuthorityCapsuleSha256': profile['authorities']['producer']['capsuleSha256'],
        'producerReceiptSha': packet.plan['producerReservation'], 'backendReceiptSha': packet.plan['backendReservation'],
        'source': {key: packet.plan[key] for key in ['appCommit', 'appTree', 'harnessCommit', 'harnessTree']},
        'runtimeAssignmentSha256': sha(assignment), 'environment': packet.plan['environment'],
        'scope': 'AUTHORIZED_PURPOSE_ONLY_NOT_NATIVE_ACCEPTANCE'})


def assert_fresh_fixture(packet, prepare):
    actual = json.loads(prepare.capture(['psql', packet.env['T3_DB_URL'], '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c',
        "SET default_transaction_read_only=on; SELECT jsonb_build_object('actors',(SELECT count(*) FROM auth.users WHERE email='t3sim-automation@t3.sim.invalid'),'companies',(SELECT count(*) FROM public.companies WHERE name='T3SIM Supplier AB'))"]))
    need(isinstance(actual, dict) and all(type(actual.get(key)) is int for key in ['actors', 'companies'])
         and actual == {'actors': 0, 'companies': 0}, 'fresh_fixture_must_not_adopt_existing_actor_or_company')
    prepare.save(packet.home / 'fixture-foundation-before.json', actual)


def observe_fixture_actor(packet, prepare):
    packet.fresh()
    fixture = prepare.read_json(packet.home / 'fixture.json')
    values = prepare.read_json(packet.home / 'env/track3.json')
    import re
    actor, company = fixture['actorUserId'], fixture['companyId']
    need(re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', actor)
         and re.fullmatch('[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', company)
         and values.get('EDIEL_AUTOMATION_ACTOR_USER_ID') == actor, 'actual_applied_fixture_actor_required')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_args, **_kwargs):
            raise ValueError('fixture_auth_redirect_forbidden')
    request = urllib.request.Request(values['SUPABASE_URL'] + '/auth/v1/admin/users/' + actor,
        headers={'Authorization': 'Bearer ' + values['SUPABASE_SERVICE_ROLE_KEY'], 'apikey': values['SUPABASE_SERVICE_ROLE_KEY']})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
        need(response.status == 200, 'actual_fixture_auth_user_required')
        user = json.loads(response.read(1024 * 1024))
    need(user.get('id') == actor and user.get('email') == 't3sim-automation@t3.sim.invalid', 'fixture_auth_identity_differs')
    observation = json.loads(prepare.capture(['psql', values['T3_DB_URL'], '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c',
        "SET default_transaction_read_only=on; SELECT jsonb_build_object('profile',EXISTS(SELECT FROM public.user_profiles WHERE id='" + actor +
        "'),'membership',EXISTS(SELECT FROM public.company_memberships WHERE company_id='" + company + "' AND user_id='" + actor +
        "' AND status='active' AND is_active=true AND accepted_at IS NOT NULL))"]))
    need(observation.get('profile') is True and observation.get('membership') is True, 'actual_fixture_profile_membership_required')
    prepare.save(packet.home / 'fixture-foundation-after.json', {'actorUserId': actor, 'companyId': company,
        'authCreatedAt': user.get('created_at'), 'observation': observation,
        'scope': 'EXISTING_GENERIC_AUTOMATION_FIXTURE_NOT_ISSUER_AUTHORITY_OR_UNDERLAY_USER_GRANTS'})


def consume_phases(packet, prepare):
    home = packet.home
    previous = {s: signal.signal(s, lambda *_: (_ for _ in ()).throw(Cancelled())) for s in [signal.SIGINT, signal.SIGTERM]}
    primary, cleanup, pilot = None, None, None
    up_attempted = False
    try:
        packet.phase('build')
        packet.phase('seal')
        seal_execution(packet, prepare)
        assert_fresh_fixture(packet, prepare)
        up_attempted = True
        packet.phase('up')
        observe_fixture_actor(packet, prepare)
        pilot = pilot_command(packet, prepare)
    except BaseException as error:
        primary = {'type': type(error).__name__, 'exitCode': getattr(error, 'exit_code', None)}
    finally:
        for s in previous:
            signal.signal(s, signal.SIG_IGN)
        if up_attempted:
            try:
                # Partial startup without a complete ownership receipt stays HOLD.
                need((home / 'cleanup-assignment.json').is_file(), 'partial_startup_exact_recovery_required')
                packet.phase('down')
            except BaseException as error:
                cleanup = {'type': type(error).__name__, 'state': 'HOLD_APP_MAIL_REQUIRES_OWNED_RECOVERY'}
        for s, handler in previous.items():
            signal.signal(s, handler)
        result = {'primaryFailure': primary, 'cleanupFailure': cleanup, 'pilot': pilot,
            'ok': primary is None and cleanup is None and pilot is not None, 'backendCleanup': 'ORIGINAL_SHELL_EXIT_PENDING',
            'wholeSuiteAcceptance': 'NOT_CLAIMED', 'runtimeAcceptance': 'REQUIRES_INDEPENDENT_ORIGINAL_REVIEW'}
        prepare.save(home / 'pilot-consumer-result.json', result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True)
    args = parser.parse_args(argv)
    prepare = load('prepare')
    profile = json.loads(prepare.private(os.environ['T3_HOSTED_PROFILE']).read_bytes())
    plan = prepare.read_json(args.plan)
    home = prepare.private(plan['simHome'], True)
    admission = prepare.read_json(home / 'bootstrap-admission.json')
    need(admission['schema'] == 'track3-hosted-bootstrap-admitted-v1'
         and admission['planSha256'] == sha(Path(args.plan).read_bytes())
         and admission['profileSha256'] == sha(Path(os.environ['T3_HOSTED_PROFILE']).read_bytes())
         and os.environ.get('GRIDEX_NATIVE_DATABASE_PHASE') == 'clean', 'real_same_shell_bootstrap_required')
    prepare.same_host(admission['host'], prepare.host_identity())
    owned_network = admission['ownedNetwork']
    need(os.environ.get('SUPABASE_NETWORK_ID') == owned_network['name'], 'same_shell_owned_network_selector_required')
    replay = prepare.canonical(plan['replayDir'])
    need(Path.cwd() == replay, 'original_replay_shell_directory_required')
    # Capture actual completed replay bytes before the consumer emits output.
    replay_log = prepare.private(home / 'same-shell.log').read_bytes()
    need(b'Supabase CLI ledger verified:' in replay_log and b'schema fingerprint verified:' in replay_log
         and b'PASS: empty local Supabase' in replay_log, 'canonical_replay_completion_evidence_required')
    with open(home / 'producer-replay.log', 'xb', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as stream:
        stream.write(replay_log)
    cli_env = {**prepare.phase_environment(admission['host'], plan['nodeBin']), 'DO_NOT_TRACK': '1',
               'SUPABASE_TELEMETRY_DISABLED': '1', 'SUPABASE_HOME': str(home / 'supabase-home'), 'SUPABASE_NETWORK_ID': owned_network['name']}
    status = json.loads(prepare.capture(['supabase', 'status', '-o', 'json'], cwd=replay, env=cli_env))
    values = environment_from_status(status, plan, admission['environment'], home)
    create_private_mail_inputs(home, values, prepare)
    # Full ordinary Packet checks now see real credentials and private CA files.
    packet = prepare.Packet(args.plan)
    packet.execute_command = lambda name, argv, env: owned_command(packet, prepare, name, argv, env)
    prepare.same_host(packet.host, admission['host'])
    backend, api, storage, resources = inspect_backend(prepare, {**plan, '_host': packet.host, '_network': owned_network})
    prepare.save(home / 'canonical-resources.json', resources)
    plan_hash = sha(Path(args.plan).read_bytes())
    dbargs = ['psql', values['T3_DB_URL'], '-XAtq', '-v', 'ON_ERROR_STOP=1']
    actual_ledger = prepare.capture(dbargs + ['-F', '\t', '-c', 'SET default_transaction_read_only=on; SELECT version,coalesce(name,\'\') FROM supabase_migrations.schema_migrations ORDER BY version'])
    ledger = json.loads((packet.app / 'scripts/gridex-aud-003-main-ledger.json').read_bytes())['entries']
    need(actual_ledger.splitlines() == sorted(str(x['version']) + '\t' + x['name'] for x in ledger), 'actual_canonical_ledger_required')
    fingerprint = prepare.capture(dbargs + ['-f', str(packet.app / 'scripts/gridex-aud-003-schema-fingerprint.sql')])
    import re
    expected = re.search(r'^EXPECTED_FINGERPRINT="([a-f0-9]{64})"$', (replay / 'scripts/gridex-aud-003-clean-replay.sh').read_text(), re.M)
    need(expected and fingerprint == expected[1], 'actual_canonical_fingerprint_required')
    prepare.save(home / 'producer-backend.json', {'planSha256': plan_hash, 'appCommit': plan['appCommit'], 'appTree': plan['appTree'],
        'backendAssignment': backend, 'apiContainerId': api, 'storageContainerId': storage})
    prepare.save(home / 'producer-replay.json', {'schema': 'track3-canonical-replay-v1', 'kind': 'canonical_supabase_cli',
        'planSha256': plan_hash, 'appCommit': plan['appCommit'], 'appTree': plan['appTree'], 'replayCommit': plan['appCommit'],
        'logSha256': sha(replay_log), 'officialLedgerVerified': True, 'postReplayAppliedMigrations': 0})
    # These describe observed canonical effects, not separately invoked adapters.
    packet.events = [{'phase': phase, 'state': 'COMPLETED', 'at': time.time(), 'observation': 'actual_same_shell_canonical_backend'} for phase in ['backend', 'replay']]
    return 0 if consume_phases(packet, prepare)['ok'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (Exception, Cancelled, KeyboardInterrupt):
        print('T3_HOSTED_CONSUMER_HOLD_PRIVATE_EVIDENCE', file=sys.stderr)
        sys.exit(1)
