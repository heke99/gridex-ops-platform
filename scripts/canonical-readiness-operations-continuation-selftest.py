#!/usr/bin/env python3
"""Owned actual74 integration and publication boundary tests."""
import argparse
import importlib.util
import os
import re
import shutil
import signal
import subprocess
import time
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('readiness_continuation_loader',ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)

def runtime():
    return loader.controller().load_readiness_runtime()

class Handle:pass

class Constructors(unittest.TestCase):
    def test_no_direct_execution_or_release(self):
        r=runtime();h=Handle()
        with patch.object(r,'owned',return_value=SimpleNamespace()),patch.object(r.alignment,'run_private') as query:
            for action in (lambda:r.execute(h,r.DATABASE,r.reviewed_paths(),object()),lambda:r.release_checks(h)):
                with self.assertRaises(r.batch.BoundaryError):action()
            query.assert_not_called()

    def test_program_and_completion_bind_owner_stage_sources_and_predecessor(self):
        r=runtime();h=Handle();stage=object();predecessor=object()
        ref=SimpleNamespace(inputs=SimpleNamespace(staging=stage),sources=())
        run=r.Release(ref,predecessor,stage,b'before',b'','token',b'program')
        release=replace(run,after=b'after')
        with patch.object(r,'owned',return_value=ref),patch.object(r.prior,'completion',return_value=predecessor),patch.object(r.batch,'validate_sources',return_value=()):
            try:
                r._RUNS[h]=run
                r.check_program(h,'program')
                with self.assertRaises(r.batch.BoundaryError):r.check_program(h,'other')
                for invalid in (None,replace(release,reference=object()),replace(release,prior_completion=object()),replace(release,staging=object()),replace(release,before=b'changed'),replace(release,token='other'),replace(release,program=b'other'),replace(release,after=b'')):
                    r._RELEASES[h]=invalid
                    with self.assertRaises(r.batch.BoundaryError):r.completion(h)
                r._RELEASES[h]=release
                self.assertIs(r.completion(h),release)
                with self.assertRaises(r.batch.BoundaryError):r.check_program(h,'program')
            finally:
                r._RUNS.pop(h,None);r._RELEASES.pop(h,None)

    def test_stale_reference_owner_and_inputs_rejected(self):
        r=runtime();h=Handle();h.name='owned';h.directory=SimpleNamespace(name='/private/owned')
        prior=SimpleNamespace(inputs=object())
        ref=r.Reference(h.name,h.directory.name,prior,prior.inputs,())
        with patch.object(r,'base_owned',return_value=prior):
            try:
                for invalid in (None,replace(ref,name='foreign'),replace(ref,directory='/foreign'),replace(ref,prior=object()),replace(ref,inputs=object())):
                    r._REFERENCES[h]=invalid
                    with self.assertRaises(r.batch.BoundaryError):r.owned(h)
                r._REFERENCES[h]=ref;self.assertIs(r.owned(h),ref)
                with self.assertRaises(r.batch.BoundaryError):r.owned(h,'READINESS_NATIVE')
            finally:r._REFERENCES.pop(h,None)

    def test_expected_receipt_requires_all_whole_source_markers_once(self):
        r=runtime();correct='READINESS_SOURCE_M\nREADINESS_SOURCE_E\nREADINESS_SOURCE_Z\nREADINESS_COMPLETE\n'
        r.check_receipt(correct)
        for invalid in ('',correct+correct,correct.replace('READINESS_SOURCE_E\n',''),correct.replace('SOURCE_E','SOURCE_Z'),correct.replace('SOURCE_M','SOURCE_X')):
            with self.assertRaises(r.batch.BoundaryError):r.check_receipt(invalid)

    def test_death_observer_uses_both_whole_source_views(self):
        r=runtime();sources=r.batch.validate_sources(r.reviewed_paths())
        sql=death_observation_sql()
        for source,name in ((sources[0],'billing_readiness_flags'),(sources[1],'gridex_tenant_runtime_readiness')):
            self.assertIn("'public."+name+"'",sql)
            self.assertIn('create or replace view public.'+name,source.data.decode())

    def test_failure_receipts_are_closed_finite_labels(self):
        r=runtime()
        for label in r.dedupe._READINESS_FAILURE_CATEGORIES:
            self.assertEqual(r.dedupe._failure_category(r.batch.BoundaryError(label)),label)
        for label in ('READINESS_PRIVATE_CUSTOMER','READINESS_BASE_CHANGED detail=private', 'private'):
            self.assertEqual(r.dedupe._failure_category(r.batch.BoundaryError(label)),'UNCLASSIFIED')

    def test_scope_registration_and_original_tail(self):
        r=runtime();order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        self.assertEqual(r.replay.SCOPES['readiness74'],74)
        self.assertEqual(r.replay.SCOPES['full'],118)
        self.assertEqual(r.replay.scope_flags('readiness74'),['--readiness-prefix-proof'])
        self.assertEqual(order[71:74],['migrations/'+p.name for p in r.reviewed_paths()])
        self.assertEqual(len(order[77:]),41)

def support():
    spec=importlib.util.spec_from_file_location('readiness_continuation_support',ROOT/'scripts/canonical-user-rbac-fixed-target-continuation-selftest.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


def rejected(r,operation):
    try:operation()
    except r.batch.BoundaryError:return
    raise AssertionError('READINESS_UNSAFE_CONTINUATION_ACCEPTED')


def native_case(mode,prior=None):
    r=runtime();test=support();test.require_owner()
    originals=r.replay.originals_snapshot();sources=r.batch.validate_sources(r.reviewed_paths())
    submitted=[];rolled_back=[];disposed=[];injected=[]
    with r.legacy.OwnedPostgres() as h:
        with r.fixed.AcceptedInputs(h) as inputs:
            r.dedupe.prepare_reference(h,'readiness74')
            core=test.characterization();reader=test.private_reader(core,h)
            h.reset(core.CANARY)
            reader.query(core.CANARY,"CREATE TABLE public.continuation_canary(id integer PRIMARY KEY,value text); INSERT INTO public.continuation_canary VALUES(1,'preserved');")
            canary=reader.snapshot(core.CANARY)
            original_query=r.alignment.run_private;original_owned=r.owned
            original_continue=r.dedupe.continue_readiness;original_validate=r.batch.validate_sources
            original_dispose=r.dedupe._dispose;original_program=r.whole_program;original_run=r.run_program
            def program(sources,before,expected,expected_rows,token):
                sql=original_program(sources,before,expected,expected_rows,token)
                for source in sources:
                    marker="SELECT 'READINESS_SOURCE_"+source.key+"';"
                    if mode==source.key+'_error':sql=sql.replace(marker,marker+'\nSELECT 1/0;')
                    if mode==source.key+'_backend':sql=sql.replace(marker,marker+'\nSELECT pg_terminate_backend(pg_backend_pid());')
                return sql
            def run_program(target,sql):
                return original_run(target,sql+'\nSELECT 1;' if mode=='program' else sql)
            def query(target,database,sql,files=()):
                if "SELECT 'READINESS_SOURCE_M';" not in sql:return original_query(target,database,sql,files)
                assert target is h and database==r.DATABASE and not files and not submitted
                positions=[sql.index(source.data.decode()) for source in sources]
                assert positions==sorted(positions) and all(sql.count(source.data.decode())==1 for source in sources)
                assert sql.index('LOCK TABLE')<sql.index('CREATE TEMP TABLE operations_admitted')<positions[0]
                submitted.extend(source.key for source in sources)
                before=r.snapshot(h)
                try:output=original_query(target,database,sql,files)
                except r.batch.BoundaryError as error:
                    if mode.endswith(('_error','_backend')):
                        expected='ALIGNMENT_QUERY_22012' if mode.endswith('_error') else 'ALIGNMENT_QUERY_57P01'
                        assert str(error)==expected,'READINESS_EXACT_INJECTED_FAILURE_REQUIRED'
                        assert r.encoded(r.snapshot(h))==r.encoded(before),'READINESS_ATOMIC_ROLLBACK_REQUIRED'
                        rolled_back.append(mode)
                    raise
                r.check_receipt(output)
                if mode=='post_comment':reader.query(database,"COMMENT ON VIEW public.billing_readiness_flags IS 'synthetic changed';")
                if mode=='post_rows':reader.query(database,"UPDATE public.roles SET description='synthetic changed';")
                if mode=='death':
                    r.fixed.privacy(h)
                    print(json.dumps({'death_ready':'readiness','directory':h.directory.name,'privacy':True}),flush=True)
                    os.kill(os.getpid(),signal.SIGKILL)
                return output
            def owned(target,state=None):
                ref=original_owned(target,state);frame=sys._getframe(1)
                if frame.f_code is not original_continue.__code__ or state!='OPERATIONS_COMPLETE' or injected:return ref
                injected.append(mode);database=frame.f_locals['database'];staging=frame.f_locals['staging'];paths=frame.f_locals['paths']
                assert r.dedupe._STATES[h]=='OPERATIONS_COMPLETE' and not submitted
                if mode=='comment':
                    reader.query(database,"COMMENT ON TABLE public.customers IS 'synthetic changed';")
                    assert not submitted # The linked complete actual71 snapshot must reject drift.
                if mode=='constraint':
                    reader.query(database,'CREATE SCHEMA operations_probe; CREATE TABLE operations_probe.holder(id integer CONSTRAINT synthetic_operations CHECK (true));')
                    assert not submitted # Global conname already belongs to the accepted actual71 projection.
                if mode=='dirty_rows':reader.query(database,"UPDATE public.roles SET description='synthetic changed';")
                if mode=='owner':reader.query(database,'ALTER DATABASE gridex_auth_legacy_replay OWNER TO service_role;')
                if mode=='stage':return original_continue(target,database,paths,object())
                if mode=='database':return original_continue(target,r.alignment.HELPER,paths,staging)
                return ref
            def validate(paths,staging=None):
                frame=sys._getframe(1)
                if mode=='hash' and frame.f_code is r.execute.__code__ and r.dedupe._STATES[h]=='READINESS_NATIVE':
                    path=staging.hold/sources[1].path.name;stat=path.stat();parent=path.parent.stat();data=path.read_bytes()
                    try:
                        path.write_bytes(data+b'\n');return original_validate(paths,staging)
                    finally:
                        path.write_bytes(data);os.chmod(path,stat.st_mode)
                        os.utime(path,ns=(stat.st_atime_ns,stat.st_mtime_ns));os.utime(path.parent,ns=(parent.st_atime_ns,parent.st_mtime_ns))
                return original_validate(paths,staging)
            def dispose(target):
                assert target is h
                original_dispose(target);disposed.append(h)
                assert not reader.query(core.CANARY,"SELECT datname FROM pg_database WHERE datname='gridex_auth_legacy_replay';").strip()
                assert reader.snapshot(core.CANARY)==canary
            with patch.object(r.alignment,'run_private',query),patch.object(r,'owned',owned),patch.object(r.batch,'validate_sources',validate),patch.object(r.dedupe,'_dispose',dispose),patch.object(r,'whole_program',program),patch.object(r,'run_program',run_program):
                command=['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--readiness-prefix-proof']
                if mode=='child_exit':command=['bash','-c','bash "$1" --readiness-prefix-proof; exit 73','operations',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh')]
                operation=lambda:r.replay.serve_child(r.legacy,h,command,'readiness74')
                if mode=='success':
                    assert operation()==0 and submitted==['M','E','Z'] and not disposed
                    assert r.dedupe._STATES[h]=='SUCCEEDED' and inputs.closed_staging is not None
                    final=reader.snapshot(r.DATABASE);accepted=json.loads(r._RELEASES[h].after)
                    assert final[0]=={key:value for key,value in accepted[0].items() if not key.startswith(('alignment_','operations_'))}
                    assert r.alignment.rows_equal(final[1],accepted[1])
                    rejected(r,lambda:original_continue(h,r.DATABASE,r.reviewed_paths(),inputs.closed_staging))
                    rejected(r,lambda:r.dedupe.fresh_target(h));assert r.dedupe._STATES[h]=='SUCCEEDED'
                else:
                    rejected(r,operation)
                    assert r.dedupe._STATES[h]=='DISPOSED' and disposed==[h]
                    if mode in ('comment','constraint','dirty_rows','owner','stage','database','hash','program'):assert not submitted
                    else:assert submitted==['M','E','Z']
                    if mode.endswith(('_error','_backend')):assert rolled_back==[mode]
                    rejected(r,lambda:r.dedupe.fresh_target(h))
                assert reader.snapshot(core.CANARY)==canary
                if prior is not None:
                    rejected(r,lambda:r.dedupe.fresh_target(prior));rejected(r,lambda:r.dedupe.fail(prior))
                    assert reader.snapshot(core.CANARY)==canary
        r.fixed.privacy(h);assert r.replay.originals_snapshot()==originals
    print('PASS readiness continuation mode='+mode+'; actual74/source/owner/atomicity/disposal/canary/privacy',flush=True)
    return h


def death_observation_sql():
    return "SELECT to_regclass('public.billing_readiness_flags') IS NOT NULL AND to_regclass('public.gridex_tenant_runtime_readiness') IS NOT NULL;"


def controller_death():
    r=runtime();support().require_owner();originals=r.replay.originals_snapshot()
    child=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--death-worker'],capture_output=True,timeout=300,env=r.legacy.clean_environment())
    assert child.returncode==-signal.SIGKILL,'READINESS_CONTROLLER_DEATH_REQUIRED'
    markers=[]
    for line in child.stdout.decode().splitlines():
        try:value=json.loads(line)
        except ValueError:continue
        if value.get('death_ready')=='readiness':markers.append(value)
    assert len(markers)==1 and markers[0].get('privacy') is True and b'PASS readiness continuation' not in child.stdout
    name=os.environ['GRIDEX_LEGACY_CONTAINER_NAME'];directory=Path(markers[0]['directory'])
    assert directory.name.startswith('gridex-auth-legacy-') and directory.is_dir() and not directory.is_symlink()
    def command(args):
        result=subprocess.run(['docker',*args],capture_output=True,timeout=30,env=r.legacy.clean_environment())
        assert result.returncode==0,'READINESS_DEATH_OBSERVATION_REQUIRED'
        return result.stdout.decode().strip()
    try:
        assert command(['inspect','--format','{{ index .Config.Labels "gridex.auth-legacy.owner" }}',name])==name
        assert command(['exec',name,'psql','-X','-U','postgres','-d',r.DATABASE,'-qAt','-c',death_observation_sql()])=='t'
        assert command(['exec',name,'psql','-X','-U','postgres','-d',r.fixed.CANARY,'-qAt','-c','SELECT value FROM public.continuation_canary;'])=='preserved'
        deadline=time.monotonic()+15
        while r.replay.originals_snapshot()!=originals and time.monotonic()<deadline:time.sleep(.1)
        assert r.replay.originals_snapshot()==originals,'READINESS_DEAD_CONTROLLER_HOLD_RESTORATION_REQUIRED'
        r.legacy.cleanup_workflow_owned();assert not command(['ps','-aq','--filter','name=^/'+name+'$'])
    finally:
        r.legacy.cleanup_workflow_owned();shutil.rmtree(directory)
    print('PASS readiness continuation controller death after COMMIT; canary/HOLD/privacy/exact cleanup',flush=True)


def main():
    parser=argparse.ArgumentParser(allow_abbrev=False);modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only',action='store_true');modes.add_argument('--cleanup-owned',action='store_true');modes.add_argument('--death-worker',action='store_true')
    args=parser.parse_args()
    if args.cleanup_owned:support().require_owner();runtime().legacy.cleanup_workflow_owned();return
    if args.death_worker:native_case('death');return
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Constructors))
    if not result.wasSuccessful():raise AssertionError('READINESS_CONSTRUCTORS_FAILED')
    if args.selection_only:return
    first=native_case('success');native_case('success',first)
    for mode in ('comment','constraint','dirty_rows','owner','stage','database','hash','program','M_error','E_error','Z_error','E_backend','post_comment','post_rows','child_exit'):native_case(mode)
    controller_death();native_case('success')
    print('PASS actual74 staged continuation; complete source/commit/rollback/owner/HOLD/privacy',flush=True)


if __name__=='__main__':
    try:main()
    except BaseException as error:
        if isinstance(error,SystemExit):raise
        label=str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL readiness continuation category='+label,file=sys.stderr);sys.exit(1)
