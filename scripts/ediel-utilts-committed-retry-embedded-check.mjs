// Focused embedded PostgreSQL execution, not native Supabase migration replay,
// transport, generated-type, or canonical-schema evidence.
// EDIEL_PGLITE_MODULE must point to pinned @electric-sql/pglite@0.3.14 tooling.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const modulePath = process.env.EDIEL_PGLITE_MODULE
assert.ok(modulePath, 'EDIEL_PGLITE_MODULE required')
const modulePackage = JSON.parse(fs.readFileSync(new URL('../package.json', pathToFileURL(modulePath)), 'utf8'))
assert.equal(modulePackage.name, '@electric-sql/pglite')
assert.equal(modulePackage.version, '0.3.14', 'pinned PGlite 0.3.14 required')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const root = fileURLToPath(new URL('..', import.meta.url))
const read = path => fs.readFileSync(`${root}/${path}`, 'utf8')
const migration = name => read(`supabase/migrations/${name}.sql`)
function section(sql, start, end) {
  const from = sql.indexOf(start)
  const to = sql.indexOf(end, from + start.length)
  assert.ok(from >= 0 && to > from, `SQL section unavailable: ${start}`)
  return sql.slice(from, to)
}
const db = new PGlite()
let checks = 0
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA extensions;
    -- PGlite lacks pgcrypto. PostgreSQL's built-in SHA256 supplies the exact
    -- byte digest used by the unchanged SQL owners, for this check only.
    CREATE FUNCTION extensions.digest(value bytea, algorithm text) RETURNS bytea
    LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT CASE WHEN algorithm='sha256' THEN sha256(value) END $$;
    CREATE TABLE public.companies(id uuid PRIMARY KEY, name text NOT NULL, status text NOT NULL);`)
  const schema = read('supabase/schema.sql')
  const tables = ['ediel_messages', 'ediel_ack_transaction_results', 'meter_reading_series',
    'meter_reading_values', 'ediel_message_profiles', 'ediel_rule_packs']
  for (const table of tables) {
    await db.exec(section(schema, `CREATE TABLE public.${table} (`, '\n);') + '\n);')
    // Load the actual primary/unique constraints needed by the bound owners.
    const constraints = schema.matchAll(new RegExp(`ALTER TABLE ONLY public\\.${table}\\n    ADD CONSTRAINT [^;]+;`, 'g'))
    for (const [sql] of constraints) if (/ PRIMARY KEY | UNIQUE /.test(sql)) await db.exec(sql)
  }
  const rowGuards = ['gridex_guard_meter_reading_series_tenant', 'gridex_guard_meter_reading_value_tenant',
    'gridex_guard_immutable_meter_reading_series', 'gridex_guard_immutable_meter_reading_value']
  for (const name of rowGuards) await db.exec(section(schema, `CREATE FUNCTION public.${name}()`, '\n--'))
  for (const [sql] of schema.matchAll(/CREATE TRIGGER [^;]+ ON public\.meter_reading_(?:series|values) [^;]+;/g)) await db.exec(sql)
  await db.exec(`GRANT SELECT ON public.ediel_messages, public.ediel_ack_transaction_results,
    public.meter_reading_series TO service_role;
    INSERT INTO public.ediel_rule_packs(id,market,family,guide_version,guide_revision,
      unh_association_code,valid_from,status,source_document,source_hash)
    VALUES('00000000-0000-4000-8000-00000000f911','electricity','UTILTS','25-A-4','1',
      'E5SE5A','2026-01-01','active','embedded-reservation-control',repeat('a',64));
    INSERT INTO public.ediel_message_profiles(id,rule_pack_id,message_code,direction,
      business_process,profile_key,profile)
    VALUES('00000000-0000-4000-8000-00000000f912','00000000-0000-4000-8000-00000000f911',
      'E66','inbound','embedded-reservation-control','embedded-reservation-control','{}');`)

  // Execute the real binding, source guard, validators and insertion owner.
  // Downstream business sinks are outside this narrow reservation check.
  await db.exec(migration('20260923135706_ediel_utilts_consumption_binding_v1'))
  await db.exec(section(migration('20260923150649_ediel_utilts_bound_sink_authority'),
    'CREATE FUNCTION gridex_utilts_binding.validate_contract_base_v1', '-- Authoritative lookup'))
  await db.exec(section(migration('20260928173000_utilts_unowned_regulating_object_sink_fence'),
    'CREATE FUNCTION gridex_utilts_binding.unowned_regulating_object_v1', '-- Forward replacement'))
  await db.exec(migration('20260928181500_utilts_held_retry_stable_reservation'))
  await db.exec(migration('20260928201500_utilts_late_175_physical_ide_fence'))
  await db.exec(migration('20260928215000_utilts_late_172_physical_ide_fence'))
  await db.exec(migration('20260929234037_utilts_s02_required_physical_scope'))

  const company = '00000000-0000-4000-8000-00000000f931'
  const source = '00000000-0000-4000-8000-00000000f932'
  const heldSource = '00000000-0000-4000-8000-00000000f933'
  const raw = "UNB+UNOC:3+91100:ZZ+21660:ZZ+261001:0000+LEGACY'UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66+LEGACY+9'NAD+MS+91100:SVK:260'NAD+MR+21660:SVK:260'IDE+24+OLD'LOC+172+POINT::9'MEA+AAZ++KWH'SEQ++1'QTY+136:9007199254740993'UNT+9+1'UNZ+1+LEGACY'"
  await db.query("INSERT INTO public.companies VALUES($1,'Embedded historical V1 control','active')", [company])
  for (const id of [source, heldSource]) await db.query(`INSERT INTO public.ediel_messages
    (id,company_id,environment,direction,message_family,message_code,raw_payload)
    VALUES($1,$2,'test','inbound','UTILTS','E66',$3)`, [id, company, raw])
  const skip = { capability: 'skip', reason: 'no_attribution', customerId: null, siteId: null,
    customerSiteId: null, meteringPointId: null, gridOwnerId: null, sourceRequestId: null }
  const contract = { version: 1, projectionVersion: 'utilts-consumption-v1', attributionVersion: 'tenant-match-v1',
    companyId: company, environment: 'test', messageCode: 'E66', transactionId: 'OLD', seriesKind: 'actual',
    profileKey: 'embedded-reservation-control', profileVersion: null, rulePackHash: null,
    guideRevision: '25-A-4', sourceType: 'ediel_utilts',
    interpretation: { localPeriodStart: null, localPeriodEnd: null, localRegistration: null,
      resolutionValue: null, resolutionFormat: null, timezoneRaw: null, timezoneFormat: null,
      offsetMinutes: null, timestampPolicy: 'explicit-offset-v1' },
    observations: [{ ordinal: 0, sourceOrdinal: 0, quantity: 9007199254740992,
      periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-10-01T00:15:00.000Z',
      readAt: '2026-10-01T00:15:00.000Z', resolution: null, unit: 'kWh', quality: null,
      readingType: 'consumption', direction: 'consumption', registerCode: null, productCode: null,
      sourceLineReference: null, externalPoint: 'POINT', gridArea: null }],
    metering: skip, billing: { ...skip, requestScope: null, periodStart: null, periodEnd: null,
      month: null, year: null, status: 'received', sourceSystem: 'ediel_utilts', currency: 'SEK' },
    billingContributionOrdinals: [] }
  const oldItem = { transactionId: 'OLD', disposition: 'accepted', responseType: 'positive_aperak',
    issueCodes: [], seriesKind: 'actual', externalMeteringPointId: 'POINT', unit: 'KWH',
    quantities: [{ qualifier: '136', value: 9007199254740992 }], consumptionContract: contract }
  const newItem = { ...oldItem, quantities: [{ qualifier: '136', value: '9007199254740993' }],
    consumptionContract: { ...contract, version: 2, projectionVersion: 'utilts-consumption-v2',
      observations: [{ ...contract.observations[0], quantity: '9007199254740993' }] } }
  const heldItem = { transactionId: 'OLD', disposition: 'internal_review', responseType: 'none',
    issueCodes: ['UTILTS_STRUCTURE_UNAVAILABLE'], seriesKind: 'actual', quantities: [],
    consumptionContract: { ...contract, observations: [] } }
  async function persist(id, item, payload = raw, tenant = company, environment = 'test') {
    await db.exec('SET ROLE service_role')
    try {
      return (await db.query(`SELECT public.gridex_persist_utilts_consumption_v1(
        $1,$2,$3,'E66',$4,$5::jsonb) result`, [tenant, environment, id, payload, JSON.stringify([item])])).rows[0].result
    } finally { await db.exec('RESET ROLE') }
  }
  async function snapshot(id) {
    return (await db.query(`SELECT jsonb_build_object(
      'source',(SELECT to_jsonb(s) FROM public.ediel_messages s WHERE id=$1),
      'receipt',(SELECT to_jsonb(r) FROM gridex_utilts_binding.receipts r WHERE source_message_id=$1),
      'acks',(SELECT jsonb_agg(to_jsonb(a) ORDER BY source_transaction_id) FROM public.ediel_ack_transaction_results a WHERE source_message_id=$1),
      'series',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM public.meter_reading_series s WHERE source_ediel_message_id=$1),
      'values',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.source_ediel_message_id=$1),
      'contracts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY series_id) FROM gridex_utilts_binding.contracts c WHERE source_message_id=$1)) snapshot`, [id])).rows[0].snapshot
  }
  async function refusal(action, message) {
    await assert.rejects(action, error => error.message === message)
    checks++
  }
  const original = await persist(source, oldItem)
  assert.equal(original[0].contractVersion, 1)
  // As in the retained SQL regression, the source row stands in for the
  // synthetic ACK FK. This tests frozen finalization, not an ACK transport.
  await db.query(`UPDATE public.ediel_ack_transaction_results SET final_response_type='positive_aperak',
    response_message_id=$1,finalized_at=clock_timestamp() WHERE source_message_id=$1`, [source])
  await persist(heldSource, heldItem)
  const before = await snapshot(source)
  const beforeHeld = await snapshot(heldSource)
  // A genuine V1 receipt/series/contract is created by the actual historical
  // public command before applying the forward migration. No direct seed or
  // post-upgrade rewrite can stand in for immutable historical replay.
  await db.exec(migration('20260930145350_ediel_utilts_exact_decimal_contract_v2'))
  await db.exec(migration('20260930161718_ediel_utilts_e30_energy_source_and_null_quality'))
  assert.deepEqual(await snapshot(source), before)
  checks++
  for (const item of [oldItem, newItem]) {
    const replay = await persist(source, item)
    assert.equal(replay[0].idempotentReplay, true)
    assert.equal(replay[0].contractVersion, 1)
    assert.deepEqual(replay[0].consumptionContract, contract)
    assert.deepEqual(replay[0].sourceBinding, original[0].sourceBinding)
    assert.deepEqual(await snapshot(source), before)
    checks++
  }
  const stored = (await db.query('SELECT gridex_utilts_binding.stored_contract_v1($1,$2,\'OLD\') contract', [company, source])).rows[0].contract
  assert.deepEqual(stored, contract)
  checks++
  await refusal(() => persist(source, { ...newItem, quantities: [{ qualifier: '136', value: '9007199254740992' }] }), 'utilts_consumption_decimal_source_conflict')
  await refusal(() => persist(source, oldItem, raw.replace('LEGACY+9', 'CHANGED+9')), 'utilts_source_binding_conflict')
  await refusal(() => persist(source, oldItem, raw, '00000000-0000-4000-8000-00000000f934'), 'utilts_source_binding_conflict')
  await refusal(() => persist(source, oldItem, raw, company, 'production'), 'utilts_source_binding_conflict')
  for (const item of [oldItem, newItem]) await refusal(() => persist(heldSource, item), 'utilts_legacy_retry_contract_unavailable')
  assert.deepEqual(await snapshot(source), before)
  assert.deepEqual(await snapshot(heldSource), beforeHeld)
  checks++

  const freshSource = '00000000-0000-4000-8000-00000000f935'
  const freshRaw = raw.replace('IDE+24+OLD', 'IDE+24+FRESH')
  const freshItem = { ...newItem, transactionId: 'FRESH',
    consumptionContract: { ...newItem.consumptionContract, transactionId: 'FRESH' } }
  await db.query(`INSERT INTO public.ediel_messages
    (id,company_id,environment,direction,message_family,message_code,raw_payload)
    VALUES($1,$2,'test','inbound','UTILTS','E66',$3)`, [freshSource, company, freshRaw])
  const beforeFresh = await snapshot(freshSource)
  await refusal(() => persist(freshSource, { ...oldItem, transactionId: 'FRESH',
    consumptionContract: { ...contract, transactionId: 'FRESH' } }, freshRaw), 'utilts_new_consumption_requires_v2')
  assert.deepEqual(await snapshot(freshSource), beforeFresh)
  const fresh = await persist(freshSource, freshItem, freshRaw)
  assert.equal(fresh[0].contractVersion, 2)
  assert.deepEqual(fresh[0].consumptionContract, freshItem.consumptionContract)
  assert.equal((await db.query('SELECT quantity::text quantity FROM public.meter_reading_values WHERE series_id=$1',
    [fresh[0].seriesId])).rows[0].quantity, '9007199254740993')
  assert.equal((await snapshot(freshSource)).receipt.contract_version, 2)
  checks++
  const storedFresh = (await db.query("SELECT gridex_utilts_binding.stored_contract_v1($1,$2,'FRESH') contract",
    [company, freshSource])).rows[0].contract
  assert.deepEqual(storedFresh, freshItem.consumptionContract)
  const afterFresh = await snapshot(freshSource)
  assert.equal((await persist(freshSource, freshItem, freshRaw))[0].idempotentReplay, true)
  assert.deepEqual(await snapshot(freshSource), afterFresh)
  checks++
  await refusal(() => persist(freshSource, { ...freshItem, consumptionContract: {
    ...freshItem.consumptionContract, observations: [{ ...freshItem.consumptionContract.observations[0], quantity: '9007199254740992' }] } }, freshRaw),
    'utilts_consumption_decimal_source_conflict')
  assert.deepEqual(await snapshot(freshSource), afterFresh)
  checks++

  const sql = read('scripts/ediel-utilts-committed-retry-regression.sql').replace(/^\\[^\n]*\n/gm, '')
  const executions = await db.exec(sql)
  const results = executions.find(result => result.fields?.map(field => field.name).join(',') === 'name,passed')?.rows
  assert.ok(results, 'retained retry results unavailable')
  const originalChecks = ['held-has-no-series', 'negative-ack-plan-is-durable-before-finalization',
    'interrupted-err-cannot-become-positive-aperak', 'fresh-authority-releases-held-transaction',
    'persisted-retry-preserves-series', 'persisted-retry-cannot-become-held',
    'same-finalized-retry-idempotent', 'finalized-ack-cannot-be-rewritten']
  for (const name of originalChecks) assert.equal(results.find(row => row.name === name)?.passed, true, name)
  assert.ok(results.every(row => row.passed === true))
  console.log(`Embedded PostgreSQL: ${results.length} retry SQL checks and ${checks} V1 upgrade/replay + exact V2 checks PASS. Native Supabase replay remains required.`)
} catch (error) {
  console.error(`Embedded PostgreSQL check failed: ${error.message}${error.code ? ` (${error.code})` : ''}`)
  if (error.where) console.error(error.where)
  process.exitCode = 1
} finally { await db.close() }
