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
ORACLES = [{'name': 'postgres', 'tag': '17.6.1.155', 'index': 'sha256:3866d94d8426927e8db3f1c5d790752292bfbe27b5f1f46e199ae1b7d3c1710b', 'manifest': 'sha256:3e2a7ab48783077d0122dc72ed5174afb543110c38266c845716c51d130658e4', 'config': 'sha256:56da3fb43b03aca9b8fa264c156177dd204f722e9500e8d80008f5c9f7b82985', 'source_repo': 'supabase/postgres'}, {'name': 'storage-api', 'tag': 'v1.54.1', 'index': 'sha256:09c0f6f63ba79f1fea1917dfa2bc1ada8ef262f3f37a4d9f6c12add27707b0cd', 'manifest': 'sha256:6395ec6600b89e8133ae65e2b203d04f37a24d3626144ea2cb21973bfaa2471c', 'config': 'sha256:da6409e5fd135ab8895f0c344f82066d99c107ca1031ed4a1ab1d33f0b775572', 'source_repo': 'supabase/storage-api'}, {'name': 'realtime', 'tag': 'v2.86.3', 'index': 'sha256:d92097f98347041afd61198d71bb819b38adc4a710db937202290f0ae5ce961b', 'manifest': 'sha256:630c1f1e1443762c100147decca9cf87afe52f22a8a96d30fe7d8782741f19fb', 'config': 'sha256:65d7549b3ce537cef75da797ac8018ce2c1bcd89fdbd9adabbf98b54ea4aa759', 'source_repo': 'supabase/realtime'}, {'name': 'gotrue', 'tag': 'v2.188.1', 'index': 'sha256:87db8c737af49a64236c461882ed3925f8b1e5c2c47176c64694dedc65153573', 'manifest': 'sha256:61f1099e790c4f364b70d6fb92cc07e5f90275abf2cf690ff045c63f1d96ee4b', 'config': 'sha256:b061f1fa636f31bc01de0a791986352e82772760cce8e1d55bbec6f552930a1e', 'source_repo': 'supabase/gotrue'}, {'name': 'kong', 'tag': '2.8.1', 'index': 'sha256:1b53405d8680a09d6f44494b7990bf7da2ea43f84a258c59717d4539abf09f6d', 'manifest': 'sha256:e21b0b793879ab96720ed4188f9441260273f4bf775bcbff8d435e019ffb759a', 'config': 'sha256:3cefb958bcd694597b65adc00053a762b1f9a6df3c6031af528d052d75a64e1a', 'source_repo': 'library/kong'}, {'name': 'postgrest', 'tag': 'v14.10', 'index': 'sha256:bca3f86f69d8ef7aa1e5ee65e66ce9a20c6c147be637517a7be8399e102901d1', 'manifest': 'sha256:78c0a947ae556093def31de0b76c37d36ca09394d603a6e61785f4c0008aeb12', 'config': 'sha256:fe5428d51d9805147859ed38db0a26e9e424c4639dc851733e99a86829e1d5aa', 'source_repo': 'postgrest/postgrest'}, {'name': 'postgres-meta', 'tag': 'v0.96.4', 'index': 'sha256:4dd3e0ff3e9a0f9f62dd1a1a827f124645549b439ddb2a53598575744585e32d', 'manifest': 'sha256:97c0d82ff90b54c04992ca1a5f2253acd89775fd288f67bdeac7db54ab6d5343', 'config': 'sha256:103063d9a3652760363e8f924b0d1ae2e742d4fe8807a9eccdb5384a46a70c89', 'source_repo': 'supabase/postgres-meta'}]
ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_TEMP': '/tmp/isolated-unit-fixture',
       'SUPABASE_INTERNAL_IMAGE_REGISTRY': 'ghcr.io'}


def source(pin):
    return 'docker.io/' + pin['source_repo'] + '@' + pin['manifest']


def target(pin):
    return 'ghcr.io/supabase/' + pin['name'] + ':' + pin['tag']


def good(pin):
    return {'Id': pin['config'], 'Os': 'linux', 'Architecture': 'amd64',
            'RepoDigests': [pin['source_repo'].removeprefix('library/') + '@' + pin['manifest']]}


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
    def test_cold_cache_covers_all_selected_bootstrap_images(self):
        docker = DockerFixture()
        result = cache.prepare(ENV, docker, Mock())
        self.assertEqual({target(p): docker.images.get(target(p), {}).get('Id') for p in ORACLES},
                         {target(p): p['config'] for p in ORACLES})
        self.assertCountEqual([x[2:] for x in docker.calls if x[2] == 'pull'],
                              [['pull', '--platform=linux/amd64', source(p)] for p in ORACLES])
        self.assertEqual(len(result['images']), len(ORACLES))
        self.assertTrue(all(x['origin'] == 'official_dockerhub_content_identical_copy' for x in result['images']))
        self.assertEqual(ENV['SUPABASE_INTERNAL_IMAGE_REGISTRY'], 'ghcr.io')
        self.assertTrue(all(x[:2] == cache.DOCKER for x in docker.calls))

    def test_verified_existing_caches_have_no_mutations(self):
        docker = DockerFixture()
        docker.images = {target(p): good(p) for p in ORACLES}
        result = cache.prepare(ENV, docker)
        self.assertEqual(len(docker.calls), len(ORACLES))
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


class DiagnosticTests(unittest.TestCase):
    # Missing/wrong diagnostic context must fail without changing refusal or commands.
    def test_each_failure_stage_reports_predicates_without_more_commands(self):
        pin = ORACLES[0]
        for stage, expected_commands in [
                ('existing_target', ['image', 'inspect']),
                ('immutable_source', ['image', 'inspect', 'image', 'inspect']),
                ('post_alias', ['image', 'inspect', 'image', 'inspect', 'tag', 'image', 'inspect'])]:
            with self.subTest(stage=stage):
                docker = DockerFixture()
                bad = good(pin); bad['Id'] = 'sha256:' + '0' * 64
                if stage == 'existing_target':
                    docker.images[target(pin)] = bad
                else:
                    docker.images[source(pin)] = bad if stage == 'immutable_source' else good(pin)
                    if stage == 'post_alias':
                        docker.after_tag = bad
                with self.assertRaises(cache.Refused) as caught:
                    cache.prepare(ENV, docker)
                self.assertEqual(str(caught.exception), 'image_identity_mismatch')
                detail = getattr(caught.exception, 'diagnostic', None)
                self.assertIsInstance(detail, dict)
                self.assertEqual(detail['image'], 'postgres')
                self.assertEqual(detail['stage'], stage)
                self.assertEqual(detail['predicates'], {
                    'is_object': True, 'config_matches': False, 'id_matches_pinned_manifest': False,
                    'id_matches_pinned_index': False, 'os_matches': True,
                    'architecture_matches': True, 'repo_digest_matches': True})
                self.assertEqual(detail['expected'], {k: pin[k] for k in ['config', 'index', 'manifest']})
                flattened = [part for call in docker.calls for part in (call[2:4] if call[2] == 'image' else call[2:3])]
                self.assertEqual(flattened, expected_commands)

    # Arbitrary inspect values must never escape through diagnostic fields.
    def test_diagnostic_does_not_expose_inspect_payload_or_secrets(self):
        pin = ORACLES[0]
        bad = {'Id': 'SECRET-' * 10000, 'Os': {'token': 'SECRET'},
               'Architecture': ['SECRET'], 'Variant': 'SECRET',
               'RepoDigests': ['https://SECRET.invalid/repo@sha256:SECRET'],
               'Config': {'Env': ['TOKEN=SECRET']},
               'Descriptor': {'digest': 'SECRET', 'platform': {'os': 'SECRET'}}}
        docker = DockerFixture(); docker.images[target(pin)] = bad
        with self.assertRaises(cache.Refused) as caught:
            cache.prepare(ENV, docker)
        detail = getattr(caught.exception, 'diagnostic', None)
        self.assertIsInstance(detail, dict)
        self.assertEqual(detail['predicates'], {
            'is_object': True, 'config_matches': False, 'id_matches_pinned_manifest': False,
            'id_matches_pinned_index': False, 'os_matches': False,
            'architecture_matches': False, 'repo_digest_matches': False})
        serialized = json.dumps(detail)
        self.assertNotIn('SECRET', serialized)
        self.assertLess(len(serialized), 800)

    def test_manifest_or_index_id_still_refused_with_diagnostic_match(self):
        for field in ['manifest', 'index']:
            pin = ORACLES[0]; bad = good(pin); bad['Id'] = pin[field]
            docker = DockerFixture(); docker.images[target(pin)] = bad
            with self.assertRaises(cache.Refused) as caught:
                cache.prepare(ENV, docker)
            self.assertEqual(str(caught.exception), 'image_identity_mismatch')
            detail = getattr(caught.exception, 'diagnostic', None)
            self.assertIsInstance(detail, dict)
            self.assertFalse(detail['predicates']['config_matches'])
            self.assertEqual(detail['predicates']['id_matches_pinned_manifest'], field == 'manifest')
            self.assertEqual(detail['predicates']['id_matches_pinned_index'], field == 'index')
            self.assertEqual(len(docker.calls), 1)

    def test_non_object_rejection_stays_generic_and_diagnostic_is_bounded(self):
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(None, cache.PINS[0])
        self.assertEqual(str(caught.exception), 'image_identity_mismatch')
        detail = getattr(caught.exception, 'diagnostic', None)
        self.assertIsInstance(detail, dict)
        self.assertEqual(set(detail['predicates'].values()), {False})

# Declared synthetic content only; never substitutes for registry provenance.
class LocalContentTests(unittest.TestCase):
    def fixture(self, config=None, manifest_change=None):
        import hashlib
        raw_config = config or b'{"os":"linux","architecture":"amd64","config":{"Env":["SECRET=synthetic"]}}'
        config_digest = 'sha256:' + hashlib.sha256(raw_config).hexdigest()
        manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
                    'config': {'mediaType': 'application/vnd.oci.image.config.v1+json',
                               'digest': config_digest, 'size': len(raw_config)}, 'layers': []}
        if manifest_change:
            manifest_change(manifest)
        raw_manifest = json.dumps(manifest).encode()
        manifest_digest = 'sha256:' + hashlib.sha256(raw_manifest).hexdigest()
        pin = cache.ImagePin('synthetic', 'test', 'sha256:' + '1' * 64,
                             manifest_digest, config_digest, 'fixture/synthetic')
        image = {'Id': manifest_digest, 'Os': 'linux', 'Architecture': 'amd64',
                 'RepoDigests': ['fixture/synthetic@' + manifest_digest],
                 'Descriptor': {'digest': manifest_digest, 'mediaType': manifest['mediaType'],
                                'size': len(raw_manifest)}}
        class Reader:
            def __init__(self):
                self.infos = [{'ID': 'synthetic-daemon', 'Containerd': {
                    'Address': '/run/synthetic.sock',
                    'Namespaces': {'Containers': 'moby', 'Plugins': 'plugins.moby'}}}] * 2
                self.blobs = {manifest_digest: raw_manifest, config_digest: raw_config}
                self.reads = []
            def qualify(self):
                pass
            def info(self):
                return self.infos.pop(0)
            def is_socket(self, address):
                return address == '/run/synthetic.sock'
            def read(self, digest, binding, limit):
                self.reads.append(digest)
                return self.blobs[digest]
        reader = Reader()
        run = Mock(return_value=subprocess.CompletedProcess([], 0, json.dumps([image]), ''))
        return pin, image, reader, run

    def check_feature(self):
        self.assertTrue(callable(getattr(cache, 'qualify_local_config', None)),
                        'strict local config qualification is missing')

    def test_valid_local_chain_hashes_both_blobs_and_reinspects(self):
        self.check_feature()
        pin, image, reader, run = self.fixture()
        self.assertTrue(cache.qualify_local_config(image, pin, 'fixture', run, reader))
        self.assertEqual(reader.reads, [pin.manifest, pin.config])
        self.assertEqual(run.call_args.args[0], cache.DOCKER + ['image', 'inspect', 'fixture'])

    def test_corrupt_truncated_missing_oversize_blobs_fail_closed(self):
        self.check_feature()
        for kind in ['hash', 'truncated', 'missing', 'oversize']:
            for blob in ['manifest', 'config']:
                with self.subTest(kind=kind, blob=blob):
                    pin, image, reader, run = self.fixture()
                    digest = getattr(pin, blob)
                    if kind == 'missing':
                        del reader.blobs[digest]
                    else:
                        reader.blobs[digest] = {'hash': b'{}', 'truncated': reader.blobs[digest][:-1],
                                               'oversize': b'x' * (4 * 1024 * 1024 + 1)}[kind]
                    self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))

    def test_manifest_config_contract_errors_are_refused_even_when_hashes_match(self):
        self.check_feature()
        changes = [lambda m: m.update(mediaType='text/plain'),
                   lambda m: m.update(schemaVersion=1),
                   lambda m: m['config'].update(digest='sha256:' + '2' * 64),
                   lambda m: m['config'].update(size=1),
                   lambda m: m['config'].update(size=True),
                   lambda m: m['config'].update(mediaType='text/plain')]
        for change in changes:
            pin, image, reader, run = self.fixture(manifest_change=change)
            self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))
        for config in [b'{"os":"windows","architecture":"amd64"}',
                       b'{"os":"linux","architecture":"arm64"}',
                       b'{"os":"linux","os":"linux","architecture":"amd64"}', b'null', b'{']:
            pin, image, reader, run = self.fixture(config=config)
            self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))

    def test_duplicate_manifest_json_is_rejected_with_real_hash(self):
        self.check_feature()
        import hashlib
        pin, image, reader, run = self.fixture()
        raw = reader.blobs[pin.manifest].replace(b'"schemaVersion": 2', b'"schemaVersion": 2, "schemaVersion": 2')
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        pin = pin._replace(manifest=digest)
        image['Id'] = digest; image['Descriptor']['digest'] = digest; image['Descriptor']['size'] = len(raw)
        reader.blobs[digest] = raw
        self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))

    def test_descriptor_and_platform_must_bind_exact_manifest(self):
        self.check_feature()
        for field, value in [('digest', 'sha256:' + '0' * 64), ('mediaType', 'text/plain'),
                             ('size', 0), ('size', True), ('size', 999),
                             ('platform', {'os': 'windows', 'architecture': 'amd64'}),
                             ('platform', {'os': 'linux', 'architecture': 'arm64'}), ('platform', [])]:
            pin, image, reader, run = self.fixture(); image['Descriptor'][field] = value
            self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))
        pin, image, reader, run = self.fixture(); del image['Descriptor']
        self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))

    def test_daemon_namespace_socket_and_inspect_drift_fail_closed(self):
        self.check_feature()
        for kind in ['daemon', 'address', 'namespace', 'plugins_only', 'remote', 'missing_id', 'inspect']:
            pin, image, reader, run = self.fixture()
            first = json.loads(json.dumps(reader.infos[0])); second = json.loads(json.dumps(first))
            if kind == 'daemon': second['ID'] = 'other'
            if kind == 'address': second['Containerd']['Address'] = '/run/other.sock'
            if kind == 'namespace': second['Containerd']['Namespaces']['Containers'] = 'other'
            if kind == 'plugins_only': del first['Containerd']['Namespaces']['Containers']
            if kind == 'remote': first['Containerd']['Address'] = 'tcp://remote:2375'
            if kind == 'missing_id': del first['ID']
            if kind == 'inspect': run.return_value.stdout = json.dumps([{'Id': 'changed'}])
            reader.infos = [first, second]
            self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))

    def test_reader_errors_and_timeouts_do_not_leak(self):
        self.check_feature()
        for error in [RuntimeError('SECRET'), TimeoutError('SECRET'), OSError('SECRET')]:
            pin, image, reader, run = self.fixture(); reader.read = Mock(side_effect=error)
            self.assertFalse(cache.qualify_local_config(image, pin, 'fixture', run, reader))

    def test_manifest_or_index_alone_cannot_qualify(self):
        self.check_feature()
        for field in ['manifest', 'index']:
            pin, image, reader, run = self.fixture(); image['Id'] = getattr(pin, field)
            if field == 'manifest': del image['Descriptor']
            with self.assertRaisesRegex(cache.Refused, '^image_identity_mismatch$'):
                cache.verify(image, pin, 'immutable_source', reference='fixture', run=run,
                             reader=reader)
            self.assertEqual(reader.reads, [])

    def test_verify_uses_config_provenance_and_classic_needs_no_reader(self):
        self.check_feature()
        pin, image, reader, run = self.fixture()
        cache.verify(image, pin, 'immutable_source', reference='fixture', run=run, reader=reader)
        self.assertEqual(len(reader.reads), 2)
        image['Id'] = pin.config; reader.read = Mock(side_effect=AssertionError('must not read'))
        cache.verify(image, pin, 'immutable_source', reference='fixture', run=run, reader=reader)
        reader.read.assert_not_called()

    def test_bounded_stream_success_overflow_stderr_and_timeout(self):
        self.assertTrue(callable(getattr(cache, 'bounded_command', None)), 'bounded reader is missing')
        import sys
        self.assertEqual(cache.bounded_command([sys.executable, '-c', 'print("ok")'], 8, 2), b'ok\n')
        for script, limit, deadline in [('print("x" * 100000)', 8, 2),
                                        ('import sys; sys.stderr.write("x" * 100000)', 8, 2),
                                        ('import time; time.sleep(5)', 8, 0.05),
                                        ('raise SystemExit(1)', 8, 2)]:
            with self.assertRaises(cache.ContentUnavailable):
                cache.bounded_command([sys.executable, '-c', script], limit, deadline)

    def test_reader_qualifies_capabilities_and_global_flags_without_docker(self):
        self.assertTrue(callable(getattr(cache, 'LocalContentReader', None)), 'local reader is missing')
        from unittest.mock import patch
        calls = []
        def command(args, limit, timeout):
            calls.append(args)
            if args[-1] == '--version': return b'ctr github.com/containerd/containerd/v2 v2.1.0 abc\n'
            if args[-1] == '--help':
                return b'--address --namespace --timeout --connect-timeout content get'
            return b'blob'
        with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
            reader = cache.LocalContentReader(command=command); reader.qualify()
            self.assertEqual(reader.read('sha256:' + 'a' * 64,
                                        ('daemon', '/run/test.sock', 'moby'), 99), b'blob')
        self.assertEqual(calls[-1], ['/usr/bin/ctr', '--address', '/run/test.sock', '--namespace', 'moby',
                                    '--timeout', '10s', '--connect-timeout', '3s',
                                    'content', 'get', 'sha256:' + 'a' * 64])
        with patch.object(cache.shutil, 'which', return_value=None):
            with self.assertRaises(cache.ContentUnavailable): cache.LocalContentReader(command=command).qualify()
        with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
            with self.assertRaises(cache.ContentUnavailable):
                cache.LocalContentReader(command=lambda *args: b'unsupported').qualify()

    def test_source_and_post_alias_each_qualify_same_config_content(self):
        self.check_feature()
        from unittest.mock import patch
        pin, image, _, _ = self.fixture(); docker = DockerFixture()
        source_ref = 'docker.io/fixture/synthetic@' + pin.manifest
        target_ref = 'ghcr.io/supabase/synthetic:test'
        docker.images[source_ref] = image
        readers = []
        def factory():
            reader = self.fixture()[2]; readers.append(reader); return reader
        with patch.object(cache, 'LocalContentReader', side_effect=factory):
            result = cache.prepare_image(pin, docker, Mock())
        self.assertEqual(result['config'], pin.config)
        self.assertEqual(len(readers), 2)
        self.assertTrue(all(r.reads == [pin.manifest, pin.config] for r in readers))
        self.assertEqual([call[2:] for call in docker.calls], [
            ['image', 'inspect', target_ref], ['image', 'inspect', source_ref],
            ['image', 'inspect', source_ref], ['tag', source_ref, target_ref],
            ['image', 'inspect', target_ref], ['image', 'inspect', target_ref]])

    def test_reader_cleanup_waits_are_always_bounded(self):
        self.assertTrue(callable(getattr(cache, 'bounded_command', None)), 'bounded reader is missing')
        from unittest.mock import patch
        process = Mock(); process.wait.return_value = 0; process.poll.return_value = 0
        selector = Mock(); selector.get_map.return_value = {}
        manager = Mock(); manager.__enter__ = Mock(return_value=selector); manager.__exit__ = Mock()
        with patch.object(cache.subprocess, 'Popen', return_value=process), \
                patch.object(cache.selectors, 'DefaultSelector', return_value=manager):
            self.assertEqual(cache.bounded_command(['fixture'], 8, 1), b'')
        self.assertTrue(all(call.kwargs.get('timeout', 0) > 0 for call in process.wait.call_args_list),
                        'unbounded child wait violates parent deadline')

    def test_no_reader_on_failed_original_os_arch_or_repo_predicate(self):
        self.check_feature()
        for field, value in [('Os', 'windows'), ('Architecture', 'arm64'), ('RepoDigests', [])]:
            pin, image, reader, run = self.fixture(); image[field] = value
            with self.assertRaises(cache.Refused):
                cache.verify(image, pin, reference='fixture', run=run, reader=reader)
            self.assertEqual(reader.reads, [])

    def test_malformed_repo_digest_on_manifest_id_remains_identity_refusal(self):
        self.check_feature()
        for value in [[{}], {'unknown': []}, 1]:
            pin, image, reader, run = self.fixture(); image['RepoDigests'] = value
            with self.assertRaisesRegex(cache.Refused, '^image_identity_mismatch$'):
                cache.verify(image, pin, reference='fixture', run=run, reader=reader)
            self.assertEqual(reader.reads, [])

    def test_info_requests_only_identity_fields(self):
        command = Mock(return_value=b'{"ID":"fixture","Containerd":{}}')
        reader = cache.LocalContentReader(command=command)
        self.assertEqual(reader.info()['ID'], 'fixture')
        self.assertEqual(command.call_args.args[0], cache.DOCKER + [
            'info', '--format', '{"ID":{{json .ID}},"Containerd":{{json .Containerd}}}'])

    def test_safe_proof_diagnostic_identifies_capability_failure_without_secret(self):
        self.check_feature()
        pin, image, reader, run = self.fixture()
        reader.qualify = Mock(side_effect=cache.ContentUnavailable('local_reader_unsupported'))
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        self.assertEqual(caught.exception.diagnostic.get('local_config_proof'), {
            'stage': 'capability', 'reason': 'local_reader_unsupported'})
        for error in [RuntimeError('SECRET'), cache.ContentUnavailable('SECRET')]:
            pin, image, reader, run = self.fixture(); reader.read = Mock(side_effect=error)
            with self.assertRaises(cache.Refused) as caught:
                cache.verify(image, pin, reference='fixture', run=run, reader=reader)
            detail = caught.exception.diagnostic
            self.assertEqual(detail.get('local_config_proof'), {
                'stage': 'manifest', 'reason': 'local_reader_failed'})
            self.assertNotIn('SECRET', json.dumps(detail))

    def test_validation_failure_reports_safe_proof_stage_and_boolean_false(self):
        self.check_feature()
        for stage in ['descriptor', 'binding', 'manifest', 'config', 'reinspect']:
            pin, image, reader, run = self.fixture(); diagnostic = {}
            if stage == 'descriptor': image['Descriptor']['size'] = 0
            if stage == 'binding': reader.infos = [{}]
            if stage == 'manifest': reader.blobs[pin.manifest] = b'{}'
            if stage == 'config': reader.blobs[pin.config] = b'{}'
            if stage == 'reinspect': run.return_value.stdout = json.dumps([{}])
            result = cache.qualify_local_config(image, pin, 'fixture', run, reader, diagnostic)
            self.assertIs(result, False)
            self.assertEqual(diagnostic['stage'], stage)
            self.assertIn(diagnostic['reason'], ['validation_failed', 'local_reader_failed'])
            self.assertLess(len(json.dumps(diagnostic)), 150)

class CtrCapabilityTests(unittest.TestCase):
    def command_for(self, banner, global_help=None, content_help=None):
        def command(args, limit, timeout):
            if args[-1] == '--version':
                return banner
            if args[-2:] == ['get', '--help']:
                return content_help if content_help is not None else b'ctr content get [command options] <digest>'
            if args[-1] == '--help':
                return global_help if global_help is not None else b'--address --namespace --timeout --connect-timeout'
            raise AssertionError('capability check must not read content or invoke Docker')
        return command

    def test_official_docker_package_and_upstream_banners_qualify(self):
        from unittest.mock import patch
        for banner in [b'ctr containerd.io 1.7.24 88bf19b2105c8b17560993bee28a01ddc2f97182\n',
                       b'ctr containerd.io v2.1.0 abc\n',
                       b'ctr github.com/containerd/containerd v1.7.24 abc\n',
                       b'ctr github.com/containerd/containerd/v2 v2.1.0 abc\n']:
            with self.subTest(banner=banner), patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
                cache.LocalContentReader(command=self.command_for(banner)).qualify()

    def test_lookalike_unsupported_and_malformed_banners_fail_with_safe_version_code(self):
        from unittest.mock import patch
        for banner in [b'ctr containerd.io.evil 2.1.0 abc\n', b'ctr evilcontainerd.io 2.1.0 abc\n',
                       b'ctr containerd.io 3.0.0 abc\n', b'ctr containerd.io 2.1 abc\n',
                       b'ctr containerd.io 2.1.0oops abc\n', b'ctr containerd.io 2.1.0 abc\nSECRET\n',
                       b'ctr containerd.io 0.1.0 abc\n', b'ctr containerd.io SECRET\n']:
            with self.subTest(banner=banner), patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
                with self.assertRaises(cache.ContentUnavailable) as caught:
                    cache.LocalContentReader(command=self.command_for(banner)).qualify()
                self.assertEqual(str(caught.exception), 'local_reader_version_unsupported')

    def test_each_required_flag_and_content_help_have_precise_safe_failure_codes(self):
        from unittest.mock import patch
        flags = [b'--address', b'--namespace', b'--timeout', b'--connect-timeout']
        with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
            for missing in flags:
                help_text = b' '.join(f for f in flags if f != missing) + b' SECRET'
                with self.assertRaises(cache.ContentUnavailable) as caught:
                    cache.LocalContentReader(command=self.command_for(
                        b'ctr containerd.io 2.1.0 abc\n', global_help=help_text)).qualify()
                self.assertEqual(str(caught.exception), 'local_reader_flags_missing')
            with self.assertRaises(cache.ContentUnavailable) as caught:
                cache.LocalContentReader(command=self.command_for(
                    b'ctr containerd.io 2.1.0 abc\n', content_help=b'SECRET unsupported')).qualify()
            self.assertEqual(str(caught.exception), 'local_reader_content_get_unsupported')

    def test_precise_capability_codes_reach_safe_refusal_diagnostic(self):
        from unittest.mock import patch
        for banner, global_help, content_help, reason in [
                (b'SECRET', None, None, 'local_reader_version_unsupported'),
                (b'ctr containerd.io 2.1.0 abc\n', b'SECRET', None, 'local_reader_flags_missing'),
                (b'ctr containerd.io 2.1.0 abc\n', None, b'SECRET', 'local_reader_content_get_unsupported')]:
            pin, image, _, run = LocalContentTests().fixture()
            reader = cache.LocalContentReader(command=self.command_for(banner, global_help, content_help))
            with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
                with self.assertRaises(cache.Refused) as caught:
                    cache.verify(image, pin, reference='fixture', run=run, reader=reader)
            self.assertEqual(caught.exception.diagnostic['local_config_proof'], {
                'stage': 'capability', 'reason': reason})
            self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))
            run.assert_not_called()

class CtrVersionShapeTests(unittest.TestCase):
    def test_version_shape_reports_only_bounded_structure(self):
        self.assertTrue(callable(getattr(cache, 'version_output_shape', None)), 'safe version shape missing')
        cases = [
            (b'ctr containerd.io v2.1.0 abc\n', {'output_ascii': True, 'line_count': 1,
                'token_count': 4, 'app_is_ctr': True, 'package_is_docker': True,
                'package_is_upstream': False, 'numeric_major_shape': True,
                'supported_numeric_major': True, 'version_grammar': True,
                'trailing_token_grammar': True, 'single_space_separators': True,
                'has_non_lf_control': False, 'has_tabs': False,
                'has_carriage_return': False, 'has_repeated_ascii_spaces': False}),
            (b'ctr containerd.io v3.1.0 vendor/revision\n', {'output_ascii': True, 'line_count': 1,
                'token_count': 4, 'app_is_ctr': True, 'package_is_docker': True,
                'package_is_upstream': False, 'numeric_major_shape': True,
                'supported_numeric_major': False, 'version_grammar': True,
                'trailing_token_grammar': False, 'single_space_separators': True,
                'has_non_lf_control': False, 'has_tabs': False,
                'has_carriage_return': False, 'has_repeated_ascii_spaces': False}),
            (b'SECRET\xff\nSECRET\nSECRET\nSECRET', {'output_ascii': False, 'line_count': 3,
                'token_count': 4, 'app_is_ctr': False, 'package_is_docker': False,
                'package_is_upstream': False, 'numeric_major_shape': False,
                'supported_numeric_major': False, 'version_grammar': False,
                'trailing_token_grammar': True, 'single_space_separators': False,
                'has_non_lf_control': False, 'has_tabs': False,
                'has_carriage_return': False, 'has_repeated_ascii_spaces': False})]
        for raw, expected in cases:
            self.assertEqual(cache.version_output_shape(raw), expected)
        detail = cache.version_output_shape(b'SECRET ' * 500)
        self.assertEqual(detail['token_count'], 5)
        self.assertNotIn('SECRET', json.dumps(detail))
        self.assertLess(len(json.dumps(detail)), 500)

    def test_failed_version_diagnostic_reaches_refusal_without_relaxing_acceptance(self):
        from unittest.mock import patch
        pin, image, _, run = LocalContentTests().fixture()
        raw = b'ctr containerd.io v2.1.0 SECRET/revision\n'
        reader = cache.LocalContentReader(command=CtrCapabilityTests().command_for(raw))
        with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
            with self.assertRaises(cache.Refused) as caught:
                cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        proof = caught.exception.diagnostic.get('local_config_proof', {})
        shape = caught.exception.diagnostic.get('local_reader_version_shape')
        self.assertIsInstance(shape, dict)
        self.assertEqual(proof['reason'], 'local_reader_version_unsupported')
        self.assertTrue(shape['supported_numeric_major'])
        self.assertFalse(shape['trailing_token_grammar'])
        self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))
        run.assert_not_called()

    def test_whitespace_shape_separates_tabs_cr_and_repeated_spaces(self):
        self.assertTrue(callable(getattr(cache, 'version_output_shape', None)), 'safe version shape missing')
        shape = cache.version_output_shape(b'ctr\tcontainerd.io  v2.1.0\r\n')
        self.assertTrue(shape.get('has_tabs'))
        self.assertTrue(shape.get('has_carriage_return'))
        self.assertTrue(shape.get('has_repeated_ascii_spaces'))
        self.assertFalse(shape['single_space_separators'])
        self.assertTrue(shape['has_non_lf_control'])

    def test_unknown_exception_shape_values_cannot_escape(self):
        pin, image, reader, run = LocalContentTests().fixture()
        error = cache.ContentUnavailable('local_reader_version_unsupported')
        error.version_shape = {'SECRET': 'SECRET', 'output_ascii': 'SECRET',
                               'line_count': 999999, 'token_count': True}
        reader.qualify = Mock(side_effect=error)
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        proof = caught.exception.diagnostic['local_config_proof']
        self.assertNotIn('version_shape', proof)
        self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))


if __name__ == '__main__':
    unittest.main()
