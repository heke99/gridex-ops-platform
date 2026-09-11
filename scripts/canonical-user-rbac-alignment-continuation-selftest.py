#!/usr/bin/env python3
"""Constructor and native gates for the owned actual68 continuation."""
import argparse
import contextlib
from dataclasses import replace
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('alignment_continuation_loader',
    ROOT/'scripts/canonical-auth-provisioning-replay.py')
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


def runtime():
    return loader.controller().load_alignment_runtime()


def test_support():
    spec = importlib.util.spec_from_file_location('alignment_continuation_test_support',
        ROOT/'scripts/canonical-user-rbac-fixed-target-continuation-selftest.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Handle:
    pass


class Constructors(unittest.TestCase):
    def test_private_expected_receipt_is_unique_complete_and_closed(self):
        r = runtime()
        rows = [['public.synthetic', {'value': 'private value'}]]
        raw = 'ALIGNMENT_COMPLETE\nALIGNMENT_EXPECTED_ROWS\n' + json.dumps(rows) + '\n'
        self.assertEqual(r.expected_receipt(raw), rows)
        for invalid in ('', raw + 'extra\n', raw + raw,
                        raw.replace('ALIGNMENT_COMPLETE', 'incomplete'),
                        raw.replace(json.dumps(rows), '{}'),
                        raw.replace(json.dumps(rows), 'private invalid JSON')):
            with self.assertRaises(r.batch.BoundaryError) as caught:
                r.expected_receipt(invalid)
            self.assertNotIn('private', str(caught.exception))

    def test_post_commit_rows_compare_complete_multisets(self):
        r = runtime()
        rows = [['public.synthetic', {'id': 1, 'enabled': True}], ['public.synthetic', {'id': 2}]]
        self.assertTrue(r.rows_equal(rows, list(reversed(rows))))
        self.assertFalse(r.rows_equal(rows, rows + rows[:1]))
        self.assertFalse(r.rows_equal(rows, [['public.synthetic', {'id': 1, 'enabled': 1}], rows[1]]))
        self.assertFalse(r.rows_equal(rows, [['public.synthetic', {'id': 1}], rows[1]]))

    def test_direct_call_cannot_start_sql_or_release(self):
        r = runtime()
        h = Handle()
        with patch.object(r, 'owned', return_value=SimpleNamespace()), patch.object(r, 'run_private') as sql:
            for operation in (lambda:r.execute(h,r.DATABASE,r.reviewed_paths(),object(),()),
                              lambda:r.release_checks(h)):
                with self.assertRaises(r.batch.BoundaryError):operation()
            sql.assert_not_called()

    def test_completion_links_fixed_reservation_staging_token_and_committed_state(self):
        r = runtime()
        h = Handle()
        inputs = SimpleNamespace(staging=object())
        ref = SimpleNamespace(inputs=inputs)
        predecessor = object()
        run = r.Release(ref, predecessor, inputs.staging, b'before', b'', 'token')
        release = replace(run, after=b'after')
        with patch.object(r, 'owned', return_value=ref):
            r._RUNS[h] = run
            r.fixed._RUNS[h] = r.fixed._RELEASES[h] = predecessor
            try:
                for invalid in (None, replace(release,reference=object()),
                                replace(release,fixed_completion=object()),
                                replace(release,staging=object()),replace(release,before=b'other'),
                                replace(release,token='other'),replace(release,after=b'')):
                    r._RELEASES[h] = invalid
                    with self.assertRaises(r.batch.BoundaryError):r.completion(h)
                r._RELEASES[h] = release
                self.assertIs(r.completion(h), release)
                r.fixed._RELEASES[h] = object()
                with self.assertRaises(r.batch.BoundaryError):r.completion(h)
            finally:
                for registry in (r._RUNS,r._RELEASES,r.fixed._RUNS,r.fixed._RELEASES):registry.pop(h,None)

    def test_references_bind_exact_owner_inputs_and_directory(self):
        r = runtime()
        h = Handle();h.name='owned';h.directory=SimpleNamespace(name='/private/owned')
        predecessor=SimpleNamespace(inputs=object())
        ref=r.Reference(h.name,h.directory.name,predecessor,predecessor.inputs,(),(),b'',())
        with patch.object(r,'base_owned',return_value=predecessor):
            try:
                for invalid in (None,replace(ref,name='foreign'),replace(ref,directory='/foreign'),
                                replace(ref,fixed=object()),replace(ref,inputs=object())):
                    r._REFERENCES[h]=invalid
                    with self.assertRaises(r.batch.BoundaryError):r.owned(h)
                r._REFERENCES[h]=ref
                self.assertIs(r.owned(h),ref)
                with self.assertRaises(r.batch.BoundaryError):r.owned(h,'ALIGNMENT_NATIVE')
            finally:r._REFERENCES.pop(h,None)

    def test_identity_preimage_uses_same_complete_projection(self):
        r=runtime()
        self.assertEqual(r.identity_preimage_sql(),
            'CREATE TEMP TABLE alignment_identity_reference(value) ON COMMIT DROP AS '+r.batch.identities_sql())
        self.assertIn('FROM alignment_identity_reference',r.batch.identity_assertions())

    def test_consumed_program_rejects_byte_order_prelude_and_owner_drift(self):
        r=runtime();h=Handle()
        with tempfile.TemporaryDirectory(prefix='alignment-program-') as directory:
            h.directory=SimpleNamespace(name=directory)
            one=Path(directory)/'one.sql';two=Path(directory)/'two.sql'
            one.write_bytes(b'SELECT 1;');two.write_bytes(b'SELECT 2;')
            program=((one,one.read_bytes()),(two,two.read_bytes()))
            r._RUNS[h]=r.Release(object(),object(),object(),b'before',b'','token',program,b'prelude')
            with patch.object(r,'owned',return_value=object()):
                try:
                    r.check_program(h,'prelude',[one,two])
                    for sql,files in (('other',[one,two]),('prelude',[two,one]),('prelude',[one]),('prelude',[one,two,two])):
                        with self.assertRaises(r.batch.BoundaryError):r.check_program(h,sql,files)
                    one.write_bytes(b'SELECT 1; SELECT 3;')
                    with self.assertRaises(r.batch.BoundaryError):r.check_program(h,'prelude',[one,two])
                    one.unlink();one.symlink_to(two)
                    with self.assertRaises(r.batch.BoundaryError):r.check_program(h,'prelude',[one,two])
                finally:r._RUNS.pop(h,None)

    def test_exact_scope_and_workflow_cleanup(self):
        r=runtime()
        self.assertEqual(r.replay.SCOPES['alignment68'],68)
        self.assertEqual(r.replay.scope_flags('alignment68'),['--alignment-prefix-proof'])
        self.assertEqual(r.replay.SCOPES['full'],112)
        order=json.loads((ROOT/'scripts/gridex-aud-003-foundation-order.json').read_text())['foundation']
        self.assertEqual(order[63:68],['migrations/'+p.name for p in r.reviewed_paths()])
        workflow=(ROOT/'.github/workflows/ops-hardening.yml').read_text()
        job=workflow.split('  user-rbac-alignment-continuation-proof:\n')[1].split('\n  user-rbac-customer-alignment-proof:')[0]
        self.assertIn('timeout-minutes: 30',job)
        self.assertIn('if: always()',job)
        self.assertIn('canonical-user-rbac-alignment-continuation-selftest.py --cleanup-owned',job)


def rejected(r, operation):
    try:operation()
    except r.batch.BoundaryError:return
    raise AssertionError('ALIGNMENT_UNSAFE_CONTINUATION_ACCEPTED')


def native_case(mode, prior=None):
    r=runtime();support=test_support();support.require_owner()
    originals=r.replay.originals_snapshot()
    sources=r.batch.validate_sources(r.reviewed_paths())
    submitted=[];rolled_back=[];disposed=[];injected=[]
    with r.legacy.OwnedPostgres() as h:
        with r.fixed.AcceptedInputs(h) as inputs:
            r.dedupe.prepare_reference(h,'alignment68')
            core=support.characterization();reader=support.private_reader(core,h)
            h.reset(core.CANARY)
            reader.query(core.CANARY,"CREATE TABLE public.continuation_canary(id integer PRIMARY KEY,value text); INSERT INTO public.continuation_canary VALUES(1,'preserved');")
            canary=reader.snapshot(core.CANARY)
            original_query=r.run_private;original_continue=r.dedupe.continue_alignment
            original_owned=r.owned;original_validate=r.batch.validate_sources
            original_dispose=r.dedupe._dispose
            original_stage=r.batch.stage_sql;original_assertions=r.batch.assertions
            def stage_sql(previous,key):
                sql=original_stage(previous,key)
                if mode==key+'_error':sql+='SELECT 1/0;'
                if mode==key+'_backend':sql+='SELECT pg_terminate_backend(pg_backend_pid());'
                return sql
            def assertions(rollback):
                sql=original_assertions(rollback)
                return sql+('SELECT 1/0;' if mode=='W_error' else '')
            def query(target,database,sql,files=()):
                envelope=bool(files) and files[0].name=='alignment-whole-P.sql'
                if not envelope:return original_query(target,database,sql,files)
                assert target is h and database==r.DATABASE and not submitted
                assert 'CREATE TEMP TABLE alignment_identity_reference(value)' in sql
                assert sql.index('LOCK TABLE')<sql.index('CREATE TEMP TABLE alignment_identity_reference(value)')
                whole=[p for p in files if p.name.startswith('alignment-whole-')]
                assert [p.read_bytes() for p in whole]==[s.data for s in sources]
                submitted.extend(s.key for s in sources)
                before=r.snapshot(h)
                if mode=='copy_hash':whole[1].write_bytes(whole[1].read_bytes()+b'\nSELECT 1;\n')
                try:output=original_query(target,database,sql,files)
                except r.batch.BoundaryError as error:
                    if mode.endswith(('_error','_backend')):
                        expected='ALIGNMENT_QUERY_22012' if mode.endswith('_error') else 'ALIGNMENT_QUERY_57P01'
                        assert str(error)==expected,'ALIGNMENT_EXACT_INJECTED_FAILURE_REQUIRED'
                        assert r.encoded(r.snapshot(h))==r.encoded(before),'ALIGNMENT_ATOMIC_ROLLBACK_REQUIRED'
                        rolled_back.append(mode)
                    raise
                r.expected_receipt(output)
                if mode=='post_catalog':reader.query(database,'ALTER TABLE public.customer_sites ALTER COLUMN site_name SET STORAGE EXTERNAL;')
                if mode=='post_rows':reader.query(database,"UPDATE public.roles SET description='synthetic changed';")
                if mode=='death':
                    r.fixed.privacy(h)
                    print(json.dumps({'death_ready':'alignment','directory':h.directory.name,'privacy':True}),flush=True)
                    os.kill(os.getpid(),signal.SIGKILL)
                return output
            def owned(target,state=None):
                ref=original_owned(target,state)
                frame=sys._getframe(1)
                if frame.f_code is not original_continue.__code__ or state!='FIXED_COMPLETE' or injected:
                    return ref
                injected.append(mode)
                database=frame.f_locals['database'];staging=frame.f_locals['staging']
                paths=frame.f_locals['paths'];bounds=frame.f_locals['actual_bounds']
                assert r.dedupe._STATES[h]=='FIXED_COMPLETE' and not submitted
                if mode=='storage':
                    reader.query(database,'ALTER TABLE public.customer_sites ALTER COLUMN site_name SET STORAGE EXTERNAL;')
                    r.fixed.assert_final(h) # The old projection omits storage drift.
                if mode=='dirty_rows':reader.query(database,"UPDATE public.roles SET description='synthetic changed';")
                if mode=='owner':reader.query(database,'ALTER DATABASE gridex_auth_legacy_replay OWNER TO service_role;')
                if mode=='stage':return original_continue(target,database,paths,object(),bounds)
                if mode=='database':return original_continue(target,r.HELPER,paths,staging,bounds)
                return ref
            def validate(paths,staging=None):
                frame=sys._getframe(1)
                if mode=='hash' and frame.f_code is r.execute.__code__ and target_state()== 'ALIGNMENT_NATIVE':
                    path=staging.hold/sources[1].path.name;stat=path.stat();parent=path.parent.stat();data=path.read_bytes()
                    try:
                        path.write_bytes(data+b'\n')
                        return original_validate(paths,staging)
                    finally:
                        path.write_bytes(data);os.chmod(path,stat.st_mode)
                        os.utime(path,ns=(stat.st_atime_ns,stat.st_mtime_ns))
                        os.utime(path.parent,ns=(parent.st_atime_ns,parent.st_mtime_ns))
                return original_validate(paths,staging)
            def target_state():return r.dedupe._STATES[h]
            def dispose(target):
                assert target is h
                original_dispose(target);disposed.append(h)
                assert not reader.query(core.CANARY,"SELECT datname FROM pg_database WHERE datname='gridex_auth_legacy_replay';").strip()
                assert reader.snapshot(core.CANARY)==canary
            with patch.object(r,'run_private',query),patch.object(r,'owned',owned),patch.object(r.batch,'validate_sources',validate),patch.object(r.dedupe,'_dispose',dispose),patch.object(r.batch,'stage_sql',stage_sql),patch.object(r.batch,'assertions',assertions):
                command=['bash',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh'),'--alignment-prefix-proof']
                if mode=='child_exit':command=['bash','-c','bash "$1" --alignment-prefix-proof; exit 73','alignment',str(ROOT/'scripts/gridex-aud-003-clean-replay.sh')]
                operation=lambda:r.replay.serve_child(r.legacy,h,command,'alignment68')
                if mode=='success':
                    assert operation()==0
                    assert submitted==['P','A','B','C','W'] and not disposed
                    assert r.dedupe._STATES[h]=='SUCCEEDED' and inputs.closed_staging is not None
                    final=reader.snapshot(r.DATABASE);accepted=json.loads(r._RELEASES[h].after)
                    assert final[0]=={key:value for key,value in accepted[0].items() if not key.startswith('alignment_')}
                    assert r.rows_equal(final[1],accepted[1])
                    rejected(r,lambda:original_continue(h,r.DATABASE,r.reviewed_paths(),inputs.closed_staging,()))
                    rejected(r,lambda:r.dedupe.fresh_target(h))
                    assert r.dedupe._STATES[h]=='SUCCEEDED'
                else:
                    rejected(r,operation)
                    assert r.dedupe._STATES[h]=='DISPOSED' and disposed==[h]
                    if mode in ('storage','dirty_rows','owner','stage','database','hash'):assert not submitted
                    else:assert submitted==['P','A','B','C','W']
                    if mode.endswith(('_error','_backend')):assert rolled_back==[mode]
                    rejected(r,lambda:r.dedupe.fresh_target(h))
                assert reader.snapshot(core.CANARY)==canary
                if prior is not None:
                    rejected(r,lambda:r.dedupe.fresh_target(prior))
                    rejected(r,lambda:r.dedupe.fail(prior))
                    assert reader.snapshot(core.CANARY)==canary
        r.fixed.privacy(h)
        assert r.replay.originals_snapshot()==originals
    print('PASS alignment continuation mode='+mode+'; actual68/source/owner/atomicity/disposal/canary/privacy',flush=True)
    return h


def controller_death():
    r=runtime();support=test_support();support.require_owner()
    originals=r.replay.originals_snapshot()
    child=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--death-worker'],
        capture_output=True,timeout=300,env=r.legacy.clean_environment())
    assert child.returncode==-signal.SIGKILL,'ALIGNMENT_CONTROLLER_DEATH_REQUIRED'
    markers=[]
    for line in child.stdout.decode().splitlines():
        try:value=json.loads(line)
        except ValueError:continue
        if value.get('death_ready')=='alignment':markers.append(value)
    assert len(markers)==1 and markers[0].get('privacy') is True and b'PASS alignment continuation' not in child.stdout
    name=os.environ['GRIDEX_LEGACY_CONTAINER_NAME'];directory=Path(markers[0]['directory'])
    assert directory.name.startswith('gridex-auth-legacy-') and directory.is_dir() and not directory.is_symlink()
    def command(args):
        result=subprocess.run(['docker',*args],capture_output=True,timeout=30,env=r.legacy.clean_environment())
        assert result.returncode==0,'ALIGNMENT_DEATH_OBSERVATION_REQUIRED'
        return result.stdout.decode().strip()
    try:
        assert command(['inspect','--format','{{ index .Config.Labels "gridex.auth-legacy.owner" }}',name])==name
        assert command(['exec',name,'psql','-X','-U','postgres','-d',r.DATABASE,'-qAt','-c',"SELECT format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid='public.billing_export_run_items'::regclass AND attname='contract_id' AND NOT attisdropped;"])=='uuid'
        assert command(['exec',name,'psql','-X','-U','postgres','-d',r.fixed.CANARY,'-qAt','-c','SELECT value FROM public.continuation_canary;'])=='preserved'
        deadline=time.monotonic()+15
        while r.replay.originals_snapshot()!=originals and time.monotonic()<deadline:time.sleep(.1)
        assert r.replay.originals_snapshot()==originals,'ALIGNMENT_DEAD_CONTROLLER_HOLD_RESTORATION_REQUIRED'
        r.legacy.cleanup_workflow_owned()
        assert not command(['ps','-aq','--filter','name=^/'+name+'$'])
    finally:
        r.legacy.cleanup_workflow_owned();shutil.rmtree(directory)
    print('PASS alignment continuation controller death after COMMIT; canary/HOLD/privacy/exact cleanup',flush=True)


def main():
    parser=argparse.ArgumentParser(allow_abbrev=False)
    modes=parser.add_mutually_exclusive_group()
    modes.add_argument('--selection-only',action='store_true')
    modes.add_argument('--cleanup-owned',action='store_true')
    modes.add_argument('--death-worker',action='store_true')
    args=parser.parse_args()
    if args.cleanup_owned:
        test_support().require_owner();runtime().legacy.cleanup_workflow_owned();return
    if args.death_worker:native_case('death');return
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Constructors))
    if not result.wasSuccessful():raise AssertionError('ALIGNMENT_CONSTRUCTORS_FAILED')
    if args.selection_only:return
    first=native_case('success')
    native_case('success',first)
    for mode in ('storage','dirty_rows','owner','stage','database','hash',
                 'copy_hash','A_error','B_backend','W_error','post_catalog','post_rows','child_exit'):
        native_case(mode)
    controller_death()
    native_case('success')
    print('PASS actual68 staged continuation; complete source/commit/rollback/owner/HOLD/privacy',flush=True)


if __name__=='__main__':
    try:main()
    except BaseException as error:
        if isinstance(error,SystemExit):raise
        label=str(error) if re.fullmatch(r'[A-Z][A-Z0-9_]{0,79}',str(error)) else type(error).__name__
        print('FAIL alignment continuation category='+label,file=sys.stderr)
        sys.exit(1)
