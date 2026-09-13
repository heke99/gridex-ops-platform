#!/usr/bin/env python3
"""Separate pinned DB2 schema effects from its historical operator program.

Every original byte has one disposition. Operator-only DDL, reconciliation DML,
legacy reports and run bookkeeping are explicitly NOT replayed or called passed.
No legacy tables or historical tenant/user/customer rows are fabricated.
"""
import hashlib
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
            chunks.extend(sql+';\n' for _,sql in found)
        elif kind == 'schema_check':
            chunks.append("DO $db2_schema_check$ DECLARE issues integer; BEGIN\n"
                          "SELECT issue_count INTO STRICT issues FROM (\n"+text+
                          ") source_check;\nIF issues <> 0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='DB2_CANONICAL_SCHEMA_INCOMPLETE'; END IF;\nEND $db2_schema_check$;\n")
    if not chunks:
        raise ValueError('DB2_SCHEMA_EFFECTS_MISSING')
    return SCOPE_GUARD+'\n'.join(chunks)
