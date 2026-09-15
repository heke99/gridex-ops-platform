"""Finite Storage DML substrate for empty, owned portable databases only.

The original bootstrap stays byte-identical. Supabase Storage's upstream
0002-storage-schema.sql installs client DML grants before tenant policies.
The portable bootstrap omitted those grants, so S01 failed at table access,
not at the customer-document RLS predicate. This adapter runs before any
Gridex source and never grants permissions inside a matrix test transaction.
Native comparison covers this 24-cell DML/RLS projection, not all Storage ACLs.
"""
import hashlib

BOOTSTRAP_SHA = 'd7d6d7b7f1a55cff7fad78ca6397aa5d4e8d43ea1d1ec362eca741bcc36b403b'
TABLES = ('storage.buckets', 'storage.objects')
ROLES = ('anon', 'authenticated', 'service_role')
PRIVILEGES = ('DELETE', 'INSERT', 'SELECT', 'UPDATE')
KEYS = {(table, role, privilege) for table in TABLES for role in ROLES for privilege in PRIVILEGES}
CAPTURE = """SELECT coalesce(jsonb_agg(to_jsonb(result) ORDER BY object_name, role_name, privilege_name), '[]'::jsonb)
FROM (
 SELECT t.object_name, r.role_name, p.privilege_name,
        has_table_privilege(r.role_name,t.object_name,p.privilege_name) AS allowed,
        c.relrowsecurity AS rls_enabled
 FROM (VALUES ('storage.objects'),('storage.buckets')) AS t(object_name)
 CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(role_name)
 CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS p(privilege_name)
 JOIN pg_class c ON c.oid=to_regclass(t.object_name)
) AS result;
"""
INITIALIZE = """
-- Test substrate only. Existing owned-runtime checks are also mandatory.
DO $storage_bootstrap$
BEGIN
  IF current_database() NOT IN ('gridex_auth_legacy_replay','gridex_auth_legacy_native','gridex_auth_legacy_atomic')
     OR to_regclass('public.companies') IS NOT NULL
     OR to_regclass('public.company_memberships') IS NOT NULL
     OR EXISTS (SELECT FROM storage.buckets)
     OR EXISTS (SELECT FROM storage.objects)
     OR (SELECT count(*) FROM pg_class WHERE oid IN ('storage.buckets'::regclass,'storage.objects'::regclass) AND relrowsecurity) <> 2
     OR EXISTS (SELECT FROM pg_policy WHERE polrelid IN ('storage.buckets'::regclass,'storage.objects'::regclass)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='EMPTY_OWNED_STORAGE_BOOTSTRAP_REQUIRED';
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO anon, authenticated, service_role;
END
$storage_bootstrap$;
"""


def render(original):
    if type(original) is not bytes or hashlib.sha256(original).hexdigest() != BOOTSTRAP_SHA:
        raise ValueError('EXACT_STORAGE_BOOTSTRAP_SOURCE_REQUIRED')
    return original.decode('utf-8') + INITIALIZE


def validate(rows, *, allowed):
    if type(allowed) is not bool or type(rows) is not list or len(rows) != len(KEYS):
        raise ValueError('COMPLETE_STORAGE_DML_PROFILE_REQUIRED')
    seen = set()
    for row in rows:
        if type(row) is not dict or set(row) != {'object_name','role_name','privilege_name','allowed','rls_enabled'}:
            raise ValueError('COMPLETE_STORAGE_DML_PROFILE_REQUIRED')
        key = tuple(row[field] for field in ('object_name','role_name','privilege_name'))
        if (any(type(value) is not str for value in key) or key not in KEYS or key in seen
                or row['allowed'] is not allowed or row['rls_enabled'] is not True):
            raise ValueError('COMPLETE_STORAGE_DML_PROFILE_REQUIRED')
        seen.add(key)
    if seen != KEYS:
        raise ValueError('COMPLETE_STORAGE_DML_PROFILE_REQUIRED')
    return sorted(rows, key=lambda row: (row['object_name'],row['role_name'],row['privilege_name']))
