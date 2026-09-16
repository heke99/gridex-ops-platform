"""Real Supabase provider-owner contract on synthetic legacy policy prerequisites.

No full historical replay, reference acceptance or application types are claimed.
The caller owns and disposes its isolated CLI project.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import time
from types import SimpleNamespace


def qualify(root, sql, native, snapshot, migrations):
    import canonical_permission_forward_contract as contract
    import canonical_native_forward_runtime as forward
    import canonical_forward_sources as sources
    import canonical_native_historical_prefix as prefix
    import canonical_storage_policy_scope as scope
    original_source=(root/scope.SOURCE).read_bytes()
    if hashlib.sha256(original_source).hexdigest()!=scope.SOURCE_SHA:
        raise ValueError('STORAGE_SOURCE_REQUIRED')
    programs=forward.programs(sources.retain(root))
    program=programs[10]
    if program.source_sha256!=contract.SCOPE_SHA:
        raise ValueError('STORAGE_SOURCE_REQUIRED')
    old=contract.storage_assertion();new=forward.assertion(11)
    marker="pg_get_userbyid(c.relowner)='postgres'"
    if old.count(marker)!=1 or new!=old.replace(marker,"pg_get_userbyid(c.relowner)='supabase_storage_admin'"):
        raise ValueError('STORAGE_OWNER_CONTRACT_REQUIRED')
    # Exact legacy statements, not a simplified production predicate.
    blocks=re.findall(r'    create policy grid_owner_agreements_platform_(?:read|write)\b.*?\n      \);',original_source.decode(),re.S)
    if len(blocks)!=2:
        raise ValueError('STORAGE_SOURCE_REQUIRED')
    owner=sql("SELECT to_json(pg_get_userbyid(relowner)) FROM pg_class WHERE oid='storage.objects'::regclass;")
    if owner!='supabase_storage_admin':
        raise ValueError('STORAGE_PROVIDER_OWNER_REQUIRED')
    sql('CREATE TABLE public.roles(id uuid PRIMARY KEY,key text,name text); ALTER TABLE public.user_roles ADD COLUMN role_id uuid;\n'+'\n'.join(blocks),False)
    before=snapshot()
    role=sql("SELECT to_json(('authenticated'::regrole::oid)::bigint);")
    if type(role) is not int or role<=0:
        raise ValueError('STORAGE_ROLE_REQUIRED')
    result=dict(scope='NATIVE_STORAGE_OWNER_AND_EXACT_FORWARD11_NOT_FULL_REPLAY',
        sourceSha256=contract.SCOPE_SHA,legacyPolicySourceSha256=scope.SOURCE_SHA,
        programSha256=prefix.sha(program.sql),nativeOwner=owner,cases=[])

    def create(raw):
        time.sleep(1.1)
        name='gridex_native_forward_11_'+prefix.sha(raw)[:12]
        prior=set(migrations.glob('*.sql'))
        native('migration','new',name)
        delta=set(migrations.glob('*.sql'))-prior
        if len(delta)!=1:
            raise ValueError('STORAGE_CLI_FILE_REQUIRED')
        path=delta.pop()
        if not re.fullmatch(r'\d{14}_'+name+r'\.sql',path.name):
            raise ValueError('STORAGE_CLI_FILE_REQUIRED')
        path.write_bytes(raw);path.chmod(0o600)
        return path,name

    def guard(name,assertion,fault):
        if not re.fullmatch(r'gridex_native_forward_11_[a-f0-9]{12}',name):
            raise ValueError('STORAGE_GUARD_REQUIRED')
        body="IF NEW.name IS DISTINCT FROM '"+name+"' OR ("+assertion+") IS DISTINCT FROM true THEN RAISE EXCEPTION 'NATIVE_FORWARD_BOUNDARY' USING ERRCODE='PF009'; END IF; "
        body+=("RAISE EXCEPTION 'NATIVE_FORWARD_LEDGER_FAULT' USING ERRCODE='PF002';" if fault else 'RETURN NEW;')
        sql('CREATE FUNCTION public.storage_owner_preflight_guard() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN '+body+' END $guard$; REVOKE ALL ON FUNCTION public.storage_owner_preflight_guard() FROM PUBLIC,anon,authenticated,service_role; CREATE TRIGGER storage_owner_preflight_guard BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.storage_owner_preflight_guard();',False)
    def drop_guard():
        sql('DROP TRIGGER storage_owner_preflight_guard ON supabase_migrations.schema_migrations; DROP FUNCTION public.storage_owner_preflight_guard();',False)

    for label,raw,assertion,state in (
        ('portable_owner_rejected_on_native',program.sql,old,'PF009'),
        ('native_full_program_post_body_rollback',program.sql+forward.POST,None,'PF001'),
        ('native_full_program_ledger_rollback',program.sql,new,'PF002')):
        path,name=create(raw)
        if assertion is not None:guard(name,assertion,True)
        try:
            response=native('migration','up','--local',allow_failure=True)
            errors=[line.rstrip(b' ') for line in response.stderr.splitlines() if line.startswith(b'ERROR:')]
            expected={'PF009':b'ERROR: NATIVE_FORWARD_BOUNDARY (SQLSTATE PF009)',
                'PF001':b'ERROR: NATIVE_FORWARD_POST_BODY (SQLSTATE PF001)',
                'PF002':b'ERROR: NATIVE_FORWARD_LEDGER_FAULT (SQLSTATE PF002)'}[state]
            if not response.returncode or errors!=[expected]:
                raise ValueError('STORAGE_FAILURE_CONTROL_REQUIRED')
        finally:
            if assertion is not None:drop_guard()
            path.unlink()
        if snapshot()!=before:
            raise ValueError('STORAGE_ROLLBACK_REQUIRED')
        result['cases'].append(dict(case=label,sqlstate=state,catalogRowsAndLedgerRestored=True))

    path,name=create(program.sql);guard(name,new,False)
    try:native('migration','up','--local')
    finally:drop_guard()
    after=snapshot()
    expected=copy.deepcopy(before[0])
    for key in scope.KEYS:
        if expected[key]['roles']!=['0']:
            raise ValueError('STORAGE_PREIMAGE_REQUIRED')
        expected[key]['roles']=[str(role)]
    if after[0]!=expected or after[1]!=before[1] or after[2][:-1]!=before[2] or len(after[2])!=len(before[2])+1:
        raise ValueError('STORAGE_EXACT_EFFECT_REQUIRED')
    prefix.verify_entry(after[2][-1],path.name,SimpleNamespace(name=name,sql=program.sql))
    if sql('SELECT to_json(('+old+'));') is not False or sql('SELECT to_json(('+new+'));') is not True:
        raise ValueError('STORAGE_OWNER_DIFFERENTIAL_REQUIRED')
    native('migration','up','--local')
    if snapshot()!=after:
        raise ValueError('STORAGE_REPEAT_REQUIRED')
    # Both a reverted role list and the wrong provider owner remain rejected.
    for label,poison in (
        ('public_policy_role','ALTER POLICY grid_owner_agreements_platform_read ON storage.objects TO PUBLIC;'),
        ('wrong_provider_owner','ALTER TABLE storage.objects OWNER TO postgres;')):
        if sql('BEGIN; '+poison+' SELECT to_json(('+new+')); ROLLBACK;') is not False:
            raise ValueError('STORAGE_NEGATIVE_OWNER_OR_ROLE_REQUIRED')
        if snapshot()!=after:
            raise ValueError('STORAGE_NEGATIVE_ROLLBACK_REQUIRED')
        result['cases'].append(dict(case=label,rejected=True,catalogRowsAndLedgerRestored=True))
    result.update(verified=True,changedPolicyRoleLists=2,allOtherCatalogRowsAndEarlierLedgerPreserved=True,
        realCliStatementLedgerVerified=True,noOpRepeatVerified=True,providerOwnerUnchanged=True)
    return result
