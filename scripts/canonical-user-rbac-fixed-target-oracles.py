"""Independent field/PK expectations for private historical source cases.

No SQL from a historical source is used as an expectation executor. Generated
UUIDs are fresh typed placeholders, resolved once and related across rows.
Only explicitly expected source timestamps share a bounded transaction clock.
"""
import copy
import json
import re
import uuid
from datetime import datetime

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
