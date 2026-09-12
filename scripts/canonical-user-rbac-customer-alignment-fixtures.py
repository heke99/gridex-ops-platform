"""Synthetic rows on full actual63 clones; never reduced prefix substitution.

Fixture preimages may be observed after constructor INSERTs. Expected source
postimages are always calculated independently from those complete preimages.
"""
import json
import re
import uuid

STAMP = '2020-01-01T00:00:00+00:00'


def uid(label):
    return str(uuid.uuid5(uuid.NAMESPACE_OID, 'alignment-synthetic/' + label))


class Fixture:
    def __init__(self, c, proof, database):
        self.c, self.p, self.db = c, proof, database
        self.shape = proof.snapshot(database)[0]
        self.rows = {}
        self.serial = 0

    def attrs(self, table):
        return self.c.batch.columns(self.shape, table)

    def literal(self, value):
        if value is None:
            return 'NULL'
        if type(value) is bool:
            return 'true' if value else 'false'
        if type(value) in (int, float):
            return str(value)
        if type(value) in (dict, list):
            return self.c.batch.json_sql(value)
        return self.c.batch.literal(value)

    def fk_parent(self, table, column):
        for key, item in self.shape.items():
            if not key.startswith('constraint/public.' + table + '/') or item['kind'] != 'f':
                continue
            match = re.search(r'FOREIGN KEY \(([^)]+)\) REFERENCES ([\w.]+)\(([^)]+)\)', item['definition'])
            if match and match[1] == column:
                self.c.check(match[3] == 'id', 'ALIGNMENT_FIXTURE_FK_SOURCE_REQUIRED')
                return match[2].removeprefix('public.')
        return None

    def value(self, table, name, item, label):
        if item['default'] is not None:
            return None, True
        if not item['notnull']:
            return None, False
        parent = self.fk_parent(table, name)
        if parent is not None:
            self.c.check(parent != table, 'ALIGNMENT_SELF_PARENT_SOURCE_REQUIRED')
            return self.add(parent, label + '-' + name), False
        kind = item['type']
        if name == 'id' or kind == 'uuid':
            return uid(label + '/' + name), False
        if kind in ('text', 'character varying') or kind.startswith('character varying('):
            # Native source CHECK/enum restrictions remain enforced. Unknown
            # required semantics fail setup and demand concrete source evidence.
            return 'alignment-' + label + '-' + name, False
        if kind in ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision') or kind.startswith('numeric('):
            return 1, False
        if kind == 'boolean':
            return False, False
        if kind in ('timestamp with time zone', 'timestamp without time zone', 'date'):
            return STAMP[:10] if kind == 'date' else STAMP, False
        if kind in ('json', 'jsonb'):
            return {}, False
        raise self.c.batch.BoundaryError('ALIGNMENT_FIXTURE_TYPE_SOURCE_REQUIRED')

    def add(self, table, label, **overrides):
        key = table, label
        if key in self.rows:
            return self.rows[key]
        attrs = self.attrs(table)
        self.c.check(attrs and 'id' in attrs, 'ALIGNMENT_FIXTURE_ACTUAL_TABLE_REQUIRED')
        values = {'id': uid(table + '/' + label), **overrides}
        self.c.check(set(values) <= set(attrs), 'ALIGNMENT_FIXTURE_COLUMN_SOURCE_REQUIRED')
        self.rows[key] = values['id']
        for name, item in attrs.items():
            if name in values or item['generated']:
                continue
            value, default = self.value(table, name, item, label)
            if not default:
                values[name] = value
        sql = 'INSERT INTO public.' + self.c.batch.ident(table) + ' (' + ','.join(self.c.batch.ident(k) for k in values) + ') VALUES (' + ','.join(self.literal(v) for v in values.values()) + ');'
        self.p.query(self.db, sql)
        return values['id']

    def base(self):
        self.company = self.add('companies', 'company-a', name='Alignment A', slug='alignment-a', status='active')
        self.other = self.add('companies', 'company-b', name='Alignment B', slug='alignment-b', status='active')
        self.customer = self.add('customers', 'customer-a', company_id=self.company, status='active')
        self.other_customer = self.add('customers', 'customer-b', company_id=self.other, status='active')
        self.null_customer = self.add('customers', 'customer-null', company_id=None, status='active')
        self.site = self.add('customer_sites', 'site-a', customer_id=self.customer, company_id=self.company)
        self.null_site = self.add('customer_sites', 'site-null', customer_id=self.null_customer, company_id=None)
        return self

    def backfill_rows(self):
        self.base()
        b = self.c.batch.model
        for table in b.B_CUSTOMERS:
            for label, company, customer in (('dirty', None, self.customer), ('populated', self.other, self.customer),
                                              ('parent-null', None, self.null_customer)):
                values = dict(company_id=company, customer_id=customer)
                if table == 'customer_sites':
                    values['site_name'] = 'alignment-' + label if 'site_name' in self.attrs(table) else None
                    if values['site_name'] is None:
                        del values['site_name']
                self.add(table, table + '-' + label, **values)
        for label, site, company, customer in (
            ('dirty', self.site, None, None), ('populated', self.site, self.other, self.other_customer),
            ('overwrite', self.null_site, None, self.other_customer), ('conflict', self.site, self.other, None)):
            values = dict(site_id=site, company_id=company, customer_id=customer)
            if not self.attrs('metering_points')['updated_at']['notnull']:
                values['updated_at'] = None
            self.add('metering_points', label, **values)
        parent = self.rows[('supplier_switch_requests', 'supplier_switch_requests-dirty')]
        message = self.rows[('ediel_messages', 'ediel_messages-dirty')]
        for table, column, parent_id in (('supplier_switch_events', 'switch_request_id', parent),
                                         ('ediel_inbound_cases', 'ediel_message_id', message),
                                         ('customer_portal_events', 'customer_id', self.customer)):
            for label, company in (('dirty', None), ('populated', self.other)):
                values = {column: parent_id, 'company_id': company}
                if 'updated_at' in self.attrs(table) and not self.attrs(table)['updated_at']['notnull']:
                    values['updated_at'] = None
                self.add(table, label, **values)
        return self

    def tgt(self, label, **values):
        defaults = dict(company_id=self.company, test_suite='alignment-' + label,
                        role_code='role', test_case_code='case', data_key='portal_payload',
                        payload={'legacy': label}, is_active=True)
        defaults.update(values)
        return self.add('ediel_tgt_test_data', label, **defaults)
