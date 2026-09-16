#!/usr/bin/env python3
"""Prove Storage bootstrap/reference alignment on isolated PostgreSQL only.

Reproduce the exact two-ACL mismatch and 42804, then independently construct
matching references and execute all nine original foundation44-52 sources.
No production target, RLS exemption, migration rewrite or schema acceptance.
"""
import importlib.util
import json
from pathlib import Path
import signal
import sys
import canonical_storage_bootstrap as storage

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('storage_reference_legacy',
    ROOT/'scripts/canonical-auth-provisioning-legacy-batch.py')
legacy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = legacy
spec.loader.exec_module(legacy)
REFERENCE = 'gridex_auth_legacy_reference'
REPLAY = 'gridex_auth_legacy_replay'


def check(condition):
    if not condition:
        raise ValueError('STORAGE_REFERENCE_PROOF_REQUIRED')


def rejected(target):
    before = target.catalog(REPLAY)
    try:
        legacy.execute(target,REPLAY,legacy.reviewed_paths())
    except legacy.BoundaryError as error:
        check(type(error) is legacy.BoundaryError and error.args==('UNEXPECTED_SQL_RESULT',))
        raw = (Path(target.directory.name)/'client-last.out').read_text(errors='replace')
        check(legacy.safe_receipt(raw,3,'profile_negative')['sqlstate']=='42804')
    else:
        raise ValueError('STORAGE_REFERENCE_NEGATIVE_REQUIRED')
    check(target.catalog(REPLAY)==before)


def run():
    if len(sys.argv)!=1:
        raise ValueError('NO_TARGET_OR_SCOPE_ARGUMENTS_ACCEPTED')
    def interrupted(_signum,_frame):
        raise ValueError('STORAGE_REFERENCE_INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)
    signal.signal(signal.SIGINT,interrupted)
    original = (ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_bytes()
    sources = tuple((p,p.read_bytes()) for p in legacy.reviewed_paths())
    # Negative control reproduces the old caller: default references, but
    # Storage DML initialized only on replay, before any historical source.
    with legacy.OwnedPostgres(postgis=True) as target:
        negative_dir = Path(target.directory.name)
        target.prefix(REFERENCE)
        before = target.catalog(REFERENCE)
        target.reset(REPLAY)
        files = [target.private('bootstrap.sql',storage.render(original)),
                 target.private('prefix-search-path.sql','SET search_path = public,extensions;')]
        files.extend(target.private('prefix-'+str(i)+'.sql',sql)
                     for i,(_,sql) in enumerate(legacy.verified_prefix(),1))
        target.run_files(REPLAY,files,'mismatched_first43',transaction=False)
        after = target.catalog(REPLAY)
        changed = {key for key in set(before)|set(after) if before.get(key)!=after.get(key)}
        check(changed=={'relation/storage.buckets','relation/storage.objects'})
        for key in changed:
            check({k:v for k,v in before[key].items() if k!='acl'}==
                  {k:v for k,v in after[key].items() if k!='acl'})
        target.reference = (before,None)
        rejected(target)
        check(target.catalog(REFERENCE)==before)
    check(not target.active and not negative_dir.exists())
    print(json.dumps(dict(case='mismatched_storage_substrate',sqlstate='42804',
        exactAclDeltas=2,rollbackVerified=True,cleanupVerified=True)),flush=True)
    # The opt-in profile is selected before both independent constructions.
    # Original source bytes and all catalog equality/negative gates stay intact.
    with legacy.OwnedPostgres(postgis=True,storage_dml=True) as target:
        positive_dir = Path(target.directory.name)
        legacy.prepare_reference(target)
        target.prefix(REPLAY)
        check(target.catalog(REPLAY)==target.reference[0])
        result = legacy.execute(target,REPLAY,legacy.reviewed_paths())
        check(result['sources']==9 and target.catalog(REPLAY)==target.reference[1])
        legacy.execute(target,REPLAY,legacy.reviewed_paths())
        check(target.catalog(REPLAY)==target.reference[1])
        storage.validate(json.loads(target.sql(REPLAY,storage.CAPTURE,'storage_profile')),allowed=True)
        target.sql(REPLAY,'GRANT TRUNCATE ON storage.objects TO authenticated;','unexpected_acl')
        rejected(target)
    check(not target.active and not positive_dir.exists())
    check((ROOT/'scripts/sql/gridex-supabase-compatible-bootstrap.sql').read_bytes()==original)
    check(all(p.read_bytes()==raw for p,raw in sources))
    print(json.dumps(dict(scope='STORAGE_REFERENCE_FOUNDATION52_ONLY',outcome='PASS',
        independentCatalogsEqual=True,originalSourcesExecuted=9,repeatVerified=True,
        unexpectedAclRejected=True,storageDmlChecks=24,sourcePreserved=True,
        cleanupVerified=True,completeReplayVerified=False,schemaAccepted=False,
        productionModified=False)),flush=True)
    return 0


if __name__=='__main__':
    try:
        raise SystemExit(run())
    except Exception:
        print(json.dumps(dict(scope='STORAGE_REFERENCE_FOUNDATION52_ONLY',outcome='FAIL',
            completeReplayVerified=False,productionModified=False)),flush=True)
        raise SystemExit(1) from None
