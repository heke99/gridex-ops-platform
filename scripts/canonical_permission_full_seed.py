"""Full-clone rollback seed for the existing 129 permission decisions.
Only fixture identity/default adaptations; no production ACL or trigger changes.
"""
import hashlib,importlib.util,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
PINS={'scripts/canonical-permission-native-fixture.py': '47425b626551df891f6b13c86390ac9b23239cbe26a3651558572778eceab3a8', 'scripts/canonical-permission-native-admission.py': '515ddf6365f1c8a220f3f4ed5a5372f92c41ed702af70f0a57f3147acd20a216', 'scripts/sql/canonical-permission-native-sources.json': '3a020477332e330d5475fe237bd9ba61ed45d5777be22c1a8d4eec5577302830', 'scripts/canonical_changed_function_witness.py': 'a1eff86d0efecc058af45dc54411bb9056bc4cd96e7fa5b057374ee8cdefcce3', 'supabase/migrations/20260909120200_canonical_role_permission_identity_reconstruction.sql': '03bec0a08fb0852bf7cdad8c96f01fe509bd6a7c970793a6db2fd4230c49dca1'}

def sha(raw):return hashlib.sha256(raw).hexdigest()

def retain(root=ROOT):
    records=[]
    for path,digest in PINS.items():
        p=Path(root)/path
        if p.resolve()!=p or not p.is_file() or sha(p.read_bytes())!=digest:
            raise ValueError('PERMISSION_FULL_SEED_SOURCE_REQUIRED')
        records.append((path,p.read_bytes()))
    return tuple(records)

def contract(retained):
    if (type(retained) is not tuple or len(retained)!=len(PINS)
        or tuple(p for p,r in retained)!=tuple(PINS)
        or any(type(raw) is not bytes or sha(raw)!=PINS[p] for p,raw in retained)):
        raise ValueError('PERMISSION_FULL_SEED_SOURCE_REQUIRED')
    # The imported fixture must be the same pinned original, never caller-supplied code.
    for path, raw in retained:
        if path.startswith('scripts/'):
            live=ROOT/path
            if live.resolve()!=live or not live.is_file() or live.read_bytes()!=raw:
                raise ValueError('PERMISSION_FULL_SEED_SOURCE_REQUIRED')

def fixture(retained):
    contract(retained)
    path=ROOT/'scripts/canonical-permission-native-fixture.py'
    spec=importlib.util.spec_from_file_location('permission_full_seed_fixture',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def identity_query():
    return """SELECT jsonb_build_object('roles',(SELECT coalesce(jsonb_agg(jsonb_build_object(
 'id',id,'key',key,'scope',scope,'active',coalesce(is_active,true))),'[]'::jsonb)
 FROM public.roles WHERE key='super_admin'),
 'permissions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'key',key)),'[]'::jsonb)
 FROM public.permissions WHERE key IN ('masterdata.read','masterdata.write','switching.read','switching.write','test.extra','admin.access')));"""

def resolve_identities(retained,document):
    f=fixture(retained)
    if type(document) is not dict or set(document)!={'roles','permissions'}:
        raise ValueError('PERMISSION_FULL_IDENTITY_REQUIRED')
    roles=document['roles'];permissions=document['permissions']
    if (type(roles) is not list or len(roles)!=1 or type(roles[0]) is not dict
        or set(roles[0])!={'id','key','scope','active'} or roles[0]['key']!='super_admin'
        or roles[0]['scope']!='platform' or roles[0]['active'] is not True):
        raise ValueError('PERMISSION_FULL_PLATFORM_ROLE_REQUIRED')
    if type(permissions) is not list or any(type(x) is not dict or set(x)!={'id','key'} or x['key'] not in f.KEYS for x in permissions):
        raise ValueError('PERMISSION_FULL_IDENTITY_REQUIRED')
    if len({x['key'] for x in permissions})!=len(permissions):raise ValueError('PERMISSION_FULL_IDENTITY_REQUIRED')
    ids=[roles[0]['id'],*[x['id'] for x in permissions]]
    if any(type(x) is not str or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',x) for x in ids):
        raise ValueError('PERMISSION_FULL_IDENTITY_REQUIRED')
    if len(set(ids))!=len(ids):raise ValueError('PERMISSION_FULL_IDENTITY_REQUIRED')
    return dict(platformRole=roles[0]['id'],permissions={**f.PERMS,**{x['key']:x['id'] for x in permissions}})

def adapted_fixture(retained,document):
    original=fixture(retained);adapted=fixture(retained)
    identities=resolve_identities(retained,document)
    adapted.RP=identities['platformRole'];adapted.PERMS=identities['permissions']
    original_cases=original.build_cases();adapted_cases=adapted.build_cases()
    substitutions={original.RP:adapted.RP,**{original.PERMS[k]:adapted.PERMS[k] for k in original.KEYS}}
    for label,body in original_cases.items():
        expected=body
        # Each source UUID is disjoint; placeholders prevent accidental cascading replacements.
        for i,(old,new) in enumerate(substitutions.items()):expected=expected.replace(old,'FULL_IDENTITY_'+str(i))
        for i,(old,new) in enumerate(substitutions.items()):expected=expected.replace('FULL_IDENTITY_'+str(i),new)
        if adapted_cases.get(label)!=expected:raise ValueError('PERMISSION_FULL_DECISION_BODY_CHANGED')
    if len(adapted_cases)!=129 or set(adapted_cases)!=set(original_cases):
        raise ValueError('PERMISSION_FULL_CASE_SCOPE_REQUIRED')
    return adapted,adapted_cases

def seed(retained,document):
    f,cases=adapted_fixture(retained,document);lit=f.lit
    # Keep only the original fixture-owned assertion schema/functions and their grants.
    prefix=f.seed().split('-- FIXTURE-ONLY SELECT grants:')[0]
    if not prefix.endswith('grant execute on all functions in schema fixture to authenticated, anon, service_role;\n'):
        raise ValueError('PERMISSION_FULL_HELPERS_REQUIRED')
    sql=prefix
    sql+="create table fixture.baseline_counts as select (select count(*) from public.canonical_platform_access_command_results) as commands, (select count(*) from public.canonical_platform_access_audit_events) as audits, (select count(*) from public.user_permission_overrides where company_id is null and is_active) as overrides;\n"
    sql+="grant select on fixture.baseline_counts to authenticated, anon, service_role;\n"
    sql+=f"insert into public.companies(id,name,slug,status,lifecycle_status) values ({lit(f.A)},'A','permission-full-fixture-a','active','active'),({lit(f.B)},'B','permission-full-fixture-b','active','active');\n"
    for i,actor in enumerate([f.UA,f.UB,f.UAB,f.NONE,f.PLATFORM,f.ADMIN]):
        email='permission-full-fixture'+str(i)+'@example.invalid'
        sql+=f"insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values ({lit(actor)},'authenticated','authenticated',{lit(email)},now(),'{{}}','{{}}');\n"
        sql+=f"insert into public.user_profiles(id,email,user_status,auth_email_confirmed_at) values ({lit(actor)},{lit(email)},'active',now()) on conflict(id) do update set user_status='active',auth_email_confirmed_at=excluded.auth_email_confirmed_at;\n"
    for role,key in [(f.RA,'ordinary_a'),(f.RB,'ordinary_b')]:
        sql+=f"insert into public.roles(id,key,name,scope,is_active) values ({lit(role)},{lit(key)},{lit(key)},'company',true);\n"
    # Test data isolation inside the case rollback, not a persistent permission change.
    sql+=f"delete from public.role_permissions where role_id={lit(f.RP)};\n"
    for actor,company,role in [(f.UA,f.A,f.RA),(f.UB,f.B,f.RB),(f.UAB,f.A,f.RA),(f.UAB,f.B,f.RB)]:
        sql+=f"insert into public.company_memberships(company_id,user_id,membership_role,role_key,role_id,status,is_active) values ({lit(company)},{lit(actor)},'operations','operations',{lit(role)},'active',true);\n"
        sql+=f"insert into public.user_roles(user_id,company_id,role_id,status,is_active) values ({lit(actor)},{lit(company)},{lit(role)},'active',true);\n"
    sql+=f"insert into public.user_roles(user_id,role_id,status,is_active) values ({lit(f.PLATFORM)},{lit(f.RP)},'active',true);\n"
    sql+=f"insert into public.admin_users(user_id,role,is_active) values ({lit(f.ADMIN)},'super_admin',true);\n"
    for key,ident in f.PERMS.items():
        sql+=f"insert into public.permissions(id,key,name) values ({lit(ident)},{lit(key)},{lit(key)}) on conflict(key) do nothing;\n"
        sql+=f.check(f'id={lit(ident)}::uuid from public.permissions where key={lit(key)}','full_permission_identity')
    for role,keys in [(f.RA,f.KEYS[:2]),(f.RB,f.KEYS[2:4]),(f.RP,f.KEYS[:4])]:
        for key in keys:sql+=f"insert into public.role_permissions(role_id,permission_id,effect) values ({lit(role)},{lit(f.PERMS[key])},'allow');\n"
    for customer,company in [(f.CA,f.A),(f.CA2,f.A),(f.CB,f.B)]:
        sql+=f"insert into public.customers(id,company_id,first_name) values ({lit(customer)},{lit(company)},'fixture');\n"
    for site,company,customer in [(f.SA,f.A,f.CA),(f.SB,f.B,f.CB)]:
        sql+=f"insert into public.customer_sites(id,company_id,customer_id) values ({lit(site)},{lit(company)},{lit(customer)});\n"
    for company in (f.A,f.B):sql+=f"insert into public.company_invitations(company_id,email) values ({lit(company)},'permission-full-invite@example.invalid');\n"
    sql+="insert into storage.buckets(id,name,public) values ('fixture-other','fixture-other',false);\n"
    for name in (f.PATH_A,f.PATH_B):sql+=f"insert into storage.objects(bucket_id,name,metadata) values ('customer-documents',{lit(name)},'{{\"version\":1}}');\n"
    sql+=f.check("not public from storage.buckets where id='customer-documents'",'private_bucket')
    sql+=f.check("to_regclass('public.user_roles_company_user_single_active_uidx') is not null",'single_role_constraint')
    return sql

def build_cases(retained,document):
    f,bodies=adapted_fixture(retained,document);seed_sql=seed(retained,document)
    adapted={}
    for label,body in bodies.items():
        for table,column in [('canonical_platform_access_command_results','commands'),('canonical_platform_access_audit_events','audits')]:
            body=re.sub(r'count\(\*\)=([0-9]+) from public\.'+table+r"(?=\))", lambda m:'count(*)=(select '+column+' from fixture.baseline_counts)+'+m[1]+' from public.'+table,body)
        body=body.replace('count(*)=1 from public.user_permission_overrides where company_id is null and is_active', 'count(*)=(select overrides from fixture.baseline_counts)+1 from public.user_permission_overrides where company_id is null and is_active')
        adapted[label]=body
    return {label:"BEGIN;\nSET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO,YMD';\nSET LOCAL statement_timeout='120s';\n"+seed_sql+body+"\nRESET ROLE; ROLLBACK; SELECT 'PERMISSION_CASE_COMPLETE';\n" for label,body in adapted.items()}
