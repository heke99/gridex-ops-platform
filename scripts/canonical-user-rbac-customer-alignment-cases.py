"""Bounded whole-source actual63 native behavior and terminal-failure cases."""
import copy
import json
import re
import subprocess
import time


def succeeded(c, result):
    if not (result.code == 0 and result.state == '00000' and result.stdout.splitlines().count('ALIGNMENT_COMPLETE') == 1):
        raise c.NativeResultError(result)


def preserved(c, p, database, before):
    after = p.snapshot(database)
    c.check(c.encoded(after[0]) == c.encoded(before[0]) and c.rows_equal(after[1], before[1]),
            'ALIGNMENT_TRANSACTION_ROLLBACK_REQUIRED')


def private_acl(c, p, database):
    for role in ('anon', 'authenticated', 'service_role'):
        for function in c.batch.FUNCTIONS:
            raw = p.query(database, 'SELECT has_function_privilege(' + c.batch.literal(role) + ',' +
                          c.batch.literal('public.' + function) + ",'EXECUTE');")
            c.check(raw.strip() == 'f', 'ALIGNMENT_EFFECTIVE_EXECUTE_DENIAL')
        for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'):
            raw = p.query(database, 'SELECT has_table_privilege(' + c.batch.literal(role) +
                          ",'public.gridex_debug_batch2_rbac_v'," + c.batch.literal(privilege) + ');')
            c.check(raw.strip() == 'f', 'ALIGNMENT_EFFECTIVE_VIEW_DENIAL')
        raw = p.query(database, 'SELECT count(*) FROM pg_attribute WHERE attrelid=\'public.gridex_debug_batch2_rbac_v\'::regclass AND attnum>0 AND NOT attisdropped AND has_column_privilege(' + c.batch.literal(role) + ",attrelid,attnum,'SELECT,INSERT,UPDATE,REFERENCES');")
        c.check(raw.strip() == '0', 'ALIGNMENT_COLUMN_GRANT_DENIAL')
        # A real role change and invocation must fail, including service_role.
        result = p.run(database, 'SET LOCAL ROLE ' + c.batch.ident(role) + '; SELECT * FROM public.gridex_get_user_roles(NULL::uuid);')
        c.check(result.code != 0 and result.state == '42501', 'ALIGNMENT_NATIVE_EXECUTE_DENIAL')


def baseline(c, p):
    database = p.fresh_generation(c.TARGET, 'empty-first-repeat')
    try:
        before = p.snapshot(database)
        expected = p.expected(before)
        succeeded(c, p.envelope(database, before, expected))
        private_acl(c, p, database)
        empty_counts = json.loads(p.query(database, "SELECT jsonb_agg(to_jsonb(x)) FROM public.admin_customer_latest_contract_counts(NULL,NULL) x;"))
        c.check(sorted((row['bucket'], row['total']) for row in empty_counts) == [('all', 0), ('none', 0)],
                'ALIGNMENT_EMPTY_COUNT_SOURCE_ORACLE')
        # Preserve historical TABLE shape, six private functions and exact view.
        after = p.snapshot(database)
        c.check(after[0] == expected, 'ALIGNMENT_EXPECTED_CATALOG_REQUIRED')
        roles = [v for k, v in expected.items() if k.startswith('alignment_function/public.gridex_get_user_roles(')]
        c.check(len(roles) == 1 and roles[0]['result'] == 'TABLE(role_key text, key text, code text, name text)',
                'ALIGNMENT_TABLE_RETURN_REQUIRED')
        succeeded(c, p.envelope(database, after, expected))
        c.check(c.encoded(p.snapshot(database)) == c.encoded(after), 'ALIGNMENT_EXACT_REPEAT_REQUIRED')
    finally:
        p.destroy(database)


def populated(c, p, fixtures):
    database = p.fresh_generation(c.TARGET, 'all-source-backfills')
    try:
        f = fixtures.Fixture(c, p, database).backfill_rows()
        f.tgt('payload')
        f.tgt('empty', payload={})
        before = p.snapshot(database)
        expected = p.expected(before)
        succeeded(c, p.envelope(database, before, expected))
        private_acl(c, p, database)
        after = p.snapshot(database)
        actual = {table[7:]: [] for table, _ in after[1] if table.startswith('public.')}
        for table, row in after[1]:
            if table.startswith('public.'):
                actual[table[7:]].append(row)
        c.check(set(c.batch.model.DML_TABLES) - {'ediel_tgt_test_data'} <= set(actual), 'ALIGNMENT_ALL_NINETEEN_TARGETS')
    finally:
        p.destroy(database)


def faults(c, p):
    # Every stage has a transaction failure and actual native backend death.
    # Each failure consumes a clone; no old handle or sequence state is rearmed.
    for mode in ('P', 'A', 'B', 'C', 'W', 'P_death', 'A_death', 'B_death', 'C_death', 'W_death',
                 'context', 'hash', 'owner', 'repeat_W'):
        database = p.fresh_generation(c.ATOMIC, mode)
        before = p.snapshot(database)
        try:
            expected = p.expected(before)
            result = p.envelope(database, before, expected, fault=mode)
            c.check(result.code != 0, 'ALIGNMENT_NATIVE_FAULT_REQUIRED')
            if not mode.endswith('_death'):
                c.check(result.state in ('22012', 'P0002', '42501'), 'ALIGNMENT_EXPECTED_FAULT_STATE')
            preserved(c, p, database, before)
        finally:
            p.dispose(database)
        try:
            p.snapshot(database)
        except c.batch.BoundaryError:
            pass
        else:
            raise c.batch.BoundaryError('ALIGNMENT_TERMINAL_REUSE_ACCEPTED')
    database = p.fresh_generation(c.ATOMIC, 'fresh-retry')
    try:
        before = p.snapshot(database)
        succeeded(c, p.envelope(database, before, p.expected(before)))
    finally:
        p.destroy(database)


def standalone_boundary(c, p):
    database = p.fresh_generation(c.ATOMIC, 'standalone-boundary')
    try:
        before = p.snapshot(database)
        for source in (p.sources[0], p.sources[-1]):
            result = p.run(database, source.data)
            c.check(result.code != 0 and result.state == 'P0002', 'ALIGNMENT_STANDALONE_REJECTED')
            preserved(c, p, database, before)
    finally:
        p.destroy(database)


def catalog_rejections(c, p):
    changes = (
        'ALTER TABLE public.billing_export_run_items ADD COLUMN contract_id text;',
        'ALTER TABLE public.customer_sites ADD COLUMN alignment_unexpected text;',
        'CREATE INDEX user_roles_user_active_role_idx ON public.user_roles(id);',
        'CREATE VIEW public.alignment_unknown_role_dependency AS SELECT public.gridex_get_user_roles(NULL::uuid);',
        'GRANT SELECT(company_id) ON public.gridex_debug_batch2_rbac_v TO authenticated;',
        'GRANT EXECUTE ON FUNCTION public.gridex_get_user_roles(uuid) TO authenticated;',
    )
    for ordinal, change in enumerate(changes):
        database = p.fresh_generation(c.ATOMIC, 'catalog-reject-' + str(ordinal))
        try:
            admitted = p.snapshot(database)
            expected = p.expected(admitted)
            p.query(database, change)
            before = p.snapshot(database)
            result = p.envelope(database, admitted, expected)
            c.check(result.code != 0 and result.state == '42804', 'ALIGNMENT_CATALOG_DRIFT_REJECTED')
            preserved(c, p, database, before)
        finally:
            p.dispose(database)


def contention(c, p):
    for statement in ('UPDATE public.customers SET company_id=company_id;',
                      'CREATE INDEX alignment_blocking_index ON public.customer_sites(id);',
                      'LOCK TABLE public.gridex_debug_batch2_rbac_v IN ACCESS EXCLUSIVE MODE;'):
        database = p.fresh_generation(c.LOCK, 'native-lock')
        holder = None
        try:
            before = p.snapshot(database)
            expected = p.expected(before)
            command = p.h.command(database, transaction=False) + ['-f', '-']
            holder = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, env=c.legacy.clean_environment())
            p.h.processes.append(holder)
            holder.stdin.write(('SET log_min_messages=panic; BEGIN; ' + statement + " SELECT 'ALIGNMENT_LOCK_HELD'; SELECT pg_sleep(20); ROLLBACK;\n").encode())
            holder.stdin.flush()
            ready, _, _ = c.select.select([holder.stdout], [], [], 10)
            c.check(bool(ready) and holder.stdout.readline() == b'ALIGNMENT_LOCK_HELD\n', 'ALIGNMENT_NATIVE_LOCK_HOLDER')
            result = p.envelope(database, before, expected)
            c.check(result.code != 0 and result.state == '55P03', 'ALIGNMENT_NATIVE_LOCK_TIMEOUT')
            holder.kill(); holder.communicate()
            preserved(c, p, database, before)
        finally:
            if holder is not None and holder.poll() is None:
                holder.kill(); holder.communicate()
            p.dispose(database)


def run(c, p):
    fixtures = c.load('alignment_actual_fixtures', 'canonical-user-rbac-customer-alignment-fixtures.py')
    with c.diagnostic_stage('case_baseline'):
        baseline(c, p)
    with c.diagnostic_stage('case_populated'):
        populated(c, p, fixtures)
    with c.diagnostic_stage('case_a_payload_and_null_order'):
        a_payload_and_null_order(c, p, fixtures)
    with c.diagnostic_stage('case_boundary_privileges'):
        boundary_privileges(c, p)
    with c.diagnostic_stage('case_standalone_c_backfills'):
        standalone_c_backfills(c, p, fixtures)
    with c.diagnostic_stage('case_tgt_loss'):
        tgt_loss(c, p, fixtures)
    with c.diagnostic_stage('case_rpc_cases'):
        rpc_cases(c, p, fixtures)
    with c.diagnostic_stage('case_count_edge_rows'):
        count_edge_rows(c, p, fixtures)
    with c.diagnostic_stage('case_role_overrides'):
        role_overrides(c, p, fixtures)
    with c.diagnostic_stage('case_guard_sources'):
        guard_sources(c, p)
    with c.diagnostic_stage('case_incoming_fk_and_trigger'):
        incoming_fk_and_trigger(c, p, fixtures)
    with c.diagnostic_stage('case_audit_and_constraint_probes'):
        audit_and_constraint_probes(c, p, fixtures)
    with c.diagnostic_stage('case_standalone_boundary'):
        standalone_boundary(c, p)
    with c.diagnostic_stage('case_faults'):
        faults(c, p)
    with c.diagnostic_stage('case_catalog_rejections'):
        catalog_rejections(c, p)
    with c.diagnostic_stage('case_contention'):
        contention(c, p)


def a_payload_and_null_order(c, p, fixtures):
    """Whole-source rollback compares preserved payload and each A6 sort key."""
    database = p.fresh_generation(c.ATOMIC, 'a-existing-payload-null-order')
    try:
        f = fixtures.Fixture(c, p, database).base()
        setup = "ALTER TABLE public.ediel_tgt_test_data ADD COLUMN IF NOT EXISTS parsed_payload jsonb NOT NULL DEFAULT '{}'::jsonb;"
        for column in ('updated_at', 'created_at'):
            if f.attrs('ediel_tgt_test_data')[column]['notnull']:
                setup += 'ALTER TABLE public.ediel_tgt_test_data ALTER COLUMN ' + c.batch.ident(column) + ' DROP NOT NULL;'
        p.query(database, setup)
        f.shape = p.snapshot(database)[0]
        parsed = {'current': [1, {'preserved': True}]}
        legacy = {'legacy': 'different-value'}
        preserved_id = f.tgt('already-parsed', parsed_payload=parsed, payload=legacy)
        winners, candidates = set(), set()
        variants = (
            ('null-updated', (fixtures.STAMP, None), (None, '2030-01-01T00:00:00+00:00'), 0),
            ('null-created', (fixtures.STAMP, fixtures.STAMP), (fixtures.STAMP, None), 0),
            ('uuid-tie', (None, None), (None, None), 1),
        )
        for name, low_times, high_times, winner in variants:
            ids = sorted(fixtures.uid('a-sort-' + name + '-' + str(i)) for i in range(2))
            winners.add(ids[winner]); candidates.update(ids)
            for ordinal, (row_id, times) in enumerate(zip(ids, (low_times, high_times))):
                f.tgt(name + '-' + str(ordinal), id=row_id, test_suite=name, data_key=str(ordinal),
                      company_id=f.company if ordinal == 0 else f.other,
                      updated_at=times[0], created_at=times[1])
        before = p.snapshot(database)
        modeled = {row['id']: row for table, row in c.batch.expected_rows(before[1])
                   if table == 'public.ediel_tgt_test_data'}
        c.check(set(modeled) & candidates == winners, 'ALIGNMENT_A_NULL_ORDER_FIXTURE_REQUIRED')
        c.check(modeled[preserved_id]['parsed_payload'] == parsed and modeled[preserved_id]['payload'] == legacy,
                'ALIGNMENT_A_EXISTING_PAYLOAD_ORACLE')
        # Full independent catalog and bidirectional whole-row/PK assertions run
        # inside the envelope before rollback, including every loser and survivor.
        succeeded(c, p.envelope(database, before, p.expected(before, setup), rollback=True))
        preserved(c, p, database, before)
    finally:
        p.dispose(database)


def boundary_privileges(c, p):
    database = p.fresh_generation(c.ATOMIC, 'whole-w-effective-privilege-probe')
    try:
        before = p.snapshot(database)
        # Admission remains exact. The test-only role and grants arise after C;
        # W must deny effective paths while membership still exists. Drop that
        # role before comparing the independent final catalog and all rows.
        succeeded(c, p.envelope(database, before, p.expected(before),
                                rollback=True, fault='boundary_privileges'))
        preserved(c, p, database, before)
    finally:
        p.dispose(database)


def tgt_loss(c, p, fixtures):
    database = p.fresh_generation(c.TARGET, 'rollback-global-a6')
    try:
        f = fixtures.Fixture(c, p, database).base()
        f.tgt('same-key-a', test_suite='collision', role_code=None, company_id=f.company,
              data_key='first', updated_at=fixtures.STAMP, created_at=fixtures.STAMP, is_active=True)
        f.tgt('same-key-b', test_suite='collision', role_code=None, company_id=f.other,
              data_key='second', updated_at=fixtures.STAMP, created_at=fixtures.STAMP, is_active=False)
        before = p.snapshot(database)
        expected = p.expected(before)
        try:
            p.envelope(database, before, expected)
        except ValueError as error:
            c.check(error.args == ('A6_LOSS_REJECTED',), 'ALIGNMENT_LOSS_ADMISSION_REQUIRED')
        else:
            raise c.batch.BoundaryError('ALIGNMENT_GLOBAL_LOSS_ACCEPTED')
        succeeded(c, p.envelope(database, before, expected, rollback=True))
        preserved(c, p, database, before)
    finally:
        p.destroy(database)


def rpc_cases(c, p, fixtures):
    database = p.fresh_generation(c.TARGET, 'owner-private-rpcs')
    try:
        f = fixtures.Fixture(c, p, database).base()
        setup = ''
        for column in ('is_active', 'message_standard', 'direction'):
            if f.attrs('ediel_message_rules')[column]['notnull']:
                setup += 'ALTER TABLE public.ediel_message_rules ALTER COLUMN ' + c.batch.ident(column) + ' DROP NOT NULL;'
        if setup:
            p.query(database, setup); f.shape = p.snapshot(database)[0]
        for ordinal, status in enumerate(('pending_signature', 'signed', 'active', 'closed')):
            customer = f.add('customers', 'counts-' + str(ordinal), company_id=f.company, status='active',
                             full_name='Alpha_' + str(ordinal))
            f.add('customer_contracts', 'count-contract-' + str(ordinal), customer_id=customer,
                  company_id=f.company, status=status, created_at=fixtures.STAMP)
        f.add('customer_contracts', 'older-contract', customer_id=f.customer, company_id=f.company,
              status='signed', created_at='2019-01-01T00:00:00+00:00')
        f.add('customer_contracts', 'later-contract', customer_id=f.customer, company_id=f.other,
              status='active', created_at=fixtures.STAMP)
        for ordinal, (start, end, direction, active) in enumerate((
            (None, None, 'both', True), ('2010-01-01', '2011-01-01', 'inbound', True),
            ('2018-01-01', '2030-01-01', 'outbound', True), ('2030-01-01', None, 'both', True),
            ('2018-01-01', '2030-01-01', 'both', False), ('2018-01-01', '2030-01-01', 'both', True),
            ('2020-01-01', '2020-01-01', 'both', True), ('2018-01-01', '2030-01-01', 'both', True),
            (None, None, None, None))):
            f.add('ediel_message_rules', 'rule-' + str(ordinal), company_id=None if ordinal == 0 else (f.company if ordinal % 2 else f.other),
                  message_family='ALIGNMENT', message_code='CaseCode', message_standard='edifact',
                  version_code='v' + str(ordinal), direction=direction, valid_from=start, valid_to=end,
                  is_active=active, created_at=fixtures.STAMP)
        before = p.snapshot(database)
        expected = p.expected(before, setup)
        succeeded(c, p.envelope(database, before, expected))
        rows = p.snapshot(database)[1]
        state = {}
        for table, row in rows:
            if table.startswith('public.'):
                state.setdefault(table[7:], []).append(row)
        for search, status in ((None, None), ('%', None), ('_', 'active'), ('Alpha_', None), ('absent', None)):
            query = 'SELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\') FROM public.admin_customer_latest_contract_counts(' + f.literal(search) + ',' + f.literal(status) + ') x;'
            actual = json.loads(p.query(database, query))
            modeled = c.batch.model.count_rows(state, search, status)
            c.check(sorted((r['bucket'], r['total']) for r in actual) == sorted(modeled), 'ALIGNMENT_COUNTS_SOURCE_ORACLE')
            # Historical wrapper double-count is characterized, not deployed here.
            c.check(sum(r['total'] for r in actual) == 2 * dict(modeled)['all'], 'ALIGNMENT_DORMANT_DOUBLE_COUNT_CHARACTERIZED')
        for inbound in (False, True):
            for code in (None, '', 'casecode', 'absent'):
                for date in ('2020-01-01', None):
                    directions = ('outbound', 'inbound', 'both', 'OUTBOUND', None) if not inbound else (None,)
                    for direction in directions:
                        groups = c.batch.model.rule_groups(state.get('ediel_message_rules', []), 'alignment', code,
                                                          direction=direction, date=date, inbound=inbound)
                        args = [f.literal('alignment'), f.literal(code), "'edifact'"]
                        if not inbound:
                            args.append(f.literal(direction))
                        args.append(f.literal(date) + '::date')
                        function = 'ediel_resolve_inbound_message_rules' if inbound else 'ediel_resolve_message_rule'
                        query = 'SELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\') FROM public.' + function + '(' + ','.join(args) + ') x;'
                        result = json.loads(p.query(database, query))
                        if not inbound:
                            c.check((not result and not groups) or (len(result) == 1 and any(result[0] == {k: r.get(k) for k in ('id','message_family','message_code','message_standard','version_code','direction','requires_contrl','requires_aperak','supports_negative_response','is_active','valid_from','valid_to','notes')} for r in groups[0])),
                                    'ALIGNMENT_EDIEL_SINGLE_SOURCE_ORACLE')
                        else:
                            ids = [r['id'] for r in result]
                            c.check(len(ids) == sum(map(len, groups)), 'ALIGNMENT_EDIEL_INBOUND_COUNT')
                            offset = 0
                            for group in groups:
                                c.check(sorted(c.encoded(r) for r in result[offset:offset + len(group)]) == sorted(c.encoded({k: r.get(k) for k in ('id','version_code','valid_from','valid_to','requires_contrl','requires_aperak','supports_negative_response')}) for r in group), 'ALIGNMENT_EDIEL_TIE_GROUP_ORDER')
                                offset += len(group)
        date = p.query(database, 'SELECT current_date;').strip()
        for standard in (None, '', 'EDIFACT'):
            for inbound in (False, True):
                function = 'ediel_resolve_inbound_message_rules' if inbound else 'ediel_resolve_message_rule'
                actual = json.loads(p.query(database, "SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') FROM public." + function + "('alignment',NULL," + f.literal(standard) + ') x;'))
                groups = c.batch.model.rule_groups(state.get('ediel_message_rules', []), 'alignment', None, standard=standard, date=date, inbound=inbound)
                allowed = {r['id'] for group in (groups if inbound else groups[:1]) for r in group}
                c.check((inbound and {r['id'] for r in actual} == allowed) or (not inbound and ((not actual and not allowed) or (len(actual) == 1 and actual[0]['id'] in allowed))), 'ALIGNMENT_EDIEL_DEFAULT_NULL_STANDARD')
        private_acl(c, p, database)
    finally:
        p.destroy(database)


def role_overrides(c, p, fixtures):
    database = p.fresh_generation(c.TARGET, 'historical-role-override-semantics')
    setup = ''
    try:
        f = fixtures.Fixture(c, p, database).base()
        actors = [fixtures.uid('role-actor-' + str(i)) for i in range(2)]
        for actor in actors:
            p.query(database, 'INSERT INTO auth.users(id,email) VALUES (' + f.literal(actor) + ',\'alignment-' + actor + '@example.invalid\');')
        # Named full-clone nullable variants exercise C's explicit NULL flags;
        # original constraints and PKs remain preserved in the immutable origin.
        for table in ('user_roles', 'company_memberships'):
            for column in ('is_active', 'status'):
                if f.attrs(table)[column]['notnull']:
                    setup += 'ALTER TABLE public.' + c.batch.ident(table) + ' ALTER COLUMN ' + c.batch.ident(column) + ' DROP NOT NULL;'
        if setup:
            p.query(database, setup); f.shape = p.snapshot(database)[0]
        roles = json.loads(p.query(database, 'SELECT jsonb_agg(to_jsonb(r)) FROM public.roles r;'))
        role = next(r for r in roles if r['key'] == 'company_admin')
        f.add('user_roles', 'null-flags', user_id=actors[0], role_id=role['id'], role='company_admin',
              company_id=f.company, is_active=None, status=None)
        f.add('user_roles', 'inactive', user_id=actors[1], role_id=role['id'], role='company_admin',
              company_id=f.other, is_active=False, status='active')
        f.add('company_memberships', 'platform-looking-company-role', user_id=actors[0], company_id=f.company,
              role_key='super_admin', is_active=None, status=None)
        f.add('company_memberships', 'other-company', user_id=actors[0], company_id=f.other,
              role_key='company_admin', is_active=True, status='active')
        for ordinal, (actor, active, start, end) in enumerate((
            (actors[0], True, None, None), (actors[0], False, None, None),
            (actors[0], True, '2010-01-01T00:00:00+00:00', '2011-01-01T00:00:00+00:00'),
            (actors[1], True, None, None))):
            values = dict(user_id=actor, permission_key='alignment.permission.' + str(ordinal), effect='allow',
                          is_active=active, valid_from=start, valid_to=end)
            if 'company_id' in f.attrs('user_permission_overrides'):
                values['company_id'] = f.company if ordinal % 2 else f.other
            f.add('user_permission_overrides', 'override-' + str(ordinal), **values)
        before = p.snapshot(database)
        expected = p.expected(before, setup)
        succeeded(c, p.envelope(database, before, expected))
        state = {}
        for table, row in p.snapshot(database)[1]:
            if table.startswith('public.'):
                state.setdefault(table[7:], []).append(row)
        now = p.query(database, 'SELECT now();').strip().replace(' ', 'T', 1)
        for actor in actors:
            actual = json.loads(p.query(database, 'SELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\') FROM public.gridex_get_user_roles(' + f.literal(actor) + '::uuid) x;'))
            expected_rows = c.batch.model.role_rows(state, actor)
            c.check(sorted(tuple(r[k] for k in ('role_key', 'key', 'code', 'name')) for r in actual) == sorted(expected_rows),
                    'ALIGNMENT_ROLE_SOURCE_ORACLE')
            overrides = json.loads(p.query(database, 'SELECT coalesce(jsonb_agg(to_jsonb(x)),\'[]\') FROM public.gridex_get_user_permission_overrides(' + f.literal(actor) + '::uuid) x;'))
            c.check(sorted((r['permission_key'], r['effect']) for r in overrides) == sorted(c.batch.model.overrides(state, actor, now)),
                    'ALIGNMENT_OVERRIDE_SOURCE_ORACLE')
        private_acl(c, p, database)
    finally:
        p.destroy(database)


def guard_sources(c, p):
    """Whole B/C remain immutable, in rollback-only actual63-derived variants."""
    b, source_c = p.sources[2], p.sources[3]
    pairs = sorted(set(re.findall(r"gridex_debug_column_exists\('([^']+)', '([^']+)'\)", b.data.decode())))
    variants = [(b, 'guard-' + table + '-' + column,
                 'ALTER TABLE public.' + c.batch.ident(table) + ' DROP COLUMN IF EXISTS ' + c.batch.ident(column) + ';', '42703' if (table, column) == ('customers', 'company_id') else '00000')
                for table, column in pairs]
    variants += [
        (b, 'guarded-table-absent', 'DROP TABLE public.customer_internal_notes;', '00000'),
        (b, 'unguarded-upload-time', 'ALTER TABLE public.customer_authorization_documents DROP COLUMN uploaded_at;', '42703'),
        (b, 'meter-read-alternative', 'ALTER TABLE public.metering_values ADD COLUMN IF NOT EXISTS read_at timestamptz;', '00000'),
        (b, 'meter-created-alternative', 'ALTER TABLE public.metering_values DROP COLUMN IF EXISTS read_at;', '00000'),
        (b, 'meter-no-time', 'ALTER TABLE public.metering_values DROP COLUMN IF EXISTS read_at; ALTER TABLE public.metering_values DROP COLUMN created_at;', '42703'),
        (source_c, 'missing-P-contract', '', '42703'),
        (source_c, 'unguarded-c-join', 'ALTER TABLE public.billing_export_run_items ADD COLUMN contract_id uuid; ALTER TABLE public.ediel_inbound_cases DROP COLUMN ediel_message_id;', '42703'),
        (source_c, 'unguarded-c-expression', 'ALTER TABLE public.billing_export_run_items ADD COLUMN contract_id uuid; ALTER TABLE public.customer_contracts DROP COLUMN customer_site_id;', '42703'),
    ]
    for source, name, setup, state in variants:
        database = p.fresh_generation(c.ATOMIC, name)
        try:
            before_setup = p.snapshot(database)
            changed = p.run(database, setup) if setup else None
            if changed is not None:
                # A dependent blocking this named omission requires exact source
                # review. Never silently skip it or manufacture CASCADE admission.
                c.check(changed.code == 0 and changed.state == '00000', 'ALIGNMENT_GUARD_SETUP_SOURCE_DEPENDENCY')
            before = p.snapshot(database)
            expected_catalog = None
            if state == '00000':
                p.fresh_generation(c.ORACLE, 'guard-independent-oracle')
                try:
                    if setup:
                        p.query(c.ORACLE, setup)
                    ddl = '\n'.join(b.data.decode().splitlines()[4:17]) + '\n'
                    ddl += '\n'.join(item[4] for item in c.batch.index_declarations(p.sources) if item[0] == 'B' and c.batch.index_selected(item, before[0]))
                    p.query(c.ORACLE, ddl)
                    expected_catalog = p.snapshot(c.ORACLE)[0]
                finally:
                    p.destroy(c.ORACLE)
            whole = p.h.private('alignment-guard-whole-' + source.key + '.sql', source.data)
            end = p.h.private('alignment-guard-rollback.sql', "SELECT 'ALIGNMENT_GUARD_CATALOG';\n" + c.batch.catalog.sql(c.repair) + '\nROLLBACK;')
            result = p.run_inputs(database, '', [whole, end])
            c.check(result.state == state and (result.code == 0) == (state == '00000'), 'ALIGNMENT_GUARD_NATIVE_RESULT')
            if expected_catalog is not None:
                lines = result.stdout.splitlines()
                c.check(lines.count('ALIGNMENT_GUARD_CATALOG') == 1 and json.loads(lines[lines.index('ALIGNMENT_GUARD_CATALOG') + 1]) == expected_catalog, 'ALIGNMENT_GUARD_INDEX_ORACLE')
            preserved(c, p, database, before)
        finally:
            p.dispose(database)


def incoming_fk_and_trigger(c, p, fixtures):
    source_a = p.sources[1]
    for action in ('RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'):
        database = p.fresh_generation(c.ATOMIC, 'a-incoming-' + action.replace(' ', '-'))
        try:
            f = fixtures.Fixture(c, p, database).base()
            first = f.tgt('loser', test_suite='fk-collision', role_code='role', data_key='loser',
                          updated_at='2010-01-01T00:00:00+00:00', created_at=fixtures.STAMP)
            f.tgt('winner', test_suite='fk-collision', role_code='role', data_key='winner',
                  updated_at=fixtures.STAMP, created_at=fixtures.STAMP)
            p.query(database, 'CREATE TABLE public.alignment_fk_probe(id uuid PRIMARY KEY, tgt_id uuid REFERENCES public.ediel_tgt_test_data(id) ON DELETE ' + action + '); INSERT INTO public.alignment_fk_probe VALUES (' + f.literal(fixtures.uid('fk-child')) + ',' + f.literal(first) + ');')
            before = p.snapshot(database)
            whole = p.h.private('alignment-fk-whole-A.sql', source_a.data)
            suffix = "SELECT 'ALIGNMENT_FK_ROWS';\n" + c.batch.rows_sql() + "\nSELECT jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value) FROM alignment_rows; ROLLBACK;"
            end = p.h.private('alignment-fk-rollback.sql', suffix)
            result = p.run_inputs(database, '', [whole, end])
            if action in ('RESTRICT', 'NO ACTION'):
                c.check(result.code != 0 and result.state == '23503', 'ALIGNMENT_NATIVE_INCOMING_FK_RESTRICTION')
            else:
                c.check(result.code == 0 and result.state == '00000', 'ALIGNMENT_NATIVE_INCOMING_FK_ACTION')
                lines = result.stdout.splitlines()
                actual = json.loads(lines[lines.index('ALIGNMENT_FK_ROWS') + 1])
                expected = c.batch.expected_rows(before[1])
                for item in list(expected):
                    if item[0] == 'public.alignment_fk_probe':
                        if action == 'CASCADE':
                            expected.remove(item)
                        else:
                            item[1]['tgt_id'] = None
                c.check(c.rows_equal(actual, expected), 'ALIGNMENT_INCOMING_FK_FULL_ROWS')
            preserved(c, p, database, before)
        finally:
            p.dispose(database)

    database = p.fresh_generation(c.ATOMIC, 'sequence-terminal')
    try:
        f = fixtures.Fixture(c, p, database).base()
        f.tgt('sequence-consumer')
        setup = '''CREATE SEQUENCE public.alignment_sequence;
CREATE FUNCTION public.alignment_sequence_probe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM nextval('public.alignment_sequence'); RETURN NEW; END $$;
CREATE TRIGGER alignment_sequence_probe AFTER UPDATE ON public.ediel_tgt_test_data
FOR EACH ROW EXECUTE FUNCTION public.alignment_sequence_probe();'''
        p.query(database, setup)
        before = p.snapshot(database)
        expected = p.expected(before, setup)
        # This unknown write hook is inadmissible for a committed group.
        try:
            p.envelope(database, before, expected)
        except c.batch.BoundaryError:
            pass
        else:
            raise c.batch.BoundaryError('ALIGNMENT_UNKNOWN_TRIGGER_ACCEPTED')
        result = p.envelope(database, before, expected, rollback=True)
        c.check(result.code != 0 and result.state == 'P0004', 'ALIGNMENT_SEQUENCE_DISCREPANCY_REQUIRED')
        after = p.snapshot(database)
        c.check(after[0] == before[0], 'ALIGNMENT_SEQUENCE_CATALOG_ROLLBACK')
        before_rows = [r for r in before[1] if r[0] != 'public.alignment_sequence']
        after_rows = [r for r in after[1] if r[0] != 'public.alignment_sequence']
        c.check(c.rows_equal(before_rows, after_rows), 'ALIGNMENT_SEQUENCE_TRANSACTIONAL_ROWS_ROLLBACK')
        c.check([r for r in after[1] if r[0] == 'public.alignment_sequence'] != [r for r in before[1] if r[0] == 'public.alignment_sequence'],
                'ALIGNMENT_NONTRANSACTIONAL_SEQUENCE_OBSERVED')
    finally:
        p.dispose(database)
    database = p.fresh_generation(c.ATOMIC, 'sequence-fresh-prefix-retry')
    try:
        before = p.snapshot(database)
        succeeded(c, p.envelope(database, before, p.expected(before)))
    finally:
        p.destroy(database)


def audit_and_constraint_probes(c, p, fixtures):
    database = p.fresh_generation(c.ATOMIC, 'a-trigger-side-writes')
    try:
        f = fixtures.Fixture(c, p, database).base()
        f.tgt('audit-loser', test_suite='audit-collision', data_key='audit-loser', updated_at='2010-01-01T00:00:00+00:00')
        f.tgt('audit-winner', test_suite='audit-collision', data_key='audit-winner', updated_at=fixtures.STAMP)
        p.query(database, '''CREATE TABLE public.alignment_audit_probe(operation text,target_id uuid,old_row jsonb,new_row jsonb);
CREATE FUNCTION public.alignment_audit_probe() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.alignment_audit_probe VALUES(TG_OP,OLD.id,to_jsonb(OLD),CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $$;
CREATE TRIGGER alignment_audit_probe AFTER UPDATE OR DELETE ON public.ediel_tgt_test_data
FOR EACH ROW EXECUTE FUNCTION public.alignment_audit_probe();''')
        before = p.snapshot(database)
        target_rows = [copy.deepcopy(r) for table, r in before[1] if table == 'public.ediel_tgt_test_data']
        audit = []
        expanded = []
        for row in target_rows:
            for name, value in (('title', None), ('source_note', None), ('raw_text', ''),
                                ('parsed_payload', {}), ('created_by', None), ('updated_by', None)):
                row.setdefault(name, copy.deepcopy(value))
            updated = copy.deepcopy(row)
            if row.get('parsed_payload') in (None, {}) and row.get('payload') not in (None, {}):
                updated['parsed_payload'] = copy.deepcopy(row['payload'])
                audit.append(['public.alignment_audit_probe', dict(operation='UPDATE', target_id=row['id'], old_row=row, new_row=updated)])
            expanded.append(updated)
        for loser in c.batch.model.a_losers(expanded):
            audit.append(['public.alignment_audit_probe', dict(operation='DELETE', target_id=loser['id'], old_row=loser, new_row=None)])
        expected = c.batch.expected_rows(before[1]) + audit
        whole = p.h.private('alignment-audit-whole-A.sql', p.sources[1].data)
        end = p.h.private('alignment-audit-rollback.sql', "SELECT 'ALIGNMENT_AUDIT_ROWS';\n" + c.batch.rows_sql() + "\nSELECT jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value) FROM alignment_rows; ROLLBACK;")
        result = p.run_inputs(database, '', [whole, end])
        c.check(result.code == 0 and result.state == '00000', 'ALIGNMENT_AUDIT_NATIVE_SOURCE_REQUIRED')
        lines = result.stdout.splitlines()
        actual = json.loads(lines[lines.index('ALIGNMENT_AUDIT_ROWS') + 1])
        c.check(c.rows_equal(actual, expected), 'ALIGNMENT_TRIGGER_COMPLETE_SIDE_WRITES')
        preserved(c, p, database, before)
    finally:
        p.dispose(database)

    for kind, expected_state in (('check', '23514'), ('outgoing_fk', '23503')):
        database = p.fresh_generation(c.ATOMIC, 'b-' + kind)
        try:
            f = fixtures.Fixture(c, p, database).base()
            f.add('customer_internal_notes', 'rejected', company_id=None, customer_id=f.customer)
            if kind == 'check':
                setup = 'ALTER TABLE public.customer_internal_notes ADD CONSTRAINT alignment_company_check CHECK(company_id IS NULL);'
            else:
                setup = 'CREATE TABLE public.alignment_allowed_company(id uuid PRIMARY KEY); ALTER TABLE public.customer_internal_notes ADD CONSTRAINT alignment_company_fk FOREIGN KEY(company_id) REFERENCES public.alignment_allowed_company(id);'
            p.query(database, setup)
            before = p.snapshot(database)
            whole = p.h.private('alignment-constraint-whole-B.sql', p.sources[2].data)
            end = p.h.private('alignment-constraint-rollback.sql', 'ROLLBACK;')
            result = p.run_inputs(database, '', [whole, end])
            c.check(result.code != 0 and result.state == expected_state, 'ALIGNMENT_NATIVE_OUTGOING_CONSTRAINT')
            preserved(c, p, database, before)
        finally:
            p.dispose(database)

    database = p.fresh_generation(c.TARGET, 'null-role-unique-distinction')
    try:
        f = fixtures.Fixture(c, p, database).base()
        f.tgt('null-first', test_suite='null-unique', role_code=None, data_key='first')
        before = p.snapshot(database)
        succeeded(c, p.envelope(database, before, p.expected(before)))
        f.shape = p.snapshot(database)[0]
        f.tgt('null-second', test_suite='null-unique', role_code=None, data_key='second')
        after = p.snapshot(database)
        c.check(len(c.batch.model.a_losers([r for table, r in after[1] if table == 'public.ediel_tgt_test_data'])) == 1,
                'ALIGNMENT_NULL_GROUP_VS_UNIQUE_REQUIRED')
        # The older four-key constraint still rejects a same-company/key insert.
        result = p.run(database, 'INSERT INTO public.ediel_tgt_test_data(id,company_id,test_suite,role_code,test_case_code,data_key) VALUES (' + f.literal(fixtures.uid('old-key-conflict')) + ',' + f.literal(f.company) + ",'null-unique','other-role','case','first');")
        c.check(result.code != 0 and result.state == '23505', 'ALIGNMENT_BASE_UNIQUE_PRESERVED')
        preserved(c, p, database, after)
    finally:
        p.destroy(database)


def count_edge_rows(c, p, fixtures):
    database = p.fresh_generation(c.TARGET, 'count-reserved-null-unknown-ties')
    try:
        f = fixtures.Fixture(c, p, database).base()
        setup = ''
        for column in ('status', 'created_at'):
            if f.attrs('customer_contracts')[column]['notnull']:
                setup += 'ALTER TABLE public.customer_contracts ALTER COLUMN ' + c.batch.ident(column) + ' DROP NOT NULL;'
        # Only source status restrictions are relaxed on this named test clone.
        # The original keeps every exact constraint; this is not an admitted
        # application schema or a correction to immutable C count semantics.
        for key, value in f.shape.items():
            if key.startswith('constraint/public.customer_contracts/') and value['kind'] == 'c' and re.search(r'\bstatus\b', value['definition']):
                setup += 'ALTER TABLE public.customer_contracts DROP CONSTRAINT ' + c.batch.ident(key.rsplit('/', 1)[1]) + ';'
        if setup:
            p.query(database, setup); f.shape = p.snapshot(database)[0]
        for ordinal, status in enumerate((None, 'none', 'unknown', 'all', 'pending_signature', 'signed', 'active', 'closed')):
            customer = f.add('customers', 'edge-customer-' + str(ordinal), company_id=f.company, status='active')
            f.add('customer_contracts', 'edge-contract-' + str(ordinal), customer_id=customer, company_id=f.company,
                  status=status, created_at=None if ordinal == 0 else fixtures.STAMP)
        for label, status in (('tie-low', 'signed'), ('tie-high', 'closed')):
            f.add('customer_contracts', label, customer_id=f.customer, company_id=f.company, status=status,
                  created_at=fixtures.STAMP)
        before = p.snapshot(database)
        succeeded(c, p.envelope(database, before, p.expected(before, setup)))
        state = {}
        for table, row in p.snapshot(database)[1]:
            if table.startswith('public.'):
                state.setdefault(table[7:], []).append(row)
        result = json.loads(p.query(database, "SELECT jsonb_agg(to_jsonb(x)) FROM public.admin_customer_latest_contract_counts(NULL,NULL) x;"))
        rows = [(r['bucket'], r['total']) for r in result]
        c.check(sorted(rows) == sorted(c.batch.model.count_rows(state)), 'ALIGNMENT_COUNT_NULL_UNKNOWN_TIE_ORACLE')
        c.check(sum(key == 'none' for key, _ in rows) == 2 and sum(key == 'all' for key, _ in rows) == 2,
                'ALIGNMENT_COUNT_DUPLICATE_LABELS')
        try:
            c.batch.model.aggregate_counts(rows)
        except ValueError:
            pass
        else:
            raise c.batch.BoundaryError('ALIGNMENT_RESERVED_ALL_AMBIGUITY_ACCEPTED')
    finally:
        p.destroy(database)


def controller_deaths(c):
    """Exact owned supervisor; never adopts/rearms the dead controller handle."""
    import os
    from pathlib import Path
    import shutil
    import signal
    originals = c.batch.replay.originals_snapshot()
    for stage in ('A', 'C'):
        child = subprocess.run([c.sys.executable, str(Path(c.__file__).resolve()), '--death-worker', stage],
                               capture_output=True, timeout=300, env=c.legacy.clean_environment())
        c.check(child.returncode == -signal.SIGKILL, 'ALIGNMENT_CONTROLLER_SIGKILL_REQUIRED')
        markers = []
        for line in child.stdout.decode().splitlines():
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if value.get('alignment_death_ready') == stage:
                markers.append(value)
        c.check(len(markers) == 1 and markers[0].get('privacy') is True, 'ALIGNMENT_DEATH_PRIVATE_CHECKPOINT')
        directory = Path(markers[0]['directory'])
        c.check(directory.name.startswith('gridex-auth-legacy-') and directory.is_dir()
                and not directory.is_symlink() and directory.stat().st_uid == os.getuid(),
                'ALIGNMENT_EXACT_DEATH_DIRECTORY')
        name = os.environ['GRIDEX_LEGACY_CONTAINER_NAME']
        c.require_owner()
        def command(args, sql=None):
            result = subprocess.run(['docker', *args], input=sql, capture_output=True, timeout=30,
                                    env=c.legacy.clean_environment())
            c.check(result.returncode == 0, 'ALIGNMENT_DEATH_OBSERVATION_FAILED')
            return result.stdout
        def query(database, sql):
            c.legacy.validate_database(database)
            return command(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', database,
                            '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'],
                           ("SET log_min_messages=panic;\n" + sql).encode())
        try:
            c.check(command(['inspect', '--format', '{{ index .Config.Labels "gridex.auth-legacy.owner" }}', name]).decode().strip() == name,
                    'ALIGNMENT_DEATH_OWNER_LABEL')
            # The dead controller cannot publish. Terminate its still-held private
            # transaction before comparing the target against the immutable origin.
            command(['exec', name, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-c',
                     "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='gridex_auth_legacy_atomic';"])
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                count = command(['exec', name, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-c',
                                 "SELECT count(*) FROM pg_stat_activity WHERE datname='gridex_auth_legacy_atomic';"])
                if count.strip() == b'0':
                    break
                time.sleep(.05)
            c.check(count.strip() == b'0', 'ALIGNMENT_DEATH_BACKEND_RELEASE')
            snapshot = c.batch.catalog.sql(c.repair) + '\n' + c.batch.rows_sql() + "\nSELECT coalesce(jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value),'[]') FROM alignment_rows; DROP TABLE alignment_rows;"
            # One outer transaction keeps the shared ON COMMIT DROP reader alive.
            snapshot = 'BEGIN;\n' + snapshot + '\nCOMMIT;'
            c.check(query(c.ATOMIC, snapshot) == query(c.batch.replay.DATABASE, snapshot),
                    'ALIGNMENT_CONTROLLER_DEATH_FULL_ROLLBACK')
            c.check(query(c.CANARY, 'SELECT value FROM public.alignment_canary;').strip() == b'preserved',
                    'ALIGNMENT_CONTROLLER_CANARY_PRESERVED')
            collector = command(['exec', name, 'sh', '-c', 'cat /var/lib/postgresql/data/pg_log_private/*.log'])
            for source in (c.core.Source(key) for key in c.core.SPECS):
                c.check(not any(value.encode() in collector for value in source.slots.values()),
                        'ALIGNMENT_CONTROLLER_COLLECTOR_PRIVACY')
            c.check(c.batch.replay.originals_snapshot() == originals, 'ALIGNMENT_CONTROLLER_SOURCE_RESTORATION')
            c.legacy.cleanup_workflow_owned()
            c.check(not command(['ps', '-aq', '--filter', 'name=^/' + name + '$']).strip(), 'ALIGNMENT_CONTROLLER_EXACT_CLEANUP')
        finally:
            c.legacy.cleanup_workflow_owned()
            shutil.rmtree(directory)
        print('PASS customer alignment controller death; rollback/privacy/exact cleanup', flush=True)


def standalone_c_backfills(c, p, fixtures):
    """C's portal fills are shadowed by B in the group; characterize whole C too."""
    database = p.fresh_generation(c.ATOMIC, 'whole-c-dirty-and-populated')
    try:
        f = fixtures.Fixture(c, p, database).base()
        setup = 'ALTER TABLE public.billing_export_run_items ADD COLUMN contract_id uuid;'
        for table in ('metering_points', 'ediel_inbound_cases', 'customer_portal_accounts', 'customer_portal_claims'):
            if f.attrs(table)['updated_at']['notnull']:
                setup += 'ALTER TABLE public.' + c.batch.ident(table) + ' ALTER COLUMN updated_at DROP NOT NULL;'
        p.query(database, setup); f.shape = p.snapshot(database)[0]
        message = f.add('ediel_messages', 'c-parent', company_id=f.company, customer_id=f.customer)
        for table, parent_column, parent in (
            ('ediel_inbound_cases', 'ediel_message_id', message),
            ('customer_portal_accounts', 'customer_id', f.customer),
            ('customer_portal_claims', 'customer_id', f.customer),
            ('customer_portal_events', 'customer_id', f.customer)):
            for label, company in (('dirty', None), ('populated', f.other)):
                values = {parent_column: parent, 'company_id': company}
                if table != 'customer_portal_events':
                    values['updated_at'] = None
                f.add(table, 'c-' + label, **values)
        for label, company, customer in (('dirty', None, f.other_customer), ('populated', f.other, f.other_customer)):
            f.add('metering_points', 'c-' + label, site_id=f.site, customer_id=customer,
                  company_id=company, updated_at=None)
        before = p.snapshot(database)
        p.fresh_generation(c.ORACLE, 'whole-c-independent-oracle')
        try:
            p.query(c.ORACLE, setup)
            source = p.sources[3].data.decode().splitlines()
            declarations = '\n'.join(item[4] for item in c.batch.index_declarations(p.sources)
                                     if item[0] == 'C' and c.batch.index_selected(item, before[0]))
            declarations += '\n' + '\n'.join(source[127:163]) + '\n' + '\n'.join(source[168:])
            p.query(c.ORACLE, declarations)
            expected_catalog = p.snapshot(c.ORACLE)[0]
        finally:
            p.destroy(c.ORACLE)
        whole = p.h.private('alignment-dirty-whole-C.sql', p.sources[3].data)
        end = p.h.private('alignment-dirty-C-rollback.sql', "SELECT 'ALIGNMENT_C_CATALOG';\n" + c.batch.catalog.sql(c.repair) + "\nSELECT 'ALIGNMENT_C_ROWS';\n" + c.batch.rows_sql() + "\nSELECT jsonb_agg(jsonb_build_array(name,value) ORDER BY name,value) FROM alignment_rows; ROLLBACK;")
        result = p.run_inputs(database, "SELECT 'ALIGNMENT_C_CLOCK'; SELECT to_jsonb(now());", [whole, end])
        c.check(result.code == 0 and result.state == '00000', 'ALIGNMENT_WHOLE_C_NATIVE_REQUIRED')
        lines = result.stdout.splitlines()
        now = json.loads(lines[lines.index('ALIGNMENT_C_CLOCK') + 1])
        actual_rows = json.loads(lines[lines.index('ALIGNMENT_C_ROWS') + 1])
        c.check(json.loads(lines[lines.index('ALIGNMENT_C_CATALOG') + 1]) == expected_catalog,
                'ALIGNMENT_WHOLE_C_CATALOG_ORACLE')
        state, other = {}, []
        for table, row in before[1]:
            if table.startswith('public.'):
                state.setdefault(table[7:], []).append(row)
            else:
                other.append([table, row])
        modeled = c.batch.model.backfills(state, 'C', now)
        expected_rows = other + [['public.' + table, row] for table, rows in modeled.items() for row in rows]
        c.check(c.rows_equal(actual_rows, expected_rows), 'ALIGNMENT_WHOLE_C_FULL_BACKFILL_ORACLE')
        preserved(c, p, database, before)
    finally:
        p.dispose(database)
