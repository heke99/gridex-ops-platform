"""Named actual57 and additional reduced whole-source characterization cases."""
import copy
import os
import signal
import time
from datetime import datetime, timezone


def cases():
    result = []
    def add(source,name,**options):
        result.append((source,name,options))
    for source in ('B0','C2','D2','F2'):
        add(source,'actual_guard',**{'no_U_boot' if source=='B0' else 'no_U_target':True},membership='none',error=True)
        if source == 'B0':
            add(source,'actual_missing_column_rejection',error=True,b0_dependency=True)
            add(source,'reduced_industry_only_next_dependency',reduced=True,b0_columns='industry',error=True,b0_dependency=True)
            add(source,'reduced_both_columns_success',reduced=True,repeat=True)
        else:
            add(source,'actual_success',membership='none' if source=='F2' else 'existing',repeat=True)
    for match in ('slug','organization','tie'):
        add('B0','reduced_match_'+match,reduced=True,match=match,repeat=True)
    add('B0','reduced_extension_guard',reduced=True,extension_absent=True,no_U_boot=True,error=True)
    for status in (False,True):
        for active in (False,True):
            missing = tuple(x for x,present in (('status',status),('is_active',active)) if not present)
            add('B0','reduced_role_flags_'+str(int(status))+str(int(active)),reduced=True,
                omit_columns={'public.user_roles':missing},repeat=True)
    for table in ('permissions','role_permissions','user_profiles','audit_logs'):
        omitted = ('public.'+table,)
        if table=='permissions':
            omitted += ('public.role_permissions',)
        add('B0','reduced_without_'+table,reduced=True,omit_tables=omitted)
    add('B0','reduced_without_system_flag',reduced=True,omit_columns={'public.roles':('is_system',)})
    add('B0','reduced_audit_without_company',reduced=True,omit_columns={'public.audit_logs':('company_id',)})
    add('C2','actual_stale_found_no_membership',membership='none',repeat=True)
    add('C2','actual_membership_collision',membership='collision',error=True)
    for source in ('C2','D2'):
        add(source,'reduced_actor_fk',reduced=True,actor_fk=True,no_U_actor=True,membership='none',error=True)
        for alias in ('email','invited_email','both'):
            add(source,'actual_invitation_'+alias,invitation=alias,repeat=True)
        add(source,'actual_accepted_expired_revoked',invitation='both',invitation_status='accepted',accepted=True,repeat=True)
        add(source,'actual_null_company_role',role_row='null_company',other_target_role=True)
        add(source,'actual_target_role_and_name_tie',role_row='target',role_name_tie=True,other_target_role=True)
        add(source,'reduced_membership_column_absent',reduced=True,membership='none',
            omit_columns={'public.company_memberships':('membership_role',)})
        for member in ('admin','member'):
            add(source,'reduced_enum_fallback_'+member,reduced=True,enum=('company_membership_role',(member,)),
                initial_member_value=member,member_value=member,omit_tables=('public.company_invitations',))
        add(source,'reduced_enum_no_label',reduced=True,enum=('company_membership_role',('viewer',)),
            initial_member_value='viewer',error=True,omit_tables=('public.company_invitations',))
        for missing in ('email','invited_email'):
            add(source,'reduced_invitation_without_'+missing,reduced=True,invitation='both',
                omit_columns={'public.company_invitations':(missing,)},error=source=='D2' and missing=='email')
        add(source,'reduced_invitation_without_aliases',reduced=True,
            omit_columns={'public.company_invitations':('email','invited_email')})
        add(source,'reduced_no_invitation_relation',reduced=True,omit_tables=('public.company_invitations',))
    add('C2','actual_email_priority_over_alias',invitation='email',second_alias=True)
    add('C2','actual_null_membership_user_rejected',membership='email_only',setup_error=True)
    add('C2','reduced_email_only_membership',reduced=True,membership='email_only',nullable=(('public.company_memberships','user_id'),))
    add('C2','reduced_missing_token_column',reduced=True,membership='none',omit_columns={'public.company_invitations':('token',)})
    add('C2','reduced_missing_token_default',reduced=True,membership='none',
        no_default=(('public.company_invitations','token'),),error=True)
    add('D2','actual_row_count_insert',membership='none',no_company=True,repeat=True)
    add('D2','actual_unrelated_blank_role',blank_role=True,role_row='null_text',repeat=True)
    add('D2','actual_no_invitation_insert',membership='none',repeat=True)
    add('D2','reduced_missing_expiry',reduced=True,omit_columns={'public.company_invitations':('expires_at',)},error=True)
    add('D2','reduced_invitation_enum_mismatch',reduced=True,invitation_enum=True,
        enum=('company_membership_role',('company_admin','member')),error=True)
    add('D2','reduced_optional_invitation_columns',reduced=True,invitation='both',
        omit_columns={'public.company_invitations':('metadata','invited_user_id','role_key','membership_role','accepted_at','updated_at')})
    for member in ('old','both'):
        add('F2','actual_'+member+'_membership',membership=member,error=member=='both',other_old=True)
    add('F2','actual_old_invitation',invitation='both',membership='old',other_old=True,repeat=True)
    add('F2','actual_old_roles_disabled',role_row='old',other_old=True,repeat=True)
    add('F2','actual_inconsistent_role_id',role_row='inconsistent',repeat=True)
    add('F2','actual_null_company_role_rejected',role_row='null_company',error=True)
    add('F2','reduced_null_company_role_moved',reduced=True,without_active_arbiters=True,role_row='null_company')
    add('F2','actual_null_email_guard',invitation='null_email',setup_error=True)
    add('F2','actual_null_invited_email_filled',invitation='null_invited_email')
    add('F2','reduced_null_email_filled',reduced=True,invitation='null_email',nullable=(('public.company_invitations','email'),))
    add('F2','actual_inserted_membership_role_id_null',membership='none')
    for alias in ('email','invited_email','both'):
        add('F2','actual_alias_'+alias,invitation=alias,repeat=True)
    for missing in (('email',),('invited_email',),('email','invited_email')):
        add('F2','reduced_add_alias_'+str(len(result)),reduced=True,invitation='both',
            omit_columns={'public.company_invitations':missing})
    add('F2','reduced_no_invitation_relation',reduced=True,omit_tables=('public.company_invitations',))
    add('F2','reduced_missing_memberships_early_cast',reduced=True,membership='none',
        omit_tables=('public.company_memberships',),error=True)
    for member in ('admin','owner','member'):
        add('F2','reduced_enum_fallback_'+member,reduced=True,enum=('company_membership_role',(member,)),
            initial_member_value=member,member_value=member)
    add('F2','reduced_enum_heuristic_unqualified',reduced=True,enum=('fixed_role',('company_admin','member')))
    add('F2','reduced_enum_no_label',reduced=True,enum=('company_membership_role',('viewer',)),
        initial_member_value='viewer',error=True)
    for source in ('C2','D2','F2'):
        add(source,'reduced_role_insert',reduced=True,no_role=True,membership='none',repeat=True)
    for source in ('D2','F2'):
        for failure in ('sentinel','backend','controller'):
            add(source,'actual_postcommit_'+failure,membership='none',durability=failure)
    return result


def expected(core, models, before, source, result, options, winner=None):
    oracle = models.Oracle(core,before,result.lower,result.upper)
    if source.key == 'B0':
        models.bootstrap(oracle,source,winner)
    elif source.key in ('C2','D2'):
        models.activate(oracle,source,options.get('member_value','company_admin'),
                        'membership_role' in oracle.columns('public.company_memberships'))
    else:
        # F2's native ALTERs add nullable aliases; exact new catalog fields are
        # specified independently and source-global alias backfill is modeled.
        if oracle.present('public.company_invitations'):
            columns = oracle.columns('public.company_invitations')
            for column in ('email','invited_email'):
                if column not in columns:
                    oracle.catalog['column/public.company_invitations/'+column] = {
                        'type':'text','notnull':False,'default':None,'identity':'','generated':'',
                        'collation':'"default"','acl':None}
                    for row in oracle.table('public.company_invitations'):
                        row[column] = None
        models.normalize(oracle,source,options.get('member_value','company_admin'))
    return oracle


def death(core, proof, source, database, kind):
    """Observe native COMMIT, kill only our child/backend, then re-observe rows."""
    label = 'fixed_private_'+source.key.lower()+'_'+kind
    lower = datetime.now(timezone.utc)
    child = os.fork()
    if child == 0:
        try:
            # This child's raw SQL remains in its private inherited memory.
            data = source.refresh()
            result = proof.run(database,"SET application_name='"+label+"';\n"+data.decode()+"\nSELECT pg_sleep(20);",transaction=False)
            os._exit(0 if result.code == 0 else 1)
        except BaseException:
            os._exit(2)
    try:
        deadline = time.monotonic()+15
        while True:
            raw = proof.query(database,"SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND application_name='"+label+"' AND wait_event='PgSleep' AND query='SELECT pg_sleep(20);';")
            if raw.strip():
                break
            core.check(time.monotonic() < deadline,'OWNED_POSTCOMMIT_NOT_OBSERVED')
            time.sleep(.1)
        committed = proof.snapshot(database)
        upper = datetime.now(timezone.utc)
        if kind == 'controller':
            os.kill(child,signal.SIGKILL)
        # An exact owned database/application label, never an arbitrary PID input.
        raw = proof.query(database,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND application_name='"+label+"' AND wait_event='PgSleep';")
        core.check(raw.strip() == 't','OWNED_BACKEND_DEATH_REQUIRED')
        _,status = os.waitpid(child,0)
        child = None
        if kind == 'controller':
            core.check(os.WIFSIGNALED(status) and os.WTERMSIG(status)==signal.SIGKILL,'CONTROLLER_SIGKILL_REQUIRED')
        else:
            core.check(os.WIFEXITED(status) and os.WEXITSTATUS(status)==1,'BACKEND_DEATH_REQUIRED')
        core.check(proof.snapshot(database) == committed,'NATIVE_COMMIT_DURABILITY_REQUIRED')
        return core.Result('','',1,'XXXXX',lower,upper),committed
    finally:
        if child is not None:
            try:
                os.kill(child,signal.SIGKILL)
                os.waitpid(child,0)
            except ProcessLookupError:
                pass


def run_case(core, models, fixtures, proof, source_key, name, options):
    print('RUN fixed-target '+source_key+' '+name,flush=True)
    source = core.Source(source_key)
    fixture = fixtures.Fixture(core,models,proof,source,name,options)
    database = fixture.database
    try:
        before = fixture.seed()
        if before is None:
            core.check(options.get('setup_error'),'UNEXPECTED_FIXTURE_REJECTION')
            print('PASS fixed-target '+source_key+' '+name+' native constructor rejection',flush=True)
            return
        repetitions = 2 if options.get('repeat') else 1
        for repetition in range(repetitions):
            suffix = "DO $$ BEGIN RAISE EXCEPTION 'private committed sentinel' USING ERRCODE='P0099'; END $$;" if options.get('durability')=='sentinel' else ''
            if options.get('durability') in ('backend','controller'):
                proof.identity(database)
                proof.graph(before[0])
                result,after = death(core,proof,source,database,options['durability'])
            else:
                result = proof.native(source,database,rollback=source_key in ('B0','C2'),suffix=suffix)
                after = proof.snapshot(database) if source_key in ('D2','F2') or result.code else core.decode_snapshot(result.stdout)
            print('RESULT fixed-target '+source_key+' '+name+' sqlstate='+result.state,flush=True)
            if options.get('error'):
                if options.get('b0_dependency'):
                    core.check('column' in result.stderr and any(column in result.stderr for column in ('industry','suspended_at')),'NATIVE_B0_DEPENDENCY_REQUIRED')
                    missing = {column for column,table in (('industry','public.companies'),('suspended_at','public.company_memberships')) if 'column/'+table+'/'+column not in before[0]}
                    core.check(missing==({'suspended_at'} if options.get('reduced') else {'industry','suspended_at'}),'B0_ACTUAL_CATALOG_ABSENCE_REQUIRED')
                verify_failure(core,result,source_key,name,options)
                core.check(proof.snapshot(database) == before,'NATIVE_FAILURE_PREIMAGE_REQUIRED')
            else:
                if options.get('durability')=='sentinel':
                    core.check(result.code != 0 and result.state=='P0099','POSTCOMMIT_SENTINEL_REQUIRED')
                elif not options.get('durability'):
                    core.check(result.code == 0 and result.state=='00000','WHOLE_SOURCE_SUCCESS_REQUIRED')
                winner = None
                if source_key=='B0' and options.get('match')=='tie':
                    # Native tie winner is deliberately unspecified. Admit only
                    # one of the original tied PKs, then verify ALL its fields.
                    old_companies = {row['id']:row for table,row in before[1] if table=='public.companies'}
                    changed = [row for table,row in after[1] if table=='public.companies' and row != old_companies.get(row['id'])]
                    core.check(len(changed)==1 and changed[0]['id'] in old_companies,'AMBIGUOUS_WINNER_REQUIRED')
                    candidates = [row for row in old_companies.values() if row.get('slug')==source.literal(209) or
                                  (row.get('org_number') or '').replace('-','')==source.literal(210,3)]
                    core.check(len(candidates)==2 and candidates[0]['created_at']==candidates[1]['created_at'] and
                               changed[0]['id'] in {row['id'] for row in candidates},'TIED_PK_WINNER_REQUIRED')
                    winner = changed[0]['id']
                expected(core,models,before,source,result,options,winner).assert_snapshot(after)
                if source_key in ('B0','C2'):
                    core.check(proof.snapshot(database)==before,'GENUINE_OUTER_ROLLBACK_REQUIRED')
                    # Repeat in the SAME outer transaction is handled below;
                    # executing after rollback alone is not an idempotence proof.
                    if repetitions==2:
                        repeat_rollback(core,models,proof,source,database,before,options,winner)
                        break
                else:
                    if source_key=='D2':
                        import re
                        notices = re.findall(r'membership rows touched: (\d+), user_role rows touched: (\d+), invitation rows touched: (\d+)',result.stderr)
                        if not options.get('durability'):
                            core.check(len(notices)==1,'PRIVATE_NOTICE_COUNT_REQUIRED')
                            core.check(tuple(map(int,notices[0]))==notice_counts(before,source),'EXACT_PRIVATE_NOTICE_COUNTS_REQUIRED')
                    before = after
        print('PASS fixed-target '+source_key+' '+name,flush=True)
    finally:
        proof.destroy(database)


def repeat_rollback(core,models,proof,source,database,before,options,winner):
    # Complete source executes twice, retaining source-assigned PKs between runs.
    proof.identity(database)
    whole = source.refresh()
    sql = b'BEGIN;\n'+whole+b'\n'+core.snapshot_sql().encode()+b'\n'+whole+b'\n'+core.snapshot_sql().encode()+b'\nROLLBACK;'
    result = proof.run(database,sql,transaction=False)
    core.check(result.code==0,'REPEATED_WHOLE_SOURCE_SUCCESS_REQUIRED')
    chunks = result.stdout.split('FIXED_CATALOG\n')
    core.check(len(chunks)==3,'REPEAT_PRIVATE_SNAPSHOTS_REQUIRED')
    first = core.decode_snapshot('FIXED_CATALOG\n'+chunks[1])
    second = core.decode_snapshot('FIXED_CATALOG\n'+chunks[2])
    expected(core,models,before,source,result,options,winner).assert_snapshot(first)
    expected(core,models,first,source,result,options,winner).assert_snapshot(second)
    core.check(proof.snapshot(database)==before,'REPEAT_OUTER_ROLLBACK_REQUIRED')


def notice_counts(before,source):
    rows = {}
    for table,row in before[1]:
        rows.setdefault(table,[]).append(row)
    s = source.slots
    company,user,email = s['C_target'],s['U_target'],s['email']
    roles = [row for row in rows['public.roles'] if (row.get('key') or row.get('name'))=='company_admin' or row.get('name') in ('company_admin','admin')]
    roles.sort(key=lambda row:0 if (row.get('key') or row.get('name'))=='company_admin' else 1 if row.get('name')=='company_admin' else 2)
    role = roles[0]['id'] if roles else object()
    memberships = sum(row['company_id']==company and (row['user_id']==user or (row.get('invited_email') or '').lower()==email.lower()) for row in rows.get('public.company_memberships',[]))
    assignments = sum(row['user_id']==user and row['company_id'] in (None,company) and (row['role_id']==role or row['role'] in (None,'company_admin')) for row in rows.get('public.user_roles',[]))
    invitations = sum(row['company_id']==company and email.lower() in ((row.get('email') or '').lower(),(row.get('invited_email') or '').lower()) for row in rows.get('public.company_invitations',[]))
    return max(1,memberships),max(1,assignments),invitations


def verify_failure(core,result,source_key,name,options):
    core.check(result.code != 0 and result.state not in ('00000','XXXXX'),'NATIVE_SOURCE_REJECTION_REQUIRED')
    if options.get('no_U_boot') or options.get('no_U_target'):
        core.check(result.state=='P0001','NATIVE_AUTH_GUARD_REQUIRED')
    elif options.get('membership') in ('both','collision') or options.get('role_row')=='null_company':
        core.check(result.state=='23505' and 'duplicate key value violates unique constraint' in result.stderr,'NATIVE_UNIQUE_GUARD_REQUIRED')
    elif options.get('actor_fk'):
        core.check('fixed_actor_fk' in result.stderr and result.state=='23503','NATIVE_ACTOR_FK_REQUIRED')
    elif name=='reduced_invitation_without_email' and source_key=='D2':
        core.check('falselower' in result.stderr,'NATIVE_MALFORMED_ALIAS_PREDICATE_REQUIRED')
    elif name=='reduced_missing_token_default':
        core.check('token' in result.stderr and 'violates not-null constraint' in result.stderr,'NATIVE_TOKEN_DEFAULT_REQUIRED')
    elif name=='reduced_missing_expiry':
        core.check('expires_at' in result.stderr and 'does not exist' in result.stderr,'NATIVE_MISSING_EXPIRY_REQUIRED')
    elif name=='reduced_missing_memberships_early_cast':
        core.check('company_memberships' in result.stderr and 'regclass' in result.stderr,'NATIVE_EARLY_REGCLASS_REQUIRED')
    elif name=='reduced_invitation_enum_mismatch':
        core.check('fixed_invitation_role' in result.stderr,'NATIVE_ENUM_ASSIGNMENT_REQUIRED')
    elif name=='reduced_enum_no_label':
        core.check('company_membership_role' in result.stderr or 'syntax error' in result.stderr,'NATIVE_ENUM_FALLBACK_REJECTION_REQUIRED')
