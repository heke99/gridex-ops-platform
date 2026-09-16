"""Compile the fixed timestamp tail; never execute SQL or certify source effects.

Historical SQL, prerequisite ordering, and reconstruction authorities remain
owned by the existing selector. Programs have new execution-unit identities;
this module never manufactures historical migration ledger entries. Native
transaction, lock, reconstruction, and source-effect proofs remain mandatory.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import importlib.util
import json
from pathlib import Path
import re
from types import MappingProxyType

import canonical_native_historical_prefix as prefix

ROOT = Path(__file__).resolve().parents[1]
# Exact output of the existing pinned selector: ordered path/hash pairs, not
# freshly accepted caller-provided hashes. Prerequisites include their hashes.
SELECTION_SHA = '076408eb112ebd8b153a18d4774ffd7122d92ad3c0a8a9aaf8b58faacfe71fbe'
PREREQUISITES_SHA = '6249f47b0918c630834735b0f7e98e6c73a89cc177a042b507b010f9cb915237'
SPLIT_PINS = {
    201: 'e47363628cfc41ccb0fd2223abbe25e27576fdbcea426052d14db7629f6690fc',
    202: '038b5a0d096044ddfd8438723aff5f77d6339ee2b4ca5b3a6b6a44d81133f598',
}
LOCK_PINS = {
    221: ('674184b2e0f3a96b8abd0bc1cd2f3434bf4e921b8d31d55fa51452ab07b68447',
          'lock table public.contract_offers in share row exclusive mode;'),
    222: ('b0558538499350b4d91f0bcef1afcf2daa39d2835bfdbcba4c6acd7ad8d19fb1',
          'lock table public.contract_offers in share row exclusive mode;'),
    224: ('4a13d84602f56b88e5307ab1eac486e2c8a209ff9772c6bd597a318e54cb5815',
          'lock table public.contract_product_versions in access exclusive mode;'),
    225: ('6618f9f279fdb6daf03e6f01863b99e79bb257b99811a629dbfec5c481bf9e39',
          'lock table public.contract_offers in share row exclusive mode;'),
}
LOCK_OPEN = b'DO $gridex_native_timestamp_lock$\nBEGIN\n'
LOCK_CLOSE = b'\nEND\n$gridex_native_timestamp_lock$;'
WHITE_LABEL_DROP = 'drop function if exists public.gridex_user_has_white_label_admin_membership(uuid);'
OPENING = {('BEGIN',), ('BEGIN', 'TRANSACTION'), ('BEGIN', 'WORK')}
CLOSING = {('COMMIT',), ('COMMIT', 'TRANSACTION'), ('COMMIT', 'WORK'), ('END',)}
CONTROLS = {'BEGIN', 'START', 'COMMIT', 'END', 'ROLLBACK', 'ABORT', 'SAVEPOINT', 'RELEASE'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def json_sha(value, *, sort=False):
    return sha(json.dumps(value, sort_keys=sort, separators=(',', ':')).encode())


def load_tail():
    path = ROOT / 'scripts/canonical-timestamp-frontier.py'
    spec = importlib.util.spec_from_file_location('native_timestamp_authority', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def transfer_outer(raw: bytes) -> tuple[bytes, bool]:
    """Remove only lexical outer transaction statements, preserving other bytes.

    Interior controls are never stripped. LOCK is handled separately against its
    full original-source hash. Quoted bodies and comments are lexically opaque.
    """
    if type(raw) is not bytes:
        raise ValueError('NATIVE_TIMESTAMP_BYTES_REQUIRED')
    try:
        text = raw.decode('utf-8')
    except UnicodeError:
        raise ValueError('NATIVE_TIMESTAMP_UTF8_REQUIRED') from None
    parsed = prefix.statements(text)
    words = [tuple(t[0].upper() for t in statement) for statement in parsed]
    wrapped = len(words) > 2 and words[0] in OPENING and words[-1] in CLOSING
    body = parsed[1:-1] if wrapped else parsed
    for statement in body:
        words = tuple(t[0].upper() for t in statement)
        if words[0] in CONTROLS or words[:2] == ('PREPARE', 'TRANSACTION'):
            raise ValueError('NATIVE_TIMESTAMP_INTERIOR_TRANSACTION_REQUIRED')
        if words[:2] == ('ALTER', 'SYSTEM'):
            raise ValueError('NATIVE_TIMESTAMP_SERVER_MUTATION_REJECTED')
        if words[0] in ('SET', 'RESET') and any(
                'log_' in t[0].lower() or t[0].lower() in ('standard_conforming_strings', 'all')
                for t in statement):
            raise ValueError('NATIVE_TIMESTAMP_SERVER_MUTATION_REJECTED')
    if wrapped:
        # Reverse-position edits retain all comments and all non-boundary SQL.
        for statement in (parsed[-1], parsed[0]):
            start, end = statement[0][1], statement[-1][2]
            if text[end:end+1] != ';':
                raise ValueError('NATIVE_TIMESTAMP_TRANSACTION_TERMINATOR_REQUIRED')
            text = text[:start] + text[end+1:]
    return text.encode(), wrapped


def split_phases(raw: bytes, ordinal: int) -> tuple[bytes, ...]:
    if ordinal not in SPLIT_PINS:
        return (raw,)
    if sha(raw) != SPLIT_PINS[ordinal]:
        raise ValueError('NATIVE_TIMESTAMP_SPLIT_SOURCE_REQUIRED')
    text = raw.decode()
    parsed = prefix.statements(text)
    controls = [(i, tuple(t[0].upper() for t in statement))
                for i, statement in enumerate(parsed) if statement[0][0].upper() in CONTROLS]
    if (controls != [(0, ('BEGIN',)), (len(parsed)-2, ('COMMIT',))]
            or parsed[-1][0][0].upper() != 'DO'):
        raise ValueError('NATIVE_TIMESTAMP_SPLIT_BOUNDARY_REQUIRED')
    end = parsed[-2][-1][2]
    if text[end:end+1] != ';':
        raise ValueError('NATIVE_TIMESTAMP_SPLIT_BOUNDARY_REQUIRED')
    # Text offsets become byte offsets only by encoding the exact slice.
    first, second = text[:end+1].encode(), text[end+1:].encode()
    if first + second != raw:
        raise ValueError('NATIVE_TIMESTAMP_SPLIT_BYTES_REQUIRED')
    return first, second


def adapt_locks(original: bytes, program: bytes, ordinal: int) -> bytes:
    text = program.decode()
    locks = [s for s in prefix.statements(text) if s[0][0].upper() == 'LOCK']
    if not locks:
        if ordinal in LOCK_PINS:
            raise ValueError('NATIVE_TIMESTAMP_LOCK_REQUIRED')
        return program
    pin = LOCK_PINS.get(ordinal)
    if (pin is None or sha(original) != pin[0] or len(locks) != 1
            or b'$gridex_native_timestamp_lock$' in program
            or program != transfer_outer(original)[0]):
        raise ValueError('NATIVE_TIMESTAMP_LOCK_SOURCE_REQUIRED')
    statement = locks[0]
    start, end = statement[0][1], statement[-1][2]
    if text[start:end+1] != pin[1]:
        raise ValueError('NATIVE_TIMESTAMP_LOCK_SHAPE_REQUIRED')
    result = (text[:start].encode() + LOCK_OPEN + text[start:end+1].encode()
              + LOCK_CLOSE + text[end+1:].encode())
    if result.replace(LOCK_OPEN, b'').replace(LOCK_CLOSE, b'') != program:
        raise ValueError('NATIVE_TIMESTAMP_LOCK_BYTES_REQUIRED')
    return result


@dataclass(frozen=True)
class Unit:
    kind: str
    ordinal: int
    phase: int
    phase_count: int
    source: str
    source_sha256: str
    source_sql: bytes = field(repr=False)
    sql: bytes = field(repr=False)
    outer_transaction_transferred: bool
    qualifications: tuple[str, ...]
    condition: str = 'always'

    def __post_init__(self):
        split = self.kind == 'timestamp' and self.ordinal in SPLIT_PINS
        if (self.kind not in ('timestamp', 'prerequisite', 'cleanup')
                or type(self.ordinal) is not int or not 1 <= self.ordinal <= 514
                or type(self.phase) is not int or type(self.phase_count) is not int
                or self.phase_count != (2 if split else 1) or not 1 <= self.phase <= self.phase_count
                or (self.kind == 'prerequisite' and self.ordinal not in (430, 482, 487, 488, 490))
                or (self.kind == 'cleanup' and self.ordinal != 490)
                or not isinstance(self.source, str)
                or not isinstance(self.source_sha256, str)
                or re.fullmatch(r'[a-f0-9]{64}', self.source_sha256) is None
                or type(self.source_sql) is not bytes or not self.source_sql
                or type(self.sql) is not bytes or not 0 < len(self.sql) <= prefix.MAX_SQL
                or type(self.outer_transaction_transferred) is not bool
                or type(self.qualifications) is not tuple
                or self.condition != ('white_label_shim_created' if self.ordinal == 490
                                      and self.kind in ('prerequisite', 'cleanup') else 'always')):
            raise ValueError('NATIVE_TIMESTAMP_BOUND_UNIT_REQUIRED')

    @property
    def digest(self):
        return sha(self.sql)

    @property
    def name(self):
        phase = f'p{self.phase:02d}' if self.kind == 'timestamp' else self.kind
        return f'gridex_native_t{self.ordinal:04d}_{phase}_{self.digest[:12]}'

    def receipt(self):
        return dict(kind=self.kind, ordinal=self.ordinal, phase=self.phase,
                    phaseCount=self.phase_count, source=self.source,
                    sourceSha256=self.source_sha256, phaseSha256=sha(self.source_sql),
                    programSha256=self.digest, name=self.name, condition=self.condition,
                    outerTransactionTransferredToCli=self.outer_transaction_transferred,
                    qualificationsRequired=list(self.qualifications), nativeVerified=False)


@dataclass(frozen=True)
class Plan:
    selected: tuple[tuple[str, str], ...]
    prerequisites: MappingProxyType
    retained: MappingProxyType = field(repr=False)
    units: tuple[Unit, ...]
    white_label_probe: str


def compile_retained(selected, prerequisites, retained) -> Plan:
    """Precompile the complete admitted bundle before any runtime staging.

    No database or source-file reads. Missing/mutated authority has no fallback.
    The driver module supplies existing source validation and reconstruction.
    """
    selected = tuple(tuple(row) for row in selected)
    prerequisites = dict(prerequisites)
    if (len(selected) != 514 or json_sha(selected) != SELECTION_SHA
            or json_sha(prerequisites, sort=True) != PREREQUISITES_SHA
            or not isinstance(retained, MappingProxyType)):
        raise ValueError('NATIVE_TIMESTAMP_SELECTION_REQUIRED')
    tail = load_tail()
    tail.validate_boundaries(selected, prerequisites)
    if tail.WHITE_LABEL_DROP != WHITE_LABEL_DROP:
        raise ValueError('NATIVE_TIMESTAMP_SHIM_AUTHORITY_REQUIRED')
    fix = tail.load_live_sync_proof().fix
    required = dict(selected)
    required.update(prerequisites.values())
    required.update(((fix.ORIGINAL, fix.ORIGINAL_SHA256),
                     (fix.FORWARD, fix.FORWARD_SHA256), (fix.HARDENING, fix.HARDENING_SHA256)))
    if set(retained) != set(required):
        raise ValueError('NATIVE_TIMESTAMP_RETAINED_BUNDLE_REQUIRED')
    for source in required.items():
        tail.read_source(ROOT, source, retained=retained)
    # Copy into private immutable containers so the caller cannot later mutate
    # an underlying dictionary exposed by its MappingProxyType.
    retained = MappingProxyType(dict(retained))
    prerequisites = MappingProxyType({k: tuple(v) for k, v in prerequisites.items()})
    units = []

    def append(kind, ordinal, source, raw, *, condition='always'):
        qualification = ['CLI_TRANSACTION']
        candidate = raw
        if kind == 'timestamp' and source[0] == fix.SOURCE:
            candidate = fix.reconstruct(ROOT, raw.decode(), retained=retained)[0].encode()
            qualification.append('LIVE_SYNC')
        phases = split_phases(candidate, ordinal) if kind == 'timestamp' else (candidate,)
        if len(phases) == 2:
            qualification.append('COMMITTED_PHASES')
        if kind == 'timestamp' and ordinal in LOCK_PINS:
            qualification.append('LOCK_LIFETIME')
        if kind == 'timestamp' and ordinal in (257, 262, 275, 351):
            qualification.append('LEDGER_DEPENDENT_READINESS')
        if kind == 'prerequisite':
            qualification.append('PREREQUISITE_ORDER')
        if condition != 'always':
            qualification.append('WHITE_LABEL_CONDITIONAL')
        for phase, body in enumerate(phases, 1):
            program, transferred = transfer_outer(body)
            program = adapt_locks(raw, program, ordinal if kind == 'timestamp' else 0)
            phase_source = raw if source[0] == fix.SOURCE else body
            units.append(Unit(kind, ordinal, phase, len(phases), source[0], source[1],
                              phase_source, program, transferred, tuple(qualification), condition))

    for ordinal, source in enumerate(selected, 1):
        stamp = Path(source[0]).name.split('_', 1)[0]
        shim = stamp == tail.WHITE_LABEL_PREFIX
        if stamp in prerequisites:
            prerequisite = prerequisites[stamp]
            append('prerequisite', ordinal, prerequisite, retained[prerequisite[0]],
                   condition='white_label_shim_created' if shim else 'always')
        append('timestamp', ordinal, source, retained[source[0]])
        if shim:
            # This is a driver-authored cleanup statement, explicitly identified
            # as such, not a historical source or an extra selected migration.
            cleanup_source = ('scripts/canonical-timestamp-frontier.py#WHITE_LABEL_DROP', sha(WHITE_LABEL_DROP.encode()))
            append('cleanup', ordinal, cleanup_source, WHITE_LABEL_DROP.encode(),
                   condition='white_label_shim_created')
    if len(units) != 522 or len({u.name for u in units}) != len(units):
        raise ValueError('NATIVE_TIMESTAMP_UNIT_ACCOUNTING_REQUIRED')
    return Plan(selected, prerequisites, retained, tuple(units), tail.WHITE_LABEL_PROBE)


def prepare() -> Plan:
    """Use the existing selector and retain all authority bytes before compiling."""
    path = ROOT / 'scripts/canonical-foundation-frontier-diagnostic.py'
    spec = importlib.util.spec_from_file_location('native_timestamp_selection', path)
    frontier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(frontier)
    foundation, report = frontier.verify_selection(frontier.load_controller())
    tail = load_tail()
    selected, prerequisites = tail.load_inputs(ROOT, report, foundation)
    retained = tail.retain_sources(ROOT, selected, prerequisites)
    return compile_retained(selected, prerequisites, retained)
