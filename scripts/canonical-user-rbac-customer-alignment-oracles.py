"""Independent whole-source row and owner-only RPC semantics, derived from A/B/C.

No database output, W implementation or test module supplies expected values.
Application ownership/authority convergence is intentionally outside this model.
"""
import copy
from collections import Counter, defaultdict
from datetime import datetime
from functools import cmp_to_key
import re

B_CUSTOMERS = ('customer_sites', 'customer_internal_notes', 'customer_authorization_documents',
               'powers_of_attorney', 'power_of_attorney_scopes', 'customer_portal_accounts',
               'customer_portal_claims', 'grid_owner_data_requests', 'metering_values',
               'billing_underlays', 'partner_exports', 'outbound_requests',
               'supplier_switch_requests', 'ediel_messages')
DML_TABLES = frozenset((*B_CUSTOMERS, 'metering_points', 'supplier_switch_events',
                        'ediel_tgt_test_data', 'ediel_inbound_cases', 'customer_portal_events'))
C_BRANCHES = (('ediel_inbound_cases', 'ediel_messages', 'ediel_message_id'),
              ('customer_portal_accounts', 'customers', 'customer_id'),
              ('customer_portal_claims', 'customers', 'customer_id'),
              ('customer_portal_events', 'customers', 'customer_id'))


def require(condition, label):
    if not condition:
        raise ValueError(label)


def compare_nullable(a, b, descending=False):
    if a is None or b is None:
        return 0 if a is b else (1 if a is None else -1)
    result = (a > b) - (a < b)
    return -result if descending else result


def sort_rows(rows, keys):
    def compare(a, b):
        for key, descending in keys:
            result = compare_nullable(a.get(key), b.get(key), descending)
            if result:
                return result
        return 0
    return sorted(rows, key=cmp_to_key(compare))


def a_losers(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(row.get(k) for k in ('test_suite', 'role_code', 'test_case_code'))].append(row)
    losers = []
    for group in groups.values():
        losers.extend(sort_rows(group, [('updated_at', True), ('created_at', True), ('id', True)])[1:])
    return losers


def admit_a(rows):
    require(not a_losers(rows), 'A6_LOSS_REJECTED')


def apply_a(rows):
    result = copy.deepcopy(rows)
    for row in result:
        for name, value in (('title', None), ('source_note', None), ('raw_text', ''),
                            ('parsed_payload', {}), ('created_by', None), ('updated_by', None)):
            row.setdefault(name, copy.deepcopy(value))
        if row.get('parsed_payload') in (None, {}) and row.get('payload') not in (None, {}):
            row['parsed_payload'] = copy.deepcopy(row['payload'])
    removed = {row['id'] for row in a_losers(result)}
    return [row for row in result if row['id'] not in removed]


def parent_for(state, table, value):
    if value is None:
        return None
    rows = [r for r in state.get(table, []) if r.get('id') == value]
    require(len(rows) <= 1, 'NONUNIQUE_PARENT_REJECTED')
    return rows[0] if rows else None


def backfills(state, stage, now):
    require(stage in ('B', 'C'), 'SOURCE_STAGE_REQUIRED')
    result = copy.deepcopy(state)
    if stage == 'B':
        branches = [(table, 'customers', 'customer_id') for table in B_CUSTOMERS]
        branches.append(('supplier_switch_events', 'supplier_switch_requests', 'switch_request_id'))
    else:
        branches = list(C_BRANCHES)
    for table, parent, column in branches:
        for row in result.get(table, []):
            p = parent_for(result, parent, row.get(column))
            if row.get('company_id') is None and p is not None and p.get('company_id') is not None:
                row['company_id'] = p['company_id']
                if stage == 'C' and table != 'customer_portal_events' and row.get('updated_at') is None:
                    row['updated_at'] = now
    for row in result.get('metering_points', []):
        p = parent_for(result, 'customer_sites', row.get('site_id'))
        if p is None or (row.get('company_id') is not None and row.get('customer_id') is not None):
            continue
        if stage == 'C' or row.get('customer_id') is None:
            row['customer_id'] = p.get('customer_id')
        if row.get('company_id') is None:
            row['company_id'] = p.get('company_id')
        if stage == 'C' and row.get('updated_at') is None:
            row['updated_at'] = now
    return result


def coalesced(*values):
    return next((v for v in values if v is not None and v != ''), None)


def role_rows(state, user):
    if user is None:
        return []
    results = set()
    for row in state.get('user_roles', []):
        if row.get('user_id') != user or row.get('is_active') is False or row.get('status') not in (None, 'active'):
            continue
        role = parent_for(state, 'roles', row.get('role_id')) or {}
        key = coalesced(role.get('key'), row.get('role'), role.get('name'))
        results.add((key, key, key, coalesced(role.get('name'), role.get('key'), row.get('role'))))
    for row in state.get('company_memberships', []):
        if row.get('user_id') == user and row.get('is_active') is not False and row.get('status') in (None, 'active'):
            key = coalesced(row.get('role_key'), row.get('membership_role'), row.get('role'))
            results.add((key,) * 4)
    return sorted(results, key=repr)


def overrides(state, user, now):
    if user is None:
        return []
    return [(r.get('permission_key'), r.get('effect')) for r in state.get('user_permission_overrides', [])
            if r.get('user_id') == user and r.get('is_active') is not False
            and (r.get('valid_from') is None or r['valid_from'] <= now)
            and (r.get('valid_to') is None or r['valid_to'] >= now)]


def ilike(value, pattern):
    if value is None:
        return False
    regex = ''
    escaped = False
    for char in pattern:
        if escaped:
            regex += re.escape(char); escaped = False
        elif char == '\\':
            escaped = True
        elif char == '%':
            regex += '.*'
        elif char == '_':
            regex += '.'
        else:
            regex += re.escape(char)
    require(not escaped, 'INVALID_LIKE_ESCAPE')
    return re.fullmatch(regex, value, re.I | re.S) is not None


def count_rows(state, search=None, status=None):
    customers = [r for r in state.get('customers', [])
                 if (status in (None, '') or r.get('status') == status)
                 and (search in (None, '') or any(ilike(r.get(k), '%' + search + '%') for k in
                      ('full_name', 'company_name', 'email', 'customer_number', 'personal_number', 'org_number')))]
    latest = []
    for customer in customers:
        matches = [r for r in state.get('customer_contracts', []) if r.get('customer_id') == customer['id']]
        if matches:
            latest.append(sort_rows(matches, [('created_at', True), ('id', True)])[0])
    partitions = Counter(r.get('status') if r.get('status') is not None else 'none' for r in latest)
    return [('all', len(customers)), ('none', len(customers) - len(latest)), *sorted(partitions.items())]


def aggregate_counts(rows):
    """Diagnostic contract oracle only; does not change dormant application helper."""
    totals = [value for key, value in rows if key == 'all']
    require(len(totals) == 1, 'RESERVED_TOTAL_AMBIGUITY')
    for _, value in rows:
        require(type(value) is int and 0 <= value <= 2**53 - 1, 'INVALID_COUNT_TOTAL')
    require(sum(value for key, value in rows if key != 'all') == totals[0], 'COUNT_CONSERVATION_REQUIRED')
    known = {'none', 'pending_signature', 'signed', 'active', 'closed'}
    result = {'all': totals[0]}
    for key, value in rows:
        if key in known:
            result[key] = result.get(key, 0) + value
    return result


def rule_groups(rows, family, code, standard='edifact', direction='outbound', date=None, inbound=False):
    """Return ordered tie groups; C deliberately supplies no final ID tiebreak."""
    candidates = []
    for row in rows:
        if family is None or row.get('message_family') is None or row['message_family'].lower() != family.lower():
            continue
        if code not in (None, '') and (row.get('message_code') is None or row['message_code'].lower() != code.lower()):
            continue
        if ('edifact' if row.get('message_standard') is None else row['message_standard']).lower() != ('edifact' if standard is None else standard).lower():
            continue
        if row.get('is_active') is False:
            continue
        if inbound:
            if row.get('direction') not in ('inbound', 'both'):
                continue
        elif not (row.get('direction') == 'both' or (direction is not None and row.get('direction') == direction)):
            continue
        if row.get('valid_from') is not None and (date is None or row['valid_from'] > date):
            continue
        if not inbound and row.get('valid_to') is not None and (date is None or row['valid_to'] < date):
            continue
        candidates.append(row)
    ordered = sort_rows(candidates, [('valid_from', True), ('valid_to', False), ('created_at', True)])
    groups = []
    for row in ordered:
        key = tuple(row.get(k) for k in ('valid_from', 'valid_to', 'created_at'))
        if not groups or groups[-1][0] != key:
            groups.append((key, []))
        groups[-1][1].append(row)
    return [group for _, group in groups]
