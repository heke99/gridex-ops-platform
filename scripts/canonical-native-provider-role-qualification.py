"""Prove native provider admission and reject client escalation on an owned DB.

Only disposable role mutations inside ROLLBACK transactions are exercised. No
historical schema, application DML, accepted baseline or hosted target is touched.
"""
import importlib.util
import json
import re
from pathlib import Path
import subprocess
import sys

import canonical_native_provider_role_chain as provider
import canonical_removed_policy_qualification as policy

ROOT=Path(__file__).resolve().parents[1]
CASES=(
 ('anon_set_service',"GRANT service_role TO anon WITH INHERIT FALSE, SET TRUE;"),
 ('authenticated_set_service',"GRANT service_role TO authenticated WITH INHERIT FALSE, SET TRUE;"),
 ('authenticated_set_storage',"GRANT supabase_storage_admin TO authenticated WITH INHERIT FALSE, SET TRUE;"),
 ('unknown_login_set_service',"CREATE ROLE gridex_role_probe LOGIN NOINHERIT; GRANT service_role TO gridex_role_probe WITH INHERIT FALSE, SET TRUE;"),
 ('unknown_login_set_storage',"CREATE ROLE gridex_role_probe LOGIN NOINHERIT; GRANT supabase_storage_admin TO gridex_role_probe WITH INHERIT FALSE, SET TRUE;"),
 ('provider_inherit_authenticator',"GRANT authenticator TO supabase_storage_admin WITH INHERIT TRUE;"),
 ('authenticator_inherit_service',"GRANT service_role TO authenticator WITH INHERIT TRUE;"),
 ('provider_direct_service',"GRANT service_role TO supabase_storage_admin WITH INHERIT FALSE, SET TRUE;"),
 ('provider_bypassrls',"ALTER ROLE supabase_storage_admin BYPASSRLS;"),
 ('authenticator_admin_option',"GRANT anon TO authenticator WITH ADMIN TRUE;"),
 ('provider_membership_removed',"REVOKE authenticator FROM supabase_storage_admin;")
)


def run():
    if len(sys.argv)!=1:raise ValueError('NO_TARGET_OR_SCOPE_ARGUMENTS_ACCEPTED')
    spec=importlib.util.spec_from_file_location('native_role_lifecycle',ROOT/'scripts/canonical-native-supabase-lifecycle.py')
    life=importlib.util.module_from_spec(spec);spec.loader.exec_module(life)
    retained=policy.retain(ROOT)
    text=retained.sql.decode()
    start='), principals AS (\n';end='), authority AS ('
    if text.count(start)!=1 or text.count(end)!=1:raise ValueError('EXACT_PRINCIPAL_QUERY_REQUIRED')
    principals='WITH principals AS (\n'+text.split(start)[1].split(end)[0]+') SELECT jsonb_agg(to_jsonb(p) ORDER BY rolname) FROM principals p;'
    if not provider.QUERY.startswith('BEGIN READ ONLY;\n') or not provider.QUERY.endswith('ROLLBACK;\n'):
        raise ValueError('EXACT_PROVIDER_QUERY_REQUIRED')
    body=provider.QUERY[len('BEGIN READ ONLY;\n'):-len('ROLLBACK;\n')]
    snapshot="SELECT jsonb_build_object('roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'bypass',rolbypassrls,'login',rolcanlogin,'inherit',rolinherit,'createdb',rolcreatedb,'createrole',rolcreaterole,'replication',rolreplication) ORDER BY rolname) FROM pg_roles),'edges',(SELECT jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'grantor',pg_get_userbyid(grantor),'admin',admin_option,'inherit',inherit_option,'set',set_option) ORDER BY roleid,member,grantor) FROM pg_auth_members));"
    original=life.check_container
    proofs=[]
    phase=['owner']
    def checked_impl(data,project,network):
        meta=original(data,project,network)
        if proofs:raise ValueError('NATIVE_ROLE_PROOF_ONCE_REQUIRED')
        # The local infrastructure owner is used only for rolled-back poison
        # fixtures, never for application migrations or production queries.
        def sql(query,expected_sqlstate=None):
            original(data,project,network)
            command=['docker','exec','-i','supabase_db_'+project,'psql','-XqAt','-w',
                     '-h','127.0.0.1','-p','5432','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
            result=subprocess.run(command,input=query.encode(),capture_output=True,timeout=30)
            if result.returncode:
                found=re.findall(rb'ERROR: +([A-Z0-9]{5}):',result.stderr)
                state=found[0].decode() if len(found)==1 else 'XXXXX'
                if expected_sqlstate is not None and state==expected_sqlstate:
                    return [dict(postgresRejectedSqlstate=state)]
                print(json.dumps(dict(stage='native_role_proof_sql_failure',phase=phase[0],sqlstate=state)),flush=True)
                raise ValueError('NATIVE_ROLE_PROOF_SQL_REQUIRED')
            if expected_sqlstate is not None:
                raise ValueError('NATIVE_ROLE_DATABASE_REJECTION_REQUIRED')
            return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        if sql("SELECT to_json(current_user='supabase_admin' AND inet_client_addr()='127.0.0.1'::inet AND rolsuper) FROM pg_roles WHERE rolname=current_user;")!=[True]:
            raise ValueError('NATIVE_ROLE_PROOF_OWNER_REQUIRED')
        phase[0]='baseline_capture'
        before=sql(snapshot)
        context,rows=sql('BEGIN READ ONLY;\n'+body+principals+'\nROLLBACK;')
        phase[0]='exact_native_context'
        digest=provider.validate(context)
        phase[0]='old_guard_rejection'
        try:policy.validate_role_graph(rows)
        except ValueError as error:
            if error.args!=('REMOVED_POLICY_ROLE_GRAPH_REQUIRED',):raise
        else:raise ValueError('PRISTINE_OLD_FAILURE_REQUIRED')
        phase[0]='new_guard_admission'
        policy.validate_role_graph(rows,context)
        rejected=[];database_rejected=[]
        for name,mutation in CASES:
            phase[0]=name
            # This reverse edge creates a cycle in the pristine provider chain.
            # PostgreSQL rejects it before a catalog state can be inspected; do
            # not misreport that as a successful Python-validator negative.
            if name=='authenticated_set_storage':
                if sql('BEGIN;\n'+mutation+'\nROLLBACK;',expected_sqlstate='0LP01')!=[dict(postgresRejectedSqlstate='0LP01')]:
                    raise ValueError('NATIVE_ROLE_DATABASE_REJECTION_REQUIRED')
                database_rejected.append(name)
            else:
                changed_context,changed_rows=sql('BEGIN;\n'+mutation+'\n'+body+principals+'\nROLLBACK;')
                try:policy.validate_role_graph(changed_rows,changed_context)
                except ValueError as error:
                    if error.args not in (('REMOVED_POLICY_ROLE_GRAPH_REQUIRED',),('REMOVED_POLICY_NATIVE_PROVIDER_CHAIN_REQUIRED',)):raise
                else:raise ValueError('NATIVE_ROLE_NEGATIVE_REJECTED_REQUIRED')
            if sql(snapshot)!=before:raise ValueError('NATIVE_ROLE_POISON_ROLLBACK_REQUIRED')
            restored_context,restored_rows=sql('BEGIN READ ONLY;\n'+body+principals+'\nROLLBACK;')
            policy.validate_role_graph(restored_rows,restored_context)
            if restored_context!=context or restored_rows!=rows:raise ValueError('NATIVE_ROLE_RECOVERY_REQUIRED')
            rejected.append(name)
        phase[0]='unrelated_unprivileged_login'
        final_context,final_rows=sql('BEGIN; CREATE ROLE gridex_role_probe LOGIN NOINHERIT;\n'+body+principals+'\nROLLBACK;')
        policy.validate_role_graph(final_rows,final_context)
        if sql(snapshot)!=before:raise ValueError('NATIVE_ROLE_POISON_ROLLBACK_REQUIRED')
        proofs.append(dict(scope='NATIVE_PROVIDER_ROLE_PROOF_NOT_RELEASE_ACCEPTANCE',
            sourceCommit='58dfddba6905ed797cb273e92e25d45893f08b64',image=meta['Config']['Image'],imageId=meta['Image'],
            pristineOldFailureReproduced=True,exactProviderChainSha256=digest,negativeCases=rejected,
            postgresRejectedCycles=database_rejected,validatorRejectedCaseCount=len(rejected)-len(database_rejected),
            rollbackAndRecoveryVerified=True,unrelatedUnprivilegedLoginAccepted=True,
            schemaAccepted=False,generatedTypesVerified=False,productionModified=False))
        return meta
    def checked(data,project,network):
        try:return checked_impl(data,project,network)
        except Exception as error:
            allowed={'NATIVE_ROLE_PROOF_ONCE_REQUIRED','NATIVE_ROLE_PROOF_SQL_REQUIRED',
                'NATIVE_ROLE_PROOF_OWNER_REQUIRED','PRISTINE_OLD_FAILURE_REQUIRED','NATIVE_ROLE_DATABASE_REJECTION_REQUIRED',
                'NATIVE_ROLE_NEGATIVE_REJECTED_REQUIRED','NATIVE_ROLE_POISON_ROLLBACK_REQUIRED',
                'NATIVE_ROLE_RECOVERY_REQUIRED','REMOVED_POLICY_ROLE_GRAPH_REQUIRED',
                'REMOVED_POLICY_NATIVE_PROVIDER_CHAIN_REQUIRED'}
            reason=error.args[0] if type(error) is ValueError and len(error.args)==1 and type(error.args[0]) is str and error.args[0] in allowed else 'UNCLASSIFIED'
            diagnostic=dict(scope='NATIVE_ROLE_PROOF_DIAGNOSTIC_NOT_ACCEPTANCE',phase=phase[0],reason=reason)
            (ROOT/'artifacts').mkdir(exist_ok=True)
            (ROOT/'artifacts/native-provider-role-diagnostic.json').write_text(json.dumps(diagnostic)+'\n')
            print(json.dumps(diagnostic),flush=True)
            raise
    life.check_container=checked
    rc=life.run_guarded()
    report=json.loads((ROOT/'artifacts/native-supabase-lifecycle.json').read_bytes())
    if rc or report.get('cleanupVerified') is not True or report.get('privateWorkspaceRemoved') is not True or len(proofs)!=1:
        raise ValueError('NATIVE_ROLE_PROOF_CLEANUP_REQUIRED')
    proof={**proofs[0], 'cleanupVerified':True,'privateWorkspaceRemoved':True}
    (ROOT/'artifacts/native-provider-role-proof.json').write_text(json.dumps(proof,sort_keys=True,indent=2)+'\n')
    print(json.dumps(proof,sort_keys=True),flush=True)
    return 0

if __name__=='__main__':
    try:raise SystemExit(run())
    except Exception:
        print('FAIL native provider role proof; no raw SQL or hosted target disclosed',file=sys.stderr)
        raise SystemExit(1) from None
