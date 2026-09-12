#!/usr/bin/env python3
"""Dedicated offline Task11a PG17 proof; no URL, source override or replay target.

Uses the unchanged OwnedPostgres create/private-log/exact-cleanup implementation.
Only finite receipt labels leave its private SQL client streams. This proves a
source-composed policy subset and metadata behavior, never managed Storage API,
complete effective-schema parity, migration registration or production acceptance.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
NATIVE = 'gridex_auth_legacy_native'
ATOMIC = 'gridex_auth_legacy_atomic'
DATABASES = frozenset([NATIVE, ATOMIC])
TERMINAL = 'PERMISSION_CASE_COMPLETE'


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name+'.py'))
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


fixture = load('canonical-permission-native-fixture')


class NativeError(RuntimeError):
    """Only fixed errors are exposed; SQL exceptions remain private."""


def owned_module():
    return load('canonical-auth-provisioning-legacy-batch')


def dedicated_name():
    name = os.environ.get('GRIDEX_LEGACY_CONTAINER_NAME')
    if name is not None and not re.fullmatch(r'gridex-auth-legacy-permissions-[a-z0-9-]{8,60}',name):
        raise NativeError('DEDICATED_PERMISSION_CONTAINER_REQUIRED')


def baseline_cases():
    cases = fixture.permission_cases(baseline=True)
    storage = fixture.storage_cases(baseline=True)
    cases.update({key:storage[key] for key in ['S13','S14','S15','S16','S20','S22']})
    cases['S_VIEWER'] = fixture.storage_additional_cases(baseline=True)['S_VIEWER']
    return cases


def case_sql(label, body):
    if label not in fixture.build_cases():
        raise ValueError('FINITE_CASE_LABEL_REQUIRED')
    return ("begin;\nset local timezone='UTC';\nset local datestyle='ISO, YMD';\n"
            "set local statement_timeout='30s';\n" + body +
            "\nreset role;\nrollback;\nselect '" + TERMINAL + "';\n")


def diagnostic(raw, stage):
    """Map private psql errors to finite admitted coordinates, never raw text."""
    errors = re.findall(r'^psql:/legacy-private/fixture-[0-9a-f]{16}\.sql:([0-9]{1,7}): ERROR:\s+([A-Z0-9]{5}): ([^\r\n]*)$',raw,re.M)
    if len(errors) != 1:
        return {}
    line,state,message = errors[0]
    result = {}
    if stage == 'source_composition':
        admitted = fixture.admission.admit()
        manifest = json.loads(fixture.admission.MANIFEST.read_text())
        offset = 1
        for key in manifest['composition_order']:
            end = offset + admitted[key].count('\n')
            if offset <= int(line) <= end:
                result = {'source_slice':key,'sql_line':int(line)}
                break
            offset = end + 2
    bodies = [fixture.seed(),fixture.acl_assertions(),*fixture.build_cases().values(),*baseline_cases().values()]
    labels = {'expected_sqlstate_mismatch'}
    for body in bodies:
        labels.update(re.findall(r"fixture\.assert_true\([^\n]*,\s*'([A-Za-z0-9_-]+)'\)",body))
    if state == 'P0001' and message in labels:
        result['assertion'] = message
    return result


def private_sql(target, database, sql, stage, **kwargs):
    try:
        return target.sql(database,sql,stage,**kwargs)
    except Exception:
        # Original helper already recorded and sanitized SQLSTATE/stage. Retain
        # its exception and cleanup behavior; supplement with finite coordinates.
        try:
            raw = (Path(target.directory.name)/'client-last.out').read_text(errors='replace')
            details = diagnostic(raw,stage)
            if details:
                print(json.dumps({'diagnostic':details},sort_keys=True),flush=True)
        except (OSError,AttributeError,ValueError):
            pass
        raise


def run_case(target, database, label, body, prefix='case'):
    if database not in DATABASES:
        raise NativeError('PERMISSION_DATABASE_NOT_ADMITTED')
    if prefix not in ('case','baseline'):
        raise NativeError('FINITE_STAGE_REQUIRED')
    result = private_sql(target,database,case_sql(label,body),prefix+'_'+label,transaction=False)
    if not result.strip().endswith(TERMINAL):
        raise NativeError('CASE_TERMINAL_MISSING')


def acl_poison(all_functions=False):
    signatures = fixture.PRIVATE_SIGNATURES if all_functions else fixture.PRIVATE_SIGNATURES[2:]
    signatures = [*signatures, *([fixture.DIAGNOSTIC_SIGNATURE] if all_functions else [])]
    return ("-- FIXTURE-ONLY preexisting ACL poison, never added to source authority.\n"
            "do $$ begin if not exists(select 1 from pg_roles where rolname='fixture_permission_grantee') then\n"
            "create role fixture_permission_grantee nologin noinherit nosuperuser nobypassrls;\n"
            "end if; end $$;\n"
            "grant fixture_permission_grantee to anon, authenticated, service_role with inherit true;\n" + ''.join(
                'grant execute on function '+signature+' to service_role, fixture_permission_grantee;\n'
                for signature in signatures) + ''.join(
                fixture.check(f"has_function_privilege('{role}',{fixture.lit(signature)},'EXECUTE')", 'poison_inherited_execute_control')
                for signature in signatures for role in ['anon', 'authenticated', 'service_role'])
            + (f'grant execute on function {fixture.DIAGNOSTIC_SIGNATURE} to public, anon, authenticated;\n' if all_functions else ''))


def capture(target, database, stage):
    return json.loads(private_sql(target,database,fixture.catalog(),stage))


def construct():
    sources = fixture.admission.compose()
    candidate = fixture.candidate()
    cases = fixture.build_cases()
    baseline = baseline_cases()
    return sources, candidate, cases, baseline


def execute():
    # Admission completes before any container or SQL mutation.
    sources, candidate, cases, baseline = construct()
    dedicated_name()
    owned = owned_module()
    with owned.OwnedPostgres() as target:
        target.reset(NATIVE)
        private_sql(target,NATIVE,sources,'source_composition')
        private_sql(target,NATIVE,fixture.seed(),'fixture_seed')
        pristine = capture(target,NATIVE,'baseline_catalog')
        for label,body in baseline.items():
            run_case(target,NATIVE,label,body,'baseline')
        if capture(target,NATIVE,'baseline_rollback') != pristine:
            raise NativeError('BASELINE_ROLLBACK_DRIFT')
        print('PASS baseline10 source defect characterizations',flush=True)
        # Fresh database in this newly created container; never an active replay target.
        target.reset(ATOMIC)
        target.docker(['exec',target.name,'dropdb','-U','postgres',ATOMIC])
        target.docker(['exec',target.name,'createdb','-U','postgres','-T',NATIVE,ATOMIC])
        private_sql(target,ATOMIC,acl_poison(),'prior_acl_poison')
        private_sql(target,ATOMIC,candidate,'candidate_first',transaction=False)
        private_sql(target,ATOMIC,fixture.acl_assertions(),'candidate_acl')
        first = capture(target,ATOMIC,'candidate_catalog')
        if first['rows'] != pristine['rows']:
            raise NativeError('CANDIDATE_ROW_DRIFT')
        private_sql(target,ATOMIC,candidate,'candidate_repeat',transaction=False)
        if capture(target,ATOMIC,'repeat_catalog') != first:
            raise NativeError('CANDIDATE_REPEAT_DRIFT')
        # Exercise CREATE OR REPLACE preserving custom and service grants on all
        # existing internals, including both newly introduced private functions.
        private_sql(target,ATOMIC,acl_poison(all_functions=True),'all_acl_poison')
        private_sql(target,ATOMIC,candidate,'candidate_acl_recovery',transaction=False)
        private_sql(target,ATOMIC,fixture.acl_assertions(),'recovered_acl')
        if capture(target,ATOMIC,'recovered_catalog') != first:
            raise NativeError('CANDIDATE_ACL_RECOVERY_DRIFT')
        for label,body in cases.items():
            run_case(target,ATOMIC,label,body)
        if capture(target,ATOMIC,'matrix_rollback') != first:
            raise NativeError('MATRIX_ROLLBACK_DRIFT')
        target.verify_logging()
        print('PASS P28 C32 F16 S24 SX2 D27; repeat, ACL recovery and row preservation',flush=True)
    print('PASS permission native owned-container cleanup',flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check',action='store_true')
    mode.add_argument('--native',action='store_true')
    mode.add_argument('--cleanup-owned',action='store_true')
    args = parser.parse_args()
    try:
        if args.cleanup_owned:
            dedicated_name()
            owned_module().cleanup_workflow_owned()
        elif args.native:
            execute()
        else:
            sources,candidate,cases,baseline = construct()
            print(json.dumps({'construction':'PASS','native':'NOT_RUN',
                              'case_count':len(cases),'baseline_count':len(baseline),
                              'case_assertions':sum(body.count('fixture.assert_true(') for body in cases.values()),
                              'composition_sha256':fixture.admission.digest(sources.encode()),
                              'candidate_sha256':fixture.admission.digest(candidate.encode())},sort_keys=True))
        return 0
    except Exception as error:
        # Never stringify a database/subprocess error or include raw SQL output.
        category = str(error) if isinstance(error,(NativeError,fixture.admission.AdmissionError)) else 'PRIVATE_PERMISSION_PROOF_FAILED'
        if not re.fullmatch(r'[A-Z_]{1,80}',category):
            category = 'PRIVATE_PERMISSION_PROOF_FAILED'
        print(category,flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
