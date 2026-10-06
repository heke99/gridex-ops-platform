import { createHash } from 'node:crypto'
import { tokenizeEdifact, segmentComposite } from '../../lib/ediel/core/edifactTokenizer'
import { closureFixture } from '../../__tests__/helpers/closureWireFixtures'

export type Db04PlanNode = {
  'Node Type': string; 'Actual Rows': number; 'Actual Loops': number
  'Rows Removed by Filter'?: number; 'Rows Removed by Index Recheck'?: number
  'Shared Hit Blocks': number; 'Shared Read Blocks': number; Plans?: Db04PlanNode[]
}
export type Db04Explain = { Plan: Db04PlanNode; 'Execution Time': number; 'Planning Time': number }
export const sqlLiteral = (value: string) => "'" + value.replaceAll("'", "''") + "'"
export function db04VisitedRows(node: Db04PlanNode): number {
  return (node['Actual Rows'] + (node['Rows Removed by Filter'] ?? 0) + (node['Rows Removed by Index Recheck'] ?? 0)) * node['Actual Loops']
    + (node.Plans ?? []).reduce((sum, child) => sum + db04VisitedRows(child), 0)
}
export function assertDb04Measurement(plan: Db04Explain, count: number, budgetMs: number): void {
  if (plan.Plan['Actual Rows'] !== count) throw Error('db04_measured_cardinality_changed')
  for (const value of [plan['Execution Time'], plan['Planning Time'], plan.Plan['Shared Hit Blocks'], plan.Plan['Shared Read Blocks']]) {
    if (!Number.isFinite(value) || value < 0) throw Error('db04_measured_plan_incomplete')
  }
  if (plan['Execution Time'] > budgetMs) throw Error('db04_measured_budget_exceeded')
}

/** Exact captured declarations only. Omitted source/auth/acceptance owners are
 * deliberately not replaced. The separate native suite retains the full schema. */
export function selectedDb04Schema(schema: string): string {
  const exact = (pattern: RegExp) => {
    const matches = [...schema.matchAll(pattern)]
    if (matches.length !== 1) throw Error('db04_captured_declaration_not_unique:' + pattern.source)
    return matches[0][0]
  }
  const tables = ['companies', 'ediel_messages', 'meter_reading_series'].map(name =>
    exact(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]+?\\n\\);`, 'g')))
  const views = ['ediel_message_ack_state_v', 'ediel_overdue_message_acks_v'].map(name =>
    exact(new RegExp(`CREATE VIEW public\\.${name} [\\s\\S]+?;`, 'g')))
  const indexes = ['ediel_messages_company_direction_ref_idx', 'ediel_messages_company_family_status_idx',
    'ediel_messages_company_id_id_uidx', 'meter_reading_series_company_period_idx', 'meter_reading_series_current_object_period_idx',
    'meter_reading_series_source_message_idx', 'meter_reading_series_supersedes_idx'].map(name =>
    exact(new RegExp(`CREATE (?:UNIQUE )?INDEX ${name} [^;]+;`, 'g')))
  const guard = exact(/CREATE FUNCTION public\.gridex_guard_meter_reading_series_tenant\(\)[\s\S]+?end \$\$;/g)
  const trigger = exact(/CREATE TRIGGER meter_reading_series_tenant_guard [^;]+;/g)
  const normalize = exact(/CREATE FUNCTION public\.gridex_normalize_org_number\(p_value text\)[\s\S]+?\$\$;/g)
  const tenantReference = exact(/CREATE FUNCTION public\.gridex_new_external_tenant_reference\(\)[\s\S]+?\$\$;/g)
  return [normalize, tenantReference, ...tables, ...views, ...indexes, guard, trigger].join('\n')
}

/** Synthetic inbound original/query metadata only: no sent/accepted message,
 * qualified assessment, standing owner, measurement values, supply or invoice.
 * BEGIN/ROLLBACK belongs to the caller; the SQL never disables native guards. */
export function buildDb04Fixture(first: string, second: string, namespace: string, profile: 'native' | 'finite_projection' = 'native') {
  const originalRows = 2048
  const uuid = (label: string) => {
    const h = createHash('md5').update(namespace + label).digest('hex')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  }
  const id = (n: number) => uuid('message-' + n)
  const series = (n: number, version: number) => uuid(`series-${n}-${version}`)
  const sqlId = (label: string) => `md5(${sqlLiteral(namespace)}||${label})::uuid`
  const tenant = (n: number) => n === 10 || n === 43 || (n > 12 && n !== 42 && n % 10 === 0) ? second : first
  const environment = (n: number) => n === 44 || (n > 12 && n !== 42 && n % 13 === 0) ? 'production' : 'test'
  const sender = (n: number) => n === 45 || (n > 12 && n !== 42 && n % 7 === 0) ? '77777' : '12345'
  const status = (n: number) => n === 8 || n % 128 === 0 ? 'failed' : 'received'
  const ref = 'd4' + namespace.replaceAll('-', '').slice(0, 5)
  const original = closureFixture({ reason: 'Z24' }).wire
  const tokens = tokenizeEdifact(original), unb = tokens.segments.find(segment => segment.tag === 'UNB')!
  const originalReference = segmentComposite(unb, 5, tokens.una)[0]
  const wire = (production: boolean) => {
    const parts = unb.raw.split('+'); while (parts.length < 12) parts.push('')
    parts[9] = '1'; parts[11] = production ? '' : '1'
    return original.replace(unb.raw, parts.join('+'))
  }
  const own = `${sqlLiteral(first)}::uuid`, foreign = `${sqlLiteral(second)}::uuid`
  const reference = sqlLiteral(ref + '42')
  const message = (n: number) => `${sqlLiteral(id(n))}::uuid`
  const base = (n: number) => `${sqlLiteral(series(n, 1))}::uuid`
  // The finite projection has no canonical admission authority at all. Native
  // reads the existing installed profile, with every real birth guard enabled.
  const profileColumns = profile === 'native'
    ? "pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile"
    : "NULL,NULL,NULL,NULL,NULL,'{}'::jsonb"
  const profileJoin = profile === 'native'
    ? "CROSS JOIN public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z05:L:26.A:r3' AND profile.is_enabled"
    : ''
  const seedSql = `
    INSERT INTO public.companies(id,name,status) VALUES(${own},'DB04 synthetic query owner A','active'),(${foreign},'DB04 synthetic query owner B','active');
    INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,
      raw_payload,message_received_at,sender_ediel_id,receiver_ediel_id,interchange_reference,created_at,
      requires_contrl,requires_aperak,contrl_status,ack_due_at,acknowledged_at,test_flag,
      canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot)
    SELECT ${sqlId("'message-'||n::text")},
      CASE WHEN n IN(10,43) OR (n>12 AND n<>42 AND n%10=0) THEN ${foreign} ELSE ${own} END,
      CASE WHEN n=44 OR (n>12 AND n<>42 AND n%13=0) THEN 'production' ELSE 'test' END,
      'inbound','edifact','PRODAT','Z05',CASE WHEN n=8 OR n%128=0 THEN 'failed' ELSE 'received' END,
      replace(CASE WHEN n=44 OR (n>12 AND n<>42 AND n%13=0) THEN ${sqlLiteral(wire(true))} ELSE ${sqlLiteral(wire(false))} END,
        ${sqlLiteral(originalReference)},${sqlLiteral(ref)}||CASE WHEN n BETWEEN 42 AND 46 THEN '42' ELSE n::text END),
      now(),CASE WHEN n=45 OR (n>12 AND n<>42 AND n%7=0) THEN '77777' ELSE '12345' END,
      CASE WHEN n=46 THEN '88888' ELSE '54321' END,${sqlLiteral(ref)}||CASE WHEN n BETWEEN 42 AND 46 THEN '42' ELSE n::text END,
      now()-make_interval(secs=>n),n=6,n=7,CASE WHEN n=11 THEN 'failed' WHEN n=6 THEN 'pending' ELSE NULL END,
      CASE WHEN n=1 THEN now()-interval '2 days' WHEN n=2 THEN now()-interval '1 day' WHEN n=3 THEN now()
        WHEN n=4 THEN now()+interval '1 hour' WHEN n BETWEEN 6 AND 11 THEN now()-interval '1 hour' ELSE NULL END,
      CASE WHEN n=9 THEN now() ELSE NULL END,CASE WHEN n=44 OR (n>12 AND n<>42 AND n%13=0) THEN 0 ELSE 1 END,
      ${profileColumns}
    FROM generate_series(1,${originalRows}) n ${profileJoin};
    INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,external_metering_point_id,grid_area_id,
      period_start,period_end,resolution,unit,quality_status,dedupe_key,series_kind,message_code,version_no,is_current,raw_transaction)
    SELECT ${sqlId("'series-'||n::text||'-1'")},m.company_id,m.id,'DB04-object-'||n,'SYNTHETIC',
      '2020-01-01'::timestamptz,'2020-01-02'::timestamptz,'UNKNOWN','KWH','received',${sqlLiteral(namespace)}||'-base-'||n,
      'request','Z05',1,false,'{"syntheticQueryMetadata":true,"authorizesBusinessEffects":false}'::jsonb
    FROM generate_series(1,${originalRows}) n JOIN public.ediel_messages m ON m.id=${sqlId("'message-'||n::text")};
    INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,external_metering_point_id,grid_area_id,
      period_start,period_end,resolution,unit,quality_status,dedupe_key,series_kind,message_code,version_no,is_current,supersedes_series_id,raw_transaction)
    SELECT ${sqlId("'series-'||n::text||'-'||v::text")},m.company_id,m.id,'DB04-object-'||n,'SYNTHETIC',
      '2020-01-01'::timestamptz,'2020-01-02'::timestamptz,'UNKNOWN','KWH','received',${sqlLiteral(namespace)}||'-version-'||n||'-'||v,
      'request','Z05',v,v=2,${sqlId("'series-'||n::text||'-1'")},'{"syntheticQueryMetadata":true,"authorizesBusinessEffects":false}'::jsonb
    FROM generate_series(1,${originalRows}) n CROSS JOIN generate_series(2,2) v
      JOIN public.ediel_messages m ON m.id=${sqlId("'message-'||n::text")}
    UNION ALL SELECT ${sqlLiteral(series(42, 3))}::uuid,${own},${message(42)},'DB04-object-42','SYNTHETIC',
      '2020-01-01'::timestamptz,'2020-01-02'::timestamptz,'UNKNOWN','KWH','received',${sqlLiteral(namespace + '-opposing-version')},
      'request','Z05',3,false,${base(42)},'{"syntheticQueryMetadata":true,"authorizesBusinessEffects":false}'::jsonb;
    -- Each higher current version opposes one real readsite predicate. These
    -- remain request metadata with no values or accepted business effects.
    INSERT INTO public.meter_reading_series(id,company_id,source_ediel_message_id,external_metering_point_id,grid_area_id,
      period_start,period_end,resolution,unit,quality_status,dedupe_key,series_kind,message_code,product_id,
      version_no,is_current,supersedes_series_id,raw_transaction)
    SELECT ${sqlId("'opposition-'||k::text")},${own},CASE WHEN k=6 THEN ${message(44)} ELSE ${message(42)} END,
      'DB04-object-42','SYNTHETIC',
      CASE WHEN k=1 THEN '2019-12-31'::timestamptz ELSE '2020-01-01'::timestamptz END,
      CASE WHEN k=2 THEN '2020-01-03'::timestamptz ELSE '2020-01-02'::timestamptz END,
      CASE WHEN k=3 THEN 'PT60M' ELSE 'UNKNOWN' END,'KWH','received',
      CASE WHEN k=5 THEN 'not-the-current-original' ELSE ${sqlLiteral(namespace)}||'-opposition-'||k END,
      'request',CASE WHEN k=7 THEN 'Z06' ELSE 'Z05' END,CASE WHEN k=4 THEN 'SYNTHETIC-OTHER' ELSE NULL END,
      10+k,true,${base(42)},'{"syntheticQueryMetadata":true,"authorizesBusinessEffects":false}'::jsonb
    FROM generate_series(1,7) k;
    ANALYZE public.ediel_messages; ANALYZE public.meter_reading_series;
  `
  const ownRows = Array.from({ length: originalRows }, (_, i) => i + 1).filter(n => tenant(n) === first)
  const expected = {
    sparseQueue: ownRows.filter(n => status(n) === 'failed').map(id),
    denseQueue: ownRows.filter(n => status(n) === 'received').slice(0, 100).map(id),
    sla: [id(1), id(2)],
  }
  const prefix = `company_id=${own} AND direction='inbound' AND message_family='PRODAT'`
  const objectWhere = `s.company_id=${own} AND s.is_current AND s.series_kind='request'
    AND coalesce(s.message_code,'')='Z05' AND coalesce(s.external_metering_point_id,'')='DB04-object-42'
    AND coalesce(s.grid_area_id,'')='SYNTHETIC' AND s.period_start IS NOT DISTINCT FROM '2020-01-01'::timestamptz
    AND s.period_end IS NOT DISTINCT FROM '2020-01-02'::timestamptz AND s.resolution='UNKNOWN'
    AND coalesce(s.product_id,'')='' AND s.dedupe_key<>'not-the-current-original'
    AND EXISTS(SELECT FROM public.ediel_messages origin WHERE origin.id=s.source_ediel_message_id AND origin.company_id=${own} AND origin.environment='test')`
  const queries = {
    sparseQueue: { sql: `SELECT * FROM public.ediel_messages WHERE ${prefix} AND status='failed' ORDER BY created_at DESC LIMIT 100`, ids: expected.sparseQueue },
    denseQueue: { sql: `SELECT * FROM public.ediel_messages WHERE ${prefix} AND status='received' ORDER BY created_at DESC LIMIT 100`, ids: expected.denseQueue },
    actorEnvironment: { sql: `SELECT id FROM public.ediel_messages WHERE ${prefix} AND environment='test' AND sender_ediel_id='12345' AND status='received' ORDER BY created_at DESC LIMIT 20`,
      ids: ownRows.filter(n => environment(n) === 'test' && sender(n) === '12345' && status(n) === 'received').slice(0, 20).map(id) },
    reference: { sql: `SELECT id FROM public.ediel_messages WHERE ${prefix} AND environment='test' AND sender_ediel_id='12345' AND receiver_ediel_id='54321' AND interchange_reference=${reference}`, ids: [id(42)] },
    wrongDirection: { sql: `SELECT id FROM public.ediel_messages WHERE company_id=${own} AND direction='outbound' AND interchange_reference=${reference}`, ids: [] },
    wrongEnvironment: { sql: `SELECT id FROM public.ediel_messages WHERE company_id=${own} AND id=${message(42)} AND environment='production'`, ids: [] },
    foreignScope: { sql: `SELECT id FROM public.ediel_messages WHERE company_id=${own} AND id=${message(43)}`, ids: [] },
    sla: { sql: `SELECT * FROM public.ediel_overdue_message_acks_v WHERE company_id=${own} ORDER BY ack_due_at ASC LIMIT 100`, ids: expected.sla },
    currentObjectVersion: { sql: `SELECT s.id,s.version_no FROM public.meter_reading_series s WHERE ${objectWhere} ORDER BY s.version_no DESC LIMIT 1 FOR UPDATE`, ids: [series(42, 2)] },
    foreignObject: { sql: `SELECT id FROM public.meter_reading_series WHERE company_id=${foreign} AND source_ediel_message_id=${message(42)}`, ids: [] },
    sourceFanout: { sql: `SELECT id FROM public.meter_reading_series WHERE source_ediel_message_id=${message(42)} ORDER BY version_no`, ids: [...[1, 2, 3].map(v => series(42, v)), ...[1, 2, 3, 4, 5, 7].map(k => uuid('opposition-' + k))] },
    supersessionFanout: { sql: `SELECT id FROM public.meter_reading_series WHERE supersedes_series_id=${base(42)} AND supersedes_series_id IS NOT NULL ORDER BY version_no`, ids: [...[2, 3].map(v => series(42, v)), ...[1, 2, 3, 4, 5, 6, 7].map(k => uuid('opposition-' + k))] },
    absentSource: { sql: `SELECT id FROM public.meter_reading_series WHERE source_ediel_message_id=${sqlLiteral(uuid('absent'))}::uuid`, ids: [] },
  }
  const forbiddenParentsSql = `DO $$BEGIN
    BEGIN
      INSERT INTO public.meter_reading_series(company_id,source_ediel_message_id,dedupe_key,series_kind,resolution,unit)
      VALUES(${foreign},${message(42)},${sqlLiteral(namespace + '-wrong-source')},'request','UNKNOWN','KWH');
      RAISE EXCEPTION 'db04_foreign_source_was_accepted';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM<>'meter_reading_series_source_tenant_mismatch' THEN RAISE; END IF;
    END;
    BEGIN
      INSERT INTO public.meter_reading_series(company_id,supersedes_series_id,dedupe_key,series_kind,resolution,unit)
      VALUES(${foreign},${base(42)},${sqlLiteral(namespace + '-wrong-supersession')},'request','UNKNOWN','KWH');
      RAISE EXCEPTION 'db04_foreign_supersession_was_accepted';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM<>'meter_reading_series_supersedes_tenant_mismatch' THEN RAISE; END IF;
    END;
  END$$;`
  const oppositionControls = [
    "AND s.period_start IS NOT DISTINCT FROM '2020-01-01'::timestamptz",
    "AND s.period_end IS NOT DISTINCT FROM '2020-01-02'::timestamptz",
    "AND s.resolution='UNKNOWN'", "AND coalesce(s.product_id,'')=''",
    "AND s.dedupe_key<>'not-the-current-original'", "AND origin.environment='test'",
    "AND coalesce(s.message_code,'')='Z05'",
  ].map((predicate, i) => ({ sql: queries.currentObjectVersion.sql.replace(predicate, ''), ids: [uuid('opposition-' + (i + 1))] }))
  const ackStates = ['ack_overdue', 'ack_overdue', 'no_ack_required', 'no_ack_required', 'no_ack_required',
    'awaiting_contrl', 'awaiting_aperak', 'failed', 'no_ack_required', 'ack_overdue', 'contrl_failed']
    .map((state, i) => ({ id: id(i + 1), canonical_ack_state: state }))
  const slaMonitorSql = `SELECT * FROM public.ediel_overdue_message_acks_v WHERE company_id=${own} LIMIT 100`
  const slaCountSql = `SELECT count(*)::int n FROM public.ediel_overdue_message_acks_v WHERE company_id=${own}`
  return { first, second, namespace, originalRows, seriesRows: originalRows * 2 + 8, seedSql, expected, queries, forbiddenParentsSql, oppositionControls, ackStates, slaMonitorSql, slaCountSql }
}
