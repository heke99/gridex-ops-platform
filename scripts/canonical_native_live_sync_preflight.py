"""Fast native reproduction of the unchanged source-bound session fixture.

Runs in the parent's disposable CLI project after its single synthetic ledger
entry. This qualifies only the real native environment's bounded behavior/ACL
fixture; it never forges a full historical prefix or a live-sync CLI receipt.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import canonical_native_historical_prefix as p
import canonical_native_timestamp_proof as proof
import canonical_native_timestamp_runtime as timestamp

ROOT=Path(__file__).resolve().parents[1]
PINS={
    'scripts/canonical-live-sync-proof.py':'fd58be14dfc5409a65f3e5d4d3d0d8b9073347a0f4a676839bf770d38cbc89ca',
    'scripts/sql/gridex-supabase-compatible-bootstrap.sql':'d7d6d7b7f1a55cff7fad78ca6397aa5d4e8d43ea1d1ec362eca741bcc36b403b',
    'supabase/migrations/20260730130000_historical_sync_forward_repair.sql':'3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b',
    'supabase/migrations/20260611190000_launch_linter_hardening_security_definer_rls.sql':'b696379a5e1d26bde5fae150d7c51e9d40df029a9dfd605810ad9051b1fb74d1',
}


def contract():
    retained={}
    for name,sha in PINS.items():
        path=ROOT/name
        if path.resolve()!=path or not path.is_file() or path.stat().st_size>100_000:
            raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_SOURCE_REQUIRED')
        raw=path.read_bytes()
        if hashlib.sha256(raw).hexdigest()!=sha:
            raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_SOURCE_REQUIRED')
        retained[name]=raw.decode()
    # The full prefix already proved this transition on its accepted clone. This
    # fast fixture uses that exact versioned definition and explicit ACL source,
    # without claiming any prior migration ran here.
    live=proof.load_live_sync()
    definition,_=live.fix.function_parts(retained['supabase/'+live.fix.FORWARD])
    hardening=retained['supabase/'+live.fix.HARDENING]
    if ("'gridex_is_current_session_allowed'" not in hardening
            or 'revoke all on function %I.%I(%s) from public, anon' not in hardening
            or 'grant execute on function %I.%I(%s) to authenticated, service_role' not in hardening):
        raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_ACL_SOURCE_REQUIRED')
    return dict(definition=definition,execute=dict(anon=False,authenticated=True,service_role=True)),dict(PINS)


def ledger(target):
    entries=json.loads(target.sql('postgres',p.LEDGER_SQL,'live_sync_preflight_ledger'))
    if type(entries) is not list or len(entries)!=1 or entries[0].get('name')!='native_lifecycle_proof':
        raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_LEDGER_REQUIRED')
    spec=importlib.util.spec_from_file_location('live_sync_preflight_lifecycle',ROOT/'scripts/canonical-native-supabase-lifecycle.py')
    lifecycle=importlib.util.module_from_spec(spec);spec.loader.exec_module(lifecycle)
    unit=SimpleNamespace(name='native_lifecycle_proof',sql=lifecycle.FIRST.encode())
    p.verify_entry(entries[0],entries[0]['version']+'_native_lifecycle_proof.sql',unit)
    return entries


def verify(command,project,parent):
    if 'nativeLiveSyncBehavior' in parent:
        raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_ONCE_REQUIRED')
    report=dict(scope='SOURCE_PINNED_SYNTHETIC_SESSION_FIXTURE_NOT_HISTORICAL_PREFIX',
                verified=False,clonesDisposed=False,historicalPrefixVerified=False,
                nativeLiveSyncCliExecutionVerified=False,schemaAccepted=False,generatedTypesVerified=False)
    parent['nativeLiveSyncBehavior']=report
    accepted,pins=contract()
    report.update(sourcePins=pins,definitionSha256=p.sha(accepted['definition'].encode()),
                  sourceDerivedExecute=accepted['execute'])
    target=proof.NativeTimestampTarget(command,project)
    preserved=False
    try:
        before=timestamp.native_snapshot(target)
        prior=ledger(target)
        proof.load_live_sync().behavior(target,accepted)
        if ledger(target)!=prior or timestamp.native_snapshot(target)!=before:
            raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_PRESERVATION_REQUIRED')
        if contract()!=(accepted,pins):
            raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_SOURCE_REQUIRED')
        preserved=True
    except Exception:
        if target._last_sql_failure is not None:
            report['nativeSqlFailure']=dict(target._last_sql_failure)
        raise
    finally:
        target.close()
        if target._owned:
            raise ValueError('NATIVE_LIVE_SYNC_PREFLIGHT_CLONE_DISPOSAL_REQUIRED')
        report['clonesDisposed']=True
    if preserved:
        report.update(verified=True,unchangedBehaviorFixtureExecuted=True,
                      catalogRowsProviderAndLedgerPreserved=True)
    return report
