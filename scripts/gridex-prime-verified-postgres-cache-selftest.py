import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import Mock

_spec = importlib.util.spec_from_file_location(
    'verified_bootstrap_cache', Path(__file__).with_name('gridex-prime-verified-postgres-cache.py'))
cache = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cache)

# Exact independent public registry observations, not derived from helper pins.
ORACLES = [{'name': 'postgres', 'tag': '17.6.1.155', 'index': 'sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b', 'manifest': 'sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4', 'config': 'sha256:56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985'}, {'name': 'storage-api', 'tag': 'v1.54.1', 'index': 'sha256:09c0f6f63ba79f1fea1917dfa2bc1ada8ef262f3f37a4d9f6c12add27707b0cd', 'manifest': 'sha256:6395ec6600b89e8133ae65e2b203d04f37a24d3626144ea2cb21973bfaa2471c', 'config': 'sha256:da6409e5fd135ab8895f0c344f82066d99c107ca1031ed4a1ab1d33f0b775572'}, {'name': 'realtime', 'tag': 'v2.86.3', 'index': 'sha256:d92097f98347041afd61198d71bb819b38adc4a710db937202290f0ae5ce961b', 'manifest': 'sha256:630c1f1e1443762c100147decca9cf87afe52f22a8a96d30fe7d8782741f19fb', 'config': 'sha256:65d7549b3ce537cef75da797ac8018ce2c1bcd89fdbd9adabbf98b54ea4aa759'}]
ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_TEMP': '/tmp/isolated-unit-fixture',
       'SUPABASE_INTERNAL_IMAGE_REGISTRY': 'ghcr.io'}


def source(pin):
    return 'docker.io/supabase/' + pin['name'] + '@' + pin['manifest']


def target(pin):
    return 'ghcr.io/supabase/' + pin['name'] + ':' + pin['tag']


def good(pin):
    return {'Id': pin['config'], 'Os': 'linux', 'Architecture': 'amd64',
            'RepoDigests': ['supabase/' + pin['name'] + '@' + pin['manifest']]}


class DockerFixture:
    def __init__(self):
        self.images = {}
        self.calls = []
        self.pull_errors = []
        self.after_tag = None

    def __call__(self, args, **kwargs):
        self.calls.append(args)
        command = args[2:]
        if command[:2] == ['image', 'inspect']:
            image = self.images.get(command[2])
            return subprocess.CompletedProcess(args, 0 if image else 1,
                json.dumps([image]) if image else '', '' if image else 'Error: No such image')
        if command[0] == 'pull':
            pin = next(p for p in ORACLES if source(p) == command[-1])
            error = self.pull_errors.pop(0) if self.pull_errors else ''
            if not error:
                self.images[source(pin)] = good(pin)
            return subprocess.CompletedProcess(args, 1 if error else 0, '', error)
        if command[0] == 'tag':
            self.images[command[2]] = self.after_tag or self.images[command[1]]
            return subprocess.CompletedProcess(args, 0, '', '')
        raise AssertionError('unexpected Docker command')


class CacheIdentityTests(unittest.TestCase):
    def test_cold_cache_covers_all_three_observed_bootstrap_images(self):
        docker = DockerFixture()
        result = cache.prepare(ENV, docker, Mock())
        self.assertEqual({target(p): docker.images.get(target(p), {}).get('Id') for p in ORACLES},
                         {target(p): p['config'] for p in ORACLES})
        self.assertCountEqual([x[2:] for x in docker.calls if x[2] == 'pull'],
                              [['pull', '--platform=linux/amd64', source(p)] for p in ORACLES])
        self.assertEqual(len(result['images']), 3)
        self.assertTrue(all(x['origin'] == 'official_dockerhub_content_identical_copy' for x in result['images']))
        self.assertEqual(ENV['SUPABASE_INTERNAL_IMAGE_REGISTRY'], 'ghcr.io')
        self.assertTrue(all(x[:2] == cache.DOCKER for x in docker.calls))

    def test_verified_existing_caches_have_no_mutations(self):
        docker = DockerFixture()
        docker.images = {target(p): good(p) for p in ORACLES}
        result = cache.prepare(ENV, docker)
        self.assertEqual(len(docker.calls), 3)
        self.assertTrue(all(x['status'] == 'verified_existing_cache' for x in result['images']))

    def test_wrong_target_is_never_overwritten_for_any_image(self):
        for pin in ORACLES:
            with self.subTest(image=pin['name']):
                docker = DockerFixture(); bad = good(pin); bad['Id'] = 'sha256:wrong'
                docker.images[target(pin)] = bad
                with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
                    cache.prepare(ENV, docker)
                self.assertEqual(docker.images[target(pin)]['Id'], 'sha256:wrong')
                self.assertFalse(any(x[2] == 'tag' and x[-1] == target(pin) for x in docker.calls))

    def test_wrong_source_identity_is_never_tagged_for_any_image(self):
        for pin in ORACLES:
            for field, value in [('Id', 'sha256:wrong'), ('Os', 'windows'),
                                 ('Architecture', 'arm64'), ('RepoDigests', [])]:
                with self.subTest(image=pin['name'], field=field):
                    docker = DockerFixture(); bad = good(pin); bad[field] = value
                    docker.images[source(pin)] = bad
                    with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
                        cache.prepare(ENV, docker)
                    self.assertNotIn(target(pin), docker.images)

    def test_another_pinned_images_digest_cannot_authorize_wrong_config(self):
        docker = DockerFixture(); docker.images[source(ORACLES[0])] = good(ORACLES[1])
        with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
            cache.prepare(ENV, docker)
        self.assertNotIn(target(ORACLES[0]), docker.images)

    def test_alias_postcondition_is_verified(self):
        docker = DockerFixture(); bad = good(ORACLES[0]); bad['Id'] = 'sha256:wrong'; docker.after_tag = bad
        with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
            cache.prepare(ENV, docker)

    def test_rate_limit_retries_are_bounded_and_no_alias_is_written(self):
        docker = DockerFixture(); docker.pull_errors = ['toomanyrequests', 'toomanyrequests']; pause = Mock()
        with self.assertRaisesRegex(cache.Refused, 'pinned_public_image_pull_failed'):
            cache.prepare(ENV, docker, pause)
        self.assertEqual(sum(x[2] == 'pull' for x in docker.calls), 2)
        self.assertFalse(any(x[2] == 'tag' for x in docker.calls)); pause.assert_called_once_with(15)

    def test_nontransient_pull_error_is_not_retried(self):
        docker = DockerFixture(); docker.pull_errors = ['manifest unknown']; pause = Mock()
        with self.assertRaises(cache.Refused):
            cache.prepare(ENV, docker, pause)
        self.assertEqual(sum(x[2] == 'pull' for x in docker.calls), 1); pause.assert_not_called()

    def test_daemon_error_is_not_a_cache_miss(self):
        docker = Mock(return_value=subprocess.CompletedProcess([], 1, '', 'permission denied'))
        with self.assertRaisesRegex(cache.Refused, 'image_inspection_failed'):
            cache.prepare(ENV, docker)
        self.assertEqual(docker.call_count, 1)

    def test_authority_and_endpoint_guards_precede_any_command(self):
        for changed in [{'GITHUB_ACTIONS': 'false'}, {'RUNNER_TEMP': ''},
                        {'SUPABASE_INTERNAL_IMAGE_REGISTRY': 'docker.io'},
                        {'DOCKER_HOST': 'tcp://remote.invalid'}, {'DOCKER_CONTEXT': 'remote'}]:
            with self.subTest(changed=changed):
                docker = Mock()
                with self.assertRaises(cache.Refused):
                    cache.prepare({**ENV, **changed}, docker)
                docker.assert_not_called()


if __name__ == '__main__':
    unittest.main()
