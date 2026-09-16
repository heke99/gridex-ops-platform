"""Finite Supabase 17.6.1.106 provider contract; never a name-only exemption.

The observed routine digests from OPS 34884449551 must also match a pristine
owned image BEFORE repository SQL. Definitions were reviewed against postgres
17.6.1.106/schema-17.sql and pg_graphql v1.5.11/sql/schema_version.sql.
The original portable admission remains immutable. No event is disabled.
"""
import copy
import hashlib
import json

IMAGE_ID='sha256:9ff6402f578a9b0d4f2aa31f660bd398b8e378761d61d31efda6ff9ad92408e5'
CACHE_SCOPE='graphql.seq_schema_version'
# name, event, function, tags, SHA256(body AND owner/ACL/config/execution flags).
PINS=(
 ('graphql_watch_ddl','ddl_command_end','graphql.increment_schema_version()',None,'6c716cfa2db5801f4f45db2b8a2495a26aff10236ff6347436498c4b2f6da99b'),
 ('graphql_watch_drop','sql_drop','graphql.increment_schema_version()',None,'6c716cfa2db5801f4f45db2b8a2495a26aff10236ff6347436498c4b2f6da99b'),
 ('issue_graphql_placeholder','sql_drop','extensions.set_graphql_placeholder()',['DROP EXTENSION'],'482d8257f500b81c83d6fdb17fb3abf2727a691653b6a888ea588634043caa6e'),
 ('issue_pg_cron_access','ddl_command_end','extensions.grant_pg_cron_access()',['CREATE EXTENSION'],'ed6e4df4588f6b50bdd6f68d640abf878247e0bcc7bb0fc3eee3099771489a1d'),
 ('issue_pg_graphql_access','ddl_command_end','extensions.grant_pg_graphql_access()',['CREATE FUNCTION'],'9287a5ec712d9c9a7c1d0500cb8e523fc2f3fd2d913e06e3f5882597a1f95260'),
 ('issue_pg_net_access','ddl_command_end','extensions.grant_pg_net_access()',['CREATE EXTENSION'],'79b4a28b9fb6fe5b94faf6c8909a90626c936a5fe1f355d42c870b6164958acb'),
 ('pgrst_ddl_watch','ddl_command_end','extensions.pgrst_ddl_watch()',None,'c8238cd6c3785df8e926ef105f82406e6dbbdeecb7be96c0f40078627353d779'),
 ('pgrst_drop_watch','sql_drop','extensions.pgrst_drop_watch()',None,'118da3cb2b8040ca21383443bc50543901baa7f68b3876cfd42c01c7294f2845'),
)
SELECT="""SELECT coalesce(jsonb_agg(jsonb_build_object(
 'name',e.evtname,'event',e.evtevent,'enabled',e.evtenabled,'tags',e.evttags,
 'owner',pg_get_userbyid(e.evtowner),'function',e.evtfoid::regprocedure::text,
 'functionOwner',pg_get_userbyid(p.proowner),
 'functionContractSha256',encode(sha256(convert_to(jsonb_build_object(
  'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
  'acl',p.proacl::text,'config',p.proconfig,'language',l.lanname,
  'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,
  'volatile',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict
 )::text,'UTF8')),'hex')) ORDER BY e.evtname),'[]'::jsonb)
 FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid
 JOIN pg_language l ON l.oid=p.prolang"""
QUERY='BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;\n'+SELECT+';\nCOMMIT;'
OLD_PREDICATE="OR EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtenabled<>'D')"
SEQUENCE_SHAPE="""SELECT jsonb_build_object('type',seqtypid::regtype::text,
 'start',seqstart,'increment',seqincrement,'max',seqmax,'min',seqmin,
 'cache',seqcache,'cycle',seqcycle)
 FROM pg_catalog.pg_sequence WHERE seqrelid='graphql.seq_schema_version'::regclass;"""


def expected():
    return [{'name':n,'event':e,'enabled':'O','tags':copy.deepcopy(t),
             'owner':'supabase_admin','function':f,'functionOwner':'supabase_admin',
             'functionContractSha256':h} for n,e,f,t,h in PINS]


def validate(events):
    if type(events) is not list or events!=expected():
        raise ValueError('NATIVE_PROVIDER_EVENT_CONTRACT_REQUIRED')


def receipt():
    return {'pristineBootstrapVerified':True,'imageId':IMAGE_ID,'pgGraphqlVersion':'1.5.11',
            'eventCount':len(PINS),'contractSha256':hashlib.sha256(
                json.dumps(expected(),sort_keys=True,separators=(',',':')).encode()).hexdigest()}


def bootstrap(sql,image_id,metadata):
    if (image_id!=IMAGE_ID or type(metadata) is not dict or
            {'name':'pg_graphql','version':'1.5.11'} not in metadata.get('extensions',[])):
        raise ValueError('NATIVE_PROVIDER_EVENT_IMAGE_REQUIRED')
    validate(sql(QUERY))
    return receipt()


def require(sql,proof):
    # JSON equality is strict here: True must not compare equal to numeric 1.
    if json.dumps(proof,sort_keys=True)!=json.dumps(receipt(),sort_keys=True):
        raise ValueError('NATIVE_PROVIDER_EVENT_BOOTSTRAP_REQUIRED')
    validate(sql(QUERY))


def setup_sql(contract=None):
    """Private invoker helper fixes deparser search_path; no routine elevation."""
    contract=expected() if contract is None else contract
    literal=json.dumps(contract,sort_keys=True,separators=(',',':')).replace("'","''")
    return ("CREATE FUNCTION pg_temp.gridex_native_provider_events() RETURNS jsonb\n"
            "LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $provider_events$\n"
            +SELECT+";\n$provider_events$;\n"
            "REVOKE ALL ON FUNCTION pg_temp.gridex_native_provider_events() FROM PUBLIC,anon,authenticated,service_role;\n"
            "CREATE TEMP TABLE native_provider_event_contract(value jsonb NOT NULL) ON COMMIT DROP;\n"
            "INSERT INTO native_provider_event_contract VALUES ('"+literal+"'::jsonb);\n")


def predicate():
    return ('OR pg_temp.gridex_native_provider_events() IS DISTINCT FROM '
            '(SELECT value FROM pg_temp.native_provider_event_contract)')


def mismatch_setups():
    """Actual SQL comparator negative controls, NOT catalog-tampering claims."""
    wrong_body=expected();wrong_body[0]['functionContractSha256']='0'*64
    wrong_owner=expected();wrong_owner[0]['owner']='postgres'
    return tuple(setup_sql(c) for c in (expected()[:-1],wrong_body,wrong_owner))


def static_catalog_sql(batch):
    # Extra read-only provider scope. It NEVER replaces the domain projection
    # or expands the write-lock/row-preservation exemptions.
    text=batch.catalog_sql();site="('public','auth','storage')"
    if text.count(site)!=4:raise ValueError('NATIVE_PROVIDER_CATALOG_SOURCE_REQUIRED')
    return ('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;\n'+text.replace(
        site,"('extensions','graphql','graphql_public','net')")+'\nCOMMIT;')
