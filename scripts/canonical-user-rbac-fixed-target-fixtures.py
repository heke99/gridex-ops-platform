"""Provider-free synthetic fixtures; reduced layouts are explicitly named.

The actual lane always clones the accepted57 target without changing guards.
Reduced databases reconstruct only the closed fixture graph, never assert actual
canonical compatibility, and never replace actual successes/rejections.
"""
import copy
import re
import uuid
from datetime import datetime, timezone

STAMP = '2020-01-01T00:00:00+00:00'
OTHER_EMAIL = 'unrelated-fixed-proof@example.invalid'
TABLE_ORDER = ('auth.users','public.roles','public.permissions','public.companies',
               'public.role_permissions','public.company_memberships','public.user_roles',
               'public.user_profiles','public.company_invitations','public.audit_logs')


def synthetic(slot):
    return str(uuid.uuid5(uuid.NAMESPACE_OID,'gridex-private-fixed-fixture/'+slot))


class Fixture:
    def __init__(self, core, models, proof, source, case, options):
        self.c,self.models,self.proof,self.source,self.case,self.options = core,models,proof,source,case,options
        self.database = proof.clone(source,case)
        if options.get('reduced'):
            self.reduced()
        self.before = proof.snapshot(self.database)
        self.catalog = self.before[0]
        proof.graph(self.catalog)
        self.oracle = models.Oracle(core,self.before)
        self.statements = []
        self.ids = {'other_user':synthetic('other_user'),'other_company':synthetic('other_company'),
                    'other_role':synthetic('other_role'),'other_actor':synthetic('other_actor')}

    def reduced(self):
        """Independent empty database with actual column definitions and a closed
        minimum graph. Every omitted/changed shape is named by case options.
        It is NOT the accepted57 target, a migration or a lossless continuation.
        """
        c,p,h = self.c,self.proof,self.proof.h
        p.owned(self.database)
        h.reset(self.database)
        catalog = p.origin[0]
        omitted = set(self.options.get('omit_tables',()))
        omitted_columns = self.options.get('omit_columns',{})
        sql = ['CREATE SCHEMA auth;', 'CREATE SCHEMA extensions;']
        if not self.options.get('extension_absent'):
            sql.append('CREATE EXTENSION pgcrypto WITH SCHEMA extensions;')
        # Exactly the reviewed pure company generated-column helper, not a DO
        # child from any fixed source. No provider or Auth callback is installed.
        helper = catalog.get('function/public.gridex_normalize_org_number(p_value text)')
        c.check(helper is not None, 'REDUCED_NORMALIZER_REQUIRED')
        sql.append(helper['definition']+';')
        enum = self.options.get('enum')
        if enum:
            name,labels = enum
            sql.append('CREATE TYPE public.'+c.ident(name)+' AS ENUM ('+','.join(c.value_sql(v) for v in labels)+');')
        for table in TABLE_ORDER:
            if table in omitted:
                continue
            columns = {k.split('/')[-1]:copy.deepcopy(v) for k,v in catalog.items() if k.startswith('column/'+table+'/')}
            if self.source.key == 'B0':
                if table == 'public.companies':
                    columns['industry'] = dict(type='text',default=c.value_sql(self.source.literal(232))+'::text',notnull=True,generated='',identity='',collation='"default"',acl=None)
                if table == 'public.company_memberships' and self.options.get('b0_columns') != 'industry':
                    columns['suspended_at'] = dict(type='timestamp with time zone',default=None,notnull=False,generated='',identity='',collation='-',acl=None)
            for column in omitted_columns.get(table,()):
                columns.pop(column,None)
            definitions = []
            for name,column in columns.items():
                typename = column['type']
                default = column['default']
                nullable = not column['notnull']
                if name == 'membership_role' and table == 'public.company_memberships' and enum:
                    typename = 'public.'+c.ident(enum[0])
                    default = c.value_sql(enum[1][-1])+'::'+typename
                if name == 'membership_role' and table == 'public.company_invitations' and self.options.get('invitation_enum'):
                    # Independent type intentionally differs from membership type.
                    sql.append("CREATE TYPE public.fixed_invitation_role AS ENUM ('company_admin','member');")
                    typename,default = 'public.fixed_invitation_role',"'member'::public.fixed_invitation_role"
                if (table,name) in self.options.get('nullable',()):
                    nullable = True
                if (table,name) in self.options.get('no_default',()):
                    default = None
                definition = c.ident(name)+' '+typename
                if column['generated']:
                    definition += ' GENERATED ALWAYS AS ('+default+') STORED'
                elif default is not None:
                    definition += ' DEFAULT '+default
                if not nullable:
                    definition += ' NOT NULL'
                definitions.append(definition)
            sql.append('CREATE TABLE '+c.qualified(table)+' ('+','.join(definitions)+');')
        for table in TABLE_ORDER:
            if table in omitted:
                continue
            for key,item in catalog.items():
                if not key.startswith('constraint/'+table+'/'):
                    continue
                definition = item['definition']
                missing = omitted_columns.get(table,())
                if any(re.search(r'\b'+re.escape(col)+r'\b',definition) for col in missing):
                    continue
                if enum and table == 'public.company_memberships' and item['kind'] == 'c' and 'membership_role' in definition:
                    continue
                if self.options.get('invitation_enum') and table == 'public.company_invitations' and item['kind'] == 'c' and 'membership_role' in definition:
                    continue
                if item['kind'] == 'f':
                    match = re.search(r'REFERENCES ([\w.]+)\(',definition)
                    parent = match[1] if '.' in match[1] else 'public.'+match[1]
                    if parent in omitted:
                        continue
                sql.append('ALTER TABLE '+c.qualified(table)+' ADD CONSTRAINT '+c.ident(key.split('/')[-1])+' '+definition+';')
        # Explicitly reduced tests retain pair/key/link uniqueness; H2 remains
        # present unless an absent column makes that historical shape impossible.
        if not self.options.get('without_active_arbiters') and not set(omitted_columns.get('public.user_roles',())) & {'role','role_id','status','is_active'}:
            sql.append(c.dedupe.index_declarations())
        if self.options.get('actor_fk'):
            for table in ('public.company_memberships','public.company_invitations'):
                sql.append('ALTER TABLE '+c.qualified(table)+' ADD CONSTRAINT fixed_actor_fk FOREIGN KEY (invited_by) REFERENCES auth.users(id);')
        result = p.run(self.database,'\n'.join(sql))
        c.check(result.code == 0, 'REDUCED_CONSTRUCTOR_FAILED')
        p.identity(self.database)
        current = p.snapshot(self.database)
        p.graph(current[0])
        # Independent exact authored relation/column set before any row values.
        wanted_tables = set(TABLE_ORDER)-omitted
        got_tables = {key.split('/')[1] for key,v in current[0].items() if key.startswith('relation/') and v['kind']=='r'}
        c.check(got_tables == wanted_tables, 'REDUCED_RELATION_SHAPE')
        for table in wanted_tables:
            expected = {key.split('/')[-1] for key in catalog if key.startswith('column/'+table+'/')}-set(omitted_columns.get(table,()))
            if self.source.key == 'B0' and table == 'public.companies':
                expected.add('industry')
            if self.source.key == 'B0' and table == 'public.company_memberships' and self.options.get('b0_columns') != 'industry':
                expected.add('suspended_at')
            actual = {key.split('/')[-1] for key in current[0] if key.startswith('column/'+table+'/')}
            c.check(expected == actual, 'REDUCED_COLUMN_SHAPE')
        c.check(not current[1], 'REDUCED_FRESH_ROWS_REQUIRED')

    def insert(self, table, values, slot):
        o,c = self.oracle,self.c
        if not o.present(table):
            return None
        columns = o.columns(table)
        values = dict(values)
        if 'id' in columns:
            values.setdefault('id',synthetic(self.case+'/'+slot))
        row = {}
        for name,column in columns.items():
            if column['generated']:
                continue
            default = column['default']
            if default in ('now()','CURRENT_TIMESTAMP'):
                row[name] = STAMP
            elif default in ('gen_random_uuid()','extensions.gen_random_uuid()'):
                row[name] = synthetic(self.case+'/'+slot+'/'+name)
            else:
                row[name] = o.default(column)
        row.update(values)
        c.check(set(row) == {k for k,v in columns.items() if not v['generated']}, 'FIXTURE_EXPLICIT_COLUMNS')
        c.check(self.options.get('setup_error') or all(row[k] is not None or not v['notnull'] for k,v in columns.items() if not v['generated']),
                'FIXTURE_REQUIRED_COLUMN')
        # Credential-bearing Auth columns stay NULL; synthetic invitation UUIDs
        # are nonredeemable offline fixture data, never issuer/app credentials.
        if table == 'auth.users':
            c.check(all(row.get(k) is None for k in ('encrypted_password','confirmation_token','recovery_token',
                     'email_confirmed_at','last_sign_in_at','raw_app_meta_data','raw_user_meta_data')), 'PROVIDER_FREE_AUTH_REQUIRED')
        self.statements.append('INSERT INTO '+c.qualified(table)+' ('+','.join(c.ident(k) for k in row)+') VALUES ('+
                               ','.join(c.value_sql(v) for v in row.values())+');')
        expected = dict(row)
        o.generated_columns(table,expected)
        o.table(table).append(expected)
        return expected

    def seed(self):
        c,s,o = self.c,self.source.slots,self.oracle
        options = self.options
        # All identities are freshly fabricated; there are no real-account reads.
        users = {self.ids['other_user']:OTHER_EMAIL,self.ids['other_actor']:'actor-fixed-proof@example.invalid'}
        for symbol in ('U_boot','U_target','U_actor','U_old'):
            if symbol == 'U_old' and not (options.get('membership') in ('old','both') or options.get('role_row') == 'old' or options.get('invitation') or options.get('other_old')):
                continue
            if symbol in s and not options.get('no_'+symbol):
                users[s[symbol]] = s.get('email','boot-fixed-proof@example.invalid') if symbol in ('U_boot','U_target') else symbol.lower()+'@fixed-proof.invalid'
        for number,(identity,email) in enumerate(users.items()):
            self.insert('auth.users',dict(id=identity,email=email),'auth-'+str(number))
        self.insert('public.companies',dict(id=self.ids['other_company'],name='Unrelated private company',status='active'),'other-company')
        self.insert('public.roles',dict(id=self.ids['other_role'],key='fixed_unrelated_role',name='Fixed unrelated role'),'other-role')
        # Accepted prefix normally has these canonical keys. Reduced fixtures
        # start empty and receive their own synthetic role identities.
        for key in ('company_admin','super_admin'):
            if key=='company_admin' and options.get('no_role'):
                continue
            if not o.by('public.roles',key=key):
                self.insert('public.roles',dict(key=key,name=key),'role-'+key)
        role = self.ids['other_role'] if options.get('no_role') else o.one('public.roles',key='company_admin')['id']
        self.ids['role'] = role
        if 'C_target' in s and not options.get('no_company'):
            self.insert('public.companies',dict(id=s['C_target'],name='Synthetic target company',status=options.get('company_status','archived')),'target-company')
        if self.source.key == 'B0':
            if options.get('match'):
                values = dict(name='Synthetic matched company',status='onboarding')
                if options['match'] in ('slug','tie'):
                    values['slug'] = self.source.literal(209)
                else:
                    values['org_number'] = self.source.literal(228)
                first = self.insert('public.companies',values,'matched-company')
                self.ids['winner'] = first['id']
                if options['match'] == 'tie':
                    self.insert('public.companies',dict(name='Synthetic organization match',org_number=self.source.literal(228),status='onboarding'),'other-match')
            if not options.get('no_U_boot'):
                self.insert('public.user_profiles',dict(id=s['U_boot'],email='preserved-profile@example.invalid',full_name='Preserved synthetic profile',user_status='disabled'),'boot-profile')
            if o.present('public.permissions'):
                self.insert('public.permissions',dict(key='fixed.unrelated',name='Unrelated fixture permission'),'permission-canary')
        else:
            user,company,email = s['U_target'],s['C_target'],s['email']
            if not options.get('no_U_target') and not options.get('no_company'):
                self.insert('public.user_profiles',dict(id=user,email='prior-profile@example.invalid',full_name='',user_status='disabled',active_company_id=self.ids['other_company']),'target-profile')
            member = options.get('membership','existing')
            if member in ('existing','old','both','collision','email_only') and o.present('public.company_memberships'):
                chosen = None if member == 'email_only' else s.get('U_old') if member in ('old','both') else user
                values = dict(company_id=company,user_id=chosen,role='member',role_id=self.ids['other_role'],status='suspended',
                              is_active=False,invited_email=email,joined_at=None,accepted_at=None)
                if 'membership_role' in o.columns('public.company_memberships'):
                    values['membership_role'] = options.get('initial_member_value','member')
                self.insert('public.company_memberships',values,'membership')
                if member in ('both','collision'):
                    self.insert('public.company_memberships',dict(values,user_id=user if member == 'both' else self.ids['other_user']),'collision-membership')
            if options.get('role_row'):
                shape = options['role_row']
                role_values = dict(user_id=user,role_id=self.ids['other_role'] if shape in ('inconsistent','null_text') else role,
                                   role=None if shape == 'null_text' else 'company_admin',
                                   company_id=None if shape in ('null_company','null_text') else company,status='active' if shape == 'inconsistent' else 'inactive',is_active=shape == 'inconsistent')
                if shape == 'old':
                    role_values['user_id'] = s['U_old']
                self.insert('public.user_roles',role_values,'role-row')
            if options.get('blank_role'):
                self.insert('public.roles',dict(key='',name='fixed_blank_key'),'blank-role')
            if options.get('invitation') and o.present('public.company_invitations'):
                aliases = options['invitation']
                columns = o.columns('public.company_invitations')
                values = dict(company_id=company,status=options.get('invitation_status','revoked'))
                for column in ('email','invited_email'):
                    if column in columns:
                        values[column] = None if aliases == 'null_'+column else email if aliases in ('both',column,'null_email','null_invited_email') else OTHER_EMAIL
                values.update({k:v for k,v in dict(invited_user_id=s.get('U_old',self.ids['other_user']),
                    invited_by=self.ids['other_actor'],membership_role='member',role_key='member',
                    expires_at=STAMP,revoked_at=STAMP,accepted_at=STAMP if options.get('accepted') else None).items() if k in columns})
                self.insert('public.company_invitations',values,'invitation')
                if options.get('second_alias'):
                    self.insert('public.company_invitations',dict(values,email=OTHER_EMAIL,invited_email=email),'second-alias')
            if options.get('other_target_role'):
                self.insert('public.user_roles',dict(user_id=user,company_id=self.ids['other_company'],role_id=role,role='company_admin',status='inactive',is_active=False),'other-target-role')
            if options.get('role_name_tie'):
                self.insert('public.roles',dict(key='fixed_name_tie',name='company_admin'),'role-name-tie')
            if options.get('other_old'):
                self.insert('public.company_memberships',dict(company_id=self.ids['other_company'],user_id=s['U_old'],role='member',status='active'),'other-old-membership')
                self.insert('public.user_roles',dict(company_id=self.ids['other_company'],user_id=s['U_old'],role='member',role_id=self.ids['other_role'],status='active'),'other-old-role')
                if o.present('public.company_invitations'):
                    self.insert('public.company_invitations',dict(company_id=self.ids['other_company'],email=OTHER_EMAIL,invited_email=OTHER_EMAIL,invited_user_id=s['U_old'],status='pending'),'other-old-invitation')
        # Every fixture's unrelated rows and sequences are in the exact oracle.
        self.proof.identity(self.database)
        self.proof.graph(self.catalog)
        result = self.proof.run(self.database,'\n'.join(self.statements))
        if options.get('setup_error'):
            c.check(result.code != 0 and result.state == '23502' and 'violates not-null constraint' in result.stderr,'ACTUAL_NATIVE_NOT_NULL_REQUIRED')
            c.check(self.proof.snapshot(self.database)==self.before,'FIXTURE_ERROR_ROLLBACK_REQUIRED')
            return None
        c.check(result.code == 0, 'FIXTURE_NATIVE_SETUP_FAILED')
        self.oracle.assert_snapshot(self.proof.snapshot(self.database))
        return self.proof.snapshot(self.database)
