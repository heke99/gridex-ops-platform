#!/usr/bin/env python3
"""Owned compatible diagnostic replay; native CLI and generic URLs are unsupported.

The parent retains the live OwnedPostgres handle. Its child shell uses a private
Unix socket, never a URL-as-ownership assertion. The real replay database owns
bootstrap, first43, batch and all subsequent SQL. Reference DBs are independent
expected catalogs, never substituted execution targets. No official ledger is
invented; a prefix proof exits before the remaining foundation/history.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import importlib.util
import importlib.machinery
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
DATABASE='gridex_auth_legacy_replay'
ENDPOINT='GRIDEX_REPLAY_OWNED_SOCKET'


def trusted_module(name,filename):
    """Reuse only the exact module loaded from this fixed repository source."""
    path=ROOT/'scripts'/filename
    if name in sys.modules:
        module=sys.modules[name]
        spec=getattr(module,'__spec__',None)
        anchor=getattr(module,'reviewed_paths',None)
        if (getattr(module,'__file__',None)!=str(path) or spec is None or
            spec.origin!=str(path) or not isinstance(spec.loader,importlib.machinery.SourceFileLoader) or
            spec.loader.get_filename(name)!=str(path) or
            getattr(anchor,'__module__',None)!=name or
            getattr(anchor,'__globals__',None) is not module.__dict__ or
            getattr(getattr(anchor,'__code__',None),'co_filename',None)!=str(path)):
            raise RuntimeError('TRUSTED_MODULE_ORIGIN_REQUIRED')
        return module
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module
    try:spec.loader.exec_module(module)
    except BaseException:
        sys.modules.pop(name,None)
        raise
    return module


def reviewed_paths():
    return ()


def controller():
    return trusted_module('canonical_owned_replay_controller','canonical-auth-provisioning-replay.py')


def load_private():
    return trusted_module('canonical_user_rbac_private_inputs','canonical-user-rbac-private-inputs.py')


def load_fixed():
    return trusted_module('canonical_user_rbac_fixed_batch','canonical-user-rbac-fixed-target-batch.py')


def load_alignment():
    return trusted_module('canonical_user_rbac_alignment_batch','canonical-user-rbac-customer-alignment-batch.py')


def load_alignment_runtime():
    return trusted_module('canonical_user_rbac_alignment_runtime','canonical-user-rbac-alignment-runtime.py')


def load_operations():
    return trusted_module('canonical_customer_operations_batch','canonical-customer-operations-batch.py')


def load_operations_runtime():
    return trusted_module('canonical_customer_operations_runtime','canonical-customer-operations-runtime.py')


def load_batch():
    return trusted_module('canonical_owned_replay_batch','canonical-auth-provisioning-legacy-batch.py')


def load_repair():
    return trusted_module('user_rbac_repair_batch','canonical-user-rbac-repair-batch.py')


def load_dedupe():
    return trusted_module('user_rbac_dedupe_batch','canonical-user-rbac-dedupe-batch.py')


SCOPES={'legacy52':52,'repair56':56,'dedupe57':57,'fixed-target':63,'alignment68':68,'operations71':71,'full':112}
FOUNDATION_SHA256='c708b2e402347f50256dd18ae702b32214ea9174952b9d3d9d7f739a2b56987a'


def require_scope(scope):
    if type(scope) is not str or scope not in SCOPES:
        raise load_batch().BoundaryError('REPLAY_SCOPE_MISMATCH')
    return scope


def scope_flags(scope):
    require_scope(scope)
    return {'legacy52':['--foundation-prefix-proof'],'repair56':['--repair-prefix-proof'],'dedupe57':['--dedupe-prefix-proof'],'fixed-target':['--fixed-target-prefix-proof'],'alignment68':['--alignment-prefix-proof'],'operations71':['--operations-prefix-proof'],'full':[]}[scope]


def require_context(payload,scope):
    if payload.get('scope')!=require_scope(scope):
        raise load_batch().BoundaryError('REPLAY_SCOPE_MISMATCH')


def selected_group(b):
    return ['migrations/'+p.name for p in b.reviewed_paths()]


class FoundationLoop:
    def __init__(self,b,target,scope='full'):
        self.scope=require_scope(scope)
        self.repair=load_repair()
        self.dedupe=load_dedupe()
        self.terminal=scope in ('dedupe57','fixed-target','alignment68','operations71','full')
        if self.terminal:
            self.dedupe.require_live(target)
            if self.dedupe._REFERENCES[target].scope != scope:
                self.dedupe.fail(target)
                raise b.BoundaryError('FROZEN_REPLAY_SCOPE_REQUIRED')
        if b is not load_batch() or self.repair.legacy is not b:
            raise RuntimeError('TRUSTED_MODULE_ORIGIN_REQUIRED')
        self.repair.require_owned(target,reference=scope!='legacy52')
        if (type(target.reference) is not tuple or len(target.reference)!=2 or
            any(type(catalog) is not dict for catalog in target.reference)):
            raise b.BoundaryError('OWNED_REFERENCE_REQUIRED')
        self.b=b;self.target=target;self.applied=False;self.validated=False
        self.legacy_reference=target.reference
        self.repair_reference=self.repair.REFERENCES.get(target) if scope!='legacy52' else None
        self.order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        self.prefix=b.verified_prefix()
        if (len(self.order)!=112 or self.order[43:52]!=selected_group(b) or
            self.order[52:56]!=selected_group(self.repair) or
            self.order[56:57]!=selected_group(self.dedupe) or
            self.order[57:63]!=selected_group(load_fixed()) or
            self.order[63:68]!=selected_group(load_alignment()) or
            self.order[68:71]!=selected_group(load_operations()) or
            hashlib.sha256(json.dumps(self.order,separators=(',',':')).encode()).hexdigest()!=FOUNDATION_SHA256):
            raise b.BoundaryError('FOUNDATION_GROUP_MISMATCH')
        if [p for p,_ in self.prefix]!=self.order[:43]:
            raise b.BoundaryError('PREFIX_MISMATCH')

    def validate(self,hold,paths):
        if self.terminal: self.dedupe.require_live(self.target)
        try:
            return self._validate(hold,paths)
        except BaseException:
            if self.terminal: self.dedupe.fail(self.target)
            raise

    def _validate(self,hold,paths):
        b=self.b
        self.repair.require_owned(self.target,reference=self.scope!='legacy52')
        if (self.target.reference is not self.legacy_reference or
            (self.scope!='legacy52' and self.repair.REFERENCES[self.target] is not self.repair_reference)):
            raise b.BoundaryError('OWNED_REFERENCE_REQUIRED')
        stage=b.StagedSources(hold)
        expected=[str(stage.hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in self.order]
        if paths!=expected: raise b.BoundaryError('STAGED_ORDER_MISMATCH')
        data=[]
        derived={}
        for name in ('gridex-aud-003-legacy-foundation.json','gridex-aud-003-legacy-foundation.additions.json'):
            derived.update(json.loads((ROOT/'scripts'/name).read_text()).get('derivedBootstrap',{}))
        for rel,physical in zip(self.order,paths):
            if rel.startswith('migrations/'):
                raw=self.repair.read_source(ROOT/'supabase'/rel,stage)
            else:
                path=Path(physical)
                if path.is_symlink() or path.resolve()!=path: raise b.BoundaryError('STAGED_SOURCE_REQUIRED')
                raw=path.read_bytes();b.verify_bytes(raw,derived[rel]['artifactSha256'])
            data.append(raw)
        if data[:43]!=[sql.encode() for _,sql in self.prefix]:
            raise b.BoundaryError('PREFIX_MISMATCH')
        # Both complete groups and their oracles are admitted even for legacy52.
        b.ddl_oracles(b.validate_sources(b.reviewed_paths(),stage),stage)
        repair_sources=self.repair.validate_sources(self.repair.reviewed_paths(),stage)
        self.repair.source_oracle(repair_sources)
        self.repair.diagnostic_guard(repair_sources)
        self.dedupe.index_declarations(stage)
        load_fixed().validate_sources(load_fixed().reviewed_paths(),stage)
        load_alignment().validate_sources(load_alignment().reviewed_paths(),stage)
        load_operations().validate_sources(load_operations().reviewed_paths(),stage)
        self.validated=True
        return stage,data

    def run(self,hold,paths):
        if self.terminal: self.dedupe.require_live(self.target)
        try:
            return self._run(hold,paths)
        except BaseException:
            if self.terminal: self.dedupe.fail(self.target)
            raise

    def _run(self,hold,paths):
        if self.applied: raise self.b.BoundaryError('FOUNDATION_ALREADY_EXECUTED')
        stage,data=self.validate(hold,paths)
        self.applied=True
        h=self.target;b=self.b
        actual_lower=datetime.now(timezone.utc)
        for ordinal,raw in enumerate(data[:43],1):
            h.run_files(DATABASE,[h.private('replay-source-'+str(ordinal)+'.sql',raw)],'replay_foundation_'+str(ordinal),transaction=False)
        receipt=b.execute(h,DATABASE,b.reviewed_paths(),stage)
        if receipt['sources']!=9: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if self.scope!='legacy52':
            receipt=self.repair.execute(h,DATABASE,self.repair.reviewed_paths(),stage)
            if receipt['sources']!=4: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if self.terminal:
            self.dedupe.accepted56(h)
            receipt=self.dedupe.execute(h,DATABASE,self.dedupe.reviewed_paths(),stage)
            if receipt['sources']!=1: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if self.scope in ('fixed-target','alignment68','operations71','full'):
            receipt=self.dedupe.continue_fixed(h,DATABASE,load_fixed().reviewed_paths(),stage)
            if receipt['sources']!=6: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if self.scope in ('alignment68','operations71','full'):
            receipt=self.dedupe.continue_alignment(h,DATABASE,load_alignment().reviewed_paths(),stage,
                (actual_lower,datetime.now(timezone.utc)))
            if receipt!={'sources':5}: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if self.scope in ('operations71','full'):
            receipt=self.dedupe.continue_operations(h,DATABASE,load_operations().reviewed_paths(),stage)
            if receipt!={'sources':3}: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if self.scope=='full':
            for ordinal,raw in enumerate(data[71:],72):
                h.run_files(DATABASE,[h.private('replay-source-'+str(ordinal)+'.sql',raw)],'replay_foundation_'+str(ordinal),transaction=False)
        print(json.dumps({'stage':'actual_replay_foundation','first43':43,'legacy_sources':9,
                          'repair_sources':0 if self.scope=='legacy52' else 4,'dedupe_sources':int(self.terminal),'scope':self.scope,
                          'fixed_sources':6 if self.scope in ('fixed-target','alignment68','operations71','full') else 0,
                          'alignment_sources':5 if self.scope in ('alignment68','operations71','full') else 0,
                          'operations_sources':3 if self.scope in ('operations71','full') else 0,
                          'executions_each':1,'foundation_sources':SCOPES[self.scope],
                          'ledger_provenance':'NO','complete_replay':False},sort_keys=True),flush=True)
        return ''


def request(payload):
    endpoint=os.environ.get(ENDPOINT,'')
    if not endpoint: raise RuntimeError('OWNED_CONTEXT_REQUIRED')
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
        connection.connect(endpoint)
        connection.sendall(json.dumps(payload).encode()+b'\n')
        connection.shutdown(socket.SHUT_WR)
        chunks=[]
        while chunk:=connection.recv(65536): chunks.append(chunk)
    response=json.loads(b''.join(chunks))
    if not response['ok']: raise RuntimeError('OWNED_REPLAY_REQUEST_FAILED')
    return response.get('output','')


def psql_payload(arguments):
    if not arguments or arguments[0]!='owned-compatible': raise RuntimeError('OWNED_TARGET_REQUIRED')
    # The shim is deliberately a narrow transport for the existing shell's
    # fixed psql forms. No connection, role, transaction or psql meta options.
    statements=[];args=iter(arguments[1:])
    for arg in args:
        if arg in ('-X','-q','-At'): continue
        if arg=='-v':
            if next(args)!='ON_ERROR_STOP=1': raise RuntimeError('PSQL_OPTION_REJECTED')
        elif arg=='-f': statements.append(Path(next(args)).read_text())
        elif arg=='-c': statements.append(next(args))
        else: raise RuntimeError('PSQL_OPTION_REJECTED')
    if not statements: statements.append(sys.stdin.read())
    return {'operation':'sql','sql':'\n'.join(statements)}


def originals_snapshot():
    migrations=ROOT/'supabase/migrations'
    entries=[]
    for path in sorted(migrations.rglob('*')):
        stat=path.lstat()
        value=os.readlink(path) if path.is_symlink() else (path.read_bytes() if path.is_file() else None)
        entries.append((str(path.relative_to(migrations)),stat.st_mode,stat.st_mtime_ns,value))
    seed=ROOT/'supabase/seed.sql'
    return (migrations.stat().st_mode,migrations.stat().st_mtime_ns,entries,
            seed.read_bytes(),seed.stat().st_mode,seed.stat().st_mtime_ns)


def serve_child(b,h,command,scope='full'):
    terminal=require_scope(scope) in ('dedupe57','fixed-target','alignment68','operations71','full')
    dedupe=load_dedupe()
    if terminal: dedupe.fresh_target(h)
    try:
        return _serve_child(b,h,command,scope)
    except BaseException:
        if terminal: dedupe.fail(h)
        raise


def _serve_child(b,h,command,scope):
    loop=FoundationLoop(b,h,scope)
    originals=originals_snapshot() if loop.terminal else None
    bootstrap=(ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text()
    bootstrap_done=False
    endpoint=Path(h.directory.name)/'replay.sock'
    shim_dir=Path(h.directory.name)/'transport';shim_dir.mkdir(mode=0o700,exist_ok=True)
    shim=shim_dir/'psql'
    shim.write_text('#!'+sys.executable+'\nimport runpy,sys\nsys.argv=['+repr(str(Path(__file__).resolve()))+',"--psql",*sys.argv[1:]]\nrunpy.run_path(sys.argv[0],run_name="__main__")\n')
    shim.chmod(0o700)
    environment=b.clean_environment()
    environment.update({ENDPOINT:str(endpoint),'GRIDEX_REPLAY_DB_URL':'owned-compatible',
                        'PATH':str(shim_dir)+os.pathsep+environment.get('PATH','')})
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
        server.bind(str(endpoint));os.chmod(endpoint,0o600);server.listen(1);server.settimeout(.2)
        child=subprocess.Popen(command,cwd=ROOT,env=environment,start_new_session=True)
        h.processes.append(child)
        try:
            while child.poll() is None:
                try: connection,_=server.accept()
                except socket.timeout: continue
                with connection:
                    connection.settimeout(10)
                    try:
                        chunks=[]
                        while chunk:=connection.recv(65536):
                            chunks.append(chunk)
                            if sum(map(len,chunks))>16*1024*1024: raise b.BoundaryError('REQUEST_TOO_LARGE')
                        payload=json.loads(b''.join(chunks))
                        if loop.terminal: loop.dedupe.require_live(h)
                        operation=payload.get('operation')
                        if operation=='context':
                            require_context(payload,scope)
                            h.verify_logging();output=''
                        elif operation in ('validate_foundation','foundation'):
                            require_context(payload,scope)
                            if operation=='validate_foundation':
                                loop.validate(payload['hold'],payload['paths']);output=''
                            else:output=loop.run(payload['hold'],payload['paths'])
                        elif operation=='sql':
                            if not loop.validated: raise b.BoundaryError('STAGED_VALIDATION_REQUIRED')
                            if loop.terminal and not loop.applied:
                                if bootstrap_done or payload['sql']!=bootstrap:
                                    raise b.BoundaryError('BOOTSTRAP_ONLY_REQUIRED')
                                bootstrap_done=True
                            elif scope in ('dedupe57','fixed-target','alignment68','operations71'):
                                raise b.BoundaryError('BOUNDED_SQL_REJECTED')
                            # Keep all client/server raw streams private. Only
                            # SQL stdout needed by fingerprint/shape checks is
                            # returned to the child; stderr is always sanitized.
                            output=h.sql(DATABASE,payload['sql'],'replay_sql',transaction=False)
                        else: raise b.BoundaryError('REPLAY_OPERATION_REJECTED')
                        response={'ok':True,'output':output}
                    except Exception as error:
                        if loop.terminal: loop.dedupe.fail(h)
                        if isinstance(error,b.BoundaryError) and str(error)=='INTERRUPTED': raise
                        print(json.dumps({'stage':'replay_transport','category':'REQUEST_REJECTED','type':type(error).__name__}),flush=True)
                        response={'ok':False}
                    connection.sendall(json.dumps(response).encode())
            status=child.wait()
            if loop.terminal:
                if status or not loop.applied or originals_snapshot()!=originals:
                    loop.dedupe.fail(h)
                    raise b.BoundaryError('ACTUAL_REPLAY_OR_RESTORATION_FAILED')
                server.close()
                endpoint.unlink(missing_ok=True)
                loop.dedupe.finish(h,scope=='full')
            return status
        finally:
            if child.poll() is None:
                # Give a disconnected shim time to fail and the real shell to
                # restore HOLD before terminating a wedged child process group.
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid,signal.SIGTERM)
                    try: child.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid,signal.SIGKILL);child.wait()
            endpoint.unlink(missing_ok=True)


def main():
    if sys.argv[1:2]==['--psql']:
        sys.stdout.write(request(psql_payload(sys.argv[2:])));return
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    parser.add_argument('--owned-compatible',action='store_true')
    scopes=parser.add_mutually_exclusive_group()
    scopes.add_argument('--foundation-prefix-proof',action='store_true')
    scopes.add_argument('--repair-prefix-proof',action='store_true')
    scopes.add_argument('--dedupe-prefix-proof',action='store_true')
    scopes.add_argument('--fixed-target-prefix-proof',action='store_true')
    scopes.add_argument('--alignment-prefix-proof',action='store_true')
    scopes.add_argument('--operations-prefix-proof',action='store_true')
    parser.add_argument('--context',action='store_true')
    parser.add_argument('--foundation')
    parser.add_argument('--validate-foundation',action='store_true')
    parser.add_argument('--hold')
    args=parser.parse_args()
    scope='legacy52' if args.foundation_prefix_proof else ('repair56' if args.repair_prefix_proof else ('dedupe57' if args.dedupe_prefix_proof else ('fixed-target' if args.fixed_target_prefix_proof else ('alignment68' if args.alignment_prefix_proof else ('operations71' if args.operations_prefix_proof else 'full')))))
    if args.context:
        request({'operation':'context','scope':scope});return
    if args.foundation:
        request({'operation':'validate_foundation' if args.validate_foundation else 'foundation','scope':scope,'hold':args.hold,'paths':Path(args.foundation).read_text().splitlines()});return
    if not args.owned_compatible: raise RuntimeError('OWNED_TARGET_REQUIRED')
    b=load_batch()
    def interrupted(signum,frame): raise b.BoundaryError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    # Full completeness admission precedes creation of the owned container.
    if scope=='full':
        result=subprocess.run([sys.executable,str(ROOT/'scripts/gridex-replay-input-accounting.py'),'--root',str(ROOT),'--require-full-effects'],capture_output=True)
        if result.returncode: raise b.BoundaryError('FULL_EFFECTS_INCOMPLETE')
        result_accounting=result.stdout
    import contextlib
    with b.OwnedPostgres() as h, contextlib.ExitStack() as private_stack:
        if scope in ('fixed-target','alignment68','operations71','full'):
            private_stack.enter_context(load_private().AcceptedInputs(h))
        if scope=='legacy52':b.prepare_reference(h)
        elif scope=='repair56':load_repair().prepare_reference(h)
        else:load_dedupe().prepare_reference(h,scope)
        if scope in ('legacy52','repair56'):h.reset(DATABASE)
        command=['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh')]
        command+=scope_flags(scope)
        result=serve_child(b,h,command,scope)
        if result: raise b.BoundaryError('ACTUAL_REPLAY_FAILED')
        if scope in ('dedupe57','fixed-target','alignment68','operations71'):
            print('PASS actual clean-shell scope='+scope+'; owned compatible diagnostic; NOT full replay')
        elif scope in ('legacy52','repair56'):
            actual=h.catalog(DATABASE) if scope=='legacy52' else load_repair().catalog(h,DATABASE)
            expected=h.reference[1] if scope=='legacy52' else load_repair().REFERENCES[h].final
            if actual!=expected: raise b.BoundaryError('ACTUAL_REPLAY_CATALOG_MISMATCH')
            print('PASS actual clean-shell scope='+scope+'; owned compatible diagnostic; NOT full replay')

    if scope=='full':
        artifacts=ROOT/'artifacts';artifacts.mkdir(exist_ok=True)
        (artifacts/'replay-input-accounting.json').write_bytes(result_accounting)


if __name__=='__main__':
    try: controller().main()
    except BaseException as error:
        if isinstance(error,(KeyboardInterrupt,SystemExit)): raise
        print('FAIL owned replay category=REJECTED type='+type(error).__name__,file=sys.stderr)
        sys.exit(1)
