"""Candidate only: prime identical public PostgreSQL bytes on disposable CI.

Does not start services, alter the Supabase registry override, or approve tests.
The GHCR index and official Docker Hub index were independently observed with
the same SHA256. Both select the pinned Linux/amd64 child manifest below.
"""
import json
import os
import subprocess
import sys
import time

INDEX = 'sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b'
MANIFEST = 'sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4'
CONFIG = 'sha256:56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985'
SOURCE = 'docker.io/supabase/postgres@' + MANIFEST
TARGET = 'ghcr.io/supabase/postgres:17.6.1.155'
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']
ALLOWED_DIGESTS = {
    repo + '@' + digest
    for repo in ['supabase/postgres', 'docker.io/supabase/postgres', 'ghcr.io/supabase/postgres']
    for digest in [MANIFEST, INDEX]
}


class Refused(RuntimeError):
    pass


def inspect(reference, run):
    result = run(DOCKER + ['image', 'inspect', reference], capture_output=True, text=True, timeout=30)
    if result.returncode:
        # A daemon/permission error must never be interpreted as a cache miss.
        if 'No such image' in result.stderr:
            return None
        raise Refused('image_inspection_failed')
    try:
        rows = json.loads(result.stdout)
        if not isinstance(rows, list) or len(rows) != 1:
            raise ValueError()
        return rows[0]
    except (ValueError, TypeError):
        raise Refused('image_inspection_invalid') from None


def verify(image):
    if (not isinstance(image, dict) or image.get('Id') != CONFIG
            or image.get('Os') != 'linux' or image.get('Architecture') != 'amd64'
            or not set(image.get('RepoDigests') or []).intersection(ALLOWED_DIGESTS)):
        raise Refused('image_identity_mismatch')


def prepare(env=os.environ, run=subprocess.run, pause=time.sleep):
    if env.get('GITHUB_ACTIONS') != 'true' or not env.get('RUNNER_TEMP'):
        raise Refused('disposable_ci_required')
    if env.get('SUPABASE_INTERNAL_IMAGE_REGISTRY') != 'ghcr.io':
        raise Refused('existing_registry_override_required')
    if any(env.get(k) for k in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS',
                                'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']):
        raise Refused('docker_endpoint_override_forbidden')
    existing = inspect(TARGET, run)
    if existing is not None:
        verify(existing)
        return {'status': 'verified_existing_cache', 'target': TARGET,
                'manifest': MANIFEST, 'config': CONFIG, 'origin': 'existing_verified_cache'}
    source = inspect(SOURCE, run)
    if source is None:
        for attempt in range(2):
            pulled = run(DOCKER + ['pull', '--platform=linux/amd64', SOURCE],
                         capture_output=True, text=True, timeout=600)
            if pulled.returncode == 0:
                break
            # Bounded retries only for the public immutable read; never a test,
            # business action or unknown write. Do not log auth/download URLs.
            if attempt == 1 or not any(marker in pulled.stderr.lower() for marker in
                                      ['toomanyrequests', '429', 'timeout', 'timed out', '502', '503']):
                raise Refused('pinned_public_image_pull_failed')
            pause(15)
        source = inspect(SOURCE, run)
    verify(source)
    tagged = run(DOCKER + ['tag', SOURCE, TARGET], capture_output=True, text=True, timeout=30)
    if tagged.returncode:
        raise Refused('cache_alias_failed')
    verify(inspect(TARGET, run))
    return {'status': 'verified_public_mirror_cache', 'source': SOURCE, 'target': TARGET,
            'index': INDEX, 'manifest': MANIFEST, 'config': CONFIG,
            'origin': 'official_dockerhub_content_identical_copy'}


if __name__ == '__main__':
    try:
        print(json.dumps(prepare(), sort_keys=True))
    except (Refused, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error) if isinstance(error, Refused)
                          else 'docker_command_timeout'}), file=sys.stderr)
        raise SystemExit(1)
