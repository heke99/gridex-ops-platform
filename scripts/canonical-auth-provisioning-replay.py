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
import importlib.util
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


def load_batch():
    name='canonical_owned_replay_batch'
    if name in sys.modules: return sys.modules[name]
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts/canonical-auth-provisioning-legacy-batch.py')
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
    return module


def selected_group(b):
    return ['migrations/'+p.name for p in b.reviewed_paths()]


class FoundationLoop:
    def __init__(self,b,target,prefix_only=False):
        if type(target) is not b.OwnedPostgres or not target.active or target.reference is None:
            raise b.BoundaryError('OWNED_REFERENCE_REQUIRED')
        self.b=b;self.target=target;self.prefix_only=prefix_only;self.applied=False
        self.order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        self.prefix=b.verified_prefix()
        if len(self.order)!=93 or self.order[43:52]!=selected_group(b):
            raise b.BoundaryError('FOUNDATION_GROUP_MISMATCH')
        if [p for p,_ in self.prefix]!=self.order[:43]:
            raise b.BoundaryError('PREFIX_MISMATCH')

    def validate(self,hold,paths):
        b=self.b;stage=b.StagedSources(hold)
        expected=[str(stage.hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in self.order]
        if paths!=expected: raise b.BoundaryError('STAGED_ORDER_MISMATCH')
        data=[]
        derived={}
        for name in ('gridex-aud-003-legacy-foundation.json','gridex-aud-003-legacy-foundation.additions.json'):
            derived.update(json.loads((ROOT/'scripts'/name).read_text()).get('derivedBootstrap',{}))
        for rel,physical in zip(self.order,paths):
            if rel.startswith('migrations/'):
                raw=stage.read(ROOT/'supabase'/rel)
            else:
                path=Path(physical)
                if path.is_symlink(): raise b.BoundaryError('STAGED_SOURCE_REQUIRED')
                raw=path.read_bytes();b.verify_bytes(raw,derived[rel]['artifactSha256'])
            data.append(raw)
        if data[:43]!=[sql.encode() for _,sql in self.prefix]:
            raise b.BoundaryError('PREFIX_MISMATCH')
        b.validate_sources(b.reviewed_paths(),stage)
        # Includes the later final-CHECK authority: validate before first SQL.
        b.ddl_oracles(b.validate_sources(b.reviewed_paths(),stage),stage)
        return stage,data

    def run(self,hold,paths):
        if self.applied: raise self.b.BoundaryError('FOUNDATION_ALREADY_EXECUTED')
        stage,data=self.validate(hold,paths)
        self.applied=True
        h=self.target;b=self.b
        for ordinal,raw in enumerate(data[:43],1):
            h.run_files(DATABASE,[h.private('replay-source-'+str(ordinal)+'.sql',raw)],'replay_foundation_'+str(ordinal),transaction=False)
        receipt=b.execute(h,DATABASE,b.reviewed_paths(),stage)
        if receipt['sources']!=9: raise b.BoundaryError('SOURCE_COMPLETION_MISMATCH')
        if not self.prefix_only:
            for ordinal,raw in enumerate(data[52:],53):
                h.run_files(DATABASE,[h.private('replay-source-'+str(ordinal)+'.sql',raw)],'replay_foundation_'+str(ordinal),transaction=False)
        print(json.dumps({'stage':'actual_replay_foundation','first43':43,'batch_sources':9,
                          'executions_each':1,'foundation_sources':52 if self.prefix_only else 93,
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


def serve_child(b,h,command,prefix_only=False):
    loop=FoundationLoop(b,h,prefix_only)
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
        child=subprocess.Popen(command,cwd=ROOT,env=environment)
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
                        operation=payload.get('operation')
                        if operation=='context':
                            if payload.get('prefix_only')!=prefix_only: raise b.BoundaryError('REPLAY_SCOPE_MISMATCH')
                            h.verify_logging();output=''
                        elif operation=='foundation':
                            output=loop.run(payload['hold'],payload['paths'])
                        elif operation=='sql':
                            # Keep all client/server raw streams private. Only
                            # SQL stdout needed by fingerprint/shape checks is
                            # returned to the child; stderr is always sanitized.
                            output=h.sql(DATABASE,payload['sql'],'replay_sql',transaction=False)
                        else: raise b.BoundaryError('REPLAY_OPERATION_REJECTED')
                        response={'ok':True,'output':output}
                    except Exception as error:
                        if isinstance(error,b.BoundaryError) and str(error)=='INTERRUPTED': raise
                        print(json.dumps({'stage':'replay_transport','category':'REQUEST_REJECTED','type':type(error).__name__}),flush=True)
                        response={'ok':False}
                    connection.sendall(json.dumps(response).encode())
            return child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
                try: child.wait(timeout=5)
                except subprocess.TimeoutExpired: child.kill();child.wait()
            endpoint.unlink(missing_ok=True)


def main():
    if '--psql' in sys.argv:
        sys.stdout.write(request(psql_payload(sys.argv[2:])));return
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owned-compatible',action='store_true')
    parser.add_argument('--foundation-prefix-proof',action='store_true')
    parser.add_argument('--context',action='store_true')
    parser.add_argument('--foundation')
    parser.add_argument('--hold')
    args=parser.parse_args()
    if args.context:
        request({'operation':'context','prefix_only':args.foundation_prefix_proof});return
    if args.foundation:
        request({'operation':'foundation','hold':args.hold,'paths':Path(args.foundation).read_text().splitlines()});return
    if not args.owned_compatible: raise RuntimeError('OWNED_TARGET_REQUIRED')
    b=load_batch()
    def interrupted(signum,frame): raise b.BoundaryError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    # Full completeness admission precedes creation of the owned container.
    if not args.foundation_prefix_proof:
        result=subprocess.run([sys.executable,str(ROOT/'scripts/gridex-replay-input-accounting.py'),'--root',str(ROOT),'--require-full-effects'],capture_output=True)
        if result.returncode: raise b.BoundaryError('FULL_EFFECTS_INCOMPLETE')
    with b.OwnedPostgres() as h:
        b.prepare_reference(h)
        h.reset(DATABASE)
        command=['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh')]
        if args.foundation_prefix_proof: command.append('--foundation-prefix-proof')
        result=serve_child(b,h,command,args.foundation_prefix_proof)
        if result: raise b.BoundaryError('ACTUAL_REPLAY_FAILED')
        if args.foundation_prefix_proof:
            if h.catalog(DATABASE)!=h.reference[1]: raise b.BoundaryError('ACTUAL_REPLAY_CATALOG_MISMATCH')
            print('PASS actual clean-shell staging first43 -> whole batch -> Q; owned compatible diagnostic; NOT full replay')


if __name__=='__main__':
    try: main()
    except BaseException as error:
        if isinstance(error,(KeyboardInterrupt,SystemExit)): raise
        print('FAIL owned replay category=REJECTED type='+type(error).__name__,file=sys.stderr)
        sys.exit(1)
