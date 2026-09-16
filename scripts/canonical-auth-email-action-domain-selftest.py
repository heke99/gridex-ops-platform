#!/usr/bin/env python3
"""Fixed PG17 action-domain fixture, not auth-provider/schema acceptance."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('auth_action_fixture_owner',ROOT/'scripts/canonical-composite-customer-fk-selftest.py')
fixture=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(fixture)
CANDIDATE=ROOT/'scripts/sql/forward-candidates/expand-auth-email-event-action-domain.sql'
CANDIDATE_SHA='69b8d5693f586209f37950be866e3f3dd8e5d910408c34ed9cb075daab85407c'
OLD_SOURCE='supabase/migrations/20260519_auth_callback_email_reset_sync.sql'
NEW_SOURCE='supabase/migrations/20260520_direct_temporary_password_auth_sync_fix.sql'
PINS={OLD_SOURCE:'59efbf233d314558f8cc7ffbb2b15788cadaaf7ba476e0f80fa1e820299419a9',
 NEW_SOURCE:'f81c427325e8ecdb9380038ebad994def06004f1a67cd6b7718247e090b632db',
 'supabase/migrations/20260910140053_canonical_auth_provisioning_legacy_boundary.sql':'fcc6594b1b312e139ac094b811fee9395ee6ab780144d14d1c19e0c178a28983',
 'scripts/sql/canonical-auth-provisioning-legacy-admission.sql':'164298b223d28d7fb28cb0d96189892da2dbbca04dc354ae39302ed58645afa5'}
OLD=('invite_sent','password_reset_sent','confirmation_sent','email_confirmed','password_updated','auth_callback_completed','auth_callback_failed')
ADDED=('email_action_verified','company_invitation_accepted','direct_user_created','direct_user_linked')
NEW=OLD+ADDED
OBSERVED_CHECK_SHA='b14da2bb4421f49b889f1e5c740f1a1cd376392401ec863a89a787d067ab9083'


def read_candidate(path=CANDIDATE):
    path=Path(path).absolute()
    if path.resolve()!=path or not path.is_file() or fixture.sha(path.read_bytes())!=CANDIDATE_SHA:
        raise ValueError('EXACT_AUTH_ACTION_CANDIDATE_REQUIRED')
    return path.read_text()


def check_row(values):
    return dict(nspname='public',relname='auth_email_events',conname='auth_email_events_action_check',
                contype='c',convalidated=True,
                definition='CHECK (action = ANY (ARRAY['+', '.join("'"+v+"'::text" for v in values)+']))')


def selection():
    candidate=read_candidate()
    sources={name:fixture.read_pinned(ROOT/name,digest) for name,digest in PINS.items()}
    for source,values in ((OLD_SOURCE,OLD),(NEW_SOURCE,NEW)):
        match=fixture.exactly_one(r'add constraint auth_email_events_action_check\s+check \(action in \((.*?)\)\)',sources[source])
        if tuple(re.findall(r"'([^']+)'",match))!=values:
            raise ValueError('EXACT_AUTH_ACTION_SOURCE_DOMAIN_REQUIRED')
    if (fixture.sha(check_row(OLD))!=OBSERVED_CHECK_SHA
        or 'INSERT INTO pg_temp.legacy_event_checks SELECT conname,pg_get_constraintdef(oid,false)' not in sources['scripts/sql/canonical-auth-provisioning-legacy-admission.sql']
        or 'FOR r IN SELECT name,definition FROM pg_temp.legacy_event_checks ORDER BY name LOOP' not in sources['supabase/migrations/20260910140053_canonical_auth_provisioning_legacy_boundary.sql']):
        raise ValueError('EXACT_AUTH_ACTION_RETAINED_BOUNDARY_REQUIRED')
    return candidate


def action_check():
    return json.loads(fixture.sql("""select coalesce((select jsonb_build_object('oid',c.oid,'relationOid',c.conrelid,
      'row',jsonb_build_object('nspname','public','relname','auth_email_events','conname',c.conname,
        'contype',c.contype::text,'convalidated',c.convalidated,'definition',pg_get_constraintdef(c.oid,true)))
      from pg_constraint c where c.conrelid=to_regclass('public.auth_email_events')
        and c.conname='auth_email_events_action_check'),'null'::jsonb);"""))


def state():
    catalog=json.loads(fixture.sql("""select jsonb_build_object(
      'relations',(select jsonb_agg(jsonb_build_array(c.oid,n.nspname,c.relname,c.relkind,c.relowner,
        c.relrowsecurity,c.relforcerowsecurity,c.reloptions,obj_description(c.oid,'pg_class')) order by c.oid)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','control')),
      'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace) and a.attnum>0),
      'columnDefaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_attrdef d join pg_class c on c.oid=d.adrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace)),
      'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
      'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c
        where c.connamespace in ('public'::regnamespace,'control'::regnamespace)),
      'indexes',(select jsonb_agg(to_jsonb(i) order by i.indexrelid) from pg_index i join pg_class c on c.oid=i.indrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace)),
      'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace in ('public'::regnamespace,'control'::regnamespace)),
      'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
        where p.pronamespace in ('public'::regnamespace,'control'::regnamespace)),
      'schemas',(select jsonb_agg(to_jsonb(n) order by n.oid) from pg_namespace n where n.nspname in ('public','control')),
      'defaults',(select jsonb_agg(to_jsonb(d) order by d.oid) from pg_default_acl d),
      'roles',(select jsonb_agg(to_jsonb(r) order by r.oid) from pg_roles r),
      'memberships',(select jsonb_agg(to_jsonb(m) order by m.roleid,m.member,m.grantor) from pg_auth_members m));"""))
    acl=json.loads(fixture.sql("""select coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,
      pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type,a.is_grantable) order by n.nspname,c.relname,a.grantor,a.grantee,a.privilege_type),'[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where n.nspname in ('public','control') and c.relkind in ('r','v');"""))
    relations=json.loads(fixture.sql("""select jsonb_agg(jsonb_build_array(n.nspname,c.relname) order by n.nspname,c.relname)
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','control') and c.relkind in ('r','v');"""))
    rows={}
    for schema,table in relations:
        if not re.fullmatch('[a-z_]+',schema) or not re.fullmatch('[a-z_]+',table):
            raise ValueError('FIXTURE_IDENTIFIER_REQUIRED')
        rows[schema+'.'+table]=json.loads(fixture.sql(f"select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from {schema}.{table} t;"))
    return dict(catalog=catalog,acl=acl,rows=rows,actionCheck=action_check())


def verify_delta(before,after):
    for state_value,values in ((before,OLD),(after,NEW)):
        check=state_value.get('actionCheck')
        if not check or check['row']!=check_row(values):raise ValueError('EXACT_AUTH_ACTION_DELTA_REQUIRED')
    left,right=copy.deepcopy(before),copy.deepcopy(after)
    for value in (left,right):
        check=value.pop('actionCheck')
        constraints=value['catalog']['constraints']
        selected=[r for r in constraints if r['oid']==check['oid']]
        if len(selected)!=1 or selected[0]['conrelid']!=check['relationOid']:
            raise ValueError('EXACT_AUTH_ACTION_DELTA_REQUIRED')
        # Only the recreated CHECK's OID and parsed expression may change.
        selected_row=selected[0]
        selected_row.pop('oid');selected_row.pop('conbin')
        value['catalog']['constraints']=[r for r in constraints if r is not selected_row]
        value['selectedConstraintMetadata']=selected_row
    if left!=right:raise ValueError('EXACT_AUTH_ACTION_DELTA_REQUIRED')


def setup():
    fixture.sql("""create schema control; grant usage on schema public,control to authenticated,service_role,anon;
      create table public.auth_email_events(id integer primary key,user_id uuid,email text,action text not null,
        status text not null default 'sent' check(status in ('sent','failed','verified','created','accepted')),
        marker text,company_id uuid,metadata jsonb not null default '{}'::jsonb);
      alter table public.auth_email_events enable row level security;
      create policy synthetic_deny on public.auth_email_events to authenticated,anon using(false) with check(false);
      create policy synthetic_service on public.auth_email_events to service_role using(true) with check(true);
      grant all on public.auth_email_events to authenticated,service_role;
      grant select on public.auth_email_events to anon;
      grant select(marker) on public.auth_email_events to service_role;
      comment on table public.auth_email_events is 'limited action-domain fixture';
      create index fixture_action_idx on public.auth_email_events(action);
      create table public.outside_auth_action(id integer primary key,marker text);
      insert into public.outside_auth_action values(1,'outside');
      grant select on public.outside_auth_action to public;
      create table control.auth_email_events(id integer primary key,action text constraint auth_email_events_action_check check(action='outside'));
      insert into control.auth_email_events values(1,'outside');""")
    fixture.sql('alter table public.auth_email_events add constraint auth_email_events_action_check '+check_row(OLD)['definition']+';')
    for index,value in enumerate(OLD,1):
        fixture.sql(f"insert into public.auth_email_events(id,action,marker,metadata) values({index},'{value}','retained','{{\"seed\":{index}}}');")
    if action_check()['row']!=check_row(OLD):raise ValueError('OBSERVED_SEVEN_ACTION_CHECK_REQUIRED')


def rejected(candidate,setup_sql,restore_sql):
    fixture.sql(setup_sql);before=state()
    fixture.sql(candidate,expected='55000')
    if state()!=before:raise ValueError('REJECTED_AUTH_ACTION_CANDIDATE_MUST_BE_ATOMIC')
    fixture.sql(restore_sql)


def verify_forward_postcondition(expected):
    from canonical_native_forward_runtime import assertion
    if fixture.sql('select ('+assertion(8)+');') != ('t' if expected else 'f'):
        raise ValueError('FORWARD_POSTCONDITION_REQUIRED')

def run():
    if sys.argv[1:] not in ([],['--selection-only']):raise ValueError('NO_EXTERNAL_TARGET_OR_SQL_OPTIONS')
    candidate=selection()
    if sys.argv[1:]:
        print(json.dumps(dict(scope='SELECTION_ONLY_NOT_SQL',candidateSha256=CANDIDATE_SHA,
          observedActionCheckSha256=OBSERVED_CHECK_SHA,intendedActionCheckSha256=fixture.sha(check_row(NEW)),
          oldValueCount=7,newValueCount=11)))
        return
    if fixture.sql("select current_user='postgres' and current_setting('server_version_num')::int between 170000 and 179999",admin=True)!='t':
        raise ValueError('FIXED_PG17_REQUIRED')
    if fixture.sql(f"select count(*) from pg_database where datname='{fixture.DATABASE}'",admin=True)!='0':
        raise ValueError('PREEXISTING_DATABASE_REFUSED')
    if fixture.sql("select count(*)=3 and bool_and(not rolsuper and not rolbypassrls and not rolcanlogin) from pg_roles where rolname in ('authenticated','service_role','anon')",admin=True)!='t':
        raise ValueError('FIXED_NONBYPASS_ROLES_REQUIRED')
    with fixture.owned_database():
        setup();verify_forward_postcondition(False);before=state()
        for value in ADDED:
            fixture.sql(f"begin; set local role service_role; insert into public.auth_email_events(id,action) values(100,'{value}'); rollback;",expected='23514')
            if state()!=before:raise ValueError('OLD_DOMAIN_REJECTION_PRESERVATION_REQUIRED')
        rejected(candidate,'alter table public.auth_email_events rename to absent_target;',
                 'alter table public.absent_target rename to auth_email_events;')
        rejected(candidate,'alter table public.auth_email_events rename to original_target; create view public.auth_email_events as select * from public.original_target;',
                 'drop view public.auth_email_events; alter table public.original_target rename to auth_email_events;')
        rejected(candidate,'alter table public.auth_email_events disable row level security;',
                 'alter table public.auth_email_events enable row level security;')
        rejected(candidate,'alter table public.auth_email_events force row level security;',
                 'alter table public.auth_email_events no force row level security;')
        rejected(candidate,"alter table public.auth_email_events alter column action set default 'invite_sent';",
                 'alter table public.auth_email_events alter column action drop default;')
        rejected(candidate,'alter table public.auth_email_events alter column action type varchar;',
                 'alter table public.auth_email_events drop constraint auth_email_events_action_check; alter table public.auth_email_events alter column action type text; alter table public.auth_email_events add constraint auth_email_events_action_check '+check_row(OLD)['definition']+';')
        old='alter table public.auth_email_events add constraint auth_email_events_action_check '+check_row(OLD)['definition']
        drop='alter table public.auth_email_events drop constraint auth_email_events_action_check;'
        rejected(candidate,drop,old+';')
        rejected(candidate,drop+old+' not valid;','alter table public.auth_email_events validate constraint auth_email_events_action_check;')
        unknown=check_row(NEW+('unknown_expansion',))['definition']
        rejected(candidate,drop+'alter table public.auth_email_events add constraint auth_email_events_action_check '+unknown+';',drop+old+';')
        rejected(candidate,'alter table public.auth_email_events add constraint extra_action_check check(length(action)>0);',
                 'alter table public.auth_email_events drop constraint extra_action_check;')
        rejected(candidate,"comment on constraint auth_email_events_action_check on public.auth_email_events is 'unreviewed';",
                 'comment on constraint auth_email_events_action_check on public.auth_email_events is null;')
        before=state()
        if candidate.count('\ncommit;\n')!=1:raise ValueError('FIXED_ATOMICITY_POINT_REQUIRED')
        injected=candidate.replace('\ncommit;\n',"\ndo $fault$ begin raise exception using errcode='ZX001',message='fixture rollback'; end $fault$;\ncommit;\n")
        fixture.sql(injected,expected='ZX001')
        if state()!=before:raise ValueError('POST_DDL_ROLLBACK_REQUIRED')
        fixture.sql(candidate);after=state();verify_delta(before,after);verify_forward_postcondition(True)
        for value,expected in (("'unknown_action'",'23514'),('null','23502')):
            fixture.sql(f'begin; set local role service_role; insert into public.auth_email_events(id,action) values(100,{value}); rollback;',expected=expected)
            if state()!=after:raise ValueError('INVALID_ACTION_MUST_PRESERVE_STATE')
        for value in (OLD[0],ADDED[0]):
            fixture.sql(f"begin; set local role authenticated; insert into public.auth_email_events(id,action) values(100,'{value}'); rollback;",expected='42501')
            if state()!=after:raise ValueError('RLS_DENIAL_MUST_PRESERVE_STATE')
        values=','.join(f"({100+i},'{value}')" for i,value in enumerate(NEW))
        answer=fixture.sql("begin; set local role service_role; insert into public.auth_email_events(id,action) values "+values+"; select count(*)=18 from public.auth_email_events; update public.auth_email_events set marker='updated' where id>=100; select count(*)=11 from public.auth_email_events where marker='updated'; delete from public.auth_email_events where id>=100; select count(*)=7 from public.auth_email_events; rollback;")
        if answer!='t\nt\nt' or state()!=after:raise ValueError('ALL_ELEVEN_ACTIONS_AND_SERVICE_DML_REQUIRED')
        fixture.sql(candidate)
        if state()!=after:raise ValueError('REPEAT_MUST_PRESERVE_CONSTRAINT_IDENTITY')
    print(json.dumps(dict(scope='LIMITED_PG17_AUTH_EMAIL_ACTION_DOMAIN_FIXTURE',candidateSha256=CANDIDATE_SHA,
      sourcePins=PINS,observedActionCheckSha256=OBSERVED_CHECK_SHA,intendedActionCheckSha256=fixture.sha(check_row(NEW)),
      oldValueCount=7,newValueCount=11,oldDomainRejectsAddedValues=True,allSourceValuesAccepted=True,
      invalidValueSqlstate='23514',nullValueSqlstate='23502',clientInsertSqlstate='42501',
      exactConstraintDeltaVerified=True,otherCatalogAclPoliciesRowsPreserved=True,serviceDmlVerified=True,
      shapeRejectionsVerified=True,postDdlRollbackVerified=True,repeatVerified=True,cleanupVerified=True,
      actualAuthHelpersVerified=False,providerEmailDeliveryVerified=False,schemaAccepted=False,productionModified=False)))


if __name__=='__main__':
    try:run()
    except Exception:
        print('FAIL bounded auth email action domain qualification; no raw SQL or data published',file=sys.stderr)
        raise SystemExit(1) from None
