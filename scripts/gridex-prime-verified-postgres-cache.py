"""Prime identical pinned PostgreSQL and bootstrap companion bytes on CI.

Official GHCR and Docker Hub index digests match for these exact versions.
The alternate cache origin is explicit. No services are started and the
Supabase registry override, native tests and existing gates are unchanged.
"""
import json
import hashlib
import re
import selectors
import shutil
import stat
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

MANIFEST_LIMIT = 1024 * 1024
CONFIG_LIMIT = 4 * 1024 * 1024
MANIFEST_TYPES = {'application/vnd.oci.image.manifest.v1+json',
                  'application/vnd.docker.distribution.manifest.v2+json'}
CONFIG_TYPES = {'application/vnd.oci.image.config.v1+json',
                'application/vnd.docker.container.image.v1+json'}


class ContentUnavailable(RuntimeError):
    """Safe local-reader failure; never includes subprocess output or content."""

STDERR_FEATURE_PATTERNS = {
    'permission_denied': rb'\bpermission denied\b',
    'connect_permission_denied': rb': connect: permission denied\b',
    'error_while_dialing': rb'transport: error while dialing:',
    'quoted_connection_error': rb'connection error: desc = "',
    'failed_to_dial': rb'failed to dial ',
    'deadline_exceeded': rb'\bdeadline(?: exceeded|exceeded)\b',
    'connection_refused': rb'\bconnection refused\b',
    'cannot_access_socket': rb'cannot access socket ',
    'no_such_file': rb'\bno such file or directory\b',
    'content_word': rb'\bcontent\b',
    'not_found': rb'\bnot found\b',
    'namespace_required': rb'namespace is required:',
    'failed_precondition': rb'\bfailed precondition\b',
    'flag_not_defined': rb'flag provided but not defined:',
    'no_help_topic': rb'no help topic for ',
    'unknown_command': rb'\bunknown command\b',
    'unknown_flag': rb'\bunknown flag\b',
    'grpc_unavailable': rb'rpc error: code = unavailable desc = ',
    'grpc_deadline_exceeded': rb'rpc error: code = deadlineexceeded desc = ',
    'not_implemented': rb'\bnot implemented\b',
    'unknown_service': rb'\bunknown service\b',
    'invalid_argument': rb'\binvalid argument\b',
    'eof': rb'\beof\b',
    'resource_exhausted': rb'\bresource(?: exhausted|exhausted)\b',
    'broken_pipe': rb'\bbroken pipe\b',
    'unavailable': rb'\bunavailable\b',
    'timeout': rb'\b(?:i/o timeout|timed out|timeout)\b',
    'canceled': rb'\b(?:canceled|cancelled)\b',
    'unauthenticated': rb'\b(?:unauthenticated|unauthorized)\b',
    'transport_closing': rb'transport is closing',
}


def stderr_output_features(raw):
    """Fixed syntax features only, never an authority or root-cause decision."""
    lowered = raw.lower()
    return {'byte_count': len(raw), 'ascii': raw.isascii(),
            **{key: bool(re.search(pattern, lowered)) for key, pattern in STDERR_FEATURE_PATTERNS.items()}}


def normalized_stderr_features(value):
    fields = set(STDERR_FEATURE_PATTERNS) | {'ascii'}
    if (not isinstance(value, dict) or type(value.get('byte_count')) is not int
            or not 0 <= value['byte_count'] <= 4096
            or not all(type(value.get(k)) is bool for k in fields)):
        return None
    return {key: value[key] for key in sorted(fields | {'byte_count'})}


def stderr_failure_class(raw):
    # These describe recognized error syntax, not an authorization/root-cause verdict.
    if b'rpc error: code = PermissionDenied desc = ' in raw:
        return 'grpc_permission_denied'
    if b'rpc error: code = NotFound desc = ' in raw:
        return 'grpc_not_found'
    if re.search(rb': connect: permission denied\b', raw):
        return 'socket_permission_denied'
    if b'rpc error: code = Unavailable desc = ' in raw:
        return 'grpc_unavailable'
    return 'unclassified'


def normalized_command_failure(value, stage=None):
    if not isinstance(value, dict):
        return None
    stage = stage if stage is not None else value.get('command_stage')
    code = value.get('exit_code')
    if (type(stage) is not str or stage not in {
            'version', 'global_help', 'content_help', 'daemon_info', 'content_get'}
            or not (code is None or type(code) is int and -127 <= code <= 255)
            or type(value.get('stderr_class')) is not str or value['stderr_class'] not in {
                'unclassified', 'grpc_permission_denied', 'grpc_not_found', 'socket_permission_denied', 'grpc_unavailable'}
            or type(value.get('failure_kind')) is not str or value['failure_kind'] not in {
                'command_exit', 'os_error', 'wait_timeout', 'deadline_exhausted', 'bounded_reader_refusal'}):
        return None
    return {'command_stage': stage, 'exit_code': code,
            'stderr_class': value['stderr_class'], 'failure_kind': value['failure_kind']}


def bounded_command(args, limit, timeout):
    """Read bounded local command streams and always reap our own child."""
    deadline = time.monotonic() + timeout
    child = None
    output = bytearray()
    stderr_size = 0
    stderr_bytes = bytearray()
    try:
        child = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 stdin=subprocess.DEVNULL)
        with selectors.DefaultSelector() as selector:
            selector.register(child.stdout, selectors.EVENT_READ, 'stdout')
            selector.register(child.stderr, selectors.EVENT_READ, 'stderr')
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ContentUnavailable('local_reader_timeout')
                for key, _ in selector.select(remaining):
                    stream_limit = limit - len(output) if key.data == 'stdout' else 4096 - stderr_size
                    chunk = os.read(key.fileobj.fileno(), min(4096, stream_limit + 1))
                    if not chunk:
                        selector.unregister(key.fileobj)
                    elif len(chunk) > stream_limit:
                        raise ContentUnavailable('local_reader_overflow')
                    elif key.data == 'stdout':
                        output.extend(chunk)
                    else:
                        stderr_size += len(chunk)
                        stderr_bytes.extend(chunk)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                error = ContentUnavailable('local_reader_failed')
                error.command_failure = {'exit_code': None, 'stderr_class': 'unclassified',
                                         'failure_kind': 'deadline_exhausted'}
                raise error
            exit_code = child.wait(timeout=remaining)
            if exit_code != 0:
                error = ContentUnavailable('local_reader_failed')
                error.command_failure = {
                    'exit_code': exit_code if type(exit_code) is int and -127 <= exit_code <= 255 else None,
                    'stderr_class': stderr_failure_class(stderr_bytes), 'failure_kind': 'command_exit'}
                error.stderr_features = stderr_output_features(stderr_bytes)
                raise error
        return bytes(output)
    except (OSError, subprocess.TimeoutExpired) as failure:
        error = ContentUnavailable('local_reader_failed')
        error.command_failure = {'exit_code': None, 'stderr_class': 'unclassified',
                                 'failure_kind': 'os_error' if isinstance(failure, OSError) else 'wait_timeout'}
        raise error from None
    finally:
        if child is not None:
            try:
                if child.poll() is None:
                    try:
                        child.kill()
                    except ProcessLookupError:
                        pass
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                raise ContentUnavailable('local_reader_cleanup_timeout') from None
            finally:
                child.stdout.close()
                child.stderr.close()


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate_key')
            result[key] = value
        return result
    def invalid_constant(value):
        raise ValueError('invalid_constant')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)


def version_output_shape(raw):
    """Classify bounded version output without retaining any output strings."""
    tokens = raw.split()
    version = tokens[2] if len(tokens) > 2 else b''
    major = re.match(rb'v?([0-9]+)\.', version)
    return {
        'output_ascii': raw.isascii(),
        'line_count': min(len(raw.splitlines()), 3),
        'token_count': min(len(tokens), 5),
        'app_is_ctr': bool(tokens) and tokens[0] == b'ctr',
        'package_is_docker': len(tokens) > 1 and tokens[1] == b'containerd.io',
        'package_is_containerd': len(tokens) > 1 and tokens[1] == b'containerd',
        'package_is_upstream': len(tokens) > 1 and tokens[1] in {
            b'github.com/containerd/containerd', b'github.com/containerd/containerd/v2'},
        'numeric_major_shape': major is not None,
        'supported_numeric_major': major is not None and major[1] in {b'1', b'2'},
        'version_grammar': bool(re.fullmatch(
            rb'v?[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z][0-9A-Za-z.+-]*)?', version)),
        'trailing_token_grammar': len(tokens) <= 3 or (len(tokens) == 4 and bool(
            re.fullmatch(rb'[0-9A-Za-z._+-]+', tokens[3]))),
        'single_space_separators': raw.removesuffix(b'\n') == b' '.join(tokens),
        'has_non_lf_control': any(b < 32 and b != 10 or b == 127 for b in raw),
        'has_tabs': b'\t' in raw,
        'has_carriage_return': b'\r' in raw,
        'has_repeated_ascii_spaces': b'  ' in raw,
    }


def normalized_version_shape(value):
    """Allow only complete fixed boolean/count fields from reader exceptions."""
    bool_fields = {'output_ascii', 'app_is_ctr', 'package_is_docker', 'package_is_upstream',
                   'package_is_containerd',
                   'numeric_major_shape', 'supported_numeric_major', 'version_grammar',
                   'trailing_token_grammar', 'single_space_separators', 'has_non_lf_control',
                   'has_tabs', 'has_carriage_return', 'has_repeated_ascii_spaces'}
    if (not isinstance(value, dict) or not all(type(value.get(k)) is bool for k in bool_fields)
            or type(value.get('line_count')) is not int or not 0 <= value['line_count'] <= 3
            or type(value.get('token_count')) is not int or not 0 <= value['token_count'] <= 5):
        return None
    return {k: value[k] for k in sorted(bool_fields | {'line_count', 'token_count'})}


class LocalContentReader:
    def __init__(self, command=bounded_command):
        self.command = command
        self.executable = None

    def _command(self, stage, args, limit, timeout):
        try:
            return self.command(args, limit, timeout)
        except ContentUnavailable as error:
            detail = normalized_command_failure(getattr(error, 'command_failure', None), stage)
            error.command_failure = detail if detail is not None else {
                'command_stage': stage, 'exit_code': None, 'stderr_class': 'unclassified',
                'failure_kind': 'bounded_reader_refusal'}
            raise

    def qualify(self):
        self.executable = shutil.which('ctr')
        if not self.executable or not os.path.isabs(self.executable):
            raise ContentUnavailable('local_reader_missing')
        version = self._command('version', [self.executable, '--version'], 4096, 5)
        # ctr is an unstable administrative CLI: require known major versions
        # plus the actual installed global flags and content-get capability.
        if not re.fullmatch(rb'ctr (?:github\.com/containerd/containerd(?:/v2)?|containerd\.io|containerd) '
                            rb'v?[12]\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z][0-9A-Za-z.+-]*)?'
                            rb'(?: [0-9A-Za-z._+-]*)?\n?', version):
            error = ContentUnavailable('local_reader_version_unsupported')
            error.version_shape = version_output_shape(version)
            raise error
        help_text = self._command('global_help', [self.executable, '--help'], 65536, 5)
        if not all(re.search(rb'(?<![\w-])' + flag + rb'(?![\w-])', help_text)
                   for flag in [b'--address', b'--namespace', b'--timeout', b'--connect-timeout']):
            raise ContentUnavailable('local_reader_flags_missing')
        get_help = self._command('content_help', [self.executable, 'content', 'get', '--help'], 16384, 5)
        if not re.search(rb'\bcontent\s+get\b', get_help):
            raise ContentUnavailable('local_reader_content_get_unsupported')

    def info(self):
        return strict_json(self._command('daemon_info', DOCKER + ['info', '--format', '{"ID":{{json .ID}},"Containerd":{{json .Containerd}}}'], 262144, 10))

    def is_socket(self, address):
        return stat.S_ISSOCK(os.stat(address).st_mode)

    def read(self, digest, binding, limit):
        if not self.executable or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise ContentUnavailable('local_reader_invalid_digest')
        _, address, namespace = binding
        return self._command('content_get', [self.executable, '--address', address, '--namespace', namespace,
                             '--timeout', '10s', '--connect-timeout', '3s',
                             'content', 'get', digest], limit, 12)


def daemon_binding(info, reader):
    daemon = info['ID']
    address = info['Containerd']['Address']
    namespaces = info['Containerd']['Namespaces']
    namespace = namespaces['Containers']
    if (not isinstance(daemon, str) or not re.fullmatch(r'[A-Za-z0-9:_.-]{1,128}', daemon)
            or not isinstance(address, str) or len(address) > 256
            or not address.startswith('/') or '\x00' in address
            or any(ord(c) < 32 or ord(c) == 127 for c in address)
            or any(c in {'.', '..'} for c in address.split('/'))
            or not isinstance(namespace, str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', namespace)
            or namespace in {'.', '..'} or namespace == namespaces.get('Plugins')
            or not reader.is_socket(address)):
        raise ContentUnavailable('local_daemon_binding_invalid')
    return daemon, address, namespace


def qualify_local_config(image, pin, reference, run, reader=None, diagnostic=None):
    """Prove the original config fingerprint from two same-daemon local blobs.

    No content fetch, cache mutation, fallback pull, or content logging is used.
    The optional reader is an internal read-only dependency for offline testing.
    """
    stage = 'descriptor'
    reason = 'validation_failed'
    qualified = False
    version_shape = None
    command_failure = None
    stderr_features = None
    try:
        descriptor = image.get('Descriptor')
        if (not isinstance(descriptor, dict) or descriptor.get('digest') != pin.manifest
                or descriptor.get('mediaType') not in MANIFEST_TYPES
                or type(descriptor.get('size')) is not int
                or not 0 < descriptor['size'] <= MANIFEST_LIMIT
                or image.get('Id') != pin.manifest or not reference or run is None):
            return False
        platform = descriptor.get('platform')
        if platform is not None and (not isinstance(platform, dict)
                or platform.get('os', 'linux') != 'linux'
                or platform.get('architecture', 'amd64') != 'amd64'):
            return False
        reader = reader if reader is not None else LocalContentReader()
        stage = 'capability'
        reader.qualify()
        stage = 'binding'
        binding = daemon_binding(reader.info(), reader)
        stage = 'manifest'
        raw_manifest = reader.read(pin.manifest, binding, MANIFEST_LIMIT)
        if (not isinstance(raw_manifest, bytes) or len(raw_manifest) != descriptor['size']
                or len(raw_manifest) > MANIFEST_LIMIT
                or 'sha256:' + hashlib.sha256(raw_manifest).hexdigest() != pin.manifest):
            return False
        manifest = strict_json(raw_manifest)
        if (not isinstance(manifest, dict) or type(manifest.get('schemaVersion')) is not int
                or manifest['schemaVersion'] != 2
                or manifest.get('mediaType') != descriptor['mediaType']):
            return False
        stage = 'config'
        config_descriptor = manifest.get('config')
        if (not isinstance(config_descriptor, dict) or config_descriptor.get('digest') != pin.config
                or config_descriptor.get('mediaType') not in CONFIG_TYPES
                or type(config_descriptor.get('size')) is not int
                or not 0 < config_descriptor['size'] <= CONFIG_LIMIT):
            return False
        raw_config = reader.read(pin.config, binding, CONFIG_LIMIT)
        if (not isinstance(raw_config, bytes) or len(raw_config) != config_descriptor['size']
                or len(raw_config) > CONFIG_LIMIT
                or 'sha256:' + hashlib.sha256(raw_config).hexdigest() != pin.config):
            return False
        config = strict_json(raw_config)
        if not isinstance(config, dict) or config.get('os') != 'linux' or config.get('architecture') != 'amd64':
            return False
        # Reinspect the exact reference, then bracket that observation with fresh
        # daemon/socket/namespace identity. Never compare or expose Config/Env.
        stage = 'reinspect'
        observed = inspect(reference, run)
        keys = ('Id', 'Os', 'Architecture', 'Variant', 'RepoDigests', 'Descriptor')
        if not isinstance(observed, dict) or any(observed.get(k) != image.get(k) for k in keys):
            return False
        stage = 'binding'
        qualified = daemon_binding(reader.info(), reader) == binding
        return qualified
    except Exception as error:
        if isinstance(error, ContentUnavailable):
            command_failure = normalized_command_failure(getattr(error, 'command_failure', None))
            stderr_features = normalized_stderr_features(getattr(error, 'stderr_features', None))
        # Normalize only fixed internal codes. Arbitrary exception messages,
        # JSON content, subprocess output and stderr never reach diagnostics.
        reason = 'local_reader_failed'
        codes = {'local_reader_timeout', 'local_reader_overflow', 'local_reader_failed',
                 'local_reader_cleanup_timeout', 'local_reader_missing',
                 'local_reader_unsupported', 'local_reader_version_unsupported',
                 'local_reader_flags_missing', 'local_reader_content_get_unsupported',
                 'local_reader_invalid_digest',
                 'local_daemon_binding_invalid'}
        if (isinstance(error, ContentUnavailable) and len(error.args) == 1
                and type(error.args[0]) is str and error.args[0] in codes):
            reason = error.args[0]
            if reason == 'local_reader_version_unsupported':
                version_shape = normalized_version_shape(getattr(error, 'version_shape', None))
        elif isinstance(error, (ValueError, TypeError, KeyError)):
            reason = 'validation_failed'
        return False
    finally:
        if diagnostic is not None and not qualified:
            diagnostic.update({'stage': stage, 'reason': reason})
            if version_shape is not None:
                diagnostic['version_shape'] = version_shape
            if command_failure is not None:
                diagnostic['command_failure'] = command_failure
            if stderr_features is not None:
                diagnostic['stderr_features'] = stderr_features


def verify(image, pin, stage="unspecified", reference=None, run=None, reader=None):
    repos = {pin.source_repo, 'docker.io/' + pin.source_repo, 'ghcr.io/supabase/' + pin.name}
    # Docker canonicalizes official library images (library/kong -> kong).
    if pin.source_repo.startswith('library/'):
        repos.add(pin.source_repo.removeprefix('library/'))
    allowed = {repo + '@' + digest for repo in repos for digest in [pin.manifest, pin.index]}
    locally_qualified = False
    proof_diagnostic = {}
    fallback_repo_matches = False
    if isinstance(image, dict) and image.get('Id') == pin.manifest:
        try:
            fallback_repo_matches = bool(set(image.get('RepoDigests') or []).intersection(allowed))
        except (TypeError, ValueError):
            pass
    if (isinstance(image, dict) and image.get('Id') == pin.manifest
            and image.get('Os') == 'linux' and image.get('Architecture') == 'amd64'
            and fallback_repo_matches):
        locally_qualified = qualify_local_config(image, pin, reference, run, reader, proof_diagnostic)
    if (not isinstance(image, dict) or (image.get('Id') != pin.config and not locally_qualified)
            or image.get('Os') != 'linux' or image.get('Architecture') != 'amd64'
            or not set(image.get('RepoDigests') or []).intersection(allowed)):
        # Diagnostic only: never serialize inspect payloads or change acceptance.
        fields = image if isinstance(image, dict) else {}
        try:
            repo_matches = bool(set(fields.get('RepoDigests') or []).intersection(allowed))
        except (TypeError, ValueError):
            repo_matches = False
        version_shape = proof_diagnostic.pop('version_shape', None)
        command_failure = proof_diagnostic.pop('command_failure', None)
        stderr_features = proof_diagnostic.pop('stderr_features', None)
        error = Refused('image_identity_mismatch')
        error.diagnostic = {
            'image': pin.name if pin in PINS else 'unknown',
            'stage': stage if stage in {'existing_target', 'immutable_source', 'post_alias'} else 'unspecified',
            'predicates': {
                'is_object': isinstance(image, dict),
                'config_matches': fields.get('Id') == pin.config,
                'id_matches_pinned_manifest': fields.get('Id') == pin.manifest,
                'id_matches_pinned_index': fields.get('Id') == pin.index,
                'os_matches': fields.get('Os') == 'linux',
                'architecture_matches': fields.get('Architecture') == 'amd64',
                'repo_digest_matches': repo_matches,
            },
        }
        if isinstance(image, dict) and image.get('Id') == pin.manifest:
            error.diagnostic['local_config_provenance'] = 'not_qualified'
            if proof_diagnostic:
                error.diagnostic['local_config_proof'] = proof_diagnostic
        if version_shape is not None:
            error.diagnostic['local_reader_version_shape'] = version_shape
        if command_failure is not None:
            error.diagnostic['local_reader_command_failure'] = command_failure
        if stderr_features is not None:
            error.diagnostic['local_reader_stderr_features'] = stderr_features
        if pin in PINS:
            error.diagnostic['expected'] = {
                'config': pin.config, 'index': pin.index, 'manifest': pin.manifest}
        raise error


def prepare_image(pin, run, pause):
    source = 'docker.io/' + pin.source_repo + '@' + pin.manifest
    target = 'ghcr.io/supabase/' + pin.name + ':' + pin.tag
    existing = inspect(target, run)
    if existing is not None:
        verify(existing, pin, 'existing_target', reference=target, run=run)
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
    verify(image, pin, 'immutable_source', reference=source, run=run)
    tagged = run(DOCKER + ['tag', source, target], capture_output=True, text=True, timeout=30)
    if tagged.returncode:
        raise Refused('cache_alias_failed')
    verify(inspect(target, run), pin, 'post_alias', reference=target, run=run)
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
                          else 'docker_command_timeout',
                          **({'diagnostic': error.diagnostic}
                             if isinstance(error, Refused) and hasattr(error, 'diagnostic') else {})}),
              file=sys.stderr)
        raise SystemExit(1)
