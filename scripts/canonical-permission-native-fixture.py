#!/usr/bin/env python3
"""Finite P28/F16/S24 plus settled-algebra source fixture; no external targets.

The SQL assertions below are test-only invoker functions, never auth substitutes.
Historical bodies/DDL/ACLs come solely from admitted source slices. Explicit
fixture SELECT/DML grants characterize policy semantics, not Data API reachability.
"""
from __future__ import annotations
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
NAME = '20260912052507_canonical_permission_overrides_and_storage_write_guards.sql'
CANDIDATE = ROOT / 'scripts/sql/forward-candidates' / NAME
SDD = ROOT / '.superpowers/sdd/2026-09-12-current-and-plan77-85/generated-migrations' / NAME


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'scripts' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


admission = load('canonical-permission-native-admission')


def uid(n):
    return f'00000000-0000-4000-8000-{n:012d}'


A, B = uid(1), uid(2)
UA, UB, UAB, NONE, PLATFORM, ADMIN = [uid(n) for n in range(11, 17)]
RA, RB, RP = [uid(n) for n in range(21, 24)]
CA, CA2, CB, SA, SB = [uid(n) for n in range(31, 36)]
KEYS = ['masterdata.read', 'masterdata.write', 'switching.read', 'switching.write', 'test.extra', 'admin.access']
PERMS = dict(zip(KEYS, [uid(n) for n in range(41, 47)]))


def lit(value):
    if value is None:
        return 'null'
    return "'" + str(value).replace("'", "''") + "'"


def check(expression, label):
    if not re.fullmatch('[A-Za-z0-9_-]+', label):
        raise ValueError('FINITE_ASSERTION_LABEL_REQUIRED')
    return f'select fixture.assert_true((select {expression}), {lit(label)});\n'


def as_role(actor=UAB, role='authenticated'):
    if role not in ('authenticated', 'anon', 'service_role'):
        raise ValueError('FIXTURE_ROLE_NOT_ADMITTED')
    return (f"set local role {role};\nset local request.jwt.claim.sub={lit(actor or '')};\n"
            + check(f"current_user={lit(role)} and auth.uid() is not distinct from {lit(actor)}::uuid", 'actor_identity')
            + check("not rolsuper and " + ('rolbypassrls' if role == 'service_role' else 'not rolbypassrls')
                    + f" from pg_roles where rolname={lit(role)}", 'actor_role_flags'))


def error(sql, state):
    return f'select fixture.expect_error({lit(sql)}, {lit(state)});\n'


def affected(sql, count):
    return f'with changed as ({sql} returning 1) select fixture.assert_true(count(*)={count},\'affected_rows\') from changed;\n'


def path(company=A, customer=CA, scope='customer', filename='source.pdf'):
    return f'companies/{company}/customers/{customer}/{scope}/power_of_attorney/{filename}'


PATH_A, PATH_B = path(), path(B, CB)
MUTABLE = ['auth.users', 'public.user_profiles', 'public.companies', 'public.company_memberships',
           'public.roles', 'public.user_roles', 'public.role_permissions', 'public.permissions',
           'public.user_permissions', 'public.user_permission_overrides', 'public.company_invitations',
           'public.canonical_platform_access_command_results', 'public.canonical_platform_access_audit_events',
           'storage.objects', 'storage.buckets', 'public.customers', 'public.customer_sites',
           'public.admin_users', 'public.company_capabilities', 'public.integration_api_clients',
           'auth.sessions', 'auth.refresh_tokens', 'vault.secrets', 'supabase_migrations.schema_migrations']


def snapshot():
    return 'jsonb_build_array(' + ','.join(
        f"(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from {table} t)"
        for table in MUTABLE) + ')'


def unchanged_begin():
    return 'reset role; create temporary table before_rows as select ' + snapshot() + ' as value;\n'


def unchanged_end():
    return 'reset role;\n' + check(snapshot() + '=(select value from before_rows)', 'unchanged_multisets')


def seed():
    sql = """
-- TEST-ONLY assertions: invoker, with finite errors, no authorization replacement.
create schema fixture;
revoke all on schema fixture from public;
grant usage on schema fixture to authenticated, anon, service_role;
create function fixture.assert_true(ok boolean, label text) returns void
language plpgsql security invoker as $$ begin
  if ok is distinct from true then raise exception using errcode='P0001',message=label; end if;
end $$;
create function fixture.expect_error(statement text, expected text) returns void
language plpgsql security invoker as $$ declare actual text; begin
  begin execute statement;
  exception when others then get stacked diagnostics actual=returned_sqlstate;
  end;
  if actual is distinct from expected then
    raise exception using errcode='P0001',message='expected_sqlstate_mismatch';
  end if;
end $$;
revoke all on all functions in schema fixture from public;
grant execute on all functions in schema fixture to authenticated, anon, service_role;
-- FIXTURE-ONLY SELECT grants: finite F16 policy subset and its invoker dependencies.
-- There is deliberately no access-table write or column write grant.
grant select on public.companies, public.company_memberships, public.company_invitations,
  public.user_roles, public.roles, public.permissions, public.role_permissions to authenticated;
-- FIXTURE-ONLY metadata DML: exercise exact admitted Storage policies, no object bytes/API.
grant select, insert, update, delete on storage.objects to authenticated, anon;
"""
    sql += f"insert into public.companies(id,name,slug,status) values ({lit(A)},'A','a','active'),({lit(B)},'B','b','active');\n"
    for i, actor in enumerate([UA, UB, UAB, NONE, PLATFORM, ADMIN]):
        sql += f"insert into auth.users(id,email,email_confirmed_at) values ({lit(actor)},'fixture{i}@example.invalid',now());\n"
        sql += f"insert into public.user_profiles(id,user_status) values ({lit(actor)},'active');\n"
    for role, key in [(RA, 'ordinary_a'), (RB, 'ordinary_b'), (RP, 'super_admin')]:
        sql += f"insert into public.roles(id,key,name,scope) values ({lit(role)},{lit(key)},{lit(key)},{lit('platform' if role==RP else 'company')});\n"
    for actor, company, role in [(UA,A,RA),(UB,B,RB),(UAB,A,RA),(UAB,B,RB)]:
        sql += f"insert into public.company_memberships(company_id,user_id,membership_role,role_id) values ({lit(company)},{lit(actor)},'operations',{lit(role)});\n"
        sql += f"insert into public.user_roles(user_id,company_id,role_id) values ({lit(actor)},{lit(company)},{lit(role)});\n"
    sql += f"insert into public.user_roles(user_id,role_id) values ({lit(PLATFORM)},{lit(RP)});\n"
    sql += f"insert into public.admin_users(user_id,role) values ({lit(ADMIN)},'super_admin');\n"
    for key, ident in PERMS.items():
        sql += f'insert into public.permissions(id,key,name) values ({lit(ident)},{lit(key)},{lit(key)});\n'
    for role, keys in [(RA,KEYS[:2]),(RB,KEYS[2:4]),(RP,KEYS[:4])]:
        for key in keys:
            sql += f'insert into public.role_permissions(role_id,permission_id) values ({lit(role)},{lit(PERMS[key])});\n'
    for customer, company in [(CA,A),(CA2,A),(CB,B)]:
        sql += f"insert into public.customers(id,company_id,first_name) values ({lit(customer)},{lit(company)},'fixture');\n"
    for site, company, customer in [(SA,A,CA),(SB,B,CB)]:
        sql += f'insert into public.customer_sites(id,company_id,customer_id) values ({lit(site)},{lit(company)},{lit(customer)});\n'
    for company in [A,B]:
        sql += f"insert into public.company_invitations(company_id,email) values ({lit(company)},'invite@example.invalid');\n"
    # The admitted bucket foundation sets customer-documents private.
    sql += "insert into storage.buckets(id,name,public) values ('fixture-other','fixture-other',false);\n"
    for name in [PATH_A, PATH_B]:
        sql += f"insert into storage.objects(bucket_id,name,metadata) values ('customer-documents',{lit(name)},'{{\"version\":1}}');\n"
    sql += check("not public from storage.buckets where id='customer-documents'", 'private_bucket')
    sql += check("count(*)=5 from pg_policy where polrelid='storage.objects'::regclass", 'exact_storage_policy_count')
    sql += check("count(*)=2 from pg_trigger where tgrelid='public.user_roles'::regclass and not tgisinternal", 'scope_trigger_count')
    sql += check("to_regclass('public.user_roles_company_user_single_active_uidx') is not null", 'single_role_constraint')
    return sql


def overrides(rows, actor=UAB):
    """rows: company, key, effect[, source SQL for valid_from/to/is_active]."""
    sql = ''
    for row in rows:
        company,key,effect,*rest=row
        extra=rest[0] if rest else 'null,null,true'
        sql += ('insert into public.user_permission_overrides(user_id,company_id,permission_key,effect,valid_from,valid_to,is_active) '
                f'values ({lit(actor)},{lit(company)},{lit(key)},{lit(effect)},{extra});\n')
    return sql


def direct(company=A, actor=UAB, key='test.extra', effect='allow', active=True, status='active', by_id=True):
    return ('insert into public.user_permissions(user_id,company_id,permission_id,permission_key,effect,is_active,status) '
            f'values ({lit(actor)},{lit(company)},{lit(PERMS[key] if by_id else None)},{lit(key)},{lit(effect)},{str(active).lower()},{lit(status)});\n')


def decision(key, want, company=A, actor=UAB, selected=None, authorized=True):
    want_sql = str(want).lower()
    selected = company if selected is None else selected
    expr = f'{lit(key)}=any(public.gridex_get_user_permissions_in_company({lit(actor)},{lit(company)}))'
    sql = 'reset role;\n' + check(f'({expr})={want_sql}', 'array_decision')
    sql += as_role(actor)
    sql += check(f'public.gridex_has_permission_in_company({lit(company)},{lit(key)})={want_sql}', 'target_wrapper')
    ctx = f'public.canonical_authenticated_tenant_context({lit(company)})'
    sql += check(f"({ctx}->>'authorized')::boolean={str(authorized).lower()}", 'context_admission')
    sql += check(f"coalesce(({ctx}->'permissions') ? {lit(key)},false)={want_sql}", 'context_decision')
    if authorized and selected != 'absent':
        sql += check(f"{ctx}->>'selected_company_id'={lit(selected)}", 'context_selection')
        sql += check(f"(select count(*)=7 from jsonb_object_keys({ctx}->'operation_policy'))", 'operation_metadata_seven')
    elif authorized:
        sql += check(f"{ctx}->>'selected_company_id' is null", 'context_no_selection')
    return sql + 'reset role;\n'


def shared(key, want, actor=UAB):
    return 'reset role;\n' + check(f"({lit(key)}=any(public.gridex_get_user_permissions({lit(actor)})))={str(want).lower()}", 'shared_decision')


def command(action='upsert_override', key='test.extra', effect='allow', actor=PLATFORM, extra=None, token='case'):
    data=dict(actor_user_id=actor,target_user_id=UAB,action=action,idempotency_key=token,permission_key=key,effect=effect)
    if extra:
        data.update(extra)
    return 'select public.canonical_manage_platform_user_access(' + lit(json.dumps(data)) + '::jsonb)'


def command_proof(cmd):
    return (as_role(PLATFORM,'service_role') + cmd + ';\nreset role;\n'
            + check('count(*)=1 from public.canonical_platform_access_command_results', 'command_result_written')
            + check('count(*)=1 from public.canonical_platform_access_audit_events', 'command_audit_written')
            + check('count(*)=1 from public.user_permission_overrides where company_id is null and is_active', 'override_written'))


def replacement_case(baseline=False):
    initial = command_proof(command(key='masterdata.write',effect='deny'))
    allow = command('replace_overrides',extra={'allow_permissions':['masterdata.write'],'deny_permissions':[]},token='replace-allow')
    if baseline:
        # The actual original command deletes, then fails to assign UNION text
        # NULL into company_id uuid. Its statement/subtransaction must roll back.
        return initial+unchanged_begin()+as_role(PLATFORM,'service_role')+error(allow,'42804')+unchanged_end()
    sql = initial+overrides([(B,'test.extra','deny')])
    replacements = [
        ('replace-allow',['masterdata.write'],[],True,False),
        ('replace-deny',[],['masterdata.write'],False,False),
        ('replace-mixed',['test.extra'],['masterdata.write'],False,True),
        ('replace-empty',[],[],True,False),
    ]
    for index,(token,allows,denies,masterdata,extra) in enumerate(replacements,2):
        cmd = command('replace_overrides',extra={'allow_permissions':allows,'deny_permissions':denies},token=token)
        sql += as_role(PLATFORM,'service_role')+cmd+';\nreset role;\n'
        expected = sorted([[key,'allow'] for key in allows]+[[key,'deny'] for key in denies])
        sql += check("coalesce(jsonb_agg(jsonb_build_array(permission_key,effect) order by permission_key,effect),'[]'::jsonb)="+lit(json.dumps(expected))+f"::jsonb from public.user_permission_overrides where user_id={lit(UAB)} and company_id is null",'replacement_rows_exact')
        sql += check(f"count(*)=1 from public.user_permission_overrides where user_id={lit(UAB)} and company_id={lit(B)} and permission_key='test.extra' and effect='deny' and is_active",'local_override_preserved')
        sql += check(f'count(*)={index} from public.canonical_platform_access_command_results','replacement_results_count')
        sql += check(f'count(*)={index} from public.canonical_platform_access_audit_events','replacement_audits_count')
        sql += decision('masterdata.write',masterdata)+decision('test.extra',extra)
        # A same-key replay returns the stored result with no audit/result/row
        # changes; a different request under that key rejects before mutation.
        sql += unchanged_begin()+as_role(PLATFORM,'service_role')
        sql += check(cmd.removeprefix('select ')+f"=(select result_payload from public.canonical_platform_access_command_results where target_user_id={lit(UAB)} and command_type='platform.user_access.replace_overrides' and idempotency_key={lit(token)})",'idempotent_result_stable')
        conflict = command('replace_overrides',extra={'allow_permissions':['switching.read'],'deny_permissions':[]},token=token)
        sql += error(conflict,'23505')+unchanged_end()+'drop table before_rows;\n'
    return sql


def permission_cases(baseline=False):
    cases = {}
    cases['P01'] = decision('masterdata.write', True,A)
    cases['P02'] = decision('masterdata.write', False,B)
    cases['P03'] = decision('switching.write', False,A)
    cases['P04'] = decision('switching.write', True,B)
    cases['P05'] = command_proof(command(key='masterdata.write',effect='deny')) + decision('masterdata.write',baseline)
    cases['P06'] = command_proof(command()) + decision('test.extra',not baseline)
    cases['P07'] = replacement_case(baseline)
    cases['P08'] = command_proof(command(key='masterdata.write',effect='deny')) + as_role(PLATFORM,'service_role') + command('clear_overrides',token='clear') + ';\nreset role;\n' + decision('masterdata.write',True)
    configs = [
        ('P09',[(A,'test.extra','allow')],'test.extra',True),
        ('P10',[(A,'masterdata.write','deny')],'masterdata.write',False),
        ('P11',[(B,'test.extra','allow')],'test.extra',False),
        ('P12',[(B,'masterdata.write','deny')],'masterdata.write',True),
        ('P13',[(None,'test.extra','deny'),(A,'test.extra','allow')],'test.extra',False),
        ('P14',[(None,'test.extra','allow'),(A,'test.extra','deny')],'test.extra',False),
        ('P15',[(None,'test.extra','allow'),(None,'test.extra','deny')],'test.extra',False),
        ('P16',[(None,'test.extra','deny'),(None,'test.extra','allow')],'test.extra',False),
        ('P17',[(None,'masterdata.write','deny','null,null,false')],'masterdata.write',True),
        ('P18',[(None,'masterdata.write','deny',"now()+interval '1 second',null,true")],'masterdata.write',True),
        ('P19',[(None,'masterdata.write','deny',"null,now()-interval '1 second',true")],'masterdata.write',True),
        ('P20',[(None,'masterdata.write','deny','now(),now(),true')],'masterdata.write',False),
    ]
    for label,rows,key,want in configs:
        cases[label]=overrides(rows)+decision(key,want)
    for label,change,selected in [
        ('P21',f"update public.company_memberships set status='removed',is_active=false where user_id={lit(UAB)} and company_id={lit(A)};",'absent'),
        ('P22',f"update public.user_roles set status='disabled',is_active=false where user_id={lit(UAB)} and company_id={lit(A)};",'absent'),
        ('P23',f"update public.roles set is_active=false where id={lit(RA)};",A),
        ('P24',f"delete from public.company_memberships where user_id={lit(UAB)};",'absent')]:
        cases[label]=overrides([(None,'test.extra','allow')])+change+'\n'+decision('test.extra',False,selected=selected)
    cases['P25'] = command_proof(command()) + unchanged_begin() + as_role(PLATFORM,'service_role') + error(command('replace_overrides',extra={'allow_permissions':['test.extra'],'deny_permissions':['test.extra']},token='overlap'),'23514') + error(command(key='unknown.key',token='unknown'),'22023') + unchanged_end()
    cases['P26'] = command_proof(command()) + unchanged_begin() + as_role(PLATFORM,'service_role') + error(command(actor=UAB,token='ordinary-actor'),'42501') + unchanged_end()
    cases['P27'] = 'reset role;\n'
    for actor in [PLATFORM,ADMIN]:
        cases['P27'] += check(f'public.canonical_actor_is_platform_admin({lit(actor)})','platform_authority') + shared('masterdata.read' if actor==PLATFORM else 'admin.access',True,actor) + as_role(actor) + check('public.gridex_user_is_platform_admin()','platform_current') + check("(public.canonical_authenticated_tenant_context(null)->>'is_platform_admin')::boolean",'platform_context') + 'reset role;\n'
    cases['P28'] = unchanged_begin() + error(f"insert into public.user_roles(user_id,company_id,role_id,role) values ({lit(NONE)},{lit(A)},{lit(RP)},'super_admin')",'23514') + error(f'insert into public.user_roles(user_id,role_id) values ({lit(NONE)},{lit(RA)})','23514') + unchanged_end()
    return {k:v for k,v in cases.items() if not baseline or k in ['P05','P06','P07']}


def algebra_cases():
    cases={}
    # Each grant mutation starts with real eligible context; no forbidden second role.
    for label,company,want in [('C01',A,True),('C02',B,False),('C03',None,True)]:
        cases[label]=direct(company)+decision('test.extra',want)
    for label,kwargs in [('C04',{'active':False}),('C05',{'status':'removed'}),('C06',{'effect':'deny'}),('C07',{'by_id':False}),('C08',{'effect':'unknown'})]:
        cases[label]=direct(**kwargs)+decision('test.extra',False)
    cases['C09']=direct(key='masterdata.write',effect='deny')+decision('masterdata.write',True)
    cases['C10']=f"update public.role_permissions set effect='deny' where role_id={lit(RA)} and permission_id={lit(PERMS['masterdata.write'])};\n"+direct(key='masterdata.write')+decision('masterdata.write',True)
    cases['C11']=f"update public.permissions set is_active=false where key='masterdata.write';\n"+decision('masterdata.write',True)+overrides([(None,'masterdata.write','deny')])+decision('masterdata.write',False)
    cases['C12']=f"update public.permissions set is_active=false where key='test.extra';\n"+overrides([(None,'test.extra','allow')])+decision('test.extra',True)
    cases['C13']=overrides([(A,'masterdata.write','deny')])+shared('masterdata.write',False)
    cases['C14']=overrides([(A,'test.extra','deny'),(B,'test.extra','allow')])+decision('test.extra',False,A)+decision('test.extra',True,B)+shared('test.extra',True)
    cases['C15']=overrides([(None,'test.extra','allow'),(A,'test.extra','deny')])+decision('test.extra',False,A)+decision('test.extra',True,B)+shared('test.extra',True)
    cases['C16']=overrides([(None,'test.extra','deny'),(A,'test.extra','allow')])+shared('test.extra',False)
    cases['C17']=direct(None,actor=NONE)+overrides([(None,'test.extra','allow')],actor=NONE)+decision('test.extra',False,actor=NONE,selected='absent')+shared('test.extra',False,NONE)
    cases['C18']=overrides([(None,'test.extra','allow')])+f"update public.company_memberships set is_active=false where user_id={lit(UAB)} and company_id={lit(A)};\n"+decision('test.extra',False,selected='absent')+shared('test.extra',True)
    cases['C19']=direct()+f"update public.user_roles set is_active=false where user_id={lit(UAB)} and company_id={lit(A)};\n"+decision('test.extra',False,selected='absent')
    cases['C20']=direct()+f"update public.roles set is_active=false where id={lit(RA)};\n"+decision('test.extra',False,selected=A)+as_role()+check("public.canonical_authenticated_tenant_context("+lit(A)+")->'roles'='[]'::jsonb",'inactive_definition_roles_empty')
    for label,change in [('C21',f"update public.user_profiles set user_status='disabled' where id={lit(UAB)};"),('C22',f'update auth.users set email_confirmed_at=null where id={lit(UAB)};'),('C23',f'update auth.users set banned_until=now()+interval \'1 day\' where id={lit(UAB)};'),('C24',f'delete from public.user_profiles where id={lit(UAB)};')]:
        cases[label]=direct()+overrides([(None,'test.extra','allow')])+change+'\n'+decision('test.extra',False,authorized=False)+shared('test.extra',False)
    cases['C25']=unchanged_begin()+error(f'insert into public.user_roles(user_id,company_id,role_id) values ({lit(UAB)},{lit(A)},{lit(RB)})','23505')+unchanged_end()+decision('masterdata.write',True)
    cases['C26']=f"update public.roles set is_active=false where id={lit(RP)};\n"+check(f'public.canonical_actor_is_platform_admin({lit(PLATFORM)})','platform_inactive_definition_authority')+shared('masterdata.read',False,PLATFORM)+as_role(PLATFORM)+check('public.gridex_user_is_platform_admin()','platform_definition_current')
    cases['C27']=f"update public.user_roles set is_active=false where user_id={lit(PLATFORM)};\n"+check(f'not public.canonical_actor_is_platform_admin({lit(PLATFORM)})','platform_inactive_assignment_no_authority')+shared('masterdata.read',False,PLATFORM)
    cases['C28']=overrides([(None,'masterdata.read','deny')],actor=PLATFORM)+shared('masterdata.read',False,PLATFORM)+check(f'public.canonical_actor_is_platform_admin({lit(PLATFORM)})','platform_deny_not_bypass')+as_role(PLATFORM)+check("public.canonical_authenticated_tenant_context(null)->'permissions' ? 'masterdata.read'",'platform_original_context_characterization')
    cases['C29']=overrides([(None,'test.extra','unknown')])+decision('test.extra',False)
    cases['C30']=overrides([(None,'test.extra','allow','now(),now(),true')])+decision('test.extra',True)
    cases['C31']=decision('masterdata.write',False,company=B,actor=UA,selected='absent')
    cases['C32']=direct(None)+overrides([(None,'test.extra','deny')])+decision('test.extra',False)
    return cases


def access_cases():
    cases={}
    for index,table in enumerate(['companies','company_memberships','user_roles','company_invitations']):
        own = 'id' if table=='companies' else 'company_id'
        positive = ''
        for actor,company in [(UA,A),(UB,B)]:
            positive += as_role(actor)+check(f'count(*)=1 from public.{table} where {own}={lit(company)}','access_select_own')
            positive += check(f'count(*)=0 from public.{table} where {own}={lit(B if company==A else A)}','access_select_foreign')+'reset role;\n'
        cases[f'F{index*4+1:02d}']=positive
        statements=[f"insert into public.{table} default values",f'update public.{table} set id=id',f'delete from public.{table}']
        for offset,(verb,statement) in enumerate(zip(['INSERT','UPDATE','DELETE'],statements),2):
            sql=positive+unchanged_begin()
            for actor in [UA,UB,PLATFORM]:
                sql+=as_role(actor)+check(f"not has_table_privilege(current_user,'public.{table}','{verb}')",'access_no_table_write')
                if verb!='DELETE':
                    sql+=check(f"not exists(select 1 from pg_attribute where attrelid='public.{table}'::regclass and attnum>0 and not attisdropped and has_column_privilege(current_user,attrelid,attnum,'{verb}'))",'access_no_column_write')
                sql+=error(statement,'42501')+'reset role;\n'
            cases[f'F{index*4+offset:02d}']=sql+unchanged_end()
    return cases


def storage_select(name, count):
    return check(f"count(*)={count} from storage.objects where bucket_id='customer-documents' and name={lit(name)}",'storage_visible_rows')


def storage_insert(name, allowed, bucket='customer-documents', upsert=False):
    stmt=f"insert into storage.objects(bucket_id,name,metadata) values ({lit(bucket)},{lit(name)},'{{\"version\":2}}')"
    if upsert:
        stmt+=" on conflict(bucket_id,name) do update set metadata=excluded.metadata"
    return affected(stmt,1) if allowed else error(stmt,'42501')


def storage_update(name, allowed, new_name=None):
    assignment='metadata=\'{"version":2}\'' if new_name is None else 'name='+lit(new_name)
    stmt=f"update storage.objects set {assignment} where bucket_id='customer-documents' and name={lit(name)}"
    return affected(stmt,1 if allowed else 0)


def storage_delete(name, allowed):
    return affected(f"delete from storage.objects where bucket_id='customer-documents' and name={lit(name)}",1 if allowed else 0)


def storage_cases(baseline=False):
    cases={}
    own=as_role(UA)+storage_select(PATH_A,1)+storage_select(PATH_B,0)
    cases['S01']=own
    cases['S02']=own+storage_insert(path(filename='new.pdf'),True)
    cases['S03']=own+storage_update(PATH_A,True)+check(f"metadata='{{\"version\":2}}'::jsonb from storage.objects where name={lit(PATH_A)}",'updated_metadata')
    cases['S04']=own+storage_delete(PATH_A,True)+storage_select(PATH_A,0)
    cases['S05']=unchanged_begin()+as_role(UB)+storage_select(PATH_B,1)+storage_select(PATH_A,0)+unchanged_end()
    cases['S06']=unchanged_begin()+as_role(UB)+storage_select(PATH_B,1)+storage_insert(path(filename='foreign.pdf'),False)+unchanged_end()
    cases['S07']=unchanged_begin()+as_role(UB)+storage_select(PATH_B,1)+storage_update(PATH_A,False)+unchanged_end()
    cases['S08']=unchanged_begin()+as_role(UB)+storage_select(PATH_B,1)+storage_delete(PATH_A,False)+unchanged_end()
    cases['S09']=unchanged_begin()+own+error(f"update storage.objects set name={lit(path(B,CB,filename='renamed.pdf'))} where name={lit(PATH_A)}",'42501')+unchanged_end()
    cases['S10']=unchanged_begin()+own+storage_insert(PATH_B,False,upsert=True)+unchanged_end()
    cases['S11']=f"update public.role_permissions set effect='deny' where role_id={lit(RB)} and permission_id={lit(PERMS['switching.write'])};\n"+unchanged_begin()+as_role(UAB)+storage_select(PATH_A,1)+storage_select(PATH_B,1)+check(f"public.gridex_has_permission_in_company({lit(A)},'masterdata.write')",'a_permission_control')+storage_insert(path(B,CB,filename='target-b.pdf'),False)+unchanged_end()
    cases['S12']=f"update public.role_permissions set effect='deny' where role_id={lit(RA)} and permission_id={lit(PERMS['masterdata.write'])};\n"+unchanged_begin()+as_role(UAB)+storage_select(PATH_A,1)+storage_select(PATH_B,1)+check(f"public.gridex_has_permission_in_company({lit(B)},'switching.write')",'b_permission_control')+storage_insert(path(filename='target-a.pdf'),False)+unchanged_end()
    paused=f"update public.companies set status='paused' where id={lit(A)};\n"
    cases['S13']=paused+unchanged_begin()+own+unchanged_end()
    for label,action in [('S14',storage_insert(path(filename='paused.pdf'),baseline)),('S15',storage_update(PATH_A,baseline)),('S16',storage_delete(PATH_A,baseline))]:
        cases[label]=paused+('' if baseline else unchanged_begin())+own+action+('' if baseline else unchanged_end())
    suspended=f"update public.companies set status='suspended' where id={lit(A)};\n"
    denied=lambda: storage_select(PATH_A,0)+storage_insert(path(filename='denied.pdf'),False)+storage_update(PATH_A,False)+storage_delete(PATH_A,False)
    cases['S17']=suspended+unchanged_begin()+as_role(UA)+denied()+unchanged_end()
    for label,change in [('S18',"is_active=false"),('S19',"status='removed'")]:
        cases[label]=f"update public.company_memberships set {change} where user_id={lit(UA)};\n"+unchanged_begin()+as_role(UA)+denied()+unchanged_end()
    cases['S20']=''
    for column,value in [('user_status',"'disabled'"),('disabled_at','now()')]:
        setup=f"update public.user_profiles set {column}={value} where id={lit(UA)};\n"
        cases['S20']+=setup+('' if baseline else unchanged_begin())+as_role(UA)+check('not public.gridex_is_current_session_allowed()','source_session_disabled')
        cases['S20']+=(storage_select(PATH_A,1)+storage_update(PATH_A,True) if baseline else denied()+unchanged_end()+"drop table before_rows;\n")
        cases['S20']+=f"reset role; update public.user_profiles set user_status='active',disabled_at=null where id={lit(UA)};\n"
    cases['S21']=unchanged_begin()+as_role(None,'anon')+denied()+unchanged_end()
    cases['S22']=paused+('' if baseline else unchanged_begin())+as_role(PLATFORM)+storage_select(PATH_A,1)+storage_insert(path(filename='platform-paused.pdf'),baseline)+storage_update(PATH_A,baseline)+storage_delete(PATH_A,baseline)+('' if baseline else unchanged_end())+f"reset role; update public.companies set status='active' where id={lit(A)};\n"+as_role(PLATFORM)+storage_insert(path(filename='platform-active.pdf'),True)
    malformed=[PATH_A.replace(A,'bad-uuid'),'/'+PATH_A,PATH_A+'/',PATH_A.replace('/customers/','//customers/'),PATH_A.replace('/power_of_attorney/','/bad-type/'),path(filename='../escape'),path(filename='.'),path(filename='bad name.pdf'),path(filename='a'*256),path(customer=CA2,scope='site-'+SA),path(scope='site-'+SB),path(A,CB),path(scope='other'),PATH_A+'/extra']
    cases['S23']=unchanged_begin()+own+check(f"gridex_private.customer_document_path_allows({lit(path(scope='site-'+SA))},'read')",'valid_site_path')
    for bad in malformed:
        cases['S23']+=check(f"not gridex_private.customer_document_path_allows({lit(bad)},'read')",'malformed_read_denied')+storage_insert(bad,False)
    cases['S23']+=check(f"not gridex_private.customer_document_path_allows({lit(PATH_A)},'unknown')",'invalid_access')+unchanged_end()
    cases['S24']=unchanged_begin()+own+storage_insert(path(filename='other-bucket.pdf'),False,'fixture-other')+unchanged_end()
    return cases


def storage_additional_cases(baseline=False):
    viewer=f"update public.company_memberships set membership_role='viewer' where user_id={lit(UA)};\n"
    cases={'S_VIEWER':viewer+('' if baseline else unchanged_begin())+as_role(UA)+storage_select(PATH_A,1)+check(f"public.gridex_has_permission_in_company({lit(A)},'masterdata.write')",'viewer_write_key_retained')+storage_insert(path(filename='viewer.pdf'),baseline)+('' if baseline else unchanged_end())}
    cases['S_UPSERT_OWN']=as_role(UA)+storage_select(PATH_A,1)+storage_insert(PATH_A,True,upsert=True)+check(f"metadata='{{\"version\":2}}'::jsonb from storage.objects where name={lit(PATH_A)}",'upsert_metadata')
    return cases


DIAGNOSTIC_SIGNATURE = 'public.canonical_get_platform_user_permission_diagnostic(uuid,uuid)'


def diagnostic_call(actor=PLATFORM, target=UAB):
    return f'public.canonical_get_platform_user_permission_diagnostic({lit(actor)}::uuid,{lit(target)}::uuid)'


def diagnostic_result(permissions, actor=PLATFORM, target=UAB):
    expected = json.dumps(dict(target_user_id=target, scope='shared_active_companies', permissions=permissions))
    call = diagnostic_call(actor, target)
    return (as_role(actor, 'service_role')
            + check(f"({call} - 'evaluated_at')={lit(expected)}::jsonb", 'diagnostic_result_exact')
            + check(f"({call}->>'evaluated_at')::timestamptz=now()", 'diagnostic_evaluated_at')
            + 'reset role;\n')


def diagnostic_cases():
    cases = {}
    cases['D01'] = unchanged_begin()+diagnostic_result(KEYS[:4])+unchanged_end()
    cases['D02'] = diagnostic_result([], target=NONE)
    cases['D03'] = as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(None), '22023')
    cases['D04'] = as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(target=None), '22023')
    cases['D05'] = f"update auth.users set deleted_at=now() where id={lit(UB)};\n"
    for target in [UAB, uid(999), UB]:
        cases['D05'] += as_role(UAB, 'service_role')+error('select '+diagnostic_call(UAB, target), '42501')
    changes = [
        f"update public.user_roles set is_active=false where user_id={lit(PLATFORM)};",
        f"update public.user_profiles set user_status='disabled' where id={lit(PLATFORM)};",
        f"delete from public.user_profiles where id={lit(PLATFORM)};",
        f"update auth.users set banned_until=now()+interval '1 day' where id={lit(PLATFORM)};",
        f"update auth.users set deleted_at=now() where id={lit(PLATFORM)};",
        f"delete from public.user_roles where user_id={lit(PLATFORM)};",
        f"update public.user_roles set status='disabled' where user_id={lit(PLATFORM)};",
    ]
    for index, change in enumerate(changes, 6):
        cases[f'D{index:02}'] = change+'\n'+unchanged_begin()+as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(), '42501')+unchanged_end()
    cases['D13'] = as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(actor=uid(999)), '42501')
    cases['D14'] = as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(target=uid(999)), 'P0002')
    cases['D15'] = f"update auth.users set deleted_at=now() where id={lit(UAB)};\n"+as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(), 'P0002')
    cases['D16'] = overrides([(A,'test.extra','deny'),(B,'test.extra','allow')])+decision('test.extra',False,A)+diagnostic_result(KEYS[:5])
    cases['D17'] = overrides([(None,'test.extra','deny'),(A,'test.extra','allow')])+diagnostic_result(KEYS[:4])
    # Test-only fault injection is transactional and rolled back with each case.
    replacement = "create or replace function public.gridex_get_user_permissions(p_user_id uuid) returns text[] language plpgsql stable security definer set search_path=public,auth,pg_temp as $fault$ begin %s end $fault$;\n"
    for label, body, state in [
        ('D18', "raise exception using errcode='22012',message='fixture_canonical_failure';", '22012'),
        ('D19', 'return null;', '22023'),
        ('D20', "return array['masterdata.read',null]::text[];", '22023'),
        ('D21', "return array['']::text[];", '22023'),
    ]:
        cases[label] = replacement % body + unchanged_begin()+as_role(PLATFORM, 'service_role')+error('select '+diagnostic_call(), state)+unchanged_end()
    cases['D22'] = f"update public.roles set is_active=false where id={lit(RP)};\n"+check(f'public.canonical_actor_is_platform_admin({lit(PLATFORM)})','diagnostic_c26_authority')+diagnostic_result([], target=PLATFORM)
    cases['D23'] = ''
    for role in ['anon', 'authenticated']:
        cases['D23'] += as_role(None if role == 'anon' else UAB, role)
        for target in [UAB, uid(999)]:
            cases['D23'] += error('select '+diagnostic_call(target=target), '42501')
        cases['D23'] += 'reset role;\n'
    cases['D24'] = ''
    for role in ['anon', 'authenticated', 'service_role']:
        cases['D24'] += as_role(None if role == 'anon' else PLATFORM, role)
        for call in [f'public.gridex_get_user_permissions({lit(UAB)})',
                     f'public.gridex_get_user_permissions_in_company({lit(UAB)},{lit(A)})',
                     f'gridex_private.effective_company_permissions({lit(UAB)},{lit(A)},now())']:
            cases['D24'] += error('select '+call, '42501')
        cases['D24'] += 'reset role;\n'
    cases['D25'] = diagnostic_result(['admin.access'], target=ADMIN)
    cases['D26'] = overrides([(None,'test.extra','allow','now(),now(),true')])+diagnostic_result(KEYS[:5])
    cases['D27'] = f"update public.admin_users set is_active=false where user_id={lit(ADMIN)};\n"+as_role(ADMIN, 'service_role')+error('select '+diagnostic_call(actor=ADMIN), '42501')
    return cases


PRIVATE_SIGNATURES=['gridex_private.effective_company_permissions(uuid,uuid,timestamptz)',
                    'gridex_private.platform_permissions(uuid,timestamptz)',
                    'public.gridex_get_user_permissions(uuid)',
                    'public.gridex_get_user_permissions_in_company(uuid,uuid)',
                    'public.canonical_authenticated_tenant_context_v1_scoped(uuid)']


def acl_assertions():
    sql=''
    for signature in PRIVATE_SIGNATURES:
        sql+=check("not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid="+lit(signature)+"::regprocedure and a.grantee<>p.proowner)",'private_owner_only')
    for role in ['authenticated','service_role']:
        sql+=check(f"has_function_privilege('{role}','gridex_private.customer_document_path_allows(text,text)','EXECUTE')",'storage_helper_executable')
    for role in ['anon','authenticated']:
        sql+=check(f"not has_function_privilege('{role}','public.canonical_manage_platform_user_access(jsonb)','EXECUTE')",'command_acl_private')
    sql+=check("has_function_privilege('authenticated','public.canonical_authenticated_tenant_context(uuid)','EXECUTE')",'context_rpc_acl')
    sql+=check("not has_function_privilege('anon','gridex_private.customer_document_path_allows(text,text)','EXECUTE')",'storage_anon_acl')
    for signature in PRIVATE_SIGNATURES:
        for role in ['anon', 'authenticated', 'service_role']:
            sql += check(f"not has_function_privilege('{role}',{lit(signature)},'EXECUTE')", 'internal_inherited_acl_denied')
    for role in ['anon', 'authenticated']:
        sql += check(f"not has_function_privilege('{role}',{lit(DIAGNOSTIC_SIGNATURE)},'EXECUTE')", 'diagnostic_inherited_acl_denied')
    sql += check(f"has_function_privilege('service_role',{lit(DIAGNOSTIC_SIGNATURE)},'EXECUTE')", 'diagnostic_service_execute')
    sql += check("count(*)=1 and bool_and(a.grantee='service_role'::regrole and a.privilege_type='EXECUTE' and not a.is_grantable) from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid="+lit(DIAGNOSTIC_SIGNATURE)+"::regprocedure and a.grantee<>p.proowner", 'diagnostic_only_explicit_service')
    sql += check("p.prosecdef and p.provolatile='s' and p.proconfig=array['search_path=public, auth, pg_temp'] and has_function_privilege(p.proowner,'public.gridex_get_user_permissions(uuid)','EXECUTE') from pg_proc p where p.oid="+lit(DIAGNOSTIC_SIGNATURE)+"::regprocedure", 'diagnostic_security_definer_contract')
    return sql


def catalog():
    return """select jsonb_build_object(
      'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_functiondef(p.oid),p.proacl,p.proowner) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','gridex_private','fixture') and p.prokind='f'),
      'policies',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,policyname) from pg_policies t where schemaname in ('public','storage')),
      'table_acl',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relacl,c.relrowsecurity,c.relforcerowsecurity) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and c.relkind='r'),
      'schema_acl',(select jsonb_agg(jsonb_build_array(nspname,nspacl,nspowner) order by nspname) from pg_namespace where nspname in ('public','gridex_private','fixture','storage','auth')),
      'indexes',(select jsonb_agg(to_jsonb(t) order by schemaname,tablename,indexname) from pg_indexes t where schemaname in ('public','storage')),
      'triggers',(select jsonb_agg(jsonb_build_array(tgname,pg_get_triggerdef(oid),tgenabled) order by tgrelid,tgname) from pg_trigger where not tgisinternal),
      'column_acl',(select jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attname,a.attacl) order by n.nspname,c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','storage') and a.attnum>0 and not a.attisdropped),
      'rows',"""+snapshot()+');'


def candidate():
    raw=CANDIDATE.read_bytes()
    manifest=json.loads(admission.MANIFEST.read_text())
    expected=manifest['forward_candidate']
    if expected['basename']!=NAME or admission.digest(raw)!=expected['sha256']:
        raise admission.AdmissionError('FORWARD_CANDIDATE_HASH_MISMATCH')
    receipt=json.loads((ROOT/'quality/audits/MIGRATION_SCAFFOLD_RECEIPT_2026-09-12.json').read_text())
    if receipt['cli_version']!='2.101.0' or receipt['provenance']['job']!=103504560679 or NAME not in [x['basename'] for x in receipt['migrations']]:
        raise admission.AdmissionError('FORWARD_SCAFFOLD_RECEIPT_MISMATCH')
    if SDD.exists() and SDD.read_bytes()!=raw:
        raise admission.AdmissionError('FORWARD_CANDIDATE_COPY_MISMATCH')
    return raw.decode()


def build_cases():
    groups={'P':permission_cases(),'C':algebra_cases(),'F':access_cases(),'S':storage_cases(),'SX':storage_additional_cases(),'D':diagnostic_cases()}
    if {k:len(v) for k,v in groups.items()}!={'P':28,'C':32,'F':16,'S':24,'SX':2,'D':27}:
        raise ValueError('FINITE_MATRIX_COUNT_MISMATCH')
    cases={name:body for group in groups.values() for name,body in group.items()}
    if len(cases)!=129 or any(not body for body in cases.values()):
        raise ValueError('FINITE_MATRIX_CASE_MISMATCH')
    return cases
