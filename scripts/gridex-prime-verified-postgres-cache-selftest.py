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
        with patch.object(cache, '_PinnedRootReader', side_effect=lambda pinned: factory()):
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
                'package_is_upstream': False, 'package_is_containerd': False, 'numeric_major_shape': True,
                'supported_numeric_major': True, 'version_grammar': True,
                'trailing_token_grammar': True, 'single_space_separators': True,
                'has_non_lf_control': False, 'has_tabs': False,
                'has_carriage_return': False, 'has_repeated_ascii_spaces': False}),
            (b'ctr containerd.io v3.1.0 vendor/revision\n', {'output_ascii': True, 'line_count': 1,
                'token_count': 4, 'app_is_ctr': True, 'package_is_docker': True,
                'package_is_upstream': False, 'package_is_containerd': False, 'numeric_major_shape': True,
                'supported_numeric_major': False, 'version_grammar': True,
                'trailing_token_grammar': False, 'single_space_separators': True,
                'has_non_lf_control': False, 'has_tabs': False,
                'has_carriage_return': False, 'has_repeated_ascii_spaces': False}),
            (b'SECRET\xff\nSECRET\nSECRET\nSECRET', {'output_ascii': False, 'line_count': 3,
                'token_count': 4, 'app_is_ctr': False, 'package_is_docker': False,
                'package_is_upstream': False, 'package_is_containerd': False, 'numeric_major_shape': False,
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

class CtrContainerdPackageTests(unittest.TestCase):
    def test_official_containerd_package_qualifies_and_has_exact_safe_match(self):
        from unittest.mock import patch
        for banner in [b'ctr containerd 1.7.24\n', b'ctr containerd v2.2.0\n']:
            with self.subTest(banner=banner), patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
                cache.LocalContentReader(command=CtrCapabilityTests().command_for(banner)).qualify()
                shape = cache.version_output_shape(banner)
                self.assertTrue(shape.get('package_is_containerd'))
                self.assertFalse(shape['package_is_docker'])
                self.assertFalse(shape['package_is_upstream'])
                self.assertNotIn('1.7.24', json.dumps(shape))

    def test_containerd_package_lookalikes_and_unsupported_versions_stay_refused(self):
        from unittest.mock import patch
        for banner in [b'ctr containerd.evil 2.2.0\n', b'ctr evilcontainerd 2.2.0\n',
                       b'ctr containerd/evil 2.2.0\n', b'ctr Containerd 2.2.0\n',
                       b'ctr containerd 3.0.0\n', b'ctr containerd 2.2.0SECRET\n']:
            with self.subTest(banner=banner), patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
                with self.assertRaises(cache.ContentUnavailable) as caught:
                    cache.LocalContentReader(command=CtrCapabilityTests().command_for(banner)).qualify()
                self.assertEqual(str(caught.exception), 'local_reader_version_unsupported')
                shape = cache.version_output_shape(banner)
                self.assertEqual(shape.get('package_is_containerd'), banner.split()[1] == b'containerd')
                self.assertNotIn('SECRET', json.dumps(shape))

    def test_known_containerd_shape_survives_normalization_without_raw_version(self):
        from unittest.mock import patch
        pin, image, _, run = LocalContentTests().fixture()
        reader = cache.LocalContentReader(command=CtrCapabilityTests().command_for(b'ctr containerd 3.0.0\n'))
        with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
            with self.assertRaises(cache.Refused) as caught:
                cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        self.assertTrue(caught.exception.diagnostic.get('local_reader_version_shape', {}).get('package_is_containerd'))
        self.assertEqual(str(caught.exception), 'image_identity_mismatch')
        self.assertNotIn('3.0.0', json.dumps(caught.exception.diagnostic))
        run.assert_not_called()

class ReaderCommandFailureTests(unittest.TestCase):
    def test_bounded_nonzero_exit_classifies_known_stderr_without_exposing_it(self):
        import sys
        for stderr, expected in [
                ('ctr: rpc error: code = PermissionDenied desc = SECRET', 'grpc_permission_denied'),
                ('ctr: rpc error: code = NotFound desc = SECRET', 'grpc_not_found'),
                ('ctr: failed to dial SECRET: connect: permission denied\n', 'socket_permission_denied'),
                ('SECRET generic not found or permission denied', 'unclassified')]:
            with self.subTest(expected=expected):
                with self.assertRaises(cache.ContentUnavailable) as caught:
                    cache.bounded_command([sys.executable, '-c',
                        'import sys; sys.stderr.write(' + repr(stderr) + '); sys.exit(7)'], 64, 2)
                self.assertEqual(str(caught.exception), 'local_reader_failed')
                detail = getattr(caught.exception, 'command_failure', None)
                self.assertIsInstance(detail, dict)
                self.assertEqual(detail, {'exit_code': 7, 'stderr_class': expected,
                                          'failure_kind': 'command_exit'})
                self.assertNotIn('SECRET', json.dumps(detail))

    def test_command_stage_is_local_constant_and_argv_budgets_are_unchanged(self):
        from unittest.mock import patch
        for stage in ['version', 'global_help', 'content_help', 'daemon_info', 'content_get']:
            calls = []
            def command(args, limit, timeout):
                calls.append((args, limit, timeout))
                if stage != 'version' and args[-1] == '--version':
                    return b'ctr containerd 2.2.0\n'
                if stage == 'content_help' and args == ['/usr/bin/ctr', '--help']:
                    return b'--address --namespace --timeout --connect-timeout'
                raise cache.ContentUnavailable('local_reader_failed')
            reader = cache.LocalContentReader(command=command)
            with patch.object(cache.shutil, 'which', return_value='/usr/bin/ctr'):
                with self.assertRaises(cache.ContentUnavailable) as caught:
                    if stage == 'daemon_info': reader.info()
                    elif stage == 'content_get':
                        reader.executable = '/usr/bin/ctr'
                        reader.read('sha256:' + 'a' * 64, ('daemon', '/run/test.sock', 'moby'), 99)
                    else: reader.qualify()
            detail = getattr(caught.exception, 'command_failure', None)
            self.assertIsInstance(detail, dict)
            self.assertEqual(detail, {'command_stage': stage, 'exit_code': None,
                                      'stderr_class': 'unclassified', 'failure_kind': 'bounded_reader_refusal'})
            expected_budget = {'version': (4096, 5), 'global_help': (65536, 5),
                               'content_help': (16384, 5), 'daemon_info': (262144, 10), 'content_get': (99, 12)}
            self.assertEqual(calls[-1][1:], expected_budget[stage])

    def test_manifest_reader_failure_propagates_only_safe_command_metadata(self):
        import sys
        pin, image, reader, run = LocalContentTests().fixture()
        real_reader = cache.LocalContentReader(command=lambda *args: cache.bounded_command(
            [sys.executable, '-c', 'import sys;sys.stderr.write("ctr: rpc error: code = NotFound desc = SECRET");sys.exit(9)'], 64, 2))
        real_reader.executable = '/usr/bin/ctr'; reader.read = real_reader.read
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        detail = caught.exception.diagnostic
        self.assertEqual(detail['local_config_proof'], {'stage': 'manifest', 'reason': 'local_reader_failed'})
        self.assertEqual(detail.get('local_reader_command_failure'), {
            'command_stage': 'content_get', 'exit_code': 9, 'stderr_class': 'grpc_not_found',
            'failure_kind': 'command_exit'})
        self.assertEqual(str(caught.exception), 'image_identity_mismatch')
        self.assertNotIn('SECRET', json.dumps(detail)); run.assert_not_called()

    def test_arbitrary_exception_metadata_cannot_escape(self):
        pin, image, reader, run = LocalContentTests().fixture()
        error = cache.ContentUnavailable('local_reader_failed')
        error.command_failure = {'command_stage': 'SECRET', 'exit_code': 999999,
                                 'stderr_class': 'SECRET', 'failure_kind': 'SECRET', 'SECRET': 'SECRET'}
        reader.read = Mock(side_effect=error)
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        self.assertNotIn('local_reader_command_failure', caught.exception.diagnostic)
        self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))

    def test_spawn_oserror_reports_no_path_or_exception_text(self):
        from unittest.mock import patch
        import errno
        with patch.object(cache.subprocess, 'Popen', side_effect=PermissionError(errno.EACCES, 'SECRET', '/SECRET')):
            with self.assertRaises(cache.ContentUnavailable) as caught:
                cache.bounded_command(['fixture'], 64, 2)
        self.assertEqual(str(caught.exception), 'local_reader_failed')
        detail = getattr(caught.exception, 'command_failure', None)
        self.assertIsInstance(detail, dict)
        self.assertEqual(detail, {'exit_code': None, 'stderr_class': 'unclassified', 'failure_kind': 'os_error'})
        self.assertNotIn('SECRET', json.dumps(detail))

class WrappedReaderErrorTests(unittest.TestCase):
    def test_known_wrapped_and_rebased_forms_expose_only_fixed_features(self):
        self.assertTrue(callable(getattr(cache, 'stderr_output_features', None)), 'stderr features missing')
        fixtures = [
            (b'ctr: connection error: desc = "transport: Error while dialing: dial unix /SECRET: connect: permission denied"',
             ['permission_denied', 'connect_permission_denied', 'error_while_dialing', 'quoted_connection_error']),
            (b'ctr: failed to dial "/SECRET": context deadline exceeded', ['failed_to_dial', 'deadline_exceeded']),
            (b'ctr: dial unix /SECRET: connect: connection refused', ['connection_refused']),
            (b'ctr: cannot access socket /SECRET: stat /SECRET: no such file or directory',
             ['cannot_access_socket', 'no_such_file']),
            (b'ctr: content sha256:' + b'a' * 64 + b': not found', ['content_word', 'not_found']),
            (b'ctr: namespace is required: failed precondition', ['namespace_required', 'failed_precondition']),
            (b'flag provided but not defined: -SECRET', ['flag_not_defined']),
            (b'No help topic for SECRET', ['no_help_topic']),
            (b'rpc error: code = Unavailable desc = SECRET', ['grpc_unavailable']),
            (b'rpc error: code = DeadlineExceeded desc = SECRET', ['grpc_deadline_exceeded']),
            (b'ctr: not implemented: unknown service SECRET', ['not_implemented', 'unknown_service']),
            (b'ctr: invalid argument: unexpected EOF', ['invalid_argument', 'eof']),
            (b'unknown command SECRET; unknown flag SECRET', ['unknown_command', 'unknown_flag']),
            (b'ctr: resource exhausted: write SECRET: broken pipe', ['resource_exhausted', 'broken_pipe']),
            (b'ctr: unavailable: operation timed out', ['unavailable', 'timeout']),
            (b'ctr: context canceled: transport is closing', ['canceled', 'transport_closing']),
            (b'ctr: unauthorized: unauthenticated', ['unauthenticated'])]
        for raw, expected_true in fixtures:
            with self.subTest(features=expected_true):
                features = cache.stderr_output_features(raw)
                for key in expected_true: self.assertIs(features.get(key), True)
                self.assertEqual(features['byte_count'], len(raw))
                self.assertTrue(all(type(v) is bool for k, v in features.items() if k != 'byte_count'))
                self.assertNotIn('SECRET', json.dumps(features))
                self.assertNotIn('sha256:', json.dumps(features))
                self.assertLess(len(json.dumps(features)), 1200)
        unknown = cache.stderr_output_features(b'SECRET\xff arbitrary')
        self.assertFalse(unknown['ascii'])
        self.assertTrue(all(v is False for k, v in unknown.items() if k not in ['byte_count', 'ascii']))

    def test_wrapped_connect_and_grpc_unavailable_have_known_safe_classes(self):
        self.assertEqual(cache.stderr_failure_class(
            b'ctr: connection error: desc = "dial unix /SECRET: connect: permission denied"'),
            'socket_permission_denied')
        self.assertEqual(cache.stderr_failure_class(b'rpc error: code = Unavailable desc = SECRET'), 'grpc_unavailable')
        self.assertEqual(cache.stderr_failure_class(b'ctr: connect: permission deniedness'), 'unclassified')

    def test_native_manifest_error_features_propagate_without_raw_content(self):
        import sys
        pin, image, reader, run = LocalContentTests().fixture()
        raw = b'ctr: connection error: desc = "transport: Error while dialing: dial unix /SECRET: connect: permission denied"'
        real = cache.LocalContentReader(command=lambda *args: cache.bounded_command(
            [sys.executable, '-c', 'import sys;sys.stderr.buffer.write(' + repr(raw) + ');sys.exit(1)'], 64, 2))
        real.executable = '/usr/bin/ctr'; reader.read = real.read
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        self.assertEqual(caught.exception.diagnostic['local_config_proof'], {'stage': 'manifest', 'reason': 'local_reader_failed'})
        features = caught.exception.diagnostic.get('local_reader_stderr_features')
        self.assertIsInstance(features, dict)
        self.assertTrue(features['connect_permission_denied']); self.assertTrue(features['quoted_connection_error'])
        self.assertEqual(caught.exception.diagnostic['local_reader_command_failure']['exit_code'], 1)
        self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))
        self.assertEqual(str(caught.exception), 'image_identity_mismatch'); run.assert_not_called()

    def test_arbitrary_feature_values_and_oversize_counts_are_not_logged(self):
        pin, image, reader, run = LocalContentTests().fixture()
        error = cache.ContentUnavailable('local_reader_failed')
        error.stderr_features = {'SECRET': 'SECRET', 'byte_count': 999999, 'ascii': 'SECRET'}
        reader.read = Mock(side_effect=error)
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        self.assertNotIn('local_reader_stderr_features', caught.exception.diagnostic)
        self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))

class SyntheticTrustFS:
    """Declared root-owned metadata/ELF bytes; no real root filesystem or tools."""
    def __init__(self):
        import hashlib, stat
        from types import SimpleNamespace
        self.nodes = {}; self.fds = {}; self.next_fd = 1
        def add(path, mode, data=b'', uid=0):
            self.nodes[path] = [SimpleNamespace(st_mode=mode, st_uid=uid, st_gid=0,
                st_dev=1, st_ino=len(self.nodes) + 1, st_size=len(data), st_mtime_ns=1, st_ctime_ns=1), data]
        self.add = add
        for path in ['/', '/usr', '/usr/bin', '/var', '/var/lib', '/var/lib/dpkg', '/var/lib/dpkg/info',
                     '/run', '/run/docker', '/run/docker/containerd']:
            add(path, stat.S_IFDIR | 0o755)
        for name, package in [('ctr', 'containerd.io'), ('docker', 'docker-ce-cli'), ('sudo', 'sudo'), ('timeout', 'coreutils')]:
            data = b'\x7fELFdeclared-synthetic-' + name.encode()
            add('/usr/bin/' + name, stat.S_IFREG | 0o755, data)
            entry = hashlib.md5(data).hexdigest() + '  usr/bin/' + name + '\n'
            add('/var/lib/dpkg/info/' + package + '.md5sums', stat.S_IFREG | 0o644, entry.encode())
        add('/run/docker/containerd/containerd.sock', stat.S_IFSOCK | 0o660)
    def realpath(self, path): return path
    def lstat(self, path):
        if path not in self.nodes: raise FileNotFoundError('synthetic missing file')
        return self.nodes[path][0]
    def open(self, path, flags):
        self.lstat(path); fd = self.next_fd; self.next_fd += 1; self.fds[fd] = [path, 0]; return fd
    def fstat(self, fd): return self.lstat(self.fds[fd][0])
    def read(self, fd, count):
        path, position = self.fds[fd]; chunk = self.nodes[path][1][position:position + count]
        self.fds[fd][1] += len(chunk); return chunk
    def close(self, fd): del self.fds[fd]
    def readlink(self, path): return self.nodes[path][1].decode('ascii')


class PinnedRootReaderTests(unittest.TestCase):
    def fixture(self, spawn=None):
        self.assertTrue(callable(getattr(cache, '_PinnedRootReader', None)), 'scoped root reader missing')
        import sys
        env = {**ENV, 'RUNNER_OS': 'Linux', 'RUNNER_ENVIRONMENT': 'github-hosted'}
        fs = SyntheticTrustFS(); calls = []; privileged_calls = []
        def command(args, limit, timeout):
            calls.append((args, limit, timeout))
            if args[0].endswith(('/sudo', '/sudo.ws')): return b'Sudo version 1.9.17p2\n'
            if args[0].endswith('/timeout'):
                return b'timeout (GNU coreutils) 9.5\n' if args[-1] == '--version' else b'--signal --kill-after'
            if args[-1] == '--version': return b'ctr containerd 2.2.0\n'
            if args[-1] == '--help': return b'--address --namespace --timeout --connect-timeout content get'
            if 'info' in args:
                return json.dumps({'ID': 'synthetic-daemon', 'Containerd': {
                    'Address': '/run/docker/containerd/containerd.sock',
                    'Namespaces': {'Containers': 'moby', 'Plugins': 'plugins.moby'}}}).encode()
            raise AssertionError('unexpected unprivileged operation')
        def owned_spawn(args, **kwargs):
            privileged_calls.append((args, kwargs))
            # Owned nonprivileged Python models pipes/process only; never runs sudo/timeout/ctr.
            return subprocess.Popen([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"declared-blob")'], **kwargs)
        reader = cache._PinnedRootReader(cache.PINS[0], env=env, platform='linux', fs=fs,
                                         command=command, spawn=spawn or owned_spawn)
        return reader, fs, env, calls, privileged_calls

    def qualify(self, reader):
        from unittest.mock import patch
        with patch.object(cache.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name):
            reader.qualify()
        return cache.daemon_binding(reader.info(), reader)


    def add_c_sudo_ws(self, fs):
        import hashlib, stat
        data = b'\x7fELFdeclared-synthetic-sudo-ws'
        fs.add('/usr/bin/sudo.ws', stat.S_IFREG | 0o755, data)
        fs.nodes['/var/lib/dpkg/info/sudo.md5sums'][1] += (hashlib.md5(data).hexdigest() + '  usr/bin/sudo.ws\n').encode()
        fs.nodes['/var/lib/dpkg/info/sudo.md5sums'][0].st_size = len(fs.nodes['/var/lib/dpkg/info/sudo.md5sums'][1])

    def test_existing_c_sudo_ws_preferred_and_qualified(self):
        reader, fs, env, calls, privileged = self.fixture(); self.add_c_sudo_ws(fs)
        binding = self.qualify(reader)
        reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(privileged[0][0][0], '/usr/bin/sudo.ws')
        self.assertTrue(any(args == ['/usr/bin/sudo.ws', '--version'] for args, _, _ in calls))

    def test_missing_ws_uses_version_qualified_legacy_c_sudo(self):
        reader, fs, env, calls, privileged = self.fixture(); self.qualify(reader)
        self.assertTrue(any(args == ['/usr/bin/sudo', '--version'] for args, _, _ in calls))

    def test_rust_unknown_and_malformed_sudo_versions_fail_without_privilege(self):
        for version in [b'sudo-rs 0.2.8\n', b'Sudo version 1.8.31\n', b'Sudo version 2.0.1\n',
                        b'Sudo version 1.9.17p2 SECRET\n', b'Sudo version 1.9.\n', b'UNKNOWN\n']:
            reader, fs, env, calls, privileged = self.fixture(); command = reader.basic.command
            reader.basic.command = lambda args, limit, timeout: version if args[0].endswith('/sudo') else command(args, limit, timeout)
            with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
            self.assertEqual(privileged, [])

    def test_present_malformed_ws_does_not_try_legacy_version(self):
        reader, fs, env, calls, privileged = self.fixture(); self.add_c_sudo_ws(fs)
        command = reader.basic.command
        reader.basic.command = lambda args, limit, timeout: b'sudo-rs 0.2.8\n' if args[0].endswith('/sudo.ws') else command(args, limit, timeout)
        with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
        self.assertFalse(any(args[0] == '/usr/bin/sudo' for args, _, _ in calls))
        self.assertEqual(privileged, [])

    def test_present_unsafe_ws_does_not_fallback_to_legacy(self):
        reader, fs, env, calls, privileged = self.fixture(); self.add_c_sudo_ws(fs)
        fs.nodes['/usr/bin/sudo.ws'][0].st_uid = 1001
        with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
        self.assertEqual(privileged, []); self.assertEqual(calls, [])

    def test_present_ws_redirect_to_other_allowed_prefix_is_refused(self):
        import stat
        reader, fs, env, calls, privileged = self.fixture(); self.add_c_sudo_ws(fs)
        fs.add('/usr/bin/sudo.ws', stat.S_IFLNK | 0o777, b'sudo')
        with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
        self.assertEqual(privileged, [])

    def test_selected_sudo_path_drift_stops_before_read(self):
        reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
        self.add_c_sudo_ws(fs)
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(privileged, [])

    def add_gnu_watchdog(self, fs):
        import hashlib, stat
        data = b'\x7fELFdeclared-synthetic-gnutimeout'
        fs.add('/usr/bin/gnutimeout', stat.S_IFREG | 0o755, data)
        fs.add('/var/lib/dpkg/info/gnu-coreutils.md5sums', stat.S_IFREG | 0o644,
               (hashlib.md5(data).hexdigest() + '  usr/bin/gnutimeout\n').encode())

    def gnu_command(self, reader, version=b'gnutimeout (GNU coreutils) 9.7\n', help_text=b'--signal --kill-after'):
        original = reader.basic.command
        reader.basic.command = lambda args, limit, timeout: ((version if args[-1] == '--version' else help_text)
            if args[0] == '/usr/bin/gnutimeout' else original(args, limit, timeout))

    def test_existing_gnu_watchdog_preferred_with_exact_package_and_argv(self):
        reader, fs, env, calls, privileged = self.fixture(); self.add_gnu_watchdog(fs); self.gnu_command(reader)
        # Ubuntu's generic coreutils package need not own the installed GNU binary.
        del fs.nodes['/var/lib/dpkg/info/coreutils.md5sums']
        binding = self.qualify(reader); reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(privileged[0][0][3], '/usr/bin/gnutimeout')

    def test_prefixed_gnu_binary_accepts_upstream_fixed_program_banner(self):
        reader, fs, env, calls, privileged = self.fixture(); self.add_gnu_watchdog(fs)
        self.gnu_command(reader, b'timeout (GNU coreutils) 9.7\n')
        self.qualify(reader)

    def test_gnu_watchdog_requires_selected_canonical_path_and_package(self):
        import stat
        for failure in ['redirect', 'missing_package']:
            reader, fs, env, calls, privileged = self.fixture(); self.add_gnu_watchdog(fs); self.gnu_command(reader)
            if failure == 'redirect': fs.add('/usr/bin/gnutimeout', stat.S_IFLNK | 0o777, b'timeout')
            else: del fs.nodes['/var/lib/dpkg/info/gnu-coreutils.md5sums']
            with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
            self.assertEqual(privileged, [])

    def test_missing_gnu_watchdog_retains_existing_legacy_gnu(self):
        reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
        reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(privileged[0][0][3], '/usr/bin/timeout')

    def test_present_unsafe_gnu_watchdog_never_uses_legacy(self):
        reader, fs, env, calls, privileged = self.fixture(); self.add_gnu_watchdog(fs); self.gnu_command(reader)
        fs.nodes['/usr/bin/gnutimeout'][0].st_uid = 1001
        with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
        self.assertEqual(privileged, []); self.assertEqual(calls, [])

    def test_present_bad_gnu_brand_version_or_flags_never_falls_back(self):
        for version, help_text in [(b'timeout (uutils coreutils) 0.8.0\n', b'--signal --kill-after'),
                (b'gnutimeout (GNU coreutils) 9.7 SECRET\n', b'--signal --kill-after'),
                (b'UNKNOWN\n', b'--signal --kill-after'),
                (b'gnutimeout (GNU coreutils) 9.7\n', b'--signal')]:
            reader, fs, env, calls, privileged = self.fixture(); self.add_gnu_watchdog(fs)
            self.gnu_command(reader, version, help_text)
            with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
            self.assertEqual(privileged, [])
            self.assertFalse(any(args[0] == '/usr/bin/timeout' for args, _, _ in calls))

    def test_gnu_watchdog_choice_drift_refused_before_privilege(self):
        reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
        self.add_gnu_watchdog(fs)
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(privileged, [])

    def test_missing_all_watchdogs_refuses_before_privilege(self):
        reader, fs, env, calls, privileged = self.fixture(); del fs.nodes['/usr/bin/timeout']
        with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
        self.assertEqual(privileged, [])

    def test_legacy_rust_timeout_is_not_qualified_as_gnu(self):
        reader, fs, env, calls, privileged = self.fixture(); command = reader.basic.command
        reader.basic.command = lambda args, limit, timeout: b'timeout (uutils coreutils) 0.8.0\n' if args[0] == '/usr/bin/timeout' else command(args, limit, timeout)
        with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
        self.assertEqual(privileged, [])

    def test_fixed_scoped_argv_pair_and_clean_environment(self):
        reader, fs, env, calls, privileged = self.fixture()
        binding = self.qualify(reader)
        self.assertEqual(reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT), b'declared-blob')
        self.assertEqual(reader.read(cache.PINS[0].config, binding, cache.CONFIG_LIMIT), b'declared-blob')
        self.assertEqual(len(privileged), 2)
        for index, (args, kwargs) in enumerate(privileged):
            self.assertEqual(args, ['/usr/bin/sudo', '-n', '--', '/usr/bin/timeout', '--signal=TERM',
                '--kill-after=1s', '10s', '/usr/bin/ctr', '--address', '/run/docker/containerd/containerd.sock',
                '--namespace', 'moby', '--timeout', '10s', '--connect-timeout', '3s', 'content', 'get',
                [cache.PINS[0].manifest, cache.PINS[0].config][index]])
            self.assertEqual(kwargs['stdin'], subprocess.DEVNULL)
            self.assertEqual(kwargs['env'], {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
        self.assertTrue(all(args[0] == '/usr/bin/docker' for args, _, _ in calls if 'info' in args))
        with self.assertRaises(cache.ContentUnavailable):
            reader.read(cache.PINS[0].config, binding, cache.CONFIG_LIMIT)

    def test_hostile_context_and_endpoint_refused_before_any_command(self):
        for change in [{'RUNNER_ENVIRONMENT': 'self-hosted'}, {'RUNNER_OS': 'macOS'},
                       {'GITHUB_ACTIONS': 'false'}, {'DOCKER_HOST': 'tcp://SECRET'},
                       {'LD_PRELOAD': '/SECRET'}, {'SUDO_ASKPASS': '/SECRET'}]:
            reader, fs, env, calls, privileged = self.fixture(); env.update(change)
            with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
            self.assertEqual(calls, []); self.assertEqual(privileged, [])

    def test_untrusted_tools_ancestors_metadata_and_elf_refused(self):
        import stat
        for mode in ['tool_owner', 'tool_write', 'ancestor_write', 'not_elf', 'missing_package', 'wrong_md5', 'docker_owner']:
            reader, fs, env, calls, privileged = self.fixture()
            if mode == 'tool_owner': fs.nodes['/usr/bin/ctr'][0].st_uid = 1000
            if mode == 'tool_write': fs.nodes['/usr/bin/ctr'][0].st_mode |= 0o002
            if mode == 'ancestor_write': fs.nodes['/usr/bin'][0].st_mode |= 0o020
            if mode == 'not_elf': fs.nodes['/usr/bin/ctr'][1] = b'#!/bin/sh\n'; fs.nodes['/usr/bin/ctr'][0].st_size = 10
            if mode == 'missing_package': del fs.nodes['/var/lib/dpkg/info/containerd.io.md5sums']
            if mode == 'wrong_md5': fs.nodes['/var/lib/dpkg/info/containerd.io.md5sums'][1] = b'0' * 32 + b'  usr/bin/ctr\n'
            if mode == 'docker_owner': fs.nodes['/usr/bin/docker'][0].st_uid = 1000
            with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
            self.assertEqual(privileged, [])

    def test_wrong_pin_digest_order_binding_and_socket_are_refused(self):
        for kind in ['other_pin', 'config_first', 'namespace', 'socket_owner', 'socket_parent_write']:
            reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
            digest = cache.PINS[0].manifest
            if kind == 'other_pin': digest = cache.PINS[1].manifest
            if kind == 'config_first': digest = cache.PINS[0].config
            if kind == 'namespace': binding = (binding[0], binding[1], 'plugins.moby')
            if kind == 'socket_owner': fs.nodes[binding[1]][0].st_uid = 1000
            if kind == 'socket_parent_write': fs.nodes['/run/docker/containerd'][0].st_mode |= 0o002
            with self.assertRaises(cache.ContentUnavailable): reader.read(digest, binding, cache.MANIFEST_LIMIT)
            self.assertEqual(privileged, [])

    def test_binary_drift_after_read_stops_scope(self):
        reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
        original_spawn = reader.spawn
        def changed_spawn(*args, **kwargs):
            child = original_spawn(*args, **kwargs)
            fs.nodes['/usr/bin/ctr'][0].st_mtime_ns += 1
            return child
        reader.spawn = changed_spawn
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].config, binding, cache.CONFIG_LIMIT)
        self.assertEqual(len(privileged), 1)

    def test_cleanup_unconfirmed_is_terminal_and_bounded(self):
        from unittest.mock import patch
        process = Mock(); process.stdout = Mock(); process.stderr = Mock()
        process.poll.return_value = None
        process.wait.side_effect = subprocess.TimeoutExpired('synthetic', 15)
        selector = Mock(); selector.get_map.return_value = {}
        manager = Mock(); manager.__enter__ = Mock(return_value=selector); manager.__exit__ = Mock(return_value=False)
        reader, fs, env, calls, privileged = self.fixture(spawn=Mock(return_value=process)); binding = self.qualify(reader)
        with patch.object(cache.selectors, 'DefaultSelector', return_value=manager):
            with self.assertRaises(cache.ContentUnavailable) as caught:
                reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(str(caught.exception), 'local_reader_cleanup_unconfirmed')
        self.assertTrue(all(0 < call.kwargs['timeout'] <= 15 for call in process.wait.call_args_list))
        process.kill.assert_not_called(); process.terminate.assert_called_once()
        before = reader.spawn.call_count
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].config, binding, cache.CONFIG_LIMIT)
        self.assertEqual(reader.spawn.call_count, before)

    def test_root_owned_alias_keeps_original_and_canonical_custody(self):
        from unittest.mock import patch
        import stat
        reader, fs, env, calls, privileged = self.fixture()
        fs.add('/usr/local', stat.S_IFDIR | 0o755); fs.add('/usr/local/bin', stat.S_IFDIR | 0o755)
        fs.add('/usr/local/bin/ctr', stat.S_IFLNK | 0o777, b'/usr/bin/ctr')
        fs.realpath = lambda path: '/usr/bin/ctr' if path == '/usr/local/bin/ctr' else path
        with patch.object(cache.shutil, 'which', side_effect=lambda name:
                          '/usr/local/bin/ctr' if name == 'ctr' else '/usr/bin/' + name):
            reader.qualify()
        binding = cache.daemon_binding(reader.info(), reader)
        self.assertEqual(reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT), b'declared-blob')
        self.assertEqual(privileged[0][0][7], '/usr/bin/ctr')
        fs.nodes['/usr/local/bin/ctr'][0].st_uid = 1000
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].config, binding, cache.CONFIG_LIMIT)
        self.assertEqual(len(privileged), 1)

    def test_missing_watchdog_capability_and_socket_are_fail_closed(self):
        for kind in ['watchdog', 'socket']:
            reader, fs, env, calls, privileged = self.fixture()
            original = reader.basic.command
            if kind == 'watchdog':
                reader.basic.command = lambda args, limit, timeout: (b'unsupported' if args[0].endswith('/timeout')
                                                                    else original(args, limit, timeout))
            if kind == 'socket': del fs.nodes['/run/docker/containerd/containerd.sock']
            with self.assertRaises(cache.ContentUnavailable): self.qualify(reader)
            self.assertEqual(privileged, [])

    def test_overflow_discards_content_terminates_owned_model_and_stops_pair(self):
        import sys
        seen = []
        def spawn(args, **kwargs):
            child = subprocess.Popen([sys.executable, '-c', 'import sys;sys.stdout.buffer.write(b"x"*(1024*1024+1))'], **kwargs)
            seen.append(child); return child
        reader, fs, env, calls, privileged = self.fixture(spawn=spawn); binding = self.qualify(reader)
        with self.assertRaises(cache.ContentUnavailable) as caught:
            reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(str(caught.exception), 'local_reader_overflow')
        self.assertIsNotNone(seen[0].poll())
        with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].config, binding, cache.CONFIG_LIMIT)
        self.assertEqual(len(seen), 1)

    def test_content_deadline_uses_term_then_bounded_reap_without_kill(self):
        from unittest.mock import patch
        now = {'value': 0}
        process = Mock(); process.poll.return_value = None; process.wait.return_value = 0
        selector = Mock(); selector.get_map.return_value = True
        selector.select.side_effect = lambda timeout: now.update(value=13) or []
        manager = Mock(); manager.__enter__ = Mock(return_value=selector); manager.__exit__ = Mock(return_value=False)
        reader, fs, env, calls, privileged = self.fixture(spawn=Mock(return_value=process)); binding = self.qualify(reader)
        with patch.object(cache.selectors, 'DefaultSelector', return_value=manager), \
                patch.object(cache.time, 'monotonic', side_effect=lambda: now['value']):
            with self.assertRaises(cache.ContentUnavailable) as caught:
                reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
        self.assertEqual(str(caught.exception), 'local_reader_timeout')
        process.terminate.assert_called_once(); process.kill.assert_not_called()
        self.assertTrue(reader.stopped)
        self.assertTrue(all(0 < call.kwargs['timeout'] <= 15 for call in process.wait.call_args_list))

    def test_changed_path_lookup_daemon_and_elf_bytes_are_terminal(self):
        import hashlib
        for kind in ['lookup', 'daemon', 'bytes']:
            reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
            if kind == 'lookup': reader.lookup = lambda name: '/tmp/hostile-' + name
            if kind == 'daemon':
                original = reader.basic.command
                reader.basic.command = lambda args, limit, timeout: (json.dumps({'ID': 'changed', 'Containerd': {
                    'Address': binding[1], 'Namespaces': {'Containers': 'moby', 'Plugins': 'plugins.moby'}}}).encode()
                    if 'info' in args else original(args, limit, timeout))
                with self.assertRaises(cache.ContentUnavailable): reader.info()
            if kind == 'bytes':
                fs.nodes['/usr/bin/ctr'][1] = fs.nodes['/usr/bin/ctr'][1][:-1] + b'X'
                digest = hashlib.md5(fs.nodes['/usr/bin/ctr'][1]).hexdigest()
                fs.nodes['/var/lib/dpkg/info/containerd.io.md5sums'][1] = (digest + '  usr/bin/ctr\n').encode()
            with self.assertRaises(cache.ContentUnavailable): reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT)
            self.assertTrue(reader.stopped); self.assertEqual(privileged, [])

    def test_intermediate_symlink_targets_cannot_hide_writable_ancestors(self):
        from unittest.mock import patch
        import stat
        reader, fs, env, calls, privileged = self.fixture()
        fs.add('/usr/local', stat.S_IFLNK | 0o777, b'/tmp/hidden/usr'); fs.add('/usr/local/bin', stat.S_IFDIR | 0o755)
        fs.add('/usr/local/bin/ctr', stat.S_IFLNK | 0o777, b'/usr/bin/ctr')
        fs.add('/tmp', stat.S_IFDIR | 0o1777); fs.add('/tmp/hidden', stat.S_IFDIR | 0o755, uid=1000)
        fs.add('/tmp/hidden/usr', stat.S_IFDIR | 0o755)
        fs.realpath = lambda path: {'/usr/local': '/tmp/hidden/usr',
                                   '/usr/local/bin/ctr': '/usr/bin/ctr'}.get(path, path)
        with patch.object(cache.shutil, 'which', side_effect=lambda name:
                          '/usr/local/bin/ctr' if name == 'ctr' else '/usr/bin/' + name):
            with self.assertRaises(cache.ContentUnavailable): reader.qualify()
        self.assertEqual(calls, []); self.assertEqual(privileged, [])

    def test_hidden_raw_two_hop_target_is_not_collapsed_to_trusted_final(self):
        import stat, hashlib
        fs = SyntheticTrustFS(); original = fs.nodes['/usr/bin/timeout'][1]
        fs.add('/usr/bin/real-timeout', stat.S_IFREG | 0o755, original)
        fs.add('/usr/bin/timeout', stat.S_IFLNK | 0o777, b'/home/runner/writable-hop/link')
        fs.add('/home', stat.S_IFDIR | 0o755); fs.add('/home/runner', stat.S_IFDIR | 0o755, uid=1000)
        fs.add('/home/runner/writable-hop', stat.S_IFDIR | 0o777, uid=1000)
        fs.add('/home/runner/writable-hop/link', stat.S_IFLNK | 0o777, b'/usr/bin/real-timeout')
        fs.nodes['/var/lib/dpkg/info/coreutils.md5sums'][1] = (hashlib.md5(original).hexdigest() + '  usr/bin/real-timeout\n').encode()
        fs.nodes['/var/lib/dpkg/info/coreutils.md5sums'][0].st_size = len(fs.nodes['/var/lib/dpkg/info/coreutils.md5sums'][1])
        fs.realpath = lambda path: '/usr/bin/real-timeout' if path in {
            '/usr/bin/timeout', '/home/runner/writable-hop/link'} else path
        with self.assertRaises(cache.ContentUnavailable): cache._TrustedFiles(fs).tool('/usr/bin/timeout', 'coreutils')

    def test_fixed_privileged_prefixes_cannot_redirect_even_to_root_protected_elf(self):
        from unittest.mock import patch
        import stat, hashlib
        for name, package in [('sudo', 'sudo'), ('timeout', 'coreutils')]:
            reader, fs, env, calls, privileged = self.fixture()
            data = fs.nodes['/usr/bin/' + name][1]; target = '/usr/bin/real-' + name
            fs.add(target, stat.S_IFREG | 0o755, data)
            fs.add('/usr/bin/' + name, stat.S_IFLNK | 0o777, target.encode())
            metadata = (hashlib.md5(data).hexdigest() + '  ' + target[1:] + '\n').encode()
            fs.nodes['/var/lib/dpkg/info/' + package + '.md5sums'][1] = metadata
            fs.nodes['/var/lib/dpkg/info/' + package + '.md5sums'][0].st_size = len(metadata)
            fs.realpath = lambda path: target if path == '/usr/bin/' + name else path
            original = reader.basic.command
            reader.basic.command = lambda args, limit, timeout: ((b'timeout (GNU coreutils) 9.5\n'
                if args[-1] == '--version' else b'--signal --kill-after') if args[0] == '/usr/bin/real-timeout'
                else original(args, limit, timeout))
            with patch.object(cache.shutil, 'which', side_effect=lambda tool: '/usr/bin/' + tool):
                with self.assertRaises(cache.ContentUnavailable): reader.qualify()
            self.assertEqual(privileged, [])

    def test_safe_usr_merge_and_relative_raw_targets_qualify(self):
        from unittest.mock import patch
        import stat
        for alias, target in [('/bin', b'usr/bin'), ('/usr/local/bin/ctr', b'../../bin/ctr')]:
            reader, fs, env, calls, privileged = self.fixture()
            if alias == '/bin':
                fs.add('/bin', stat.S_IFLNK | 0o777, target)
                lookup = lambda name: '/bin/' + name
            else:
                fs.add('/usr/local', stat.S_IFDIR | 0o755); fs.add('/usr/local/bin', stat.S_IFDIR | 0o755)
                fs.add(alias, stat.S_IFLNK | 0o777, target)
                lookup = lambda name: alias if name == 'ctr' else '/usr/bin/' + name
            with patch.object(cache.shutil, 'which', side_effect=lookup): reader.qualify()
            binding = cache.daemon_binding(reader.info(), reader)
            self.assertEqual(reader.read(cache.PINS[0].manifest, binding, cache.MANIFEST_LIMIT), b'declared-blob')
            self.assertEqual(privileged[0][0][0], '/usr/bin/sudo')
            self.assertEqual(privileged[0][0][3], '/usr/bin/timeout')
            self.assertEqual(privileged[0][0][7], '/usr/bin/ctr')

    def test_pin_identity_gate_never_invokes_caller_equality_or_properties(self):
        from unittest.mock import patch
        class Lookalike:
            def __eq__(self, other): raise AssertionError('caller equality must not run')
            @property
            def manifest(self): raise AssertionError('caller property must not run')
        class Derived(cache.ImagePin):
            def __eq__(self, other): raise AssertionError('subclass equality must not run')
        command = Mock(); spawn = Mock()
        for pin in [Lookalike(), Derived(*cache.PINS[0]), cache.ImagePin(*cache.PINS[0])]:
            with self.assertRaises(cache.ContentUnavailable):
                cache._PinnedRootReader(pin, command=command, spawn=spawn)
        command.assert_not_called(); spawn.assert_not_called()

    def test_raw_target_dotdot_is_not_a_socket_and_link_cycles_are_bounded(self):
        import stat
        for target in [b'..', b'containerd.sock']:
            fs = SyntheticTrustFS()
            fs.add('/run/docker/containerd/containerd.sock', stat.S_IFLNK | 0o777, target)
            with self.assertRaises(cache.ContentUnavailable):
                cache._TrustedFiles(fs).socket('/run/docker/containerd/containerd.sock')

    def test_digest_and_binding_values_cannot_spoof_equality(self):
        class TextLookalike(str):
            def __eq__(self, other): return True
            def __ne__(self, other): return False
        for kind in ['digest', 'namespace']:
            reader, fs, env, calls, privileged = self.fixture(); binding = self.qualify(reader)
            digest = cache.PINS[0].manifest
            if kind == 'digest': digest = TextLookalike('sha256:' + 'f' * 64)
            else: binding = (binding[0], binding[1], TextLookalike('other-namespace'))
            with self.assertRaises(cache.ContentUnavailable): reader.read(digest, binding, cache.MANIFEST_LIMIT)
            self.assertEqual(privileged, [])


class TrustedBinaryCheckDiagnosticTests(unittest.TestCase):
    def assert_serialized_refusal(self, error, expected):
        pin, image, reader, run = LocalContentTests().fixture()
        reader.qualify = Mock(side_effect=error)
        with self.assertRaises(cache.Refused) as caught:
            cache.verify(image, pin, reference='fixture', run=run, reader=reader)
        detail = caught.exception.diagnostic['local_config_proof']
        self.assertEqual(detail['reason'], str(error))
        self.assertEqual(detail['stage'], 'capability')
        self.assertEqual(detail.get('trusted_binary_check'), expected)
        self.assertEqual(str(caught.exception), 'image_identity_mismatch')
        self.assertNotIn('SECRET', json.dumps(caught.exception.diagnostic))
        run.assert_not_called()

    def actual_file_refusal(self, check):
        from unittest.mock import patch
        fs = SyntheticTrustFS(); path = '/usr/bin/ctr'
        kwargs = {'executable': True}
        if check == 'file_size': fs.nodes[path][0].st_size = 0
        elif check == 'file_overflow':
            fs.nodes[path][1] = b'x' * (2 * 1024 * 1024 + 1)
            fs.nodes[path][0].st_size = 1; kwargs = {'executable': False}
        elif check == 'elf_magic':
            fs.nodes[path][1] = b'TEXT' + fs.nodes[path][1][4:]
        if check == 'file_read_deadline':
            with patch.object(cache.time, 'monotonic', side_effect=[0, 6]):
                with self.assertRaises(cache.ContentUnavailable) as caught:
                    cache._TrustedFiles(fs)._file(path, **kwargs)
        else:
            with self.assertRaises(cache.ContentUnavailable) as caught:
                cache._TrustedFiles(fs)._file(path, **kwargs)
        self.assertEqual(fs.fds, {})
        self.assertEqual(str(caught.exception), 'local_reader_trusted_binary_required')
        self.assertEqual(getattr(caught.exception, 'trusted_binary_check', None), check)
        self.assert_serialized_refusal(caught.exception, check)

    def test_actual_file_size_refusal_has_fixed_check(self): self.actual_file_refusal('file_size')
    def test_actual_file_read_deadline_refusal_has_fixed_check(self): self.actual_file_refusal('file_read_deadline')
    def test_actual_file_overflow_refusal_has_fixed_check(self): self.actual_file_refusal('file_overflow')
    def test_actual_elf_magic_refusal_has_fixed_check(self): self.actual_file_refusal('elf_magic')

    def test_actual_sudo_version_refusal_has_fixed_check(self):
        reader, fs, env, calls, privileged = PinnedRootReaderTests().fixture()
        command = reader.basic.command
        reader.basic.command = lambda args, limit, timeout: b'SECRET malformed sudo banner' if args[0] == '/usr/bin/sudo' else command(args, limit, timeout)
        with self.assertRaises(cache.ContentUnavailable) as caught:
            PinnedRootReaderTests().qualify(reader)
        self.assertEqual(privileged, [])
        self.assertEqual(str(caught.exception), 'local_reader_trusted_binary_required')
        self.assertEqual(getattr(caught.exception, 'trusted_binary_check', None), 'sudo_version')
        self.assert_serialized_refusal(caught.exception, 'sudo_version')

    def test_malicious_attribute_values_and_str_subclasses_are_omitted(self):
        class UntrustedString(str):
            def __hash__(self): raise AssertionError('SECRET hash called')
            def __str__(self): raise AssertionError('SECRET str called')
        for value in ['SECRET', 'elf_magic\nSECRET', {'SECRET': 'SECRET'}, True, None, UntrustedString('elf_magic')]:
            error = cache.ContentUnavailable('local_reader_trusted_binary_required')
            error.trusted_binary_check = value
            self.assert_serialized_refusal(error, None)

    def test_valid_attribute_only_binds_exact_base_reason_and_exception_type(self):
        error = cache.ContentUnavailable('local_reader_failed'); error.trusted_binary_check = 'elf_magic'
        self.assert_serialized_refusal(error, None)
        class UntrustedError(cache.ContentUnavailable):
            @property
            def trusted_binary_check(self): raise AssertionError('SECRET property called')
        self.assert_serialized_refusal(UntrustedError('local_reader_trusted_binary_required'), None)

if __name__ == '__main__':
    unittest.main()
