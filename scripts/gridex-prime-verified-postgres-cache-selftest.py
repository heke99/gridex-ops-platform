import copy
import subprocess
import unittest
from unittest.mock import Mock

import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "verified_postgres_cache", Path(__file__).with_name("gridex-prime-verified-postgres-cache.py"))
cache = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cache)

ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_TEMP': '/tmp/isolated-unit-fixture',
       'SUPABASE_INTERNAL_IMAGE_REGISTRY': 'ghcr.io'}


def good():
    return {'Id': cache.CONFIG, 'Os': 'linux', 'Architecture': 'amd64',
            'RepoDigests': ['supabase/postgres@' + cache.MANIFEST]}


class DockerFixture:
    def __init__(self, target=None, source=None, pull_exit=0, pull_error='', target_after_tag=None):
        self.target = target
        self.source = source
        self.pull_exit = pull_exit
        self.pull_error = pull_error
        self.target_after_tag = target_after_tag
        self.calls = []

    def __call__(self, args, **kwargs):
        import json
        self.calls.append(args)
        command = args[2:]
        if command[:2] == ['image', 'inspect']:
            image = self.target if command[2] == cache.TARGET else self.source
            return subprocess.CompletedProcess(args, 0 if image else 1,
                json.dumps([image]) if image else '', '' if image else 'Error: No such image')
        if command[0] == 'pull':
            if not self.pull_exit:
                self.source = good()
            return subprocess.CompletedProcess(args, self.pull_exit, '', self.pull_error)
        if command[0] == 'tag':
            self.target = self.target_after_tag or copy.deepcopy(self.source)
            return subprocess.CompletedProcess(args, 0, '', '')
        raise AssertionError('unexpected Docker command')


class CacheIdentityTests(unittest.TestCase):
    def test_cold_cache_pulls_only_immutable_public_digest_and_verifies_tag(self):
        docker = DockerFixture()
        result = cache.prepare(ENV, docker, Mock())
        self.assertEqual(result['origin'], 'official_dockerhub_content_identical_copy')
        self.assertEqual([x[2:] for x in docker.calls if x[2] == 'pull'],
                         [['pull', '--platform=linux/amd64', cache.SOURCE]])
        self.assertEqual(docker.target['Id'], cache.CONFIG)
        self.assertEqual(ENV['SUPABASE_INTERNAL_IMAGE_REGISTRY'], 'ghcr.io')
        self.assertTrue(all(x[:2] == cache.DOCKER for x in docker.calls))

    def test_verified_existing_cache_has_no_mutations(self):
        docker = DockerFixture(target=good())
        self.assertEqual(cache.prepare(ENV, docker)['status'], 'verified_existing_cache')
        self.assertEqual(len(docker.calls), 1)

    def test_existing_wrong_target_is_not_overwritten(self):
        bad = good(); bad['Id'] = 'sha256:wrong'
        docker = DockerFixture(target=bad)
        with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
            cache.prepare(ENV, docker)
        self.assertEqual(len(docker.calls), 1)

    def test_source_wrong_identity_never_tagged(self):
        for field, value in [('Id', 'sha256:wrong'), ('Os', 'windows'),
                             ('Architecture', 'arm64'), ('RepoDigests', [])]:
            with self.subTest(field=field):
                bad = good(); bad[field] = value
                docker = DockerFixture(source=bad)
                with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
                    cache.prepare(ENV, docker)
                self.assertFalse(any(x[2] in ['pull', 'tag'] for x in docker.calls))

    def test_alias_postcondition_verified(self):
        bad = good(); bad['Id'] = 'sha256:wrong'
        docker = DockerFixture(source=good(), target_after_tag=bad)
        with self.assertRaisesRegex(cache.Refused, 'image_identity_mismatch'):
            cache.prepare(ENV, docker)

    def test_rate_limit_retries_are_bounded_and_no_tag_is_written(self):
        docker = DockerFixture(pull_exit=1, pull_error='toomanyrequests')
        pause = Mock()
        with self.assertRaisesRegex(cache.Refused, 'pinned_public_image_pull_failed'):
            cache.prepare(ENV, docker, pause)
        self.assertEqual(sum(x[2] == 'pull' for x in docker.calls), 2)
        self.assertFalse(any(x[2] == 'tag' for x in docker.calls))
        pause.assert_called_once_with(15)

    def test_nontransient_failure_is_not_retried(self):
        docker = DockerFixture(pull_exit=1, pull_error='manifest unknown')
        with self.assertRaises(cache.Refused):
            cache.prepare(ENV, docker, Mock())
        self.assertEqual(sum(x[2] == 'pull' for x in docker.calls), 1)

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
