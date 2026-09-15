"""Exact historical journal ACL oracle, not authorization of client access.

The PG17 bootstrap grants all table privileges to the three managed roles.
6D2 creates this table without changing those defaults. Characterize precisely;
final RLS, reachability and release checks remain separate and mandatory.
"""
import json

ROLES = ('anon', 'authenticated', 'postgres', 'service_role')
PRIVILEGES = ('DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE')
EXPECTED = tuple((role, privilege, False, 'postgres') for role in ROLES for privilege in PRIVILEGES)


def matches_sql():
    """Boolean expression for pg_class alias c; rejects missing/extra/option drift."""
    expected = json.dumps(EXPECTED, separators=(',', ':')).replace("'", "''")
    grantee = "case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end"
    return f"""((select coalesce(jsonb_agg(jsonb_build_array({grantee},a.privilege_type,a.is_grantable,pg_get_userbyid(a.grantor)::text)
      order by ({grantee}) collate "C",a.privilege_type collate "C",a.is_grantable,pg_get_userbyid(a.grantor)::text collate "C"),'[]'::jsonb)
      from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)='{expected}'::jsonb)"""
