"""Durable auth-fixture receipts; never a substitute for SQL/release verification.

Only fixed command identities, hashes, sizes, exit statuses and recognized
SQLSTATE tokens leave the private output files. SQL text, exception messages,
rows, connection strings and environment values are not serialized. Observed
SQLSTATEs can come from expected negative controls; they are NOT a root-cause
claim. The original runner continues to own command selection and fail-fast.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

KNOWN_SQLSTATES = frozenset({
    '08001', '08006', '0A000', '22001', '22003', '22007', '22023', '22P02',
    '23502', '23503', '23505', '23514', '25001', '25P01', '25P02', '2BP01',
    '40001', '40P01', '42501', '42601', '42703', '42704', '42710', '42804',
    '42883', '42P01', '42P07', '42P13', '53300', '55000', '55P03', '57014',
    '57P01', 'P0001', 'P0004', 'XX000',
})
STATE = re.compile(rb'(?:SQLSTATE[ :]+|(?:ERROR|FATAL|PANIC):\s+)([A-Z0-9]{5})\b')
PARTITIONS = frozenset({'all19', 'all18', 'all17', 'original16', 'legacy17', 'repair18', 'dedupe19'})


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def stream_receipt(stream, root):
    stream.seek(0)
    digest = hashlib.sha256()
    size = 0
    states = set()
    overlap = b''
    frames = []
    while chunk := stream.read(65536):
        digest.update(chunk)
        size += len(chunk)
        scanned = overlap + chunk
        for token in STATE.findall(scanned):
            value = token.decode('ascii')
            if value in KNOWN_SQLSTATES:
                states.add(value)
        # Keep only source files actually present in this checkout. Discard
        # absolute runner paths, exception text, library frames and SQL text.
        for filename, line in re.findall(rb'File "([^"\r\n]{1,2048})", line ([0-9]{1,7}),', scanned):
            candidate = Path(filename.decode('utf-8', errors='replace'))
            if not candidate.is_absolute():
                candidate = root / candidate
            if (candidate.parent == root / 'scripts' and candidate.suffix == '.py'
                    and candidate.resolve() == candidate and candidate.is_file()):
                source = candidate.read_bytes()
                number = int(line)
                if 1 <= number <= len(source.splitlines()):
                    frame = {'script': candidate.relative_to(root).as_posix(), 'line': number,
                             'scriptSha256': sha(source)}
                    if frame not in frames and len(frames) < 32:
                        frames.append(frame)
        overlap = chunk[-4096:]
    return size, digest.hexdigest(), states, frames


def checkout(root):
    result = subprocess.run(['git', 'rev-parse', '--verify', 'HEAD'], cwd=root,
                            capture_output=True, check=False)
    value = result.stdout.decode('ascii', errors='replace').strip()
    return value if result.returncode == 0 and re.fullmatch('[a-f0-9]{40}', value) else None


class Evidence:
    def __init__(self, root, partition, commands):
        self.root = Path(root)
        if (not self.root.is_absolute() or self.root.resolve() != self.root
                or not self.root.is_dir() or partition not in PARTITIONS or not commands):
            raise ValueError('AUTH_EVIDENCE_INPUT_REQUIRED')
        self.selected = tuple(tuple(command) for command in commands)
        self.next = 0
        records = []
        for command in self.selected:
            if (len(command) not in (2, 3) or command[0] != 'python3'
                    or not isinstance(command[1], str)
                    or re.fullmatch(r'scripts/[a-z0-9_-]+\.py', command[1]) is None
                    or (len(command) == 3 and command[2] != '--selection-only')):
                raise ValueError('AUTH_EVIDENCE_COMMAND_REQUIRED')
            self.read_source(command[1])
            records.append({'command': list(command), 'status': 'PENDING'})
        self.document = {
            'schemaVersion': 1, 'scope': 'AUTH_GROUP_COMMAND_EVIDENCE_NOT_RELEASE_ACCEPTANCE',
            'checkoutRevision': checkout(self.root), 'partition': partition,
            'runnerSha256': sha(self.read_source('scripts/canonical-auth-membership-group.py')),
            'status': 'PENDING', 'commandCount': len(records), 'commands': records,
            'firstFailedCommand': None, 'completeReplayVerified': False,
            'generatedTypesVerified': False, 'sqlRuntimeCertified': False,
            'sqlstatesAreObservedTokensNotRootCause': True,
        }

    def read_source(self, relative):
        path = self.root / relative
        if path.resolve() != path or not path.is_file():
            raise ValueError('AUTH_EVIDENCE_SOURCE_REQUIRED')
        return path.read_bytes()

    def save(self):
        directory = self.root / 'artifacts'
        if directory.is_symlink():
            raise ValueError('AUTH_EVIDENCE_OUTPUT_REQUIRED')
        directory.mkdir(exist_ok=True)
        if directory.resolve() != directory or not directory.is_dir():
            raise ValueError('AUTH_EVIDENCE_OUTPUT_REQUIRED')
        target = directory / 'auth-membership-group.json'
        if target.is_symlink():
            raise ValueError('AUTH_EVIDENCE_OUTPUT_REQUIRED')
        if target.exists():
            metadata = target.lstat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
                raise ValueError('AUTH_EVIDENCE_OUTPUT_REQUIRED')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory,
                                             prefix='.auth-evidence-', delete=False) as stream:
                temporary = Path(stream.name)
                json.dump(self.document, stream, sort_keys=True, indent=2)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def run(self, command, environment):
        if (self.document['status'] not in ('PENDING', 'RUNNING')
                or self.next >= len(self.selected) or tuple(command) != self.selected[self.next]):
            raise ValueError('AUTH_EVIDENCE_ORDER_REQUIRED')
        row = self.document['commands'][self.next]
        row.update(status='RUNNING', scriptSha256=sha(self.read_source(command[1])))
        self.document['status'] = 'RUNNING'
        self.save()  # Retain the exact active fixture even if CI terminates here.
        started = time.monotonic()
        with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
            try:
                result = subprocess.run(command, cwd=self.root, env=environment,
                                        stdout=stdout, stderr=stderr, check=False)
                row.update(returncode=result.returncode,
                           status='PASSED' if result.returncode == 0 else 'FAILED')
                if result.returncode != 0:
                    self.document.update(status='FAILED', firstFailedCommand=self.next + 1)
                elif self.next + 1 == len(self.selected):
                    self.document['status'] = 'COMMANDS_PASSED'
            except BaseException as error:
                status = 'INTERRUPTED' if isinstance(error, (KeyboardInterrupt, SystemExit)) else 'ERROR'
                row['status'] = status
                self.document.update(status=status, firstFailedCommand=self.next + 1)
                raise
            finally:
                out_size, out_sha, out_states, out_frames = stream_receipt(stdout, self.root)
                err_size, err_sha, err_states, err_frames = stream_receipt(stderr, self.root)
                row.update(stdoutBytes=out_size, stdoutSha256=out_sha,
                           stderrBytes=err_size, stderrSha256=err_sha,
                           observedSqlstates=sorted(out_states | err_states),
                           checkoutTracebackFrames=(out_frames + err_frames)[:32],
                           elapsedMilliseconds=max(0, round((time.monotonic() - started) * 1000)))
                self.save()
        self.next += 1
        return result
