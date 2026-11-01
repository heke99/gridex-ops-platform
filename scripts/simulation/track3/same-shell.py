"""Keep canonical replay and an explicit reviewed consumer in one owned shell.

This supervisor does not provision a complete T3 producer. The consumer owns
build/scenario/app-mail cleanup and backend receipts; canonical EXIT owns its
original cleanup. Shell success does not attest either cleanup's actual effects.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone

SHELL = r'''set -euo pipefail
readonly T3_SS_REPLAY_DIR="$1" T3_SS_REPLAY_SCRIPT="$2" T3_SS_CONSUMER="$3"
readonly T3_SS_PLAN="$4" T3_SS_PYTHON="$5" T3_SS_BOUNDARIES="$6"
set --
cd -- "$T3_SS_REPLAY_DIR"
printf 'replay-entered\n' >> "$T3_SS_BOUNDARIES"
source "$T3_SS_REPLAY_SCRIPT"
printf 'replay-returned\nconsumer-entered\n' >> "$T3_SS_BOUNDARIES"
"$T3_SS_PYTHON" "$T3_SS_CONSUMER" --plan "$T3_SS_PLAN"
printf 'consumer-returned\n' >> "$T3_SS_BOUNDARIES"
'''
COMPLETE = ['replay-entered', 'replay-returned', 'consumer-entered', 'consumer-returned']


def need(condition, code):
    if not condition:
        raise ValueError(code)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def exclusive(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb')


def run_shell(replay_dir, replay_script, consumer, plan, log, boundaries, timeout, env, python_bin, grace=5):
    """Finite subprocess group only; preserve canonical traps without replacing them."""
    need(type(timeout) in (int, float) and 0 < timeout <= 21600
         and type(grace) in (int, float) and 0 < grace <= 30, 'bounded_timeout_required')
    need(isinstance(env, dict) and all(isinstance(k, str) and re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', k)
         and isinstance(v, str) and '\0' not in v for k, v in env.items()), 'explicit_environment_required')
    need(not any(k in env for k in ['BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS', 'GRIDEX_REPLAY_DB_URL'])
         and not any(k.startswith('T3_SS_') for k in env), 'shell_or_replay_override_forbidden')
    child = None
    interrupted = None
    timed_out = forced = False
    shutdown_deadline = None

    def forward(number):
        # An unreaped live Popen leader keeps this process-group identity owned.
        if child is not None and child.returncode is None:
            try:
                os.killpg(child.pid, number)
            except ProcessLookupError:
                pass

    def stop(number):
        nonlocal shutdown_deadline
        if shutdown_deadline is None:
            shutdown_deadline = time.monotonic() + grace
            forward(number)

    def interrupted_by(number, _frame):
        nonlocal interrupted
        interrupted = interrupted or number
        stop(number)

    with exclusive(log) as output:
        with exclusive(boundaries):
            pass
        previous = {s: signal.signal(s, interrupted_by) for s in (signal.SIGINT, signal.SIGTERM)}
        try:
            child = subprocess.Popen(['/bin/bash', '--noprofile', '--norc', '-c', SHELL, 't3-same-shell',
                                      str(replay_dir), str(replay_script), str(consumer), str(plan), str(python_bin), str(boundaries)],
                                     cwd=replay_dir, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            if interrupted:
                forward(interrupted)
            overall_deadline = time.monotonic() + timeout
            while True:
                now = time.monotonic()
                if shutdown_deadline is None and now >= overall_deadline:
                    timed_out = True
                    stop(signal.SIGTERM)
                if shutdown_deadline is not None and now >= shutdown_deadline:
                    forced = True
                    forward(signal.SIGKILL)
                    code = child.wait()
                    break
                deadline = shutdown_deadline if shutdown_deadline is not None else overall_deadline
                # Observe without reaping: retain the owned group leader identity
                # until escalation also covers a consumer surviving shell exit.
                exited = os.waitid(os.P_PID, child.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                if exited is not None and shutdown_deadline is None:
                    code = child.wait()
                    break
                time.sleep(min(.02, max(.001, deadline-now)))
        finally:
            # Unexpected supervisor exceptions must not abandon a live owned
            # shell. Never signal a reaped leader's potentially reused group.
            try:
                if child is not None and child.returncode is None:
                    stop(signal.SIGTERM)
                    # Even if observation failed, do not reap the shell early:
                    # TERM may exit the shell while its consumer ignores TERM.
                    while time.monotonic() < shutdown_deadline:
                        time.sleep(min(.02, max(.001, shutdown_deadline-time.monotonic())))
                    forward(signal.SIGKILL)
                    child.wait()
            finally:
                for number, handler in previous.items():
                    signal.signal(number, handler)
    events = Path(boundaries).read_text().splitlines()
    return {'ok': code == 0 and events == COMPLETE and not timed_out and interrupted is None,
            'shellExit': code, 'timedOut': timed_out, 'signal': interrupted, 'forcedKill': forced,
            'boundaries': events, 'logSha256': sha(log), 'boundarySha256': sha(boundaries),
            'originalFailureExitSeparatelyObserved': False,
            'cleanupAcceptance': 'NOT_ATTESTED_BY_SUPERVISOR'}


def load_prepare():
    specification = importlib.util.spec_from_file_location('t3_prepare', Path(__file__).with_name('prepare.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


def check_packet(packet, prepare):
    """Extend, never replace, the actual prepare.Packet plan preflight."""
    p = packet.plan
    replay = prepare.canonical(p['replayDir'])
    for other in [packet.app, prepare.HARNESS, packet.home]:
        need(not replay.is_relative_to(other) and not other.is_relative_to(replay), 'separate_nonoverlapping_replay_checkout_required')
    prepare.source(replay, p['appCommit'], p['appTree'])
    relative = 'scripts/gridex-aud-003-clean-replay.sh'
    script = prepare.canonical(str(replay / relative))
    need(sha(script) == p['replayScriptSha256']
         and prepare.capture(['git', '-C', str(replay), 'ls-files', '--error-unmatch', '--', relative]) == relative,
         'exact_tracked_canonical_replay_required')
    entry = p['consumer']
    need(isinstance(entry, dict) and isinstance(entry.get('path'), str) and not Path(entry['path']).is_absolute(), 'explicit_python_consumer_required')
    consumer = prepare.canonical(str(prepare.HARNESS / entry['path']))
    need(consumer.is_relative_to(prepare.HARNESS) and consumer.suffix == '.py'
         and consumer != prepare.TRACK / 'prepare.py' and sha(consumer) == entry['sha256']
         and prepare.capture(['git', '-C', str(prepare.HARNESS), 'ls-files', '--error-unmatch', '--', entry['path']]) == entry['path'],
         'tracked_reviewed_same_shell_consumer_required')
    need(p['ports']['db'] == 54322 and type(p.get('sameShellTimeoutSeconds')) is int
         and 0 < p['sameShellTimeoutSeconds'] <= 21600, 'canonical_db_port_and_overall_timeout_required')
    return replay, script, consumer


def bounded_timeout(seconds, expires, now=None):
    now = now or datetime.now(timezone.utc)
    need(type(seconds) in (int, float) and 0 < seconds <= 21600
         and isinstance(expires, datetime) and expires.utcoffset() is not None,
         'bounded_expiring_timeout_required')
    remaining = (expires-now).total_seconds()
    need(remaining > 0, 'packet_expired_before_spawn')
    return min(seconds, remaining)


def docker_resources(prepare, packet):
    env = prepare.phase_environment(packet.host, packet.node)
    endpoint = 'unix://' + packet.host['socket']
    need(env.get('DOCKER_HOST') == endpoint, 'fixed_docker_endpoint_required')
    result = {}
    for name, args in [('containers', ['container', 'ls', '-aq', '--no-trunc']),
                       ('volumes', ['volume', 'ls', '-q']),
                       ('networks', ['network', 'ls', '-q', '--no-trunc'])]:
        rows = prepare.capture(['docker', '--host', endpoint, *args], env=env).splitlines()
        pattern = '[A-Za-z0-9][A-Za-z0-9_.-]*' if name == 'volumes' else '[0-9a-f]{64}'
        need(len(rows) == len(set(rows)) and all(re.fullmatch(pattern, row) for row in rows), 'invalid_docker_inventory')
        result[name] = sorted(rows)
    return result


def run_guarded(packet, prepare, shell_args, timeout, env):
    before = docker_resources(prepare, packet)
    need(not before['containers'] and not before['volumes'], 'exclusive_empty_docker_required')
    # Clamp again immediately before spawn, after resource observation.
    timeout = bounded_timeout(timeout, packet.expires)
    result = run_shell(*shell_args, timeout=timeout, env=env, python_bin=str(Path(sys.executable).resolve()))
    restored = False
    after = None
    try:
        prepare.same_host(packet.host, prepare.host_identity(enforce_capacity=False))
        after = docker_resources(prepare, packet)
        restored = not after['containers'] and not after['volumes'] and after['networks'] == before['networks']
    except Exception:
        pass
    result.update(dockerBefore=before, dockerAfter=after, resultDockerRestored=restored)
    result['ok'] = result['ok'] and restored
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check', 'execute'])
    parser.add_argument('--plan', required=True)
    args = parser.parse_args(argv)
    prepare = load_prepare()
    packet = prepare.Packet(args.plan)
    replay, script, consumer = check_packet(packet, prepare)
    if args.mode == 'check':
        print('T3_SAME_SHELL_SOURCE_CHECKED_NOT_PROVISIONED')
        return 0
    wrapper_hash = sha(__file__)
    # Share the existing producer lock and exclusive intent so this is not a
    # second execution budget beside prepare.py execute.
    with open(packet.home / 'producer.lock', 'a', opener=lambda n, f: os.open(n, f | os.O_NOFOLLOW, 0o600)) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        packet.fresh()
        need(check_packet(packet, prepare) == (replay, script, consumer) and sha(__file__) == wrapper_hash, 'same_shell_source_changed')
        prepare.save(packet.home / 'execution-intent.json', {'schema': 'track3-same-shell-attempt-v1',
                     'planSha256': prepare.sha(packet.original), 'host': packet.host, 'wrapperSha256': wrapper_hash,
                     'replayScriptSha256': sha(script), 'consumerSha256': sha(consumer)})
        timeout = bounded_timeout(packet.plan['sameShellTimeoutSeconds'], packet.expires)
        env = {**packet.env, **prepare.phase_environment(packet.host, packet.node)}
        result = run_guarded(packet, prepare, (replay, script, consumer, packet.file, packet.home / 'same-shell.log',
                           packet.home / 'same-shell-boundaries.log'), timeout, env)
        prepare.save(packet.home / 'same-shell-result.json', result)
    print('T3_SAME_SHELL_RETURNED_REQUIRES_EFFECT_REVIEW' if result['ok'] else 'T3_SAME_SHELL_HOLD_SEE_PRIVATE_RESULT')
    if result['ok']:
        return 0
    if result['signal']:
        return 128 + result['signal']
    if result['timedOut']:
        return 124
    return result['shellExit'] if 1 <= result['shellExit'] <= 255 else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('BLOCKED: T3 same-shell input, identity or lifecycle check failed', file=sys.stderr)
        sys.exit(1)
