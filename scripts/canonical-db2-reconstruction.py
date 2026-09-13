#!/usr/bin/env python3
"""Separate pinned DB2 schema effects from its historical operator program.

Every original byte has one disposition. Operator-only DDL, reconciliation DML,
legacy reports and run bookkeeping are explicitly NOT replayed or called passed.
No legacy tables or historical tenant/user/customer rows are fabricated.
"""
import hashlib
import importlib.util
from pathlib import Path
import re

PREFLIGHT = 'migrations/01_db2_full_view_preflight_schema_and_functions.sql'
FINISH = 'migrations/03_db2_validation_and_finish.sql'
PINS = {PREFLIGHT:'4de50050384d6892612c16484de8b198785c59cbb5d2ff03e7cea7e600d36cc9',
        FINISH:'74579e9fb883c1aba60933b1c82460164534d6bf171a7fb094b528f5bbb7224e'}
# Inclusive line ranges, reviewed against the immutable byte streams below.
# 'operator' includes DDL for legacy-only reports/writers, not merely row writes.
PARTITIONS = {
    PREFLIGHT: (
        (1,11,'documentation'),(12,13,'schema'),(14,34,'operator'),
        (35,56,'schema'),(57,74,'operator'),(75,98,'schema'),(99,200,'operator'),
        (201,241,'schema'),(242,260,'operator'),(261,271,'schema'),
        (272,284,'operator'),(285,320,'schema'),(321,333,'operator'),
        (334,365,'schema'),(366,373,'strict_indexes'),(374,398,'operator'),
        (399,433,'schema'),(434,1076,'operator'),(1077,1077,'schema'),(1078,1079,'operator')),
    FINISH: ((1,35,'operator'),(36,41,'schema_check'),(42,127,'operator')),
}
INDEXES = ('company_memberships_company_user_uidx','company_memberships_company_status_idx',
           'company_invitations_company_status_idx','company_invitations_email_status_idx')
SCOPE_GUARD = """DO $db2_canonical_scope$
BEGIN
  IF current_setting('check_function_bodies') <> 'on' OR to_regclass('public.customer_profiles') IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DB2_LEGACY_OPERATOR_RECONCILIATION_REQUIRED';
  END IF;
END $db2_canonical_scope$;
"""


def verified(relative, raw):
    if relative not in PINS or type(raw) is not bytes or hashlib.sha256(raw).hexdigest() != PINS[relative]:
        raise ValueError('DB2_SOURCE_MISMATCH')
    return raw


def read(root, relative):
    base = Path(root)/'supabase'
    p = base/relative
    if relative not in PINS or base.is_symlink() or p.parent.is_symlink() or p.is_symlink() or not p.is_file():
        raise ValueError('DB2_SOURCE_REQUIRED')
    return verified(relative,p.read_bytes())


def partition(relative, raw):
    lines = verified(relative,raw).splitlines(keepends=True)
    parts, next_line = [], 1
    for start,end,disposition in PARTITIONS[relative]:
        if start != next_line or end < start or end > len(lines):
            raise ValueError('DB2_PARTITION_GAP_OR_OVERLAP')
        value = b''.join(lines[start-1:end])
        parts.append((start,end,disposition,value))
        next_line = end+1
    if next_line != len(lines)+1 or b''.join(p[3] for p in parts) != raw:
        raise ValueError('DB2_PARTITION_INCOMPLETE')
    return parts


def ledger(relative, raw):
    return {'source':relative,'sha256':PINS[relative],
            'wholeOriginalExecuted':False,'historicalOperatorProgramExecuted':False,
            'parts':[{'firstLine':a,'lastLine':b,'disposition':kind,
                      'sha256':hashlib.sha256(value).hexdigest()}
                     for a,b,kind,value in partition(relative,raw)]}


# Known predecessor: migrations/20260519_saas_ui_tenant_admin.sql, lines 78-79.
# The immutable DB2 source requests a third DESC key but IF NOT EXISTS cannot
# upgrade the earlier namesake. This is an explicit, guarded reconstruction
# transition, not a rewrite of either historical source or a production repair.
INVITE_PREIMAGE_SHA256 = '861130aecf1b3c5d400cbf414c8d99e14d21adbd635c9f8ddb0c357c1964009e'


def invitation_index_transition(raw):
    spec = importlib.util.spec_from_file_location(
        'db2_index_shape', Path(__file__).with_name('canonical-residual-index-effects.py'))
    effects = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(effects)
    declarations = effects.declarations(PREFLIGHT, raw)
    _, name, table, unique, tail = declarations[-1]
    if (name, table, unique) != ('company_invitations_email_status_idx', 'company_invitations', ''):
        raise ValueError('DB2_INVITATION_INDEX_SOURCE_MISMATCH')
    actual = effects.shape('public.' + name)
    previous = effects.shape('pg_temp.gridex_db2_invite_index_previous')
    desired = effects.shape('pg_temp.gridex_db2_invite_index_desired')
    return f"""DO $db2_invite_owned$ BEGIN
  IF current_database() NOT IN ('gridex_auth_legacy_replay', 'gridex_auth_legacy_atomic') THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DB2_INVITATION_INDEX_OWNED_DATABASE_REQUIRED';
  END IF;
END $db2_invite_owned$;
LOCK TABLE public.company_invitations IN SHARE MODE;
CREATE TEMP TABLE gridex_db2_invite_index_shape (LIKE public.company_invitations) ON COMMIT DROP;
CREATE INDEX gridex_db2_invite_index_previous ON pg_temp.gridex_db2_invite_index_shape(lower(email), status);
CREATE INDEX gridex_db2_invite_index_desired ON pg_temp.gridex_db2_invite_index_shape{tail};
DO $db2_invite_transition$
DECLARE candidate oid := to_regclass('public.company_invitations_email_status_idx');
BEGIN
  -- A missing index is created by the original DDL immediately below. An
  -- already-correct index is kept with its OID, metadata and dependencies.
  IF candidate IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=candidate
                 AND indrelid='public.company_invitations'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DB2_INVITATION_INDEX_PREIMAGE_MISMATCH';
  END IF;
  IF {actual} IS NOT DISTINCT FROM {desired} THEN RETURN; END IF;
  -- Reject every unknown semantic or attached operational property instead
  -- of silently replacing a custom/unique/partial/clustered/annotated index.
  IF {actual} IS DISTINCT FROM {previous}
     OR EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=candidate AND (indisclustered OR indisreplident))
     OR EXISTS (SELECT 1 FROM pg_class WHERE oid=candidate AND (reloptions IS NOT NULL OR reltablespace<>0))
     OR EXISTS (SELECT 1 FROM pg_description WHERE objoid=candidate AND classoid='pg_class'::regclass)
     OR EXISTS (SELECT 1 FROM pg_seclabel WHERE objoid=candidate AND classoid='pg_class'::regclass) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='DB2_INVITATION_INDEX_PREIMAGE_MISMATCH';
  END IF;
  DROP INDEX public.company_invitations_email_status_idx;
END $db2_invite_transition$;
DROP TABLE pg_temp.gridex_db2_invite_index_shape;
"""


def reconstruct(relative, raw):
    chunks = []
    for _,_,kind,value in partition(relative,raw):
        text = value.decode('utf-8')
        if kind == 'schema':
            chunks.append(text)
        elif kind == 'strict_indexes':
            found = re.findall(r"select public\.gridex_db1_try_exec\('db2_v4_index','([a-z_]+)',\n  '(create (?:unique )?index if not exists [^']+)'\);",text)
            if tuple(p[0] for p in found) != INDEXES:
                raise ValueError('DB2_INDEX_SOURCE_MISMATCH')
            # Execute the exact index DDL directly. Do not swallow uniqueness or
            # permission failures through the legacy operator logging wrapper.
            for name, sql in found:
                if name == 'company_invitations_email_status_idx':
                    chunks.append(invitation_index_transition(raw))
                chunks.append(sql+';\n')
        elif kind == 'schema_check':
            chunks.append("DO $db2_schema_check$ DECLARE issues integer; BEGIN\n"
                          "SELECT issue_count INTO STRICT issues FROM (\n"+text+
                          ") source_check;\nIF issues <> 0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DB2_CANONICAL_SCHEMA_INCOMPLETE'; END IF;\nEND $db2_schema_check$;\n")
    if not chunks:
        raise ValueError('DB2_SCHEMA_EFFECTS_MISSING')
    return SCOPE_GUARD+'\n'.join(chunks)
