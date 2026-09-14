"""Read-only, redacted diagnostics. This module never authorizes a trigger."""
import hashlib
import re

KNOWN = {
    'issue_pg_graphql_access': 'extensions.grant_pg_graphql_access()',
    'issue_graphql_placeholder': 'extensions.set_graphql_placeholder()',
    'pgrst_ddl_watch': 'extensions.pgrst_ddl_watch()',
    'pgrst_drop_watch': 'extensions.pgrst_drop_watch()',
    'graphql_watch_ddl': 'graphql.increment_schema_version()',
    'graphql_watch_drop': 'graphql.increment_schema_version()',
    'issue_pg_cron_access': 'extensions.grant_pg_cron_access()',
    'issue_pg_net_access': 'extensions.grant_pg_net_access()',
}
# No function body, configuration value, row or SQL exception text is returned.
# The digest binds body AND execution properties; it is evidence, not authority.
QUERY = """BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
SELECT jsonb_build_object('roleTriggerCount',
 (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.roles'::regclass
 AND NOT tgisinternal AND tgenabled<>'D'), 'events',
 (SELECT coalesce(jsonb_agg(jsonb_build_object(
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
 JOIN pg_language l ON l.oid=p.prolang));
COMMIT;
"""


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def summarize(raw):
    """Unknown/user-chosen names are represented only by SHA256, never literals."""
    if (type(raw) is not dict or set(raw) != {'roleTriggerCount', 'events'}
            or type(raw['roleTriggerCount']) is not int or raw['roleTriggerCount'] < 0
            or type(raw['events']) is not list or len(raw['events']) > 1000):
        raise ValueError('NATIVE_TRIGGER_DIAGNOSTIC_SHAPE_REQUIRED')
    events=[]; seen=set()
    fields={'name','event','enabled','tags','owner','function','functionOwner','functionContractSha256'}
    for entry in raw['events']:
        if (type(entry) is not dict or set(entry) != fields
                or any(type(entry[k]) is not str for k in fields-{'tags'})
                or not re.fullmatch('[a-f0-9]{64}',entry['functionContractSha256'])
                or entry['name'] in seen or entry['enabled'] not in ('D','O','R','A')
                or entry['event'] not in ('ddl_command_start','ddl_command_end','sql_drop','table_rewrite')
                or (entry['tags'] is not None and (type(entry['tags']) is not list
                    or any(type(t) is not str or not re.fullmatch('[A-Z ]{1,80}',t) for t in entry['tags'])))):
            raise ValueError('NATIVE_TRIGGER_DIAGNOSTIC_SHAPE_REQUIRED')
        seen.add(entry['name'])
        known=KNOWN.get(entry['name']) == entry['function']
        events.append({'name':entry['name'] if known else 'UNRECOGNIZED',
                       'nameSha256':digest(entry['name']),
                       'function':entry['function'] if known else 'UNRECOGNIZED',
                       'functionIdentitySha256':digest(entry['function']),
                       'owner':entry['owner'] if entry['owner'] in ('supabase_admin','postgres') else 'OTHER',
                       'functionOwner':entry['functionOwner'] if entry['functionOwner'] in ('supabase_admin','postgres') else 'OTHER',
                       'event':entry['event'],'enabled':entry['enabled'],'tags':entry['tags'],
                       'functionContractSha256':entry['functionContractSha256']})
    return {'activeRoleTriggerCount':raw['roleTriggerCount'], 'eventTriggers':events,
            'blanketEventTriggerBanWouldReject':any(e['enabled']!='D' for e in events),
            'admissionChanged':False, 'eventTriggersAuthorized':False}
