#!/usr/bin/env python3
"""Private accepted-input transport, extracted without whole-input exemptions."""
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import weakref

ROOT = Path(__file__).resolve().parents[1]

def _controller():
    spec = importlib.util.spec_from_file_location('private_controller_loader', ROOT/'scripts/canonical-auth-provisioning-replay.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module.controller()

replay = _controller()
legacy, repair, dedupe = replay.load_batch(), replay.load_repair(), replay.load_dedupe()
BoundaryError = legacy.BoundaryError
_ACTIVE = weakref.WeakKeyDictionary()

def reviewed_paths():
    return ()

def check(condition, label='FIXED_ASSERTION_FAILED'):
    if not condition:
        raise BoundaryError(label)

class MemoryAdmission:
    """One opaque, single-use generated control; never a physical file."""
    name = 'repair-admission.sql'

    def __init__(self, adapter, data, name='repair-admission.sql'):
        self.name = name
        self.adapter, self.data, self.valid = adapter, bytearray(data), True

    def read_text(self):
        self.adapter.owned()
        check(self.valid, 'STALE_MEMORY_ADMISSION')
        return self.data.decode()

    def __fspath__(self):
        self.read_text()
        return str(Path(self.adapter.directory)/self.name)

    def clear(self):
        self.data.clear()
        self.valid = False


class AcceptedInputs:
    """Same-handle adaptation of the exact accepted preparation handle.

    Four whole inputs retain writer/inode provenance. Only three exact generated
    reference/admission controls use stdin; all other methods/writes delegate.
    """
    ORDER = ('repair-context.sql','repair-admission.sql','repair-whole-R2.sql',
             'repair-stage-R2.sql','repair-whole-E2.sql','repair-stage-E2.sql',
             'repair-whole-S2.sql','repair-stage-S2.sql','repair-whole-W.sql',
             'repair-assertions.sql')
    LEGACY_ORDER = ('envelope-context.sql','envelope-admission.sql')+tuple(
        name for alias,*_ in legacy.SOURCE_SPECS
        for name in ('whole-'+alias+'.sql','stage-'+alias+'.sql'))+('whole-Q.sql','envelope-assertions.sql')
    GENERATED = ('envelope-context.sql','repair-context.sql','repair-admission.sql')
    PREFIX = ('01_db1_schema_repair_core_helpers_and_canonical_tables.sql',
              '85f3561be4d91cee063bbf626302de7726a09c5ce08743b250e62cee959bb5f2')

    def __init__(self, h):
        self.h, self.name = h, h.name
        self.directory = h.directory.name if h.directory else None
        self.active = self.closed = False
        self.staging = None
        self.closed_staging = None
        self.route = self.binding = self.phase = None
        self.result_call = None
        self.records, self.envelope, self.buffers = {}, [], []
        self.sources = {'prefix-1.sql':self.PREFIX,'replay-source-1.sql':self.PREFIX,
                        'repair-whole-E2.sql':repair.SPECS[1][1:3],
                        'dedupe-whole-H2.sql':(dedupe.SOURCE.name,dedupe.SHA256)}

    def owned(self):
        repair.require_owned(self.h, False)
        check(self.active and self.h.name == self.name and self.h._created_name == self.name
              and self.h.directory.name == self.directory
              and self.h.__dict__.get('private') is self.private_wrapper
              and self.h.__dict__.get('run_files') is self.run_wrapper
              and self.h.command == self.command, 'STALE_ACCEPTED_INPUT_OWNER')
        if self.binding is not None:
            current = (self.h.reference,repair.REFERENCES.get(self.h),dedupe._REFERENCES.get(self.h))
            check(all(actual is bound for actual,bound in zip(current,self.binding)),
                  'ACCEPTED_ENVELOPE_REFERENCE_CHANGED')
            check(dedupe._STATES.get(self.h) == self.phase, 'ACCEPTED_ENVELOPE_PHASE_CHANGED')

    def canonical(self, name, staging=None):
        filename, digest = self.sources[name]
        path = ROOT/'supabase/migrations'/filename
        if staging is None:
            check(path.is_file() and not path.is_symlink() and path.resolve() == path,
                  'CANONICAL_ACCEPTED_INPUT_REQUIRED')
        manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
        check(manifest.get(filename) == digest, 'ACCEPTED_INPUT_MANIFEST_MISMATCH')
        data = repair.read_source(path,staging)
        legacy.verify_bytes(data,digest)
        return data

    @staticmethod
    def physical(path):
        check(type(path) is type(ROOT) and path.is_file() and not path.is_symlink()
              and path.resolve() == path, 'PHYSICAL_ACCEPTED_INPUT_REQUIRED')
        stat = path.stat()
        return stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns

    def writer(self, frame, name):
        if name == 'prefix-1.sql':
            return (frame.f_code in legacy.OwnedPostgres.prefix.__code__.co_consts
                    and frame.f_back.f_code is legacy.OwnedPostgres.prefix.__code__
                    and frame.f_back.f_locals.get('self') is self.h
                    and dedupe._STATES.get(self.h) is None)
        if name == 'replay-source-1.sql':
            loop = frame.f_locals.get('self')
            return (frame.f_code is replay.FoundationLoop._run.__code__
                    and type(loop) is replay.FoundationLoop and loop.target is self.h
                    and dedupe._STATES.get(self.h) == 'FRESH')
        if name == 'envelope-context.sql':
            return (frame.f_code is legacy.envelope_files.__code__ and frame.f_locals.get('target') is self.h
                    and dedupe._STATES.get(self.h) in (None,'FRESH'))
        function = dedupe.execute if name == 'dedupe-whole-H2.sql' else repair.envelope_files
        return (frame.f_code is function.__code__ and frame.f_locals.get('target') is self.h
                and dedupe._STATES.get(self.h) == ('NATIVE' if name == 'dedupe-whole-H2.sql' else 'FRESH'))

    def write(self, name, data, frame):
        try:
            return self._write(name,data,frame)
        except BaseException:
            self.clear()
            raise

    def _write(self, name, data, frame):
        self.owned()
        if name == 'client-last.out':
            call = self.result_call
            check(call is not None and frame.f_code is legacy.OwnedPostgres.run_files.__code__
                  and frame.f_back is call['frame'] and frame.f_back.f_code is AcceptedInputs.run.__code__
                  and frame.f_back.f_locals.get('self') is self
                  and frame.f_back.f_locals.get('call') is call
                  and frame.f_locals.get('self') is self.h
                  and frame.f_locals.get('files') is call['files']
                  and all(frame.f_locals.get(key)==call[key] for key in
                          ('database','stage','transaction','expect','timeout')),
                  'TRUSTED_RESULT_WRITER_REQUIRED')
            self.result_owned(call)
            result = frame.f_locals.get('result')
            check(type(result) is subprocess.CompletedProcess and type(result.stdout) is bytes
                  and type(result.stderr) is bytes and type(data) is bytes
                  and data == result.stdout+result.stderr, 'EXACT_RESULT_BYTES_REQUIRED')
            path = Path(self.directory)/name
            check(not path.exists() and not path.is_symlink(), 'PHYSICAL_RESULT_FORBIDDEN')
            # This exact writer ignores private()'s return. The real run_files
            # frame retains stdout/stderr and returns its ordinary result; no sink.
            return None
        generated = name in self.GENERATED
        route = ('repair' if frame.f_code is repair.envelope_files.__code__ else
                 'legacy' if frame.f_code is legacy.envelope_files.__code__ else None)
        if generated or name in self.sources:
            check(self.writer(frame,name), 'TRUSTED_ACCEPTED_WRITER_REQUIRED')
        if route is not None:
            order = self.ORDER if route == 'repair' else self.LEGACY_ORDER
            check(frame.f_locals.get('target') is self.h and len(self.envelope) < len(order)
                  and name == order[len(self.envelope)], 'CLOSED_CONTROL_WRITES_REQUIRED')
            if not self.envelope:
                check(self.route is None and not self.buffers, 'FRESH_CONTROL_ENVELOPE_REQUIRED')
                state = dedupe._STATES.get(self.h)
                staging = frame.f_locals.get('staging')
                check(staging is self.staging and (state == 'FRESH' or
                      (route == 'legacy' and state is None and staging is None)),
                      'EXACT_CONTROL_PHASE_REQUIRED')
                self.route = route
                self.phase = state
                self.binding = (self.h.reference,repair.REFERENCES.get(self.h),dedupe._REFERENCES.get(self.h))
            check(self.route == route, 'EXACT_CONTROL_ROUTE_REQUIRED')
        if generated:
            check(not (Path(self.directory)/name).exists() and not (Path(self.directory)/name).is_symlink(),
                  'PHYSICAL_ADMISSION_FORBIDDEN')
            path = MemoryAdmission(self,data.encode() if isinstance(data,str) else data,name)
            self.buffers.append(path)
        else:
            if name in self.sources:
                staging = frame.f_locals.get('stage' if name == 'replay-source-1.sql' else 'staging')
                if name == 'replay-source-1.sql':
                    check(type(staging) is legacy.StagedSources and self.staging is None,
                          'ACCEPTED_REPLAY_STAGE_REQUIRED')
                    self.staging = staging
                elif name != 'prefix-1.sql':
                    check(staging is self.staging, 'ACCEPTED_REPLAY_STAGE_REQUIRED')
                check((data.encode() if isinstance(data,str) else data) == self.canonical(name,staging),
                      'COMPLETE_ACCEPTED_INPUT_REQUIRED')
            path = self.private(name,data)
            if name in self.sources:
                check(path == Path(self.directory)/name, 'ACCEPTED_WRITER_PATH_MISMATCH')
                self.records[name] = (path,self.physical(path))
        if route is not None:
            self.envelope.append(path)
        return path

    def result_owned(self, call):
        self.owned()
        current = (self.h.reference,repair.REFERENCES.get(self.h),dedupe._REFERENCES.get(self.h))
        check(self.result_call is call and all(a is b for a,b in zip(current,call['references']))
              and dedupe._STATES.get(self.h) == call['phase'] and self.staging is call['staging'],
              'STALE_RESULT_INVOCATION')

    def run(self, database, files, stage, transaction=True, expect='00000', timeout=120):
        files = tuple(files)
        virtual = [path for path in files if isinstance(path,MemoryAdmission)]
        generated = any(getattr(path,'name',None) in self.GENERATED for path in files)
        if not virtual and not generated and not self.envelope:
            self.owned()
            check(self.result_call is None, 'FRESH_RESULT_INVOCATION_REQUIRED')
            call = dict(frame=sys._getframe(),database=database,files=files,stage=stage,
                        transaction=transaction,expect=expect,timeout=timeout,
                        references=(self.h.reference,repair.REFERENCES.get(self.h),dedupe._REFERENCES.get(self.h)),
                        phase=dedupe._STATES.get(self.h),staging=self.staging)
            self.result_call = call
            try:
                output = self.run_files(database,files,stage,transaction,expect,timeout)
                self.result_owned(call)
                return output
            finally:
                self.result_call = None
                call.clear()
        try:
            self.owned()
            state = dedupe._STATES.get(self.h)
            check(self.route in ('legacy','repair'), 'EXACT_CONTROL_ROUTE_REQUIRED')
            preparation = self.route == 'legacy' and state is None
            if preparation:
                check(database == 'gridex_auth_legacy_reference' and self.staging is None,
                      'EXACT_CONTROL_PHASE_REQUIRED')
            else:
                repair.require_owned(self.h)
                dedupe.require_live(self.h)
                check(database == replay.DATABASE and state == 'FRESH', 'EXACT_CONTROL_PHASE_REQUIRED')
            check(stage == 'whole_batch' and transaction is True and expect == '00000'
                  and timeout == 120, 'EXACT_CONTROL_RESULT_REQUIRED')
            order = self.LEGACY_ORDER if self.route == 'legacy' else self.ORDER
            count = 1 if self.route == 'legacy' else 2
            check(len(files) == len(order) and tuple(path.name for path in files) == order
                  and len(self.envelope) == len(files)
                  and all(a is b for a,b in zip(files,self.envelope))
                  and len(virtual) == count and virtual == self.buffers
                  and all(virtual[i] is files[i] and virtual[i].adapter is self and virtual[i].valid
                          for i in range(count)), 'EXACT_CONTROL_INPUTS_REQUIRED')
            argv = self.h.command(database,files,transaction)
            positions = []
            for control in virtual:
                found = [i for i,value in enumerate(argv) if value == '/legacy-private/'+control.name]
                check(len(found) == 1 and argv[found[0]-1] == '-f', 'EXACT_CONTROL_ARGUMENT_REQUIRED')
                positions.extend(found)
            argv[positions[0]] = '-'
            if count == 2:
                check(positions[1] == positions[0]+2, 'ADJACENT_GENERATED_CONTROLS_REQUIRED')
                del argv[positions[1]-1:positions[1]+1]
            started = time.monotonic()
            try:
                result = subprocess.run(argv,input=b'\n'.join(bytes(control.data) for control in virtual),capture_output=True,
                                        timeout=timeout,env=legacy.clean_environment())
            except (OSError,subprocess.TimeoutExpired):
                raise BoundaryError('PRIVATE_SQL_PROCESS_FAILED') from None
            self.owned()
            receipt = legacy.safe_receipt(result.stderr.decode(errors='replace'),result.returncode,stage)
            receipt['milliseconds'] = round((time.monotonic()-started)*1000)
            print(json.dumps(receipt,sort_keys=True),flush=True)
            check(receipt['sqlstate'] == expect and (expect == '00000') == (result.returncode == 0),
                  'UNEXPECTED_SQL_RESULT')
            return result.stdout.decode()
        finally:
            self.clear()

    def clear(self):
        self.result_call = None
        for buffer in self.buffers:
            buffer.clear()
        self.buffers.clear()
        self.envelope.clear()
        self.route = self.binding = self.phase = None

    def __enter__(self):
        repair.require_owned(self.h,False)
        check(not self.active and not self.closed and self.h not in dedupe._STATES
              and re.fullmatch(r'gridex-auth-legacy-(?:fixed|continuation)-[0-9]+-[0-9]+',self.name) is not None,
              'FRESH_FIXED_PREPARATION_REQUIRED')
        check(getattr(self.h.private,'__func__',None) is legacy.OwnedPostgres.private
              and getattr(self.h.run_files,'__func__',None) is legacy.OwnedPostgres.run_files,
              'TRUSTED_ACCEPTED_METHODS_REQUIRED')
        for name in self.sources:
            self.canonical(name)
        self.originals = {name:(name in self.h.__dict__,self.h.__dict__.get(name))
                          for name in ('private','run_files')}
        self.private,self.run_files,self.command = self.h.private,self.h.run_files,self.h.command
        self.private_wrapper = lambda name,data:self.write(name,data,sys._getframe(1))
        self.run_wrapper = lambda *args,**kwargs:self.run(*args,**kwargs)
        self.h.private,self.h.run_files = self.private_wrapper,self.run_wrapper
        self.active = True
        _ACTIVE[self.h] = self
        return self

    def __exit__(self, kind, error, traceback):
        if self.closed:
            return
        intact = (self.h.__dict__.get('private') is self.private_wrapper
                  and self.h.__dict__.get('run_files') is self.run_wrapper)
        try:
            for name,(present,value) in self.originals.items():
                if present:
                    self.h.__dict__[name] = value
                else:
                    self.h.__dict__.pop(name,None)
        finally:
            self.clear()
            self.closed_staging = self.staging
            self.staging = None
            self.active,self.closed = False,True
            _ACTIVE.pop(self.h,None)
        check(intact,'ACCEPTED_METHODS_CHANGED')

    def whole_input(self, proof, path):
        check(self.closed and not self.active and proof.h is self.h and proof.name == self.name
              and proof.directory == self.directory, 'ACCEPTED_INPUT_PROVENANCE_REQUIRED')
        record = self.records.get(path.name)
        if record is None or path != record[0]:
            return False
        logical = ROOT/'supabase/migrations'/self.sources[path.name][0]
        staging = self.closed_staging if not logical.is_file() else None
        check(self.physical(path) == record[1] and path.read_bytes() == self.canonical(path.name,staging),
              'RETAINED_ACCEPTED_INPUT_CHANGED')
        return True



def privacy(c,proof):
    """Inspect server collector/client files privately; never publish contents."""
    sources = [c.Source(key) for key in c.SPECS]
    values = {value.encode() for source in sources for value in source.slots.values()}
    for source in sources:
        for line in {'B0':(226,227,228,231),'C2':(33,),'D2':(33,66),'F2':(40,)}[source.key]:
            values.add(source.literal(line).encode())
    # The closed owner command reads only its collector directory, into memory.
    command = ['docker','exec',proof.name,'sh','-c','cat /var/lib/postgresql/data/pg_log_private/*.log']
    result = subprocess.run(command,capture_output=True,timeout=30,env=c.legacy.clean_environment())
    c.check(result.returncode==0,'PRIVATE_COLLECTOR_INSPECTION_REQUIRED')
    c.check(not any(value in result.stdout+result.stderr for value in values),'SOURCE_LITERAL_IN_COLLECTOR')
    for path in Path(proof.directory).rglob('*'):
        c.check(path.name not in c.AcceptedInputs.GENERATED, 'PHYSICAL_ADMISSION_FORBIDDEN')
        if path.is_file():
            inputs = getattr(proof,'accepted_inputs',None)
            if inputs is not None and inputs.whole_input(proof,path):
                continue
            contents = path.read_bytes()
            c.check(not any(value in contents for value in values),'SOURCE_LITERAL_IN_PRIVATE_ARTIFACT')
