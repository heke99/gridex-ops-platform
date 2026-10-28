"""Prime identical pinned PostgreSQL and bootstrap companion bytes on CI.

Official GHCR and Docker Hub index digests match for these exact versions.
The alternate cache origin is explicit. No services are started and the
Supabase registry override, native tests and existing gates are unchanged.
"""
import json
import os
import subprocess
import sys
import time
from typing import NamedTuple


class ImagePin(NamedTuple):
    name: str
    tag: str
    index: str
    manifest: str
    config: str
    source_repo: str


PINS = (
    ImagePin('postgres', '17.6.1.155', 'sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b', 'sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4', 'sha256:56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985', 'supabase/postgres'),
    ImagePin('storage-api', 'v1.54.1', 'sha256:09c0f6f63ba79f1fea1917dfa2bc1ada8ef262f3f37a4d9f6c12add27707b0cd', 'sha256:6395ec6600b89e8133ae65e2b203d04f37a24d3626144ea2cb21973bfaa2471c', 'sha256:da6409e5fd135ab8895f0c344f82066d99c107ca1031ed4a1ab1d33f0b775572', 'supabase/storage-api'),
    ImagePin('realtime', 'v2.86.3', 'sha256:d92097f98347041afd61198d71bb819b38adc4a710db937202290f0ae5ce961b', 'sha256:630c1f1e1443762c100147decca9cf87afe52f22a8a96d30fe7d8782741f19fb', 'sha256:65d7549b3ce537cef75da797ac8018ce2c1bcd89fdbd9adabbf98b54ea4aa759', 'supabase/realtime'),
    ImagePin('gotrue', 'v2.188.1', 'sha256:87db8c737af49a64236c461882ed3925f8b1e5c2c47176c64694dedc65153573', 'sha256:61f1099e790c4f364b70d6fb92cc07e5f90275abf2cf690ff045c63f1d96ee4b', 'sha256:b061f1fa636f31bc01de0a791986352e82772760cce8e1d55bbec6f552930a1e', 'supabase/gotrue'),
    ImagePin('kong', '2.8.1', 'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d', 'sha256:e21b0b793879ab96720ed4188f9441260273f4bf775bcbff8d435e019ffb759a', 'sha256:3cefb958bcd694597b65adc00053a762b1f9a6df3c6031af528d052d75a64e1a', 'library/kong'),
    ImagePin('postgrest', 'v14.10', 'sha256:bca3f86f69d8ef7aa1e5ee65e66ce9a20c6c147be637517a7be8399e102901d1', 'sha256:78c0a947ae556093def31de0b76c37d36ca09394d603a6e61785f4c0008aeb12', 'sha256:fe5428d51d9805147859ed38db0a26e9e424c4639dc851733e99a86829e1d5aa', 'postgrest/postgrest'),
    ImagePin('postgres-meta', 'v0.96.4', 'sha256:4dd3e0ff3e9a0f9f62dd1a1a827f124645549b439ddb2a53598575744585e32d', 'sha256:97c0d82ff90b54c04992ca1a5f2253acd89775fd288f67bdeac7db54ab6d5343', 'sha256:103063d9a3652760363e8f924b0d1ae2e742d4fe8807a9eccdb5384a46a70c89', 'supabase/postgres-meta'),
)
DOCKER = ['docker', '--host=unix:///var/run/docker.sock']


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


def verify(image, pin):
    repos = {pin.source_repo, 'docker.io/' + pin.source_repo, 'ghcr.io/supabase/' + pin.name}
    # Docker canonicalizes official library images (library/kong -> kong).
    if pin.source_repo.startswith('library/'):
        repos.add(pin.source_repo.removeprefix('library/'))
    allowed = {repo + '@' + digest for repo in repos for digest in [pin.manifest, pin.index]}
    if (not isinstance(image, dict) or image.get('Id') != pin.config
            or image.get('Os') != 'linux' or image.get('Architecture') != 'amd64'
            or not set(image.get('RepoDigests') or []).intersection(allowed)):
        raise Refused('image_identity_mismatch')


def prepare_image(pin, run, pause):
    source = 'docker.io/' + pin.source_repo + '@' + pin.manifest
    target = 'ghcr.io/supabase/' + pin.name + ':' + pin.tag
    existing = inspect(target, run)
    if existing is not None:
        verify(existing, pin)
        return {'status': 'verified_existing_cache', 'target': target,
                'manifest': pin.manifest, 'config': pin.config, 'origin': 'existing_verified_cache'}
    image = inspect(source, run)
    if image is None:
        for attempt in range(2):
            pulled = run(DOCKER + ['pull', '--platform=linux/amd64', source],
                         capture_output=True, text=True, timeout=600)
            if pulled.returncode == 0:
                break
            # Retry only a public immutable read. Never log auth/download URLs.
            if attempt == 1 or not any(marker in pulled.stderr.lower() for marker in
                                      ['toomanyrequests', '429', 'timeout', 'timed out', '502', '503']):
                raise Refused('pinned_public_image_pull_failed')
            pause(15)
        image = inspect(source, run)
    verify(image, pin)
    tagged = run(DOCKER + ['tag', source, target], capture_output=True, text=True, timeout=30)
    if tagged.returncode:
        raise Refused('cache_alias_failed')
    verify(inspect(target, run), pin)
    return {'status': 'verified_public_mirror_cache', 'source': source, 'target': target,
            'index': pin.index, 'manifest': pin.manifest, 'config': pin.config,
            'origin': 'official_dockerhub_content_identical_copy'}


def prepare(env=os.environ, run=subprocess.run, pause=time.sleep):
    if env.get('GITHUB_ACTIONS') != 'true' or not env.get('RUNNER_TEMP'):
        raise Refused('disposable_ci_required')
    if env.get('SUPABASE_INTERNAL_IMAGE_REGISTRY') != 'ghcr.io':
        raise Refused('existing_registry_override_required')
    if any(env.get(k) for k in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS',
                                'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']):
        raise Refused('docker_endpoint_override_forbidden')
    images = [prepare_image(pin, run, pause) for pin in PINS]
    return {'status': 'verified_public_image_caches', 'images': images}


if __name__ == '__main__':
    try:
        print(json.dumps(prepare(), sort_keys=True))
    except (Refused, subprocess.TimeoutExpired) as error:
        print(json.dumps({'status': 'failed', 'reason': str(error) if isinstance(error, Refused)
                          else 'docker_command_timeout'}), file=sys.stderr)
        raise SystemExit(1)
