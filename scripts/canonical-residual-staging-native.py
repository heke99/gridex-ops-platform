#!/usr/bin/env python3
"""Verify the shared full FoundationLoop with actual originals absent during HOLD.

This owned integration test does not waive source-effect acceptance, create a
ledger, capture an accepted schema, or generate application types. Sources remain
absent through all timestamp stages and session authorities; restoration is last.
"""
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load():
    spec=importlib.util.spec_from_file_location('staging_frontier',ROOT/'scripts/canonical-foundation-frontier-diagnostic.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m


@contextmanager
def originals_absent(hold):
    migrations=ROOT/'supabase/migrations'
    directory_stat=migrations.stat()
    backup=hold.parent/'original-migrations';backup.mkdir(mode=0o700)
    moved=[]
    try:
        for source in sorted(migrations.iterdir()):
            if source.is_symlink():
                raise ValueError('SYMLINK_SOURCE_REJECTED')
            if source.is_file() and source.suffix=='.sql':
                if (hold/source.name).read_bytes()!=source.read_bytes():
                    raise ValueError('STAGED_SOURCE_MISMATCH')
                source.rename(backup/source.name);moved.append(source.name)
        if list(migrations.glob('*.sql')) or not moved:
            raise ValueError('ORIGINAL_REMOVAL_NOT_VERIFIED')
        yield
    finally:
        for name in moved:
            (backup/name).rename(migrations/name)
        os.utime(migrations,ns=(directory_stat.st_atime_ns,directory_stat.st_mtime_ns))


def run():
    if len(sys.argv)!=1:
        raise ValueError('NO_TARGET_ARGUMENTS_ACCEPTED')
    frontier=load();controller=frontier.load_controller()
    order,report=frontier.verify_selection(controller)
    timestamp=frontier.load_timestamp()
    selected,prerequisites=timestamp.load_inputs(ROOT,report,order)
    retained=timestamp.retain_sources(ROOT,selected,prerequisites)
    legacy=controller.load_batch()
    def interrupted(*_):
        raise RuntimeError('STAGED_REPLAY_INTERRUPTED')
    signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGTERM,interrupted)
    before=controller.originals_snapshot()
    result={};progress={'foundationApplied':0,'timestampApplied':0}
    with legacy.OwnedPostgres(postgis=True) as target:
        try:
            timestamp.verify_spatial_runtime(target)
            with controller.load_private().AcceptedInputs(target):
                controller.load_dedupe().prepare_reference(target,'full')
                controller.load_dedupe().fresh_target(target)
                hold=Path(target.directory.name)/'integrated-hold';hold.mkdir(mode=0o700)
                for source in (ROOT/'supabase/migrations').iterdir():
                    if source.is_symlink():
                        raise ValueError('SYMLINK_SOURCE_REJECTED')
                    if source.is_file() and source.suffix=='.sql':
                        shutil.copy2(source,hold/source.name)
                paths=[str(hold/Path(p).name if p.startswith('migrations/') else ROOT/'supabase'/p) for p in order]
                loop=controller.FoundationLoop(legacy,target,'full')
                with originals_absent(hold):
                    loop.validate(str(hold),paths)
                    target.sql(controller.DATABASE,(ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_text(),
                               'staged_integration_bootstrap',transaction=False)
                    loop.run(str(hold),paths)
                    progress.update(loop.residual_receipt)
                    progress.update(foundationApplied=144,originalsAbsentDuringFoundation=True)
                    timestamp.execute_tail(ROOT,target,controller.DATABASE,selected,prerequisites,progress,
                                           retained=retained)
                    if list((ROOT/'supabase/migrations').glob('*.sql')):
                        raise ValueError('TIMESTAMP_ORIGINALS_RECREATED')
                    progress['originalsAbsentDuringTimestamp']=True
                if controller.originals_snapshot()!=before:
                    raise ValueError('STAGED_SOURCE_RESTORATION_FAILED')
                result={'outcome':'STAGED_SHARED_FOUNDATION_AND_CONTINUATION_PASSED',**progress}
        except Exception as error:
            last=Path(target.directory.name)/'client-last.out'
            safe=frontier.safe_error_identifiers(last.read_bytes()) if last.is_file() else {}
            result={'outcome':'BLOCKED','errorType':type(error).__name__,**safe,**progress}
        if controller.originals_snapshot()!=before:
            raise ValueError('STAGED_SOURCE_PRESERVATION_FAILED')
    if target.active:
        raise ValueError('OWNED_CLEANUP_REQUIRED')
    print(json.dumps({**result,'scope':'STAGED_SHARED_FOUNDATION_INTEGRATION','cleanup':'PASS',
                      'completeReplayVerified':False,'generatedTypesVerified':False,
                      'ledgerProvenanceVerified':False,'productionModified':False},sort_keys=True))
    return 0 if result['outcome']=='STAGED_SHARED_FOUNDATION_AND_CONTINUATION_PASSED' else 1


if __name__=='__main__':
    raise SystemExit(run())
