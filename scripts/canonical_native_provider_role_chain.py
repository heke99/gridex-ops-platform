"""Read-only qualification of the native Storage -> authenticator role chain.

A provider name alone never authorizes an exemption. All four direct edges,
no inherited service privileges, no client route to Storage, and the complete
set of non-bypass LOGIN origins of service_role must match the pristine proof.
The old policy, table, column and function ACL checks remain authoritative.
"""
import hashlib
import json

PROVIDER = 'supabase_storage_admin'
QUERY = """BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL search_path=pg_catalog;
WITH roles AS (
 SELECT rolname,rolsuper,rolbypassrls,rolcanlogin,
        pg_has_role(oid,'service_role','USAGE') AS service_usage
 FROM pg_roles WHERE rolname IN ('supabase_storage_admin','authenticator','service_role')
), edges AS (
 SELECT pg_get_userbyid(roleid) AS role,pg_get_userbyid(member) AS member,
        pg_get_userbyid(grantor) AS grantor,admin_option AS admin,
        inherit_option AS inherit,set_option AS set
 FROM pg_auth_members
 WHERE member IN (to_regrole('supabase_storage_admin'),to_regrole('authenticator'))
    OR roleid=to_regrole('supabase_storage_admin')
)
SELECT jsonb_build_object(
 'scope','NATIVE_STORAGE_AUTHENTICATOR_ROLE_CHAIN',
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM roles r),
 'edges',(SELECT jsonb_agg(to_jsonb(e) ORDER BY role,member,grantor) FROM edges e),
 'serviceOrigins',ARRAY(SELECT rolname FROM pg_roles
   WHERE rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
     AND rolname NOT IN ('authenticated','anon','service_role','authenticator')
     AND pg_has_role(oid,'service_role','MEMBER') ORDER BY rolname),
 'clientCanReachProvider',pg_has_role('anon','supabase_storage_admin','MEMBER')
                       OR pg_has_role('authenticated','supabase_storage_admin','MEMBER')
);
ROLLBACK;
"""


def expected():
    return dict(scope='NATIVE_STORAGE_AUTHENTICATOR_ROLE_CHAIN',
        roles=[dict(rolname=name,rolsuper=False,rolbypassrls=name=='service_role',
                    rolcanlogin=name!='service_role',service_usage=name=='service_role')
               for name in ('authenticator','service_role',PROVIDER)],
        edges=[dict(role=role,member=member,grantor='supabase_admin',admin=False,
                    inherit=False,set=True) for role,member in (
            ('anon','authenticator'),('authenticated','authenticator'),
            ('authenticator',PROVIDER),('service_role','authenticator'))],
        serviceOrigins=[PROVIDER],clientCanReachProvider=False)


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=True)


def validate(value):
    # JSON comparison also rejects 0/1 masquerading as booleans. Unknown,
    # duplicate, missing or changed origins/edges are never normalized away.
    if type(value) is not dict or value!=expected() or canonical(value)!=canonical(expected()):
        raise ValueError('REMOVED_POLICY_NATIVE_PROVIDER_CHAIN_REQUIRED')
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def capture(target):
    from canonical_policy_actor_qualification import _admit
    database,native=_admit(target)
    if native is not True or database!='postgres':
        raise ValueError('REMOVED_POLICY_NATIVE_PROVIDER_TARGET_REQUIRED')
    value=json.loads(target.sql(database,QUERY,'native_storage_role_chain',transaction=False))
    _admit(target)
    validate(value)
    return value


def allows_service_origin(principals,context):
    validate(context)
    by_name={p['rolname']:p for p in principals}
    if len(by_name)!=len(principals):
        raise ValueError('REMOVED_POLICY_NATIVE_PROVIDER_CHAIN_REQUIRED')
    # Cross-bind the independent query to the policy witness's own metadata.
    for want in context['roles']:
        actual=by_name.get(want['rolname'],{})
        if any(type(actual.get(k)) is not type(v) or actual.get(k)!=v for k,v in want.items()):
            raise ValueError('REMOVED_POLICY_NATIVE_PROVIDER_CHAIN_REQUIRED')
    return True
