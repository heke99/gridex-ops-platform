"""Closed SQL-policy formula proofs, conditional on separately qualified helpers.

This module does not run SQL, establish ACLs, classify live role applicability,
or accept schemas. Callers must supply *all* applicable rows after exact catalog
and role-graph admission. The finite proof compares SQL RLS acceptance (IS TRUE),
including UNKNOWN, rather than conflating SQL NULL with Python falsehood.
"""
from functools import lru_cache
import hashlib
import itertools
import json
import re


ROW_FIELDS = frozenset(('nspname', 'relname', 'polname', 'command', 'permissive',
                        'roles', 'using_expression', 'check_expression'))
A = '( SELECT gridex_user_is_platform_admin() AS gridex_user_is_platform_admin)'
W = 'gridex_can_write_company(company_id)'
R = 'gridex_can_read_company(company_id)'
G = ('( SELECT gridex_is_current_session_allowed() AS gridex_is_current_session_allowed)'
     ' AND (' + A + ' OR company_id IN '
     '( SELECT gridex_user_company_ids() AS gridex_user_company_ids))')
ASSUMPTIONS = (
    'Actual authenticated claim makes service predicate S FALSE.',
    'Qualified helper W TRUE implies non-NULL company N TRUE and R TRUE.',
    'Qualified read helper R and expanded session/membership G have identical IS TRUE acceptance.',
    'Membership-IN predicate M TRUE implies non-NULL company N TRUE.',
    'IS NOT NULL predicate N is two-valued; other predicates also receive SQL UNKNOWN valuations.',
)

# Each pattern is one fixed, reviewed primitive. No identifier substitution,
# evaluation of SQL/Python text, comments, casts other than the fixed service
# predicate, arbitrary SELECTs, NOT, or unrecognized function calls are allowed.
_FN = r'(?:public\.)?'
_ATOMS = (
    ('S', r"\(\(\s*SELECT\s+auth\.role\(\)\s+AS\s+role\s*\)\)\s*=\s*'(?-i:service_role)'::text"),
    ('A', r'\(\s*SELECT\s+' + _FN + r'gridex_user_is_platform_admin\(\)\s+AS\s+gridex_user_is_platform_admin\s*\)'),
    ('J', r'\(\s*SELECT\s+' + _FN + r'gridex_is_current_session_allowed\(\)\s+AS\s+gridex_is_current_session_allowed\s*\)'),
    ('M', r'company_id\s+IN\s*\(\s*SELECT\s+' + _FN + r'gridex_user_company_ids\(\)\s+AS\s+gridex_user_company_ids\s*\)'),
    ('A', _FN + r'gridex_user_is_platform_admin\(\)'),
    ('W', _FN + r'gridex_can_write_company\(company_id\)'),
    ('R', _FN + r'gridex_can_read_company\(company_id\)'),
    ('N', r'company_id\s+IS\s+NOT\s+NULL\b'),
)
_ATOM_PATTERNS = tuple((name, re.compile(pattern, re.IGNORECASE)) for name, pattern in _ATOMS)
_WORD = re.compile(r'(AND|OR|true|false)\b', re.IGNORECASE)


def _fail(reason):
    raise ValueError('REMOVED_POLICY_FORMULA_' + reason)


def normalize(expression):
    """Parse the closed SQL boolean grammar into immutable tuple ASTs."""
    if type(expression) is not str or not expression.strip() or len(expression) > 16384:
        _fail('EXPRESSION_REQUIRED')
    tokens = []
    pos = 0
    while pos < len(expression):
        if expression[pos].isspace():
            pos += 1
            continue
        for name, pattern in _ATOM_PATTERNS:
            match = pattern.match(expression, pos)
            if match:
                tokens.append(('atom', name))
                pos = match.end()
                break
        else:
            match = _WORD.match(expression, pos)
            if match:
                word = match.group().lower()
                tokens.append(('const', word == 'true') if word in ('true', 'false') else word)
                pos = match.end()
            elif expression[pos] in '()':
                tokens.append(expression[pos])
                pos += 1
            else:
                _fail('UNKNOWN_SQL')
        if len(tokens) > 512:
            _fail('EXPRESSION_TOO_COMPLEX')
    index = 0

    def primary(depth):
        nonlocal index
        if depth > 64 or index >= len(tokens):
            _fail('MALFORMED_SQL')
        token = tokens[index]
        index += 1
        if isinstance(token, tuple):
            return token
        if token != '(':
            _fail('MALFORMED_SQL')
        result = disjunction(depth + 1)
        if index >= len(tokens) or tokens[index] != ')':
            _fail('MALFORMED_SQL')
        index += 1
        return result

    def conjunction(depth):
        nonlocal index
        result = primary(depth)
        while index < len(tokens) and tokens[index] == 'and':
            index += 1
            result = ('and', result, primary(depth))
        return result

    def disjunction(depth):
        nonlocal index
        result = conjunction(depth)
        while index < len(tokens) and tokens[index] == 'or':
            index += 1
            result = ('or', result, conjunction(depth))
        return result

    result = disjunction(0)
    if index != len(tokens):
        _fail('MALFORMED_SQL')
    return result


def _sql_and(left, right):
    if left is False or right is False:
        return False
    return None if left is None or right is None else True


def _sql_or(left, right):
    if left is True or right is True:
        return True
    return None if left is None or right is None else False


def evaluate(ast, values):
    """Evaluate a parsed AST with SQL TRUE/FALSE/UNKNOWN semantics."""
    kind = ast[0]
    if kind == 'const':
        return ast[1]
    if kind == 'atom':
        value = values[ast[1]]
        if value is not None and type(value) is not bool:
            _fail('BOOLEAN_VALUE_REQUIRED')
        return value
    left, right = evaluate(ast[1], values), evaluate(ast[2], values)
    if kind == 'and':
        return _sql_and(left, right)
    if kind == 'or':
        return _sql_or(left, right)
    _fail('AST_REQUIRED')


def _join(kind, expressions):
    result = ('const', kind == 'and')
    for expression in expressions:
        result = (kind, result, expression)
    return result


@lru_cache(maxsize=2)
def _valuations(three_valued):
    domain = (False, True, None) if three_valued else (False, True)
    result = []
    for terms in itertools.product(domain, repeat=5):
        for nonnull in (False, True):
            values = dict(zip(('A', 'W', 'R', 'J', 'M'), terms), N=nonnull, S=False)
            if values['W'] is True and not (nonnull and values['R'] is True):
                continue
            if values['M'] is True and not nonnull:
                continue
            expanded = _sql_and(values['J'], _sql_or(values['A'], values['M']))
            if (values['R'] is True) != (expanded is True):
                continue
            result.append(values)
    return tuple(result)


def _assert_truth(actual, expected, reason, implication=False):
    for three_valued in (False, True):
        for values in _valuations(three_valued):
            left = evaluate(actual, values) is True
            right = evaluate(expected, values) is True
            mismatch = (left and not right) if implication else (left != right)
            if mismatch:
                _fail(reason)


def _validate_rows(rows):
    if type(rows) is not list or not rows or len(rows) > 256:
        _fail('ROWS_REQUIRED')
    identities = set()
    relation = None
    for item in rows:
        if type(item) is not dict or set(item) != ROW_FIELDS:
            _fail('ROW_SHAPE')
        if item['nspname'] != 'public' or any(type(item[k]) is not str or not item[k]
                                             for k in ('relname', 'polname')):
            _fail('ROW_IDENTITY')
        if item['command'] not in ('r', 'a', 'w', 'd', '*') or type(item['permissive']) is not bool:
            _fail('ROW_METADATA')
        roles = item['roles']
        if (type(roles) is not list or not roles or
                any(type(role) is not str for role in roles) or roles != sorted(set(roles)) or
                not ({'authenticated', 'PUBLIC'} & set(roles))):
            _fail('AUTHENTICATED_APPLICABILITY_REQUIRED')
        if any(type(item[k]) is not str for k in ('using_expression', 'check_expression')):
            _fail('ROW_EXPRESSION')
        if item['command'] == 'a' and item['using_expression']:
            _fail('INSERT_USING_FORBIDDEN')
        if item['command'] in ('r', 'd') and item['check_expression']:
            _fail('READ_DELETE_CHECK_FORBIDDEN')
        key = (item['nspname'], item['relname'], item['polname'])
        if key in identities or (relation is not None and relation != key[:2]):
            _fail('DUPLICATE_OR_MIXED_RELATION')
        identities.add(key)
        relation = key[:2]


def prove_component(rows, command, mode):
    """Prove every applicable branch; UPDATE USING and CHECK are independent.

    ACL-denied commands intentionally have no formula-success path. Their caller
    must establish real effective denial and record that different kind of proof.
    """
    modes = {'tenant_read': ('r',), 'tenant_write': ('a', 'w'), 'service_only': ('d',)}
    if type(mode) is not str or type(command) is not str or mode not in modes or command not in modes[mode]:
        _fail('MODE_COMMAND_REQUIRED')
    _validate_rows(rows)
    applicable = [item for item in rows if item['command'] in (command, '*')]
    if not applicable or not any(item['permissive'] for item in applicable):
        _fail('PERMISSIVE_POLICY_REQUIRED')
    if not any(not item['permissive'] for item in applicable):
        _fail('RESTRICTIVE_GUARD_REQUIRED')
    components = ('using', 'check') if command == 'w' else ('check',) if command == 'a' else ('using',)
    target_guard = normalize(G if mode == 'tenant_read' else W)
    target_effective = ('const', False) if mode == 'service_only' else target_guard
    proofs = {}
    for component in components:
        permissive, restrictive = [], []
        for item in applicable:
            expression = item['using_expression']
            if component == 'check':
                expression = item['check_expression'] or expression
            parsed = normalize(expression or 'true')
            (permissive if item['permissive'] else restrictive).append(parsed)
        allow = _join('or', permissive)
        guard = _join('and', restrictive)
        _assert_truth(guard, target_guard, 'RESTRICTIVE_GUARD_MISMATCH_' + component.upper())
        if mode == 'tenant_write':
            envelope = normalize(A + ' OR ' + (W if component == 'check' else R))
            _assert_truth(allow, envelope, 'PERMISSIVE_ENVELOPE_MISMATCH_' + component.upper(), True)
        effective = ('and', allow, guard)
        _assert_truth(effective, target_effective, 'EFFECTIVE_MISMATCH_' + component.upper())
        proofs[component] = dict(permissiveRows=len(permissive), restrictiveRows=len(restrictive),
                                 restrictiveGuardProved=True, effectivePredicateProved=True)
    return dict(formulaProved=True, command=command, mode=mode, components=proofs,
                applicableRows=len(applicable),
                valuations=dict(twoValued=len(_valuations(False)), threeValued=len(_valuations(True))),
                assumptions=list(ASSUMPTIONS), aclProved=False, roleApplicabilityProved=False,
                schemaAccepted=False)


def _row_hash(row):
    try:
        encoded = json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()
    except (TypeError, ValueError):
        _fail('ROW_SERIALIZATION')
    return hashlib.sha256(encoded).hexdigest()


def prove_replacements(register):
    """Bind all 59 reviewed replacements; prove 57 formulas, never ACL inertness.

    Register formulas are composed with the *required* guards synthetically.
    Live callers must separately invoke prove_component on admitted live rows.
    """
    if type(register) is not dict or register.get('schemaAccepted') is not False:
        _fail('REGISTER_REQUIRED')
    replacements = register.get('replacementPolicies')
    if type(replacements) is not list or len(replacements) != len(REPLACEMENTS):
        _fail('REGISTER_INVENTORY')
    expected = {(table, name): (command, digest) for table, command, name, digest in REPLACEMENTS}
    seen = set()
    counts = dict(r=0, a=0, w=0, d=0)
    component_count = 0
    acl_only = []
    send_lock = []
    for item in replacements:
        if type(item) is not dict or item.get('schemaAcceptance') is not False:
            _fail('REGISTER_ROW_REQUIRED')
        identity = item.get('identity')
        if (type(identity) is not list or len(identity) != 3 or identity[0] != 'public' or
                any(type(part) is not str for part in identity)):
            _fail('REGISTER_IDENTITY')
        key = tuple(identity[1:])
        if key not in expected or key in seen:
            _fail('REGISTER_INVENTORY')
        seen.add(key)
        command, digest = expected[key]
        if item.get('sha256') != digest:
            _fail('REGISTER_HASH')
        table, name = key
        actual = item.get('row')
        if table == 'company_invitations' and command in ('a', 'w'):
            if (actual is not None or item.get('rowHashVerified') is not False or
                    item.get('command') != command or item.get('roles') != ['authenticated']):
                _fail('ACL_ONLY_ROW_REQUIRED')
            acl_only.append(identity)
            continue
        if (type(actual) is not dict or item.get('rowHashVerified') is not True or
                _row_hash(actual) != digest):
            _fail('REGISTER_FULL_ROW_HASH')
        if (actual.get('command') != command or actual.get('roles') != ['authenticated'] or
                actual.get('permissive') is not True or
                [actual.get(k) for k in ('nspname', 'relname', 'polname')] != identity):
            _fail('REGISTER_ROW_METADATA')
        mode = 'tenant_read' if command == 'r' else 'service_only' if command == 'd' else 'tenant_write'
        guard = dict(actual, polname='required_guard_for_formula_proof', permissive=False,
                     using_expression=G if command == 'r' else '' if command == 'a' else W,
                     check_expression=W if command in ('a', 'w') else '')
        proof = prove_component([actual, guard], command, mode)
        counts[command] += 1
        component_count += len(proof['components'])
        if table == 'ediel_send_locks' and command in ('a', 'w'):
            send_lock.append(identity)
    if counts != dict(r=20, a=18, w=18, d=1) or len(acl_only) != 2 or len(send_lock) != 2:
        _fail('REGISTER_PARTITION')
    return dict(formulaProofComplete=True, fullRowsProved=57, componentProofs=component_count,
                commandCounts=counts, aclOnlyRows=2, aclOnlyIdentities=acl_only,
                sendLockWriteFormulasProvedButFinalAclDenialRequired=send_lock,
                assumptions=list(ASSUMPTIONS),
                valuations=dict(twoValued=len(_valuations(False)), threeValued=len(_valuations(True))),
                liveCompositionProved=False, aclProved=False, schemaAccepted=False)


# Exact reviewed latest-9f artifact replacement identities and SHA256 row hashes.
REPLACEMENTS = (
    ('audit_logs', 'w', 'gridex_mp_e185c4f1c4faa621e763', '782df18a820280215f262727364e75c7b9e57a5564accfdf66eba794b0f8677b'),
    ('audit_logs', 'a', 'gridex_mp_e8534998783068d30ad5', '8bb3c8a1f2583ed1b4ba85ff95e67b0ee0eec75ca223da4469cab3245a5370cc'),
    ('audit_logs', 'r', 'gridex_perf_authenticated_select_v1', 'cd121127afcb18d5f7c7a94e8bf40a134825589418127fc4271a98f57baa273b'),
    ('communication_routes', 'a', 'gridex_mp_2bbf4b53469fd6178461', '95bd00e515d5a61bf2475080b16122f6d6d67d5f541174ede3ddbae524740d3d'),
    ('communication_routes', 'w', 'gridex_mp_8ce55d030c258cc5474f', '2b8d63bd0f2fc6c8ee614d2d382c2fc39fdd102ae149e87fe20b8b868982e15d'),
    ('communication_routes', 'r', 'gridex_perf_authenticated_select_v1', 'e240d58e3c8e83351133ccfb78d735eb4f8662eb147f49aa4ecc9a9943846189'),
    ('company_invitations', 'w', 'gridex_mp_2a597f77b183f20e38eb', '18f905571729f74e9435c5244f27aab5c97a4ebdceab7e5e8b0e65d119ff7df2'),
    ('company_invitations', 'a', 'gridex_mp_95994347788240807258', '4aa7bdaaf4d1f9c11b662a03ceef90e1482062f499f077b8e7c0b6d842671813'),
    ('company_invitations', 'r', 'gridex_perf_authenticated_select_v1', '3d21dfd40beb5983a5c3a8756775f3c876fc1ea853b11f96ad29fb4acc754ec2'),
    ('customer_addresses', 'w', 'gridex_mp_1f934487828f7347c978', '809d2a6a69dfeeb51c6beb9b58d57a85a2d09ab4b647824d52d011dff306d5ca'),
    ('customer_addresses', 'a', 'gridex_mp_da053eddfc63c1160c87', 'b89b061c99f1e115a5b0163c39a1b246702736b101ce2aa38e9d2a9fbfc3daff'),
    ('customer_addresses', 'r', 'gridex_perf_authenticated_select_v1', 'c6c17d2e089753f1986a8000eac20c96b6fbe6197f811a2c3a32ba98a4858d8e'),
    ('customer_authorization_documents', 'a', 'gridex_mp_1d593b44e4e0b65447f0', 'a09b10de76afdad3b984ac21da36f5b6c095b161e573eb691f6bbaebd23b0ab7'),
    ('customer_authorization_documents', 'w', 'gridex_mp_e7abd844eea07efcc87c', '8e0e834766171238bef8268cb3af3d405ea414869aabc46b704190fd9a953de8'),
    ('customer_authorization_documents', 'r', 'gridex_perf_authenticated_select_v1', 'f0d045836b782fb0b25cdd114c62be077bf75a0de36b51cd12619f6b7dee0b89'),
    ('customer_contacts', 'w', 'gridex_mp_270875e31c4d1babd33d', 'da01460a8d687743db1607f3a2cf55c28626ecd803aa5ca61465281960393cf4'),
    ('customer_contacts', 'a', 'gridex_mp_49cbb82bb9ef2f4b7bc6', 'e0ea038654b835ff0b0114948ff9778a9152d96b2e1c5c32f83f7aa38c210a6f'),
    ('customer_contacts', 'r', 'gridex_perf_authenticated_select_v1', 'dc27337d5bfa0065b1eb6cdc68413368a68349f661d6423ee3cc578703d7c110'),
    ('customer_contract_events', 'a', 'gridex_mp_5b6b24da4796a6585646', '7e402400fb9442476d59c8fce0e48a2616e1e1d382ac7171a7ed548e172343df'),
    ('customer_contract_events', 'w', 'gridex_mp_bbd32d16dab17f7c0ba6', '2d7245653835bb12af223f1d69f5207b6cf05f51b5994383753dca090f2d51fb'),
    ('customer_contract_events', 'r', 'gridex_perf_authenticated_select_v1', '1fd38163e856bd8a889fb44bb33f5eaa8f4c7dd0db3562b79f446d548501a4c5'),
    ('customer_documents', 'a', 'gridex_mp_0073cf03fb4f4ce5e3f0', '49d10215a5e2865f89afa2c9a8db38eaa8bdadac91d18d82c31dd08b097e5ea4'),
    ('customer_documents', 'w', 'gridex_mp_a0f2cbd6aa7f33827796', '51aba851e1a198c4e760c85e413c883b6cff20755cc7f03c30af937a385548fa'),
    ('customer_documents', 'r', 'gridex_perf_authenticated_select_v1', '483ffd87b5c62a880942e4d443634a08f3d5a139f9f90d773f702b1a1dc51788'),
    ('customer_info_request_events', 'w', 'gridex_mp_5aede207f5fa533f44df', '5ae42e880bfba9e0c6537e429cef7915f64ae59c7657ae9c58608610de540d38'),
    ('customer_info_request_events', 'a', 'gridex_mp_73114b6f8226a07cb343', '3d5224c8fd56638e58196bba0e4b3385a71f843451b1f2928978220c7c520d08'),
    ('customer_info_request_events', 'd', 'gridex_mp_f625bcbc0cffb824de0e', 'fbac14f4bad4b43b0ff1b7eebf29741584e481b644de48482f0606ed0af0acc6'),
    ('customer_info_request_events', 'r', 'gridex_perf_authenticated_select_v1', '053e63723c2b5dc44ca6eddf575fa7c1bedcbc6db2810e3425b0c3654185abce'),
    ('customer_internal_notes', 'w', 'gridex_mp_bafc57c78c71919f52da', '81fb4d757626f8d2073b9c66d5a2654c6507b21abbb313efe225595bbfa2e02f'),
    ('customer_internal_notes', 'a', 'gridex_mp_be5f6971559d176aaad8', 'aa2ff99f5a6f099a711339841585c2d1b08ff98b43b49fc4eb35a3f300fb632c'),
    ('customer_internal_notes', 'r', 'gridex_perf_authenticated_select_v1', '9a430555386b1f6f04e06abe5640ef9cb5ae6f5c685dfa1fd7447acb4eb8257a'),
    ('customer_operation_tasks', 'w', 'gridex_mp_ba822806184f6afc0d7b', '270832f2a22c36dd306afef540e63ec56133e10de049228f662ca35059b97b76'),
    ('customer_operation_tasks', 'a', 'gridex_mp_de72ba51a19d049d3ff1', '50b9d32249501c470de22ae98557729ff0635884f8b352107fc5a1cc4b124bf4'),
    ('customer_operation_tasks', 'r', 'gridex_perf_authenticated_select_v1', '5d6ac822cfc111bef78ec63bca222dc5f04359da5d2ec69e53f079bb6d9cacb7'),
    ('ediel_actor_settings', 'w', 'gridex_mp_c4ab4a1fbf80131385eb', 'df57f8323bffdeb1c5e76937910a144251666e808d62e25f3afaf9deba991147'),
    ('ediel_actor_settings', 'a', 'gridex_mp_cab292ed7c776394f0dd', '004b1f731639e149f2456a53f7753b64798b88016b14f6fb2f25ca1ce4527286'),
    ('ediel_actor_settings', 'r', 'gridex_perf_authenticated_select_v1', 'ab4f22c9ca1a61326f6f58693c7a7fd30a60536efcaa26230df629a55dca5148'),
    ('ediel_route_profiles', 'w', 'gridex_mp_8fd20e477ab2a47d421b', '009788d252ecaa118d552e7f96629feecde808643a175d64dd147698155579ac'),
    ('ediel_route_profiles', 'a', 'gridex_mp_ba54c24776262517c51f', '428433f0848ee5dc028b938d6390ed2e25d34e33a8881baa75a1de31ba1b2cd2'),
    ('ediel_route_profiles', 'r', 'gridex_perf_authenticated_select_v1', '1155745f7bf3090b6b1e5853e84606b3a890121be4147b4daea0db3437cb4124'),
    ('ediel_send_locks', 'a', 'gridex_mp_4fc7c88588b93b1e8b6f', 'ab884aab91bd11ae84ca1b86f96c9b02a7d7396dc9756043d3a528587aced529'),
    ('ediel_send_locks', 'w', 'gridex_mp_d31ac6d667cda6f43cf7', '7d0dbea7e2bf08fd09e865691864f44f988a760a910ddddcaa4633e45f9ec9f2'),
    ('ediel_send_locks', 'r', 'gridex_perf_authenticated_select_v1', '3828b4087163470d43f1e4feca9d1650e3235040315bb0cd222fb01682a72480'),
    ('grid_owner_data_requests', 'w', 'gridex_mp_3c68c5fbae9693de53a1', 'a4bc9915fc66827588d6c27fe7817bd3aadcd3921fa5800e928edd66cf7b0051'),
    ('grid_owner_data_requests', 'a', 'gridex_mp_f0872e9b54bb3b580ffc', 'e4d7cf6f957c509b9067ed541b4f29ec5ef737548a1ae22496930a1709d6500c'),
    ('grid_owner_data_requests', 'r', 'gridex_perf_authenticated_select_v1', 'b5768a28760e1dfddc3977c5364552d67ca3115c6b48a65c043749b3fddde8b3'),
    ('metering_permissions', 'a', 'gridex_mp_2ec74ad3e1b0cd7abfb6', '4195d3deb407dca15814a9b150dca1aa68d930c2dbac09f7698aee3306af91b1'),
    ('metering_permissions', 'w', 'gridex_mp_59ebea0afaa910af537c', 'a8dcf5a2054e9f61400610a8666c1017b4e1304cfe4e9bbc3aea9bad0c280be2'),
    ('metering_permissions', 'r', 'gridex_perf_authenticated_select_v1', '589e5976fd82ed8c74a8214cf348bc2daa6ae1066d7710b81124143c9e1142e9'),
    ('outbound_dispatch_events', 'a', 'gridex_mp_4c07aa807632113d80dc', '6e05eaee0a82238795b699a6a0ce2a76a8497a1ff978a7548f181a6f66015385'),
    ('outbound_dispatch_events', 'w', 'gridex_mp_d66a86f24dcc7e750e7d', '25b4eb146b7f2885a87baf1ed51c8b5ab6af0dcb7f7c0592b6ae5511b24e48af'),
    ('outbound_dispatch_events', 'r', 'gridex_perf_authenticated_select_v1', '2a31db33464daee1d24a3e70bc930921dcb08add4efbd3daff075e3a5c72d6c8'),
    ('outbound_requests', 'w', 'gridex_mp_1ce7db6da88a5f81cfc3', '6bcd63fb4682b39b164e95f84dd68c515ac8a4643b76b16cd2b2757ceb8545b5'),
    ('outbound_requests', 'a', 'gridex_mp_f7d75aa9ec401b6055ba', 'e936c5e0272ac1b01ddb5a6d38c14ef37a0fdc26ec81d6ae53c0e338ad35ea60'),
    ('outbound_requests', 'r', 'gridex_perf_authenticated_select_v1', '162caa6b18d8c319b3f4b1d78fac131304c39b18c9ecff93d300e47fe86d2d6e'),
    ('partner_exports', 'w', 'gridex_mp_6b8fbc2194343d1a9420', 'b2dda3f48450795a575eb722701267bf4dbe9941de82725bcf2f1f915241ab31'),
    ('partner_exports', 'a', 'gridex_mp_a8b3832738662a80c300', '8aa46e2d48247ebb855bd9fd30f20e865ffc7e3fac3540fe48706f2c563346bf'),
    ('partner_exports', 'r', 'gridex_perf_authenticated_select_v1', '2a98528e6558f18e5da8c4ce3856dc9812a527b0ee4c484d92f232362113b9cd'),
    ('user_roles', 'r', 'gridex_perf_authenticated_select_v1', '5a98141eb2e23a874dde422b1e1aac2a58e0525cecaf42248741a960bb78b64d'),
)
