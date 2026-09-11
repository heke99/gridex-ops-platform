#!/usr/bin/env python3
"""Trusted once-only lossless continuation on an unpublished owned database."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import weakref
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


replay = load('fixed_runtime_loader', 'canonical-auth-provisioning-replay.py').controller()
legacy, repair, dedupe = replay.load_batch(), replay.load_repair(), replay.load_dedupe()
BoundaryError = legacy.BoundaryError
SPECS = {
    'B0': ('20260519_bootstrap_div3rsa_superadmin.sql', 344,
           'bd9e06fc4b0244bc3bf6d9fc64924552766edf303168d4e2e11f0b8abe0334c0'),
    'C2': ('20260525_debug_batch_2c_activate_afshin_nibela.sql', 249,
           'b92f043727f2e5699a277c7d649dd583b8f04b1bdcd759840a2d0d1e52953659'),
    'D2': ('20260525_debug_batch_2d_activate_afshin_nibela_v2.sql', 287,
           '048bf0d47d0ae0e996517b770ac4d4591726a2b8e029a91348c8a031acf37dd7'),
    'F2': ('20260525_debug_batch_2f_normalize_afshin_nibela.sql', 245,
           '9fcf47f11a881c01a670f7858af5a297a2a49fb5033fdc256a024c8ae979e35b'),
}
WRITE_TABLES = frozenset(('auth.users', 'public.companies', 'public.user_profiles',
                         'public.roles', 'public.permissions', 'public.role_permissions',
                         'public.user_roles', 'public.company_memberships',
                         'public.company_invitations', 'public.audit_logs'))
# No new database names, URLs, provider clients, roles, or generic target option.
CANARY = 'gridex_auth_legacy_seeded'
AcceptedInputs = replay.load_private().AcceptedInputs


def check(condition, label='FIXED_ASSERTION_FAILED'):
    if not condition:
        raise BoundaryError(label)


class Source:
    """Pinned whole bytes; repr never discloses source-bound fixture values."""
    def __init__(self, key, path=None, staging=None):
        check(key in SPECS, 'SOURCE_REQUIRED')
        self.key = key
        name, lines, digest = SPECS[key]
        canonical = ROOT/'supabase/migrations'/name
        path = canonical if path is None else path
        check(type(path) is type(canonical) and path == canonical and (staging is not None or path.is_file())
              and not path.is_symlink() and path.resolve() == path, 'WHOLE_SOURCE_REQUIRED')
        data = repair.read_source(path,staging)
        legacy.verify_bytes(data, digest, lines)
        manifest = json.loads((ROOT/'scripts/migration-history-manifest.json').read_text())['files']
        check(manifest.get(name) == digest, 'ORIGINAL_MANIFEST_REQUIRED')
        self.path, self.data, self.staging = path, data, staging
        self.text = data.decode()
        self.slots = {}
        pattern = r"v_(company_id|user_id|correct_user_id|old_user_id|actor_user_id|email)\s+(?:uuid|text)\s*:=\s*'([^']+)'"
        for variable, value in re.findall(pattern, self.text, re.I):
            symbol = {'company_id':'C_target', 'user_id':'U_boot' if key == 'B0' else 'U_target',
                      'correct_user_id':'U_target', 'old_user_id':'U_old',
                      'actor_user_id':'U_actor', 'email':'email'}[variable]
            self.slots[symbol] = value
        expected = {'B0': {'U_boot'}, 'C2': {'C_target','U_target','U_actor','email'},
                    'D2': {'C_target','U_target','U_actor','email'},
                    'F2': {'C_target','U_target','U_old','email'}}[key]
        check(set(self.slots) == expected, 'SOURCE_SLOT_SHAPE')
        for symbol, value in self.slots.items():
            if symbol != 'email':
                check(str(uuid.UUID(value)) == value, 'SOURCE_SLOT_TYPE')
        check(bool(re.search(r'^commit;\s*$', self.text, re.I | re.M)) == (key in ('D2','F2')),
              'NATIVE_TRANSACTION_REQUIRED')

    def literal(self, line, ordinal=0):
        values = re.findall(r"'((?:''|[^'])*)'", self.text.splitlines()[line-1])
        check(len(values) > ordinal, 'SOURCE_ORACLE_LITERAL')
        return values[ordinal].replace("''", "'")

    def refresh(self):
        other = Source(self.key, staging=self.staging)
        check(other.data == self.data, 'SOURCE_CHANGED')
        return other.data


def ident(value):
    check(re.fullmatch(r'[a-z_][a-z0-9_]*', value) is not None, 'IDENTIFIER_REQUIRED')
    return '"'+value+'"'


def qualified(table):
    check(table in WRITE_TABLES, 'CLOSED_WRITE_TABLE_REQUIRED')
    return '.'.join(ident(part) for part in table.split('.'))


def value_sql(value):
    if value is None:
        return 'NULL'
    if type(value) is bool:
        return 'true' if value else 'false'
    if type(value) in (int, float):
        return str(value)
    if type(value) in (dict, list):
        return legacy.literal(json.dumps(value, separators=(',',':')))+'::jsonb'
    check(type(value) is str, 'FIXTURE_VALUE_TYPE')
    return legacy.literal(value)


# Complete portable catalog includes FKs, indexes, functions, event triggers and ACLs.
CATALOG_SQL = repair.catalog_sql()
ROWS_SQL = '''
CREATE TEMP TABLE fixed_rows(name text, value jsonb) ON COMMIT DROP;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT n.nspname,c.relname,c.relkind FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage') AND c.relkind IN ('r','p','S') LOOP
 IF r.relkind='S' THEN
  EXECUTE format('INSERT INTO fixed_rows SELECT %L,jsonb_build_object(''last_value'',last_value,''log_cnt'',log_cnt,''is_called'',is_called) FROM %I.%I',r.nspname||'.'||r.relname,r.nspname,r.relname);
 ELSE
  EXECUTE format('INSERT INTO fixed_rows SELECT %L,to_jsonb(x) FROM %I.%I x',r.nspname||'.'||r.relname,r.nspname,r.relname);
 END IF;
END LOOP; END $$;
SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM fixed_rows;
DROP TABLE fixed_rows;
'''


def snapshot_sql():
    return "SELECT 'FIXED_CATALOG';\n"+CATALOG_SQL+"\nSELECT 'FIXED_ROWS';\n"+ROWS_SQL


def decode_snapshot(output):
    lines = output.splitlines()
    check(lines.count('FIXED_CATALOG') == 1 and lines.count('FIXED_ROWS') == 1,
          'PRIVATE_SNAPSHOT_REQUIRED')
    return (json.loads(lines[lines.index('FIXED_CATALOG')+1]),
            json.loads(lines[lines.index('FIXED_ROWS')+1]))



ORDER = ('auth.users','public.roles','public.permissions','public.companies',
         'public.role_permissions','public.company_memberships','public.user_roles',
         'public.user_profiles','public.company_invitations','public.audit_logs')


class Generated:
    def __init__(self):
        self.value = None


class Clock:
    def __init__(self, lower, upper):
        self.lower, self.upper, self.value = lower, upper, None


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z','+00:00'))


class Oracle:
    def __init__(self, core, snapshot, lower=None, upper=None):
        self.c = core
        self.catalog = copy.deepcopy(snapshot[0])
        self.rows = {}
        for table,row in snapshot[1]:
            self.rows.setdefault(table,[]).append(copy.deepcopy(row))
        self.now = Clock(lower,upper) if lower is not None else None
        self.used = {str(v) for _,row in snapshot[1] for v in row.values() if isinstance(v,str)}

    def columns(self, table):
        prefix = 'column/'+table+'/'
        return {key[len(prefix):]:value for key,value in self.catalog.items() if key.startswith(prefix)}

    def present(self, table):
        return 'relation/'+table in self.catalog

    def table(self, table):
        return self.rows.setdefault(table,[])

    def default(self, column):
        expression = column['default']
        if expression is None or expression.startswith('NULL::'):
            return None
        if expression in ('now()','CURRENT_TIMESTAMP'):
            self.c.check(self.now is not None, 'ORACLE_CLOCK_REQUIRED')
            return self.now
        if expression in ('gen_random_uuid()','extensions.gen_random_uuid()'):
            return Generated()
        if expression in ('true','false'):
            return expression == 'true'
        if re.fullmatch(r'-?[0-9]+',expression):
            return int(expression)
        match = re.fullmatch(r"'((?:''|[^'])*)'::[\w .\[\]()]+",expression)
        self.c.check(match is not None, 'DEFAULT_ORACLE_REVIEW_REQUIRED')
        value = match[1].replace("''", "'")
        if column['type'] in ('jsonb','json'):
            return json.loads(value)
        return value

    def generated_columns(self, table, row):
        for name,column in self.columns(table).items():
            if not column['generated']:
                continue
            if table == 'public.companies' and name == 'normalized_org_number':
                row[name] = re.sub('[^0-9]','',row.get('org_number') or '') or None
            elif table == 'auth.users' and name == 'confirmed_at':
                dates = [row.get(k) for k in ('email_confirmed_at','phone_confirmed_at') if row.get(k)]
                row[name] = min(dates) if dates else None
            else:
                raise self.c.BoundaryError('GENERATED_COLUMN_ORACLE_REVIEW_REQUIRED')

    def new(self, table, values):
        columns = self.columns(table)
        self.c.check(set(values) <= set(columns), 'ORACLE_COLUMN_REQUIRED')
        row = {name: self.default(column) for name,column in columns.items() if not column['generated']}
        row.update(values)
        self.generated_columns(table,row)
        self.table(table).append(row)
        return row

    def update(self, table, row, values):
        self.c.check(set(values) <= set(row), 'ORACLE_UPDATE_COLUMN_REQUIRED')
        row.update(values)
        self.generated_columns(table,row)

    def metadata(self, row, values):
        return dict(row.get('metadata') or {}, **values)

    def by(self, table, **fields):
        return [row for row in self.table(table) if all(row.get(k) == v for k,v in fields.items())]

    def one(self, table, **fields):
        rows = self.by(table,**fields)
        self.c.check(len(rows) == 1, 'ORACLE_SINGLE_ROW_REQUIRED')
        return rows[0]

    def match(self, expected, actual, bind=False):
        if isinstance(expected, Generated):
            if expected.value is not None:
                return expected.value == actual
            try:
                valid = str(uuid.UUID(actual)) == actual and uuid.UUID(actual).version == 4 and actual not in self.used
            except (ValueError,TypeError,AttributeError):
                return False
            if bind and valid:
                expected.value = actual
                self.used.add(actual)
            return valid
        if isinstance(expected, Clock):
            if not isinstance(actual,str):
                return False
            try:
                parsed = timestamp(actual)
            except ValueError:
                return False
            valid = expected.lower <= parsed <= expected.upper
            if expected.value is not None:
                return valid and parsed == expected.value
            if bind and valid:
                expected.value = parsed
            return valid
        if isinstance(expected, dict):
            return isinstance(actual,dict) and set(expected) == set(actual) and all(
                self.match(value,actual[key],bind) for key,value in expected.items())
        if isinstance(expected,list):
            return isinstance(actual,list) and len(expected) == len(actual) and all(
                self.match(x,y,bind) for x,y in zip(expected,actual))
        return expected == actual

    def assert_rows(self, after):
        actual = {}
        for table,row in after[1]:
            actual.setdefault(table,[]).append(row)
        for table in (*ORDER,*sorted((set(actual)|set(self.rows))-set(ORDER))):
            expected_rows = self.rows.get(table,[])
            candidates = list(actual.pop(table,[]))
            self.c.check(len(candidates) == len(expected_rows), 'FULL_ROW_MULTISET_MISMATCH')
            # Original PK identity is checked before allocating any new ID.
            expected_rows = sorted(expected_rows,key=lambda row:isinstance(row.get('id'),Generated))
            for expected in expected_rows:
                matches = [row for row in candidates if self.match(expected,row)]
                self.c.check(len(matches) == 1, 'FULL_PK_FIELD_ORACLE_MISMATCH')
                row = matches[0]
                self.c.check(self.match(expected,row,True), 'RELATED_GENERATED_VALUE_MISMATCH')
                candidates.remove(row)
            self.c.check(not candidates, 'UNEXPECTED_DEPENDENT_ROW')
        self.c.check(not actual, 'UNEXPECTED_RELATION_ROWS')

    def assert_snapshot(self, after):
        self.c.check(after[0] == self.catalog, 'FULL_CATALOG_ORACLE_MISMATCH')
        self.assert_rows(after)


def activate(oracle, source, member_value='company_admin', membership_column=True):
    """C2/D2 complete explicit effects, including the stale FOUND defect."""
    o, s, n = oracle,source.slots,oracle.now
    key = source.key
    company,user,email,actor = (s[k] for k in ('C_target','U_target','email','U_actor'))
    companies = o.by('public.companies',id=company)
    if companies:
        row = companies[0]
        if key == 'C2':
            values = {'status': 'onboarding' if row['status'] in ('archived','paused','suspended','pending_deletion',None) else row['status'],
                      'updated_at':n,'metadata':o.metadata(row,{source.literal(29,1):True})}
        else:
            values = {'name':row['name'] or source.literal(33),
                      'status':row['status'] if row['status'] in ('active','onboarding') else 'onboarding', 'updated_at':n}
        o.update('public.companies',row,values)
    else:
        o.new('public.companies',{'id':company,'name':source.literal(33),'status':'onboarding','created_at':n,'updated_at':n})
    if key == 'D2':
        for row in o.table('public.roles'):
            if not row['key']:
                row['key'] = row['name'] or None
    roles = [r for r in o.table('public.roles') if r.get('key') == 'company_admin' or
             r.get('name') in (('company_admin','admin') if key == 'D2' else ('company_admin',))]
    roles.sort(key=lambda r:0 if r.get('key') == 'company_admin' else 1 if r.get('name') == 'company_admin' else 2)
    if not roles:
        line = 52 if key=='C2' else 57
        role = o.new('public.roles',dict(name=source.literal(line),key=source.literal(line,1),
                     description=source.literal(line,2),scope=source.literal(line,3)))
    else:
        o.c.check(len(roles) == 1 or (roles[0]['key'] == 'company_admin' and roles[1]['key'] != 'company_admin'),
                  'ROLE_TIE_REQUIRES_NAMED_ORACLE')
        role = roles[0]
    if key == 'D2' and not role['key']:
        role['key'] = 'company_admin'
    role_id = role['id']
    profiles = o.by('public.user_profiles',id=user)
    if profiles:
        row = profiles[0]
        full_name = row['full_name']
        if full_name is None or (key == 'D2' and full_name == ''):
            full_name = source.literal(33 if key == 'C2' else 66)
        o.update('public.user_profiles',row,dict(email=email,full_name=full_name,user_status='active',active_company_id=company,updated_at=n))
    else:
        o.new('public.user_profiles',dict(id=user,email=email,full_name=source.literal(33 if key == 'C2' else 66),
              user_status='active',active_company_id=company,updated_at=n))
    members = [r for r in o.table('public.company_memberships') if r['company_id'] == company and
               (r['user_id'] == user or (r.get('invited_email') or '').lower() == email.lower())]
    membership_meta = 'debug_batch_'+{'C2':'2c','D2':'2d'}[key]+'_activation'
    for row in members:
        values = dict(user_id=user,role='company_admin',role_id=role_id,status='active',is_active=True,
                      invited_email=email,invited_by=actor,invited_at=row.get('invited_at') or n,
                      joined_at=row.get('joined_at') or n,accepted_at=row.get('accepted_at') or n,
                      disabled_at=None,disabled_by=None,removed_at=None,removed_by=None,status_reason=None,
                      role_key='company_admin',updated_at=n,metadata=o.metadata(row,{membership_meta:True}))
        if membership_column:
            values['membership_role'] = member_value
        o.update('public.company_memberships',row,values)
    if not members and (key == 'D2' or not membership_column):
        values = dict(company_id=company,user_id=user,role='company_admin',role_id=role_id,status='active',
                      is_active=True,invited_email=email,invited_by=actor,invited_at=n,joined_at=n,accepted_at=n,
                      role_key='company_admin',created_at=n,updated_at=n,metadata={membership_meta:True})
        if membership_column:
            values['membership_role'] = member_value
        o.new('public.company_memberships',values)
    rows = [r for r in o.table('public.user_roles') if r['user_id'] == user and r['company_id'] in (None,company)
            and (r['role_id'] == role_id or r['role'] == 'company_admin' or (key == 'D2' and r['role'] is None))]
    for row in rows:
        o.update('public.user_roles',row,dict(role_id=role_id,role='company_admin',company_id=company,status='active',is_active=True))
    if not rows:
        o.new('public.user_roles',dict(user_id=user,role='company_admin',role_id=role_id,company_id=company,status='active',is_active=True,created_at=n))
    if not o.present('public.company_invitations'):
        return
    columns = o.columns('public.company_invitations')
    invitations = o.table('public.company_invitations')
    matches = lambda col:[r for r in invitations if r['company_id'] == company and (r.get(col) or '').lower() == email.lower()]
    if key == 'C2':
        rows = matches('email') if 'email' in columns else []
        if not rows and 'invited_email' in columns:
            rows = matches('invited_email')
        if not rows and 'email' in columns:
            o.new('public.company_invitations',dict(company_id=company,email=email,full_name=source.literal(230),
                  membership_role=member_value,role_key='company_admin',status='accepted',invited_by=actor,
                  invited_user_id=user,expires_at=None,accepted_at=n,metadata={membership_meta:True}))
    else:
        rows = [r for r in invitations if r['company_id'] == company and any(
                (r.get(col) or '').lower() == email.lower() for col in ('email','invited_email') if col in columns)]
    for row in rows:
        values = dict(status='accepted',expires_at=None)
        optional = dict(invited_user_id=user,role_key='company_admin',membership_role=member_value,
                        accepted_at=row.get('accepted_at') or n,updated_at=n,metadata=o.metadata(row,{membership_meta:True}))
        values.update({k:v for k,v in optional.items() if k in columns})
        if key == 'C2':
            values['revoked_at'] = None
        o.update('public.company_invitations',row,values)


def bootstrap(o, source, winner=None):
    user,n = source.slots['U_boot'],o.now
    email = o.one('auth.users',id=user)['email']
    roles = {}
    for line in (74,75):
        key,name,description = (source.literal(line,i) for i in range(3))
        values = dict(key=key,name=name,description=description)
        if 'is_system' in o.columns('public.roles'):
            values['is_system'] = True
        rows = o.by('public.roles',key=key)
        if rows:
            role = rows[0]
            o.update('public.roles',role,values)
        else:
            role = o.new('public.roles',values)
        roles[key] = role['id']
    if o.present('public.permissions'):
        for line in range(100,123):
            key,name,description = (source.literal(line,i) for i in range(3))
            values = dict(key=key,name=name,description=description)
            rows = o.by('public.permissions',key=key)
            if rows:
                o.update('public.permissions',rows[0],values)
            else:
                o.new('public.permissions',values)
    if o.present('public.permissions') and o.present('public.role_permissions'):
        keys = set()
        for line in range(139,149):
            keys.update(re.findall(r"'([^']+)'",source.text.splitlines()[line-1]))
        o.c.check(len(keys) == 20, 'COMPANY_PERMISSION_ORACLE_REQUIRED')
        for role_key,role_id in roles.items():
            for permission in o.table('public.permissions'):
                if role_key != 'super_admin' and permission['key'] not in keys:
                    continue
                if not o.by('public.role_permissions',role_id=role_id,permission_id=permission['id']):
                    o.new('public.role_permissions',dict(role_id=role_id,permission_id=permission['id']))
    for key,role_id in roles.items():
        rows = o.by('public.user_roles',user_id=user,role_id=role_id)
        flags = {k:v for k,v in dict(status='active',is_active=True).items() if k in o.columns('public.user_roles')}
        if rows:
            if key == 'super_admin':
                for row in rows:
                    o.update('public.user_roles',row,flags)
        else:
            o.new('public.user_roles',dict(user_id=user,role_id=role_id,**flags))
    slug,organization = source.literal(209),source.literal(210,3)
    companies = [r for r in o.table('public.companies') if r['slug'] == slug or
                 (r['org_number'] or '').replace('-','') == organization]
    if companies:
        companies.sort(key=lambda r:r['created_at'])
        row = next((r for r in companies if r['id'] == winner),companies[0])
        values = dict(name=source.literal(243),slug=row['slug'] if row['slug'] is not None else slug,
                      org_number=row['org_number'] if row['org_number'] is not None else source.literal(245),
                      status='active',primary_contact_email=row['primary_contact_email'] if row['primary_contact_email'] is not None else email,
                      primary_contact_name=row['primary_contact_name'] if row['primary_contact_name'] is not None else source.literal(248),
                      industry=row['industry'] if row['industry'] is not None else source.literal(249),
                      metadata=o.metadata(row,{'operational_company':True,'bootstrap_confirmed_at':n}),updated_at=n)
        o.update('public.companies',row,values)
    else:
        row = o.new('public.companies',dict(name=source.literal(226),slug=slug,org_number=source.literal(228),
                    status='active',primary_contact_email=email,primary_contact_name=source.literal(231),
                    industry=source.literal(232),metadata={'bootstrap':True,'bootstrap_reason':source.literal(235,1),
                    'operational_company':True},created_by=user))
    company = row['id']
    memberships = o.by('public.company_memberships',company_id=company,user_id=user)
    if memberships:
        row = memberships[0]
        o.update('public.company_memberships',row,dict(membership_role='owner',status='active',
                 accepted_at=row['accepted_at'] or n,suspended_at=None,
                 metadata=o.metadata(row,{'bootstrap_confirmed_at':n,'role_note':source.literal(289,1)})))
    else:
        o.new('public.company_memberships',dict(company_id=company,user_id=user,membership_role='owner',status='active',
              invited_email=email,invited_by=user,invited_at=n,accepted_at=n,
              metadata={'bootstrap':True,'role_note':source.literal(279,1)}))
    if o.present('public.user_profiles'):
        profiles = o.by('public.user_profiles',id=user)
        if profiles:
            row = profiles[0]
            o.update('public.user_profiles',row,dict(email=row['email'] if row['email'] is not None else email,
                    full_name=row['full_name'] if row['full_name'] is not None else source.literal(297),active_company_id=company))
        else:
            o.new('public.user_profiles',dict(id=user,email=email,full_name=source.literal(297),active_company_id=company))
    if o.present('public.audit_logs'):
        values = dict(actor_user_id=user,entity_type='company',entity_id=company,action='bootstrap_operational_company',
                      new_values={'company_name':source.literal(322,1),'user_id':user},
                      metadata={'source':source.literal(323,1)})
        if 'company_id' in o.columns('public.audit_logs'):
            values['company_id'] = company
        o.new('public.audit_logs',values)
    constraint = 'constraint/public.company_memberships/company_memberships_role_check'
    o.c.check(constraint in o.catalog, 'MEMBERSHIP_CHECK_ORACLE_REQUIRED')
    o.catalog[constraint]['definition'] = "CHECK ((membership_role = ANY (ARRAY['owner'::text, 'company_admin'::text, 'member'::text, 'viewer'::text])))"


def normalize(o, source, member_value='company_admin'):
    s,n = source.slots,o.now
    user,old,company,email = (s[k] for k in ('U_target','U_old','C_target','email'))
    if o.present('public.company_invitations'):
        for row in o.table('public.company_invitations'):
            if row.get('invited_email') is None and row.get('email') is not None:
                row['invited_email'] = row['email']
            if row.get('email') is None and row.get('invited_email') is not None:
                row['email'] = row['invited_email']
    companies = o.by('public.companies',id=company)
    if companies:
        row = companies[0]
        o.update('public.companies',row,dict(name=source.literal(40),status=row['status'] if row['status'] in ('active','onboarding') else 'onboarding',updated_at=n))
    else:
        o.new('public.companies',dict(id=company,name=source.literal(40),status='onboarding',created_at=n,updated_at=n))
    roles = [r for r in o.table('public.roles') if (r.get('key') or r['name']) == 'company_admin' or r['name'] in ('company_admin','admin')]
    roles.sort(key=lambda r:0 if (r.get('key') or r['name']) == 'company_admin' else 1)
    if not roles:
        role_id = o.new('public.roles',dict(name=source.literal(56),description=source.literal(56,1),
                       key=source.literal(56,2),scope=source.literal(56,3),created_at=n))['id']
    else:
        o.c.check(len(roles) == 1 or ((roles[0].get('key') or roles[0]['name']) == 'company_admin'
                                   and (roles[1].get('key') or roles[1]['name']) != 'company_admin'), 'ROLE_TIE_REQUIRES_NAMED_ORACLE')
        role_id = roles[0]['id']
    for table,column in (('public.company_memberships','user_id'),('public.company_invitations','invited_user_id')):
        if o.present(table):
            for row in o.table(table):
                if row['company_id'] == company and row[column] == old:
                    o.update(table,row,{column:user,'updated_at':n,'metadata':o.metadata(row,
                             {'normalized_from_old_afshin_user_id':old,'debug_batch_2f':True})})
    members = o.by('public.company_memberships',company_id=company,user_id=user)
    if members:
        row = members[0]
        o.update('public.company_memberships',row,dict(role='company_admin',role_key='company_admin',
                 membership_role=member_value,status='active',is_active=True,invited_email=email,
                 accepted_at=row.get('accepted_at') or n,joined_at=row.get('joined_at') or n,
                 removed_at=None,removed_by=None,disabled_at=None,disabled_by=None,status_reason=None,
                 updated_at=n,metadata=o.metadata(row,{'debug_batch_2f_normalized':True})))
    else:
        o.new('public.company_memberships',dict(company_id=company,user_id=user,role='company_admin',role_key='company_admin',
              membership_role=member_value,status='active',is_active=True,invited_email=email,invited_at=n,accepted_at=n,
              joined_at=n,created_at=n,updated_at=n,metadata={'debug_batch_2f_normalized':True}))
    conflict = [r for r in o.table('public.user_roles') if r['user_id'] == user and r['company_id'] == company
                and (r['role'] == 'company_admin' or r['role_id'] == role_id) and
                (r.get('is_active') is not False and r.get('status') in (None,'active'))]
    if not conflict:
        o.new('public.user_roles',dict(user_id=user,role_id=role_id,role='company_admin',company_id=company,
              status='active',is_active=True,created_at=n))
    for row in o.table('public.user_roles'):
        if row['user_id'] == user and row['company_id'] in (company,None) and (row['role'] == 'company_admin' or row['role_id'] == role_id):
            o.update('public.user_roles',row,dict(role_id=row['role_id'] or role_id,role='company_admin',status='active',is_active=True,company_id=company))
        if row['user_id'] == old and row['company_id'] == company:
            o.update('public.user_roles',row,dict(status='inactive',is_active=False))
    if o.present('public.company_invitations'):
        for row in o.table('public.company_invitations'):
            if row['company_id'] == company and email.lower() in ((row.get('email') or row.get('invited_email') or '').lower(),
                                                                 (row.get('invited_email') or row.get('email') or '').lower()):
                o.update('public.company_invitations',row,dict(status='accepted',invited_user_id=user,
                         accepted_at=row.get('accepted_at') or n,expires_at=None,updated_at=n,
                         metadata=o.metadata(row,{'debug_batch_2f_accepted':True})))


# Runtime ownership is bound before the accepted prefix starts. No test runner is
# imported here; the compatibility oracle module re-exports the semantics above.
P_NAME = '20260911095503_canonical_user_rbac_fixed_target_prerequisites.sql'
X_NAME = '20260911095505_canonical_user_rbac_fixed_target_restoration.sql'
FORWARD = {'P': ('50a29a266a5c270ebcbd407099d5bc408291ad1115e478002f5d114131e8ad80', 27), 'X': ('79d345f2d3dd36099431711ec3b774a6a950f541e0b3866644b4de9495f46503', 93)}
_DATABASE = replay.DATABASE
_REFERENCES = weakref.WeakKeyDictionary()
_RUNS = weakref.WeakKeyDictionary()
_RELEASES = weakref.WeakKeyDictionary()
SEEDS = frozenset(('public.roles','public.permissions','public.role_permissions'))
CHECK_KEY = 'constraint/public.company_memberships/company_memberships_role_check'


def reviewed_paths():
    return tuple(ROOT/'supabase/migrations'/name for name in
                 (P_NAME,*(spec[0] for spec in SPECS.values()),X_NAME))


def validate_sources(paths, staging=None):
    check(tuple(paths) == reviewed_paths(), 'COMPLETE_FIXED_GROUP_REQUIRED')
    check(staging is None or type(staging) is legacy.StagedSources, 'EXACT_FIXED_STAGING_REQUIRED')
    sources = []
    additions = json.loads((ROOT/'scripts/migration-history-manifest.additions.json').read_text())['files']
    for path,key in zip(paths,('P',*SPECS,'X')):
        if key in SPECS:
            sources.append(Source(key, path, staging))
            continue
        check(not path.is_symlink() and path.resolve() == path, 'COMPLETE_FORWARD_SOURCE_REQUIRED')
        data = repair.read_source(path,staging)
        digest,lines = FORWARD[key]
        legacy.verify_bytes(data,digest,lines)
        check(additions.get(path.name) == digest, 'FORWARD_MANIFEST_REQUIRED')
        sources.append(type('ForwardSource',(),{'key':key,'path':path,'data':data})())
    slots = [sources[i].slots for i in (2,3,4)]
    check(slots[0] == slots[1] and all(slots[0][key] == slots[2][key]
          for key in ('U_target','C_target','email')), 'SHARED_SOURCE_SLOTS_REQUIRED')
    check(len({sources[1].slots['U_boot'],slots[0]['U_target'],slots[0]['U_actor'],slots[2]['U_old']}) == 4,
          'DISTINCT_SYNTHETIC_SUBJECTS_REQUIRED')
    return tuple(sources)


def encoded(snapshot):
    return json.dumps(snapshot,sort_keys=True,separators=(',',':')).encode()


def decoded(snapshot):
    value = json.loads(snapshot)
    return value[0],value[1]


def prerequisite_catalog(base):
    result = copy.deepcopy(base)
    declarations = {
        'column/public.companies/industry':dict(type='text',notnull=True,
            default="'electricity_supplier'::text",identity='',generated='',collation='"default"',acl=None),
        'column/public.company_memberships/suspended_at':dict(type='timestamp with time zone',notnull=False,
            default=None,identity='',generated='',collation='-',acl=None),
    }
    for key,column in declarations.items():
        check(key not in base, 'FRESH_PREREQUISITES_REQUIRED')
        result[key] = column
    return result


@dataclass(frozen=True,repr=False)
class Reference:
    name: str
    directory: str
    dedupe: object
    final_catalog: bytes
    originals: object
    inputs: object
    sources: tuple


@dataclass(frozen=True,repr=False)
class Reservation:
    reference: object
    s0: bytes
    s1: bytes
    token: str


def owned(target, stage=None):
    dedupe.require_owned(target)
    ref = _REFERENCES.get(target)
    check(type(ref) is Reference and target.name == ref.name and target.directory.name == ref.directory
          and dedupe._REFERENCES[target] is ref.dedupe and ref.dedupe.continuation,
          'FROZEN_FIXED_REFERENCE_REQUIRED')
    check(dedupe._STATES.get(target) not in ('TERMINAL','DISPOSED','SUCCEEDED'), 'UNPUBLISHED_FIXED_REQUIRED')
    if stage is not None:
        check(dedupe._STATES.get(target) == stage, 'FIXED_STAGE_REQUIRED')
    return ref


def prepare_reference(target):
    dedupe.require_owned(target)
    check(target not in _REFERENCES and target not in dedupe._STATES
          and dedupe._REFERENCES[target].continuation, 'FRESH_FIXED_REFERENCE_REQUIRED')
    inputs = replay.load_private()._ACTIVE.get(target)
    check(type(inputs) is replay.load_private().AcceptedInputs, 'PRIVATE_FIXED_PREPARATION_REQUIRED')
    inputs.owned()
    sources = validate_sources(reviewed_paths())
    _REFERENCES[target] = Reference(target.name,target.directory.name,dedupe._REFERENCES[target],
        encoded((prerequisite_catalog(dedupe._REFERENCES[target].final),[])),replay.originals_snapshot(),inputs,sources)


@dataclass(repr=False)
class NativeResult:
    stdout: str
    stderr: str
    code: int
    state: str
    lower: datetime
    upper: datetime


def run_private(target, sql, transaction=True):
    """Memory-only complete input, with server readiness before any private bytes."""
    owned(target)
    target.verify_logging()
    command = target.command(_DATABASE,transaction=transaction)+['-f','-']
    lower = datetime.now(timezone.utc)
    process = None
    payload = bytearray(sql.encode() if isinstance(sql,str) else sql)
    try:
        process = subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE,env=legacy.clean_environment())
        target.processes.append(process)
        process.stdin.write(b"SET log_min_messages=panic; SELECT 'FIXED_PRIVATE_READY' WHERE current_setting('log_min_messages')='panic' AND current_setting('log_min_error_statement')='panic' AND current_setting('log_parameter_max_length_on_error')='0';\n")
        process.stdin.flush()
        ready,_,_ = select.select([process.stdout],[],[],10)
        check(bool(ready) and process.stdout.readline()==b'FIXED_PRIVATE_READY\n','PRIVATE_SESSION_REQUIRED')
        stdout,stderr = process.communicate(bytes(payload),timeout=120)
    except (OSError,subprocess.TimeoutExpired):
        raise BoundaryError('PRIVATE_MEMORY_PROCESS_FAILED') from None
    finally:
        payload.clear()
        if process is not None and process.poll() is None:
            process.kill(); process.communicate()
    receipt = legacy.safe_receipt(stderr.decode(errors='replace'),process.returncode,'private')
    return NativeResult(stdout.decode(),stderr.decode(errors='replace'),process.returncode,
                        receipt['sqlstate'],lower,datetime.now(timezone.utc))


def query(target, sql):
    result = run_private(target,sql)
    check(result.code == 0 and result.state == '00000','FIXED_PRIVATE_QUERY_FAILED')
    return result.stdout


def snapshot(target):
    return decode_snapshot(query(target,snapshot_sql()))


def identity(target):
    ref = owned(target)
    raw = target.docker(['inspect','--format',
        '{{.HostConfig.NetworkMode}}|{{ index .Config.Labels "gridex.auth-legacy.owner" }}',ref.name])
    check(raw.decode().strip()=='none|'+ref.name,'OFFLINE_FIXED_OWNER_REQUIRED')
    check(query(target,"SELECT current_database(),current_user,inet_server_addr() IS NULL,inet_server_port() IS NULL,(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database());").strip()
          == _DATABASE+'|postgres|t|t|postgres','LOCAL_FIXED_DATABASE_REQUIRED')
    check(query(target,"SELECT count(*) FROM pg_constraint f JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace WHERE f.contype='f' AND pn.nspname IN ('public','auth','storage') AND cn.nspname NOT IN ('public','auth','storage');").strip()=='0','EXTERNAL_INCOMING_FK_REJECTED')


def foreign_keys(catalog):
    result = []
    for key,item in catalog.items():
        if not key.startswith('constraint/') or item['kind']!='f':
            continue
        match = re.fullmatch(r'FOREIGN KEY \(([^)]+)\) REFERENCES ([\w.]+)\(([^)]+)\)(.*)',item['definition'])
        check(match is not None,'FIXED_FK_DEFINITION_REQUIRED')
        parent = match[2] if '.' in match[2] else 'public.'+match[2]
        columns = tuple(x.strip().strip('"') for x in match[1].split(','))
        parents = tuple(x.strip().strip('"') for x in match[3].split(','))
        check(len(columns)==len(parents),'FIXED_FK_COLUMNS_REQUIRED')
        result.append((key.split('/')[1],columns,parent,parents))
    return result


def graph(catalog,rows):
    """Pin the admitted write/default graph and every reachable incoming action."""
    fks = foreign_keys(catalog)
    reachable = set(WRITE_TABLES)
    while True:
        expanded = reachable | {child for child,_,parent,_ in fks if parent in reachable}
        if expanded == reachable: break
        reachable = expanded
    for key,item in catalog.items():
        table = key.split('/')[1] if '/' in key else ''
        if key.startswith('event_trigger/'):
            check(item['enabled']=='D','UNREVIEWED_EVENT_TRIGGER')
        if key.startswith(('trigger/','rule/')):
            check(table not in WRITE_TABLES,'UNREVIEWED_WRITE_TRIGGER')
            if item['enabled']!='D' and table in reachable:
                check(key.startswith('trigger/') and 'FOR EACH ROW' in item['definition']
                      and not re.search(r'\bDELETE\b',item['definition'],re.I),'UNREVIEWED_INCOMING_HOOK')
        if key.startswith('relation/') and table in WRITE_TABLES:
            check(item['kind']=='r','ORDINARY_FIXED_TABLE_REQUIRED')
        if key.startswith('column/auth.users/'):
            default=item['default']
            check(default is None or default.startswith('NULL::') or
                  (key=='column/auth.users/is_anonymous' and default=='false') or
                  (key=='column/auth.users/confirmed_at' and item['generated']=='s'
                   and default=='LEAST(email_confirmed_at, phone_confirmed_at)'), 'AUTH_DEFAULT_REVIEW_REQUIRED')
        if key.startswith('column/') and table in WRITE_TABLES:
            check(not item['identity'],'SEQUENCE_CONSUMER_REJECTED')
            if item['generated']:
                expression = item['default']
                check((table=='auth.users' and key.endswith('/confirmed_at') and expression=='LEAST(email_confirmed_at, phone_confirmed_at)')
                      or (table=='public.companies' and key.endswith('/normalized_org_number')
                          and expression=='gridex_normalize_org_number(org_number)'), 'UNREVIEWED_GENERATED_EXPRESSION')
            else:
                # Exact catalog equality pins referenced functions; only reviewed
                # literals, UUID and clock defaults are reachable, never nextval.
                Oracle(sys.modules[__name__],({},[]),datetime.now(timezone.utc),datetime.now(timezone.utc)).default(item)
    for child,_,parent,_ in fks:
        if child in WRITE_TABLES:
            check(parent in WRITE_TABLES,'UNREVIEWED_FK_TARGET')
    for table,row in rows:
        if table in reachable-WRITE_TABLES or (table.startswith('auth.') and not table.endswith('_seq')):
            check(table in SEEDS,'EMPTY_DEPENDENT_GRAPH_REQUIRED')
    return fks


def capture_prefix(target):
    ref = owned(target,'H2_COMPLETE')
    check(target not in _RUNS,'FRESH_FIXED_RESERVATION_REQUIRED')
    identity(target)
    before = snapshot(target)
    check(before[0] == ref.dedupe.final,'ACTUAL57_FIXED_CATALOG_REQUIRED')
    for table,_ in before[1]:
        check(table not in WRITE_TABLES-SEEDS,'EMPTY_FIXED_BUSINESS_REQUIRED')
    graph(prerequisite_catalog(before[0]),before[1])
    expected_catalog = decoded(ref.final_catalog)[0]
    check(expected_catalog==prerequisite_catalog(before[0]),'INDEPENDENT_FIXED_CATALOG_REQUIRED')
    _RUNS[target] = Reservation(ref,encoded(before),encoded((expected_catalog,before[1])),uuid.uuid4().hex)


def constructor(before,sources):
    o = Oracle(sys.modules[__name__],before)
    boot,shared = sources[1],sources[2]
    stamp = '2020-01-01T00:00:00+00:00'
    values = [('auth.users',dict(id=boot.slots['U_boot'],email='fixed-bootstrap@example.invalid')),
              ('auth.users',dict(id=shared.slots['U_target'],email=shared.slots['email'])),
              ('auth.users',dict(id=shared.slots['U_actor'],email='fixed-actor@example.invalid')),
              ('public.companies',dict(id=shared.slots['C_target'],name='Synthetic fixed target',
                 slug=boot.literal(209),status='active',created_by=None,updated_by=None))]
    statements=[]
    for table,overrides in values:
        columns=o.columns(table)
        row={}
        for name,column in columns.items():
            if column['generated']: continue
            if column['default'] in ('now()','CURRENT_TIMESTAMP'): row[name]=stamp
            elif column['default'] in ('gen_random_uuid()','extensions.gen_random_uuid()'):
                check(name=='id' and name in overrides,'EXPLICIT_CONSTRUCTOR_UUID_REQUIRED'); row[name]=overrides[name]
            else: row[name]=o.default(column)
        row.update(overrides)
        check(set(row)=={k for k,v in columns.items() if not v['generated']},'CONSTRUCTOR_COLUMNS_REQUIRED')
        check(all(row[k] is not None or not v['notnull'] for k,v in columns.items() if not v['generated']),
              'CONSTRUCTOR_REQUIRED_COLUMN')
        if table=='auth.users':
            check(all(value is None for key,value in row.items() if key not in ('id','email','created_at','updated_at','is_anonymous'))
                  and row.get('is_anonymous') in (None,False),'PROVIDER_FREE_CONSTRUCTOR_REQUIRED')
        statements.append('INSERT INTO '+qualified(table)+' ('+','.join(ident(k) for k in row)+') VALUES ('+
                          ','.join(value_sql(v) for v in row.values())+');')
        o.generated_columns(table,row); o.table(table).append(row)
    check(len(o.table('public.companies'))==1,'ONE_SHARED_COMPANY_REQUIRED')
    return '\n'.join(statements),o


def cleanup_plan(before,after):
    """Exact captured PK differences and a row-specific child-first ordering."""
    original={(table,row['id']):row for table,row in before[1] if table in WRITE_TABLES}
    current={(table,row['id']):row for table,row in after[1] if table in WRITE_TABLES}
    check(len(original)==sum(table in WRITE_TABLES for table,_ in before[1])
          and len(current)==sum(table in WRITE_TABLES for table,_ in after[1]),'EXACT_PRIMARY_KEYS_REQUIRED')
    check(set(original)<=set(current),'ORIGINAL_SEED_IDENTITY_LOST')
    generated={key:row for key,row in current.items() if key not in original}
    restored=[]
    for (table,key),row in original.items():
        check(table in SEEDS,'ORIGINAL_BUSINESS_FORBIDDEN')
        if current[table,key]!=row:
            restored.append(dict(table=table,before=row,after=current[table,key]))
    fks=foreign_keys(after[0]); deletions=[]
    while generated:
        candidates=[]
        for key,row in generated.items():
            parent=key[0]
            descendants=[]
            for child,columns,relation,parents in fks:
                if relation!=parent: continue
                for child_key,child_row in current.items():
                    if child_key[0]==child and all(child_row[col] is not None and child_row[col]==row[ref]
                                                   for col,ref in zip(columns,parents)):
                        descendants.append(child_key)
            if not descendants: candidates.append(key)
        check(candidates,'CAPTURED_GRAPH_NOT_CHILD_FIRST')
        priority=('public.audit_logs','public.company_invitations','public.company_memberships','public.user_roles',
                  'public.user_profiles','public.companies','auth.users','public.role_permissions','public.permissions','public.roles')
        key=min(candidates,key=lambda item:(priority.index(item[0]),item[1]))
        deletions.append(dict(table=key[0],row=generated.pop(key)))
        current.pop(key)
    return deletions,restored


def cleanup_input(target,sources,post):
    reservation=_RUNS[target]; before=decoded(reservation.s1)
    deletions,restorations=cleanup_plan(before,post)
    envelope=dict(database=_DATABASE,owner=target.name,stage='F2_COMPLETE',reservation=reservation.token,
                  hashes=[hashlib.sha256(s.data).hexdigest() for s in sources],post_catalog=post[0],post_rows=post[1],
                  deletions=deletions,restorations=restorations,membership_check=before[0][CHECK_KEY])
    context="CREATE TEMP TABLE fixed_restoration_reservation(owner text NOT NULL,reservation text NOT NULL,hashes jsonb NOT NULL,database_name text NOT NULL,backend integer NOT NULL,transaction_id bigint NOT NULL,stage text NOT NULL) ON COMMIT DROP;\n"
    context+="INSERT INTO fixed_restoration_reservation SELECT "+value_sql(target.name)+","+value_sql(reservation.token)+","+value_sql(envelope['hashes'])+",current_database(),pg_backend_pid(),txid_current(),'F2_COMPLETE';\n"
    context+="CREATE TEMP TABLE fixed_restoration_context(value jsonb NOT NULL) ON COMMIT DROP;\n"
    context+="INSERT INTO fixed_restoration_context SELECT "+value_sql(envelope)+" || jsonb_build_object('backend',pg_backend_pid()::text,'transaction',txid_current()::text);\n"
    context+=repair.catalog_capture('fixed_post_catalog')+'\n'
    context+=ROWS_SQL.replace("SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM fixed_rows;",
            "CREATE TEMP TABLE fixed_post_rows ON COMMIT DROP AS SELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') AS rows FROM fixed_rows;")
    return context.encode()+b'\n'+sources[-1].data


def execute(target,database,paths,staging):
    ref=owned(target,'FIXED_NATIVE')
    check(database==_DATABASE and type(staging) is legacy.StagedSources,'ACTUAL_FIXED_STAGING_REQUIRED')
    inputs=ref.inputs; inputs.owned()
    check(inputs.staging is staging,'SAME_FIXED_STAGING_REQUIRED')
    sources=validate_sources(paths,staging)
    reservation=_RUNS.get(target)
    check(type(reservation) is Reservation and reservation.reference is ref,'FIXED_RESERVATION_REQUIRED')
    identity(target)
    before=snapshot(target)
    check(encoded(before)==reservation.s0,'FIXED_PREIMAGE_CHANGED')
    graph(prerequisite_catalog(before[0]),before[1])
    expected=decoded(reservation.s1)
    result=run_private(target,sources[0].data)
    check(result.code==0 and result.state=='00000','FIXED_PREREQUISITES_FAILED')
    check(snapshot(target)==expected,'INDEPENDENT_S1_MISMATCH')
    sql,oracle=constructor(expected,sources)
    result=run_private(target,sql)
    check(result.code==0 and result.state=='00000','FIXED_CONSTRUCTOR_FAILED')
    post=snapshot(target); oracle.assert_snapshot(post)
    for source in sources[1:-1]:
        result=run_private(target,source.refresh(),transaction=source.key in ('B0','C2'))
        check(result.code==0 and result.state=='00000','FIXED_NATIVE_SOURCE_FAILED')
        oracle=Oracle(sys.modules[__name__],post,result.lower,result.upper)
        if source.key=='B0': bootstrap(oracle,source)
        elif source.key in ('C2','D2'): activate(oracle,source)
        else: normalize(oracle,source)
        post=snapshot(target); oracle.assert_snapshot(post)
        target_members=[r for table,r in post[1] if table=='public.company_memberships' and r['user_id']==sources[2].slots['U_target']]
        if source.key=='C2': check(not target_members,'C2_ABSENT_MEMBERSHIP_REQUIRED')
        if source.key in ('D2','F2'): check(len(target_members)==1,'D2_F2_MEMBERSHIP_REQUIRED')
    current=validate_sources(paths,staging)
    check(all(a.data==b.data for a,b in zip(current,sources)),'FIXED_STAGED_INPUT_CHANGED')
    result=run_private(target,cleanup_input(target,sources,post))
    check(result.code==0 and result.state=='00000','FIXED_RESTORATION_FAILED')
    check(snapshot(target)==expected,'LOSSLESS_FIXED_RESTORATION_REQUIRED')
    # Completed equality is separate from the immutable reference and reservation.
    _RELEASES[target]=reservation
    return {'sources':6}


def assert_final(target):
    owned(target)
    reservation=_RUNS.get(target)
    check(type(reservation) is Reservation and _RELEASES.get(target) is reservation,'FIXED_COMPLETION_REQUIRED')
    check(snapshot(target)==decoded(reservation.s1),'FIXED_FINAL_MISMATCH')


def privacy(target):
    ref=_REFERENCES.get(target)
    check(type(ref) is Reference,'FIXED_PRIVACY_OWNER_REQUIRED')
    ref.inputs.__exit__(None,None,None)
    # Pins/slots were captured before staging and stay available during terminal
    # disposal even while the child restores HOLD. No fallback reads real users.
    source_map={source.key:source for source in ref.sources if source.key in SPECS}
    core=type('PrivateCore',(),{'Source':staticmethod(lambda key:source_map[key]),'SPECS':SPECS,
                              'legacy':legacy,'check':staticmethod(check),'AcceptedInputs':AcceptedInputs})
    replay.load_private().privacy(core,type('PrivateProof',(),{
        'h':target,'name':ref.name,'directory':ref.directory,'accepted_inputs':ref.inputs})())


def release_checks(target,full=False):
    ref=owned(target,'FIXED_COMPLETE')
    frame=sys._getframe(2)
    check(frame.f_code is replay._serve_child.__code__ and frame.f_locals.get('h') is target
          and type(frame.f_locals.get('loop')) is replay.FoundationLoop
          and frame.f_locals['loop'].target is target and frame.f_locals.get('status')==0
          and frame.f_locals['child'].poll()==0 and frame.f_locals['server'].fileno()==-1
          and not (Path(ref.directory)/'replay.sock').exists(),'SUCCESSFUL_ORIGINAL_CHILD_REQUIRED')
    if not full:
        assert_final(target)
    else:
        check(_RELEASES.get(target) is _RUNS.get(target),'FIXED_COMPLETION_REQUIRED')
    check(replay.originals_snapshot()==ref.originals,'FIXED_ORIGINALS_RESTORATION_REQUIRED')
    privacy(target)
    return _RUNS[target]
