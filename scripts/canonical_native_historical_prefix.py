"""First native historical boundary: 43 pinned inputs, not full replay acceptance.

The official CLI owns the applied ledger. A canonical execution-unit name never
pretends to be an original, already-applied historical migration. Original files
remain untouched. Later transaction envelopes (legacy52 and onwards) are NOT
admitted by this module. No URL, linked project or source override is accepted.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import time
import sys

from canonical_native_lock_boundary import adapt as adapt_lock_boundary, qualify as qualify_lock_boundary

ROOT = Path(__file__).resolve().parents[1]
ORDER_SHA = '11af5df0de43b4e135a2c8172a1ffc937079241826a60e5fefda9cb588363595'
LIMIT = 43
MAX_SQL = 8 * 1024 * 1024
LEDGER_SQL = """SELECT coalesce(jsonb_agg(jsonb_build_object(
 'version',version,'name',name,'statements',statements) ORDER BY version),
 '[]'::jsonb) FROM supabase_migrations.schema_migrations;"""
SETTINGS = {
    'logging_collector': 'on', 'log_directory': 'gridex_native_private_logs',
    'log_file_mode': '0600', 'log_statement': 'none',
    'log_min_error_statement': 'panic', 'log_min_messages': 'panic',
    'log_error_verbosity': 'terse', 'log_parameter_max_length': '0',
    'log_parameter_max_length_on_error': '0', 'log_min_duration_statement': '-1',
    'log_min_duration_sample': '-1', 'log_transaction_sample_rate': '0',
    'log_duration': 'off', 'standard_conforming_strings': 'on',
}


class PrefixError(ValueError):
    """A closed diagnostic code; never carry SQL or process output."""


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sql_tokens(sql: str) -> tuple[tuple[str, int, int], ...]:
    """Lex SQL without changing quoted values, dollar bodies or operators.

    This is a lexical identity check, NOT a SQL parser or equivalence proof.
    Comments/spacing outside quoted tokens are the only ignored differences.
    Psql metacommands and unterminated tokens are rejected, never stripped.
    """
    if not isinstance(sql, str) or not sql or len(sql.encode()) > MAX_SQL or '\x00' in sql:
        raise PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    result = []; i = 0; size = len(sql)
    operators = '+-*/<>=~!@#%^&|`?:'
    while i < size:
        start = i
        if sql[i].isspace():
            i += 1; continue
        if sql.startswith('--', i):
            end = sql.find('\n', i + 2)
            i = size if end < 0 else end + 1; continue
        if sql.startswith('/*', i):
            depth = 1; i += 2
            while i < size and depth:
                if sql.startswith('/*', i): depth += 1; i += 2
                elif sql.startswith('*/', i): depth -= 1; i += 2
                else: i += 1
            if depth: raise PrefixError('NATIVE_UNTERMINATED_SQL_TOKEN')
            continue
        if sql[i] == '\\':
            raise PrefixError('NATIVE_PSQL_METACOMMAND_REJECTED')
        escaped = sql[i:i+2].lower() == "e'"
        if sql[i] in "'\"" or escaped:
            if escaped: i += 1
            quote = sql[i]; i += 1
            while i < size:
                if escaped and sql[i] == '\\': i += 2; continue
                if sql[i] == quote:
                    i += 1
                    if i < size and sql[i] == quote: i += 1; continue
                    break
                i += 1
            else: raise PrefixError('NATIVE_UNTERMINATED_SQL_TOKEN')
            if i > size: raise PrefixError('NATIVE_UNTERMINATED_SQL_TOKEN')
        elif sql[i] == '$' and (tag := re.match(r'\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$', sql[i:])):
            end = sql.find(tag[0], i + len(tag[0]))
            if end < 0: raise PrefixError('NATIVE_UNTERMINATED_SQL_TOKEN')
            i = end + len(tag[0])
        elif sql[i].isalnum() or sql[i] == '_':
            i += 1
            while i < size and (sql[i].isalnum() or sql[i] in '_$'): i += 1
        elif sql[i] in operators:
            i += 1
            while i < size and sql[i] in operators:
                if sql.startswith('--', i) or sql.startswith('/*', i): break
                i += 1
        else:
            i += 1
        result.append((sql[start:i], start, i))
    if not result: raise PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    return tuple(result)


def statements(sql: str) -> tuple[tuple[tuple[str, int, int], ...], ...]:
    output = []; current = []
    for token in sql_tokens(sql):
        if token[0] == ';':
            if current: output.append(tuple(current)); current = []
        else: current.append(token)
    if current: output.append(tuple(current))
    if not output: raise PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    return tuple(output)


def identity(sql: str) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(token[0] for token in statement) for statement in statements(sql))


def cli_program(raw: bytes) -> tuple[bytes, bool]:
    """Transfer only an exact outer BEGIN/COMMIT to the CLI transaction.

    Interior transaction controls are deliberately unsupported. No search/replace
    inside functions, identifiers, comments or string literals is performed.
    Four hash-pinned LOCK sources additionally receive atomic DO contexts;
    their locks remain in the CLI transaction through its ledger insertion.
    This is a derived execution program, never a rewrite of source history.
    """
    try: text = raw.decode('utf-8')
    except (AttributeError, UnicodeError): raise PrefixError('NATIVE_UTF8_SOURCE_REQUIRED') from None
    parsed = statements(text)
    words = [tuple(token[0].upper() for token in statement) for statement in parsed]
    opening = {('BEGIN',), ('BEGIN', 'TRANSACTION'), ('BEGIN', 'WORK')}
    closing = {('COMMIT',), ('COMMIT', 'TRANSACTION'), ('COMMIT', 'WORK'), ('END',)}
    wrapped = len(words) > 2 and words[0] in opening and words[-1] in closing
    body = parsed[1:-1] if wrapped else parsed
    for statement in body:
        keyword = statement[0][0].upper()
        if keyword in {'BEGIN','START','COMMIT','END','ROLLBACK','ABORT','SAVEPOINT','RELEASE'}:
            raise PrefixError('NATIVE_INTERIOR_TRANSACTION_CONTROL_REJECTED')
        if keyword == 'ALTER' and len(statement) > 1 and statement[1][0].upper() == 'SYSTEM':
            raise PrefixError('NATIVE_SERVER_MUTATION_REJECTED')
        if keyword in {'SET','RESET'} and any('log_' in t[0].lower() or t[0].lower() in {'standard_conforming_strings','all'} for t in statement):
            raise PrefixError('NATIVE_SERVER_MUTATION_REJECTED')
    if wrapped:
        # Positions come from lexer tokens, not a regex over arbitrary SQL.
        start = parsed[1][0][1]; end = parsed[-2][-1][2]
        text = text[start:end] + ';\n'
    program = text.encode()
    if not program or not body: raise PrefixError('NATIVE_SQL_INPUT_REQUIRED')
    program = adapt_lock_boundary(raw, program, statements, PrefixError)
    return program, wrapped


@dataclass(frozen=True)
class Program:
    ordinal: int
    source: str
    source_sha256: str
    sql: bytes = field(repr=False)
    outer_transaction_transferred: bool

    def __post_init__(self):
        if (type(self.ordinal) is not int or not 1 <= self.ordinal <= LIMIT
                or not isinstance(self.source, str)
                or not re.fullmatch(r'(?:migrations|bootstrap)/[A-Za-z0-9_.-]+\.sql', self.source)
                or not isinstance(self.source_sha256, str)
                or not re.fullmatch(r'[a-f0-9]{64}', self.source_sha256)
                or type(self.sql) is not bytes or not self.sql or len(self.sql) > MAX_SQL
                or type(self.outer_transaction_transferred) is not bool):
            raise PrefixError('NATIVE_BOUND_PROGRAM_REQUIRED')

    @property
    def digest(self) -> str:
        return sha(self.sql)

    @property
    def name(self) -> str:
        return f'gridex_native_f{self.ordinal:04d}_{self.digest[:12]}'

    def receipt(self) -> dict:
        return {'ordinal': self.ordinal, 'source': self.source,
                'sourceSha256': self.source_sha256, 'programSha256': self.digest,
                'outerTransactionTransferredToCli': self.outer_transaction_transferred}


def prepare() -> tuple[Program, ...]:
    """Read exactly the already-pinned first43 selection and no later envelope."""
    path = ROOT/'scripts/canonical-auth-provisioning-legacy-batch.py'
    spec = importlib.util.spec_from_file_location('native_prefix_source_authority', path)
    module = importlib.util.module_from_spec(spec)
    # This source uses dataclasses; the module must be present during execution.
    import sys
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
        verified = module.verified_prefix()
    finally:
        sys.modules.pop(spec.name, None)
    order = json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
    if (sha(json.dumps(order, separators=(',', ':')).encode()) != ORDER_SHA
            or len(verified) != LIMIT or [name for name, _ in verified] != order[:LIMIT]):
        raise PrefixError('NATIVE_PREFIX_ORDER_REQUIRED')
    programs = []
    for ordinal, (name, source) in enumerate(verified, 1):
        if not re.fullmatch(r'(?:migrations|bootstrap)/[A-Za-z0-9_.-]+\.sql', name):
            raise PrefixError('NATIVE_SOURCE_PATH_REQUIRED')
        physical = ROOT/'supabase'/name
        if physical.resolve() != physical or not physical.is_file():
            raise PrefixError('NATIVE_SOURCE_PATH_REQUIRED')
        raw = physical.read_bytes()
        if raw != source.encode():
            raise PrefixError('NATIVE_SOURCE_BYTES_REQUIRED')
        program, transferred = cli_program(raw)
        programs.append(Program(ordinal, name, sha(raw), program, transferred))
    return tuple(programs)


def verify_entry(entry: dict, filename: str, program: Program) -> None:
    if (not re.fullmatch(r'\d{14}_'+re.escape(program.name)+r'\.sql', filename)
            or type(entry) is not dict or entry.get('version') != filename[:14]
            or entry.get('name') != program.name or type(entry.get('statements')) is not list
            or not entry['statements']):
        raise PrefixError('NATIVE_EXECUTED_LEDGER_REQUIRED')
    source_text = program.sql.decode()
    tokens = sql_tokens(source_text)
    # CLI 2.101.0 SplitAndTrim retains a final comment-only EOF fragment in
    # the ledger. Admit only the EXACT suffix of these pinned source bytes,
    # at the final position; never discard arbitrary non-executable entries.
    tail = source_text[tokens[-1][2]:].strip() if tokens[-1][0] == ';' else ''
    fragments = entry['statements']
    if tail:
        if fragments[-1] != tail:
            raise PrefixError('NATIVE_EXECUTED_STATEMENTS_REQUIRED')
        fragments = fragments[:-1]
    actual = []
    for statement in fragments:
        # Every ledger item must be one full SQL statement, never a marker or
        # a concatenated fallback which could conceal missing execution units.
        if not isinstance(statement, str): raise PrefixError('NATIVE_EXECUTED_LEDGER_REQUIRED')
        parsed = identity(statement)
        if len(parsed) != 1: raise PrefixError('NATIVE_EXECUTED_LEDGER_REQUIRED')
        actual.extend(parsed)
    if tuple(actual) != identity(source_text):
        raise PrefixError('NATIVE_EXECUTED_STATEMENTS_REQUIRED')


def private_write(path: Path, raw: bytes) -> tuple[int, int]:
    if (path.is_symlink() or path.parent.resolve() != path.parent
            or path.parent.stat().st_mode & 0o077):
        raise PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    fd = os.open(path, os.O_WRONLY | os.O_NOFOLLOW)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_uid != os.getuid():
            raise PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
        os.fchmod(fd, 0o600)
        os.ftruncate(fd, 0)
        with os.fdopen(fd, 'wb', closefd=False) as stream: stream.write(raw)
        os.fsync(fd)
        return metadata.st_dev, metadata.st_ino
    finally:
        os.close(fd)


def verify_private(path: Path, raw: bytes, physical: tuple[int, int]) -> None:
    if path.is_symlink(): raise PrefixError('NATIVE_PRIVATE_SOURCE_CHANGED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        meta = os.fstat(fd)
        if (not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1
                or (meta.st_dev, meta.st_ino) != physical or stat.S_IMODE(meta.st_mode) != 0o600
                or meta.st_uid != os.getuid()):
            raise PrefixError('NATIVE_PRIVATE_SOURCE_CHANGED')
        with os.fdopen(fd, 'rb', closefd=False) as stream: actual = stream.read(MAX_SQL + 1)
        if actual != raw: raise PrefixError('NATIVE_PRIVATE_SOURCE_CHANGED')
    finally:
        os.close(fd)


def protect_logging(command, sql, project: str) -> None:
    """Protect the dedicated native server BEFORE sending any historical SQL."""
    if not re.fullmatch(r'gridex-sb-[a-f0-9]{12}-[a-f0-9]{16}', project):
        raise PrefixError('NATIVE_OWNER_REQUIRED')
    name = 'supabase_db_'+project
    before = json.loads(command(['docker', 'inspect', name]).stdout)
    network = project+'-network'
    if (len(before) != 1 or before[0].get('Name') != '/'+name
            or before[0].get('Config', {}).get('Labels', {}).get('com.supabase.cli.project') != project
            or set(before[0].get('NetworkSettings', {}).get('Networks', {})) != {network}
            or not before[0].get('Config', {}).get('Image', '').startswith('public.ecr.aws/supabase/postgres:17.')):
        raise PrefixError('NATIVE_OWNED_SERVER_REQUIRED')
    network_meta = json.loads(command(['docker', 'network', 'inspect', network]).stdout)
    if (len(network_meta) != 1 or network_meta[0].get('Internal') is not True
            or network_meta[0].get('Labels', {}).get('gridex.native.owner') != project):
        raise PrefixError('NATIVE_OWNED_SERVER_REQUIRED')
    directory = sql("SELECT to_json(current_setting('data_directory')); ")
    if directory != '/var/lib/postgresql/data':
        raise PrefixError('NATIVE_DATA_DIRECTORY_REQUIRED')
    command(['docker','exec','--user','postgres',name,'mkdir','-m','700',directory+'/gridex_native_private_logs'])
    # The provider's postgres role is deliberately not a superuser. Only
    # this already-verified, disposable server's fixed logging configuration
    # uses its local infrastructure owner; migrations retain the postgres role.
    # In image 17.6.1.106 the upstream pg_hba.conf.j2 uses SCRAM for this
    # role on Unix sockets, but an existing local-only route for 127.0.0.1.
    # Stay INSIDE this verified container; never change HBA or expose a port.
    admin = ['docker','exec','-i',name,'psql','-X','-qAt','-w',
             '-h','127.0.0.1','-p','5432','-U','supabase_admin',
             '-d','postgres','-v','ON_ERROR_STOP=1']
    check = command(admin, data=("SELECT current_user = 'supabase_admin' AND rolsuper "
                                 "AND inet_client_addr() = '127.0.0.1'::inet "
                                 "AND inet_server_addr() = '127.0.0.1'::inet "
                                 "AND inet_server_port() = 5432 "
                                 "FROM pg_roles WHERE rolname = current_user;").encode())
    if check.stdout.strip() != b't':
        raise PrefixError('NATIVE_LOGGING_ADMIN_REQUIRED')
    for key, value in SETTINGS.items():
        # ALTER SYSTEM must be a standalone command, not inside a SQL batch.
        # Never grant the migration/application roles additional privileges.
        command(admin, data=f"ALTER SYSTEM SET {key} = '{value}';".encode())
    command(['docker','restart',name], timeout=120)
    deadline = time.monotonic() + 60
    while True:
        ready = command(['docker','exec',name,'pg_isready','-U','postgres'], allow_failure=True)
        if ready.returncode == 0: break
        if time.monotonic() >= deadline: raise PrefixError('NATIVE_RESTART_NOT_READY')
        time.sleep(.25)
    after = json.loads(command(['docker', 'inspect', name]).stdout)
    if (len(after) != 1 or any(before[0].get(key) != after[0].get(key)
                              for key in ('Id','Image','Name','Config'))
            or set(after[0].get('NetworkSettings', {}).get('Networks', {})) != {network}):
        raise PrefixError('NATIVE_OWNED_SERVER_REQUIRED')
    quoted = ','.join("'"+key+"'" for key in SETTINGS)
    observed = sql('SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ('+quoted+');')
    if observed != SETTINGS: raise PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')
    mode = command(['docker','exec',name,'stat','-c','%a',directory+'/gridex_native_private_logs']).stdout.strip()
    if mode != b'700': raise PrefixError('NATIVE_PRIVATE_LOGGING_REQUIRED')


def execute(command, native, sql, work: Path, project: str,
            programs: tuple[Program, ...], progress: dict) -> dict:
    """Apply a finite prefix via actual CLI files; return only hashes/counts.

    This operation may only be called inside the qualified native lifecycle.
    Its caller owns final resource cleanup and must reject acceptance on failure.
    """
    if type(progress) is not dict or progress:
        raise PrefixError('NATIVE_FRESH_PROGRESS_REQUIRED')
    progress.update(scope='FIRST43_NATIVE_HISTORY_NOT_COMPLETE_REPLAY',
                    foundationInputsExecuted=0, foundationInputsRequired=144,
                    timestampInputsExecuted=0, timestampInputsRequired=514,
                    historicalPrefixLedgerVerified=False,
                    historicalGridexSourcesExecuted=False,
                    completeReplayVerified=False, generatedTypesVerified=False,
                    originalHistoricalVersionsMarkedApplied=False,
                    canonicalExecutionUnits=[], connectedDatabaseModified=False)
    if (type(programs) is not tuple or len(programs) != LIMIT
            or [p.ordinal for p in programs] != list(range(1, LIMIT + 1))
            or programs != prepare()):
        raise PrefixError('NATIVE_EXACT_PREFIX_REQUIRED')
    protect_logging(command, sql, project)
    migrations = work/'supabase/migrations'
    if migrations.resolve() != migrations or migrations.is_symlink():
        raise PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    migrations.chmod(0o700)
    baseline = sql(LEDGER_SQL)
    if type(baseline) is not list or len(baseline) != 1:
        raise PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
    expected = copy.deepcopy(baseline); receipts = progress['canonicalExecutionUnits']
    files = {path.name for path in migrations.iterdir()}
    if len(files) != 1 or not re.fullmatch(r'\d{14}_native_lifecycle_proof\.sql', next(iter(files))):
        raise PrefixError('NATIVE_UNEXPECTED_MIGRATION_INPUT')
    baseline_path = migrations/next(iter(files))
    first_meta = baseline_path.lstat()
    if not stat.S_ISREG(first_meta.st_mode) or first_meta.st_nlink != 1:
        raise PrefixError('NATIVE_PRIVATE_SOURCE_REQUIRED')
    first_raw = baseline_path.read_bytes()
    retained = [(baseline_path, first_raw, (first_meta.st_dev, first_meta.st_ino))]
    verify_private(*retained[0])
    if (type(baseline[0]) is not dict or baseline[0].get('version') != baseline_path.name[:14]
            or baseline[0].get('name') != 'native_lifecycle_proof'
            or type(baseline[0].get('statements')) is not list
            or not baseline[0]['statements']
            or tuple(part for text in baseline[0]['statements'] for part in identity(text)) != identity(first_raw.decode())):
        raise PrefixError('NATIVE_SYNTHETIC_PREFLIGHT_LEDGER_REQUIRED')
    for program in programs:
        progress['currentFoundationOrdinal'] = program.ordinal
        # Preserve sources even if another process edits the checkout mid-run.
        source = ROOT/'supabase'/program.source
        if source.resolve() != source or sha(source.read_bytes()) != program.source_sha256:
            raise PrefixError('NATIVE_SOURCE_BYTES_REQUIRED')
        if program.ordinal == 27:
            progress['transactionBoundary27'] = {}
            qualify_lock_boundary(sys.modules[__name__], native, sql, work, program,
                                  expected, retained, progress['transactionBoundary27'])
        # CLI timestamps have one-second precision. Do not invent or rename a
        # timestamp to hide collisions; wait once before creating the next file.
        time.sleep(1.05)
        native('migration','new',program.name)
        current = {path.name for path in migrations.iterdir()}
        added = current - files
        if len(added) != 1 or not files <= current:
            raise PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
        filename = next(iter(added)); path = migrations/filename
        if (not re.fullmatch(r'\d{14}_'+re.escape(program.name)+r'\.sql', filename)
                or filename[:14] <= expected[-1]['version']):
            raise PrefixError('NATIVE_CLI_CREATED_FILE_REQUIRED')
        physical = private_write(path, program.sql)
        verify_private(path, program.sql, physical)
        retained.append((path, program.sql, physical))
        for item in retained: verify_private(*item)
        outcome = native('migration','up','--local',allow_failure=True)
        for item in retained: verify_private(*item)
        actual = sql(LEDGER_SQL)
        if outcome.returncode:
            # A SQLSTATE is a finite diagnostic, not the raw SQL/error payload.
            state = re.search(rb'SQLSTATE[ :]+([A-Z0-9]{5})\b', outcome.stderr)
            if state: progress['failedSqlstate'] = state[1].decode()
            if actual != expected: raise PrefixError('NATIVE_FAILED_LEDGER_CHANGED')
            raise PrefixError('NATIVE_HISTORICAL_SQL_FAILED')
        if (type(actual) is not list or len(actual) != len(expected)+1
                or actual[:-1] != expected):
            raise PrefixError('NATIVE_UNEXPECTED_LEDGER_DELTA')
        verify_entry(actual[-1], filename, program)
        expected = copy.deepcopy(actual); files = current
        receipts.append({**program.receipt(), 'cliFile': filename,
                         'ledgerStatementsSha256': sha(json.dumps(actual[-1]['statements'], separators=(',',':')).encode())})
        progress['foundationInputsExecuted'] = len(receipts)
        progress['historicalGridexSourcesExecuted'] = True
    for item in retained: verify_private(*item)
    native('migration','up','--local')
    for item in retained: verify_private(*item)
    if sql(LEDGER_SQL) != expected:
        raise PrefixError('NATIVE_HISTORICAL_LEDGER_REPEAT_CHANGED')
    progress['historicalPrefixLedgerVerified'] = True
    return progress
