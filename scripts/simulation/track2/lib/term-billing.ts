// TERM-fakturering: hjälpare för att ställa upp leveransperiod, mätvärden, spotpriser och anropa appens riktiga
// rutter (generate-underlay, spot/lock-month, pricing/preview). Allt via HTTP med en riktig admin-session eller via
// stackens egen databas; ingen appkod importeras.
//
// ============================== BACKENDERSÄTTNINGAR (läs detta först) ==============================
// Varje ersättning är en medveten genväg i harnessen. Den anges här så att ingen tror att steget bevisar mer än det gör.
//
// B1. createSupplyPeriod: en rad i customer_supply_periods skrivs med SQL (source/source_process 'sim_term02').
//     VERIFIERAR INTE: att leveransperioden uppstår via en riktig bytesprocess (PRODAT Z03/Z04, bekräftelse,
//     marknadsstart market_start_at, reglerat underlag/ground). Fältet market_start_at lämnas NULL.
//
// B2. insertMeteringValues: metering_values + normalized_metering_values skrivs med SQL med alla fält som
//     appens läsväg kräver (revision_status current, billing_status billable, billing_gate_status eligible,
//     supply_period_id, source_message_id, source_metering_value_id). Det finns ingen normal ingest-RPC som ger
//     fakturerbara värden: den riktiga vägen kräver ett inkommet UTILTS E66-original (ediel_messages + regelbevis +
//     bunden förbrukningskontrakt-rad + ACK-resultat + meter_reading_series) och en kvalificerad leveransperiod
//     (gridex_received_sources.billing_supply_basis_v1 -> normal_switch_confirmations eller supply_source_transitions
//     med validation_assessments och regulated_supply_ground_versions). Se gridex_billing_source.basis_v1 och
//     gridex_store_billing_underlay / gridex_set_metering_billing_gate i stackens databas.
//     KONSEKVENS: värdena kan inte bli "qualified" (billing_source_basis.qualified=false), så generate-underlay kan
//     bara ge needs_review (aldrig ready_for_pricing) och lagrar underlaget via den oskyddade not-ready-grenen i
//     gridex_store_billing_underlay. Täckning, överlapp, dubbletter, summor, period och intervallantal kontrolleras
//     däremot av appens egen kod. Scenariot skiljer därför "ersättningsblockerare" (källbevis, ej verifierbara här)
//     från riktiga täckningsvarningar (classifyUnderlayWarnings).
//     VERIFIERAR INTE: UTILTS-original, kvalitetskod från källobservation, kvalificerat källbevis, leveransperiodens
//     rättsliga underlag, ACK/APERAK, retention.
//
// B3. insertSpotIntervals: spot_price_intervals skrivs med SQL (källa 'elprisetjustnu'). Ingen extern hämtning.
//     VERIFIERAR INTE: leverantörens API, parsning, valutakonvertering, importjobb (spot_price_import_jobs/runs).
//
// B4. prepareAndLockSpotMonth: spot_price_daily_summaries skrivs med SQL (verified, med checksumma över intervallen
//     och förväntat antal intervall enligt oraklets egen DST-regel). spot_price_monthly_summaries-raden skapas som
//     stub; databasens egen trigger (gridex_enforce_spot_price_month_server_aggregate_v1) räknar om alla fält från
//     intervallen och sätter verified endast vid full täckning. Själva låsningen görs via appens riktiga route
//     POST /api/internal/spot/lock-month (om session ges) eller RPC gridex_lock_spot_price_month (service_role).
//     VERIFIERAR INTE: importörens dagsvalidering (validateSpotPriceDay), leverantörsdata, importköer.
//
// B5. disableConsumptionEstimates: companies.metadata.billing.estimate_missing_consumption=false (tenantens
//     dokumenterade avstängning). Annars är estimering på som standard och en mätvärdeslucka ger historikbegäran/
//     uppskattning i stället för ett underlag. VERIFIERAR INTE: estimeringen och dess avstämning.
// ===================================================================================================
import { randomUUID } from 'node:crypto'
import { psql, psqlRows, serviceClient } from './db'
import type { AppSession } from './session'
import type { SignedContractFixture } from './term-fixture'
import {
  dec, decAdd, decCmp, decToString, isoUtc, ratioRound, ROUND_MODES, sekNumberToOre, sha256Hex, stockholmDateOf,
  stockholmDayBoundsUtc, stockholmMonthBoundsUtc, vatOnOre,
  type OracleInvoice, type OracleLineCode, type OracleTerms,
} from './term-oracle'

const lit = (v: unknown): string => v === null || v === undefined ? 'NULL'
  : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`

function assertSafeJson(json: string): void {
  if (json.includes('$sim$')) throw new Error('term-billing: JSON innehåller dollar-citeringstaggen $sim$')
}

export type PriceAreaCode = 'SE1' | 'SE2' | 'SE3' | 'SE4'
export const SPOT_SOURCE = 'elprisetjustnu'

// ---------------------------------------------------------------- leveransperiod och tenantkonfiguration

export type SupplyPeriodInput = {
  /** Affärsdatum YYYY-MM-DD (customer_supply_periods.start_date). */
  startsOn: string
  /** Sista leveransdag YYYY-MM-DD (inklusive) eller null (pågående). */
  endsOn: string | null
  status: 'active' | 'confirmed_by_grid_owner' | 'ended' | (string & {})
}

/** BACKENDERSÄTTNING B1. Returnerar leveransperiodens id. */
export function createSupplyPeriod(contract: SignedContractFixture, input: SupplyPeriodInput): string {
  for (const d of [input.startsOn, input.endsOn]) {
    if (d !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`createSupplyPeriod: ogiltigt datum ${d}`)
  }
  const id = randomUUID()
  psql(`INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,
      start_date,end_date,actual_start_date,actual_end_date,source,source_process,status,metadata)
    VALUES(${lit(id)},${lit(contract.companyId)},${lit(contract.customerId)},${lit(contract.meteringPointId)},${lit(contract.contractId)},${lit(contract.contractId)},
      ${lit(input.startsOn)}::date,${input.endsOn === null ? 'NULL' : `${lit(input.endsOn)}::date`},${lit(input.startsOn)}::date,${input.endsOn === null ? 'NULL' : `${lit(input.endsOn)}::date`},
      'sim_term02','sim_term02',${lit(input.status)},'{"sim":"term02"}'::jsonb);`)
  return id
}

/** BACKENDERSÄTTNING B5. */
export function disableConsumptionEstimates(companyId: string): void {
  psql(`UPDATE public.companies SET metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{billing}',
      coalesce(metadata->'billing','{}'::jsonb)||'{"estimate_missing_consumption":false}'::jsonb,true) WHERE id=${lit(companyId)};`)
  const check = psql(`SELECT metadata->'billing'->>'estimate_missing_consumption' FROM public.companies WHERE id=${lit(companyId)}`)
  if (check !== 'false') throw new Error(`disableConsumptionEstimates: metadata ej satt (fick "${check}")`)
}

function findSupplyPeriodId(c: SignedContractFixture): string {
  const rows = psqlRows<{ id: string }>(`SELECT id FROM public.customer_supply_periods
    WHERE company_id=${lit(c.companyId)} AND metering_point_id=${lit(c.meteringPointId)} AND contract_id=${lit(c.contractId)}`)
  if (rows.length !== 1) throw new Error(`insertMeteringValues: kontraktet ${c.contractId} har ${rows.length} leveransperioder; ange opts.supplyPeriodId`)
  return rows[0].id
}

// ---------------------------------------------------------------- mätvärden

export type MeterValueInput = {
  /** UTC-ögonblick som ISO-sträng med Z (intervallets start, inklusive). */
  startUtc: string
  /** UTC-ögonblick som ISO-sträng med Z (intervallets slut, exklusive). */
  endUtc: string
  /** kWh som kanonisk decimalsträng utan avslutande nollor ('0.25', '2', '0'). */
  kwh: string
  /** ISO 8601-varaktighet som i normalized_metering_values.resolution. */
  resolution: 'PT15M' | 'PT60M'
}

export type InsertedMeterValues = {
  supplyPeriodId: string
  sourceMessageId: string
  normalizedIds: string[]
  meteringValueIds: string[]
}

/** BACKENDERSÄTTNING B2 (se filhuvudet). Skriver fakturerbara (men inte "qualified") mätvärden. */
export function insertMeteringValues(contract: SignedContractFixture, values: readonly MeterValueInput[],
  opts: { supplyPeriodId?: string; tag?: string } = {}): InsertedMeterValues {
  if (values.length === 0) throw new Error('insertMeteringValues: inga värden')
  for (const v of values) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v.startUtc) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v.endUtc)) {
      throw new Error(`insertMeteringValues: tidpunkt måste vara UTC ISO med Z (${v.startUtc} – ${v.endUtc})`)
    }
    if (!/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/.test(v.kwh)) throw new Error(`insertMeteringValues: kWh ska vara kanonisk decimalsträng, fick "${v.kwh}"`)
  }
  const supplyPeriodId = opts.supplyPeriodId ?? findSupplyPeriodId(contract)
  const area = contract.input.priceArea ?? 'SE3'
  // normalized_metering_values.source_message_id saknar främmande nyckel och måste vara icke-null för gate-vakten
  // (billing_underlay_items-triggern). Ett slumpmässigt id utan ediel_messages-rad är själva ersättningen.
  const sourceMessageId = randomUUID()
  const tag = `${opts.tag ?? 'sim-term02'}-${sourceMessageId.slice(0, 8)}`
  const rows = values.map((v, n) => ({ id: randomUUID(), mv: randomUUID(), n, s: v.startUtc, e: v.endUtc, kwh: v.kwh, res: v.resolution }))
  const json = JSON.stringify(rows)
  assertSafeJson(json)
  const c = contract
  psql(`BEGIN;
    CREATE TEMP TABLE sim_v ON COMMIT DROP AS
      SELECT * FROM jsonb_to_recordset($sim$${json}$sim$::jsonb) AS x(id uuid, mv uuid, n int, s timestamptz, e timestamptz, kwh numeric, res text);
    INSERT INTO public.metering_values(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,reading_type,value_kwh,quantity_kwh,quantity,unit,
        quality_code,read_at,period_start,period_end,resolution,source_system,raw_payload,is_current,revision_number,revision_status,billing_status,
        billing_gate_status,billing_gate_reasons,billing_gate_snapshot,billing_gate_evaluated_at,direction,supply_period_id,price_area,
        source_transaction_id,source_transaction_reference,source_line_reference,product_code,created_at)
      SELECT v.mv,${lit(c.companyId)},${lit(c.customerId)},${lit(c.siteId)},${lit(c.siteId)},${lit(c.meteringPointId)},'consumption',v.kwh,v.kwh,v.kwh,'kWh',
        '136',v.e,v.s,v.e,v.res,'sim_term02',jsonb_build_object('sim',${lit(tag)},'n',v.n),true,1,'current','billable',
        'eligible','[]'::jsonb,'{"status":"eligible","sim":true}'::jsonb,now(),'consumption',${lit(supplyPeriodId)}::uuid,${lit(area)},
        ${lit(tag)}||'-'||v.n,${lit(tag)}||'-'||v.n,${lit(tag)}||'-L'||v.n,'8716867000030',now()
      FROM sim_v v;
    INSERT INTO public.normalized_metering_values(id,company_id,customer_id,customer_site_id,site_id,metering_point_id,facility_id,price_area,grid_area,
        period_start,period_end,resolution,quantity_kwh,quality_status,source_type,source_message_id,source_transaction_reference,source_line_reference,
        source_metering_value_id,raw_payload,status,revision_status,billing_status,product_code,direction,unit,revision_number,supply_period_id,
        billing_gate_status,billing_gate_reasons,billing_gate_snapshot,billing_gate_evaluated_at)
      SELECT v.id,${lit(c.companyId)},${lit(c.customerId)},${lit(c.siteId)},${lit(c.siteId)},${lit(c.meteringPointId)},${lit(c.gsrn)},${lit(area)},'TES',
        v.s,v.e,v.res,v.kwh,'136','sim_term02',${lit(sourceMessageId)}::uuid,${lit(tag)}||'-'||v.n,${lit(tag)}||'-L'||v.n,
        v.mv,jsonb_build_object('sim',${lit(tag)},'n',v.n),'stored','current','billable','8716867000030','consumption','kWh',1,${lit(supplyPeriodId)}::uuid,
        'eligible','[]'::jsonb,'{"status":"eligible","sim":true}'::jsonb,now()
      FROM sim_v v;
    COMMIT;`, { timeoutMs: 600_000 })
  return { supplyPeriodId, sourceMessageId, normalizedIds: rows.map((r) => r.id), meteringValueIds: rows.map((r) => r.mv) }
}

/** Sammanfattar appens källbevisbedömning (RPC gridex_read_billing_source_values_v1, service_role). Registrerar, kastar inte. */
export async function readSourceBasisSummary(companyId: string, normalizedIds: readonly string[]): Promise<{ total: number; qualified: number; reasons: Record<string, number> }> {
  const reasons: Record<string, number> = {}
  let qualified = 0
  for (let i = 0; i < normalizedIds.length; i += 1000) {
    const { data, error } = await serviceClient().rpc('gridex_read_billing_source_values_v1', { p_company_id: companyId, p_value_ids: normalizedIds.slice(i, i + 1000) })
    if (error) throw new Error(`gridex_read_billing_source_values_v1: ${error.message}`)
    for (const row of data as Array<{ billing_source_basis?: { qualified?: boolean; reason?: string | null } }>) {
      const basis = row.billing_source_basis
      if (basis?.qualified === true) qualified += 1
      else reasons[basis?.reason ?? 'unknown'] = (reasons[basis?.reason ?? 'unknown'] ?? 0) + 1
    }
  }
  return { total: normalizedIds.length, qualified, reasons }
}

// ---------------------------------------------------------------- spotpriser

export type SpotIntervalInput = {
  startUtc: string
  endUtc: string
  /** SEK/kWh exkl. moms som decimalsträng (kan vara negativ eller '0'). */
  sekPerKwh: string
  resolution: 'hourly' | 'quarter_hour'
}

/**
 * BACKENDERSÄTTNING B3. Idempotent: befintliga intervall lämnas orörda, men om ett befintligt intervall har annat pris
 * eller annan upplösning kastas ett fel (area/månad är redan använd av annan data; använd annan area/månad eller färsk stack).
 */
export function insertSpotIntervals(area: PriceAreaCode, intervals: readonly SpotIntervalInput[]): { total: number; inserted: number } {
  if (intervals.length === 0) throw new Error('insertSpotIntervals: inga intervall')
  const rows = intervals.map((i) => ({ s: i.startUtc, e: i.endUtc, p: i.sekPerKwh, r: i.resolution }))
  for (const r of rows) {
    if (!/^-?\d+(\.\d+)?$/.test(r.p)) throw new Error(`insertSpotIntervals: ogiltigt pris "${r.p}"`)
  }
  const json = JSON.stringify(rows)
  assertSafeJson(json)
  const recordset = `jsonb_to_recordset($sim$${json}$sim$::jsonb) AS x(s timestamptz, e timestamptz, p numeric, r text)`
  const inserted = Number(psql(`WITH ins AS (
      INSERT INTO public.spot_price_intervals(source,price_area,time_start,time_end,sek_per_kwh,resolution,source_payload)
      SELECT ${lit(SPOT_SOURCE)},${lit(area)},x.s,x.e,x.p,x.r,'{"sim":"term02"}'::jsonb FROM ${recordset}
      ON CONFLICT (source,price_area,time_start,time_end) DO NOTHING RETURNING 1)
    SELECT count(*) FROM ins;`, { timeoutMs: 300_000 }))
  const mismatch = psqlRows<{ s: string; e: string; db_price: string; want_price: string; db_res: string | null; want_res: string }>(`
    SELECT x.s,x.e,i.sek_per_kwh::text AS db_price,x.p::text AS want_price,i.resolution AS db_res,x.r AS want_res
    FROM ${recordset} LEFT JOIN public.spot_price_intervals i
      ON i.source=${lit(SPOT_SOURCE)} AND i.price_area=${lit(area)} AND i.time_start=x.s AND i.time_end=x.e
    WHERE i.id IS NULL OR i.sek_per_kwh<>x.p OR i.resolution<>x.r LIMIT 5`)
  if (mismatch.length > 0) throw new Error(`insertSpotIntervals: befintlig spotdata för ${area} avviker eller saknas: ${JSON.stringify(mismatch)}`)
  return { total: intervals.length, inserted }
}

type DbSpotInterval = { time_start: string; time_end: string; sek: string; resolution: string }

export type LockedSpotMonth = { area: PriceAreaCode; month: string; status: string; intervalCount: number; expectedIntervalCount: number; averageSekPerKwh: string; checksum: string | null; lockedVia: 'route' | 'rpc' | 'already_locked' }

/**
 * BACKENDERSÄTTNING B4. Skapar verifierade dagssammanställningar (oraklets egna förväntade intervallantal per
 * Stockholm-dag), stubben för månadssammanställningen (databasen räknar om den) och låser månaden.
 * Med `session` (behörighet pricing.write) låses via appens route POST /api/internal/spot/lock-month.
 */
export async function prepareAndLockSpotMonth(area: PriceAreaCode, month: string, session?: AppSession): Promise<LockedSpotMonth> {
  const bounds = stockholmMonthBoundsUtc(month)
  const existing = psqlRows<{ status: string }>(`SELECT status FROM public.spot_price_monthly_summaries
    WHERE source=${lit(SPOT_SOURCE)} AND price_area=${lit(area)} AND billing_month=${lit(month)}`)[0]
  if (existing?.status === 'locked') return readLockedMonth(area, month, 'already_locked')

  const rows = psqlRows<DbSpotInterval>(`SELECT time_start,time_end,sek_per_kwh::text AS sek,resolution FROM public.spot_price_intervals
    WHERE source=${lit(SPOT_SOURCE)} AND price_area=${lit(area)} AND time_start>=${lit(isoUtc(bounds.startMs))}::timestamptz AND time_start<${lit(isoUtc(bounds.endMs))}::timestamptz
    ORDER BY time_start`)
  if (rows.length === 0) throw new Error(`prepareAndLockSpotMonth: inga spotintervall för ${area} ${month}`)

  const byDay = new Map<string, DbSpotInterval[]>()
  for (const r of rows) {
    const day = stockholmDateOf(Date.parse(r.time_start))
    byDay.set(day, [...(byDay.get(day) ?? []), r])
  }
  const dailySql: string[] = []
  for (const day of bounds.days) {
    const list = byDay.get(day)
    if (!list) throw new Error(`prepareAndLockSpotMonth: ${area} ${day} saknar spotintervall`)
    const dayBounds = stockholmDayBoundsUtc(day)
    const resolutions = new Set(list.map((r) => r.resolution))
    if (resolutions.size !== 1) throw new Error(`prepareAndLockSpotMonth: ${area} ${day} har blandad upplösning`)
    const resolution = [...resolutions][0]
    const stepMs = resolution === 'quarter_hour' ? 15 * 60_000 : resolution === 'hourly' ? 60 * 60_000 : 0
    if (!stepMs) throw new Error(`prepareAndLockSpotMonth: okänd upplösning ${resolution}`)
    let cursor = dayBounds.startMs
    let weightedNum = dec(0)
    let minP = dec(list[0].sek)
    let maxP = dec(list[0].sek)
    for (const r of list) {
      const s = Date.parse(r.time_start)
      const e = Date.parse(r.time_end)
      if (s !== cursor || e - s !== stepMs) {
        throw new Error(`prepareAndLockSpotMonth: ${area} ${day} har lucka/överlapp/fel längd vid ${r.time_start} (väntade start ${isoUtc(cursor)}, steg ${stepMs / 60000} min)`)
      }
      cursor = e
      const p = dec(r.sek)
      weightedNum = decAdd(weightedNum, p)
      if (decCmp(p, minP) < 0) minP = p
      if (decCmp(p, maxP) > 0) maxP = p
    }
    if (cursor !== dayBounds.endMs) throw new Error(`prepareAndLockSpotMonth: ${area} ${day} täcker inte hela dygnet (slutar ${isoUtc(cursor)}, dygnet slutar ${isoUtc(dayBounds.endMs)})`)
    const expectedCount = dayBounds.minutes / (stepMs / 60_000)
    if (list.length !== expectedCount) throw new Error(`prepareAndLockSpotMonth: ${area} ${day} har ${list.length} intervall, oraklet väntar ${expectedCount}`)
    // Alla intervall har samma längd, så det varaktighetsviktade medelvärdet är det enkla medelvärdet.
    const average = decToString({ n: ratioRound(weightedNum, dec(list.length), 6, 'half_away'), s: 6 })
    const checksum = sha256Hex(JSON.stringify(list.map((r) => [r.time_start, r.time_end, r.sek, r.resolution])))
    dailySql.push(`(${lit(SPOT_SOURCE)},${lit(area)},${lit(day)}::date,${lit(isoUtc(dayBounds.startMs))}::timestamptz,${lit(isoUtc(dayBounds.endMs))}::timestamptz,
      ${average},${decToString(minP)},${decToString(maxP)},${list.length},'verified',${expectedCount},${dayBounds.minutes},${dayBounds.minutes},${lit(resolution)},'[]'::jsonb,now(),now(),${lit(checksum)},now())`)
  }
  psql(`INSERT INTO public.spot_price_daily_summaries(source,price_area,price_date,period_start,period_end,average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,
      interval_count,status,expected_interval_count,covered_duration_minutes,expected_duration_minutes,resolution,quality_issues,provider_fetched_at,verified_at,source_checksum,updated_at)
    VALUES ${dailySql.join(',\n')}
    ON CONFLICT (source,price_area,price_date) DO UPDATE SET period_start=excluded.period_start,period_end=excluded.period_end,
      average_sek_per_kwh=excluded.average_sek_per_kwh,min_sek_per_kwh=excluded.min_sek_per_kwh,max_sek_per_kwh=excluded.max_sek_per_kwh,
      interval_count=excluded.interval_count,status=excluded.status,expected_interval_count=excluded.expected_interval_count,
      covered_duration_minutes=excluded.covered_duration_minutes,expected_duration_minutes=excluded.expected_duration_minutes,
      resolution=excluded.resolution,quality_issues=excluded.quality_issues,provider_fetched_at=excluded.provider_fetched_at,
      verified_at=excluded.verified_at,source_checksum=excluded.source_checksum,updated_at=excluded.updated_at
      WHERE public.spot_price_daily_summaries.status<>'locked';`, { timeoutMs: 120_000 })

  // Månadsstub: databasens trigger räknar om alla aggregerade fält från intervallen (och dagssammanställningarna).
  if (!existing) {
    psql(`INSERT INTO public.spot_price_monthly_summaries(source,price_area,billing_month,average_sek_per_kwh,min_sek_per_kwh,max_sek_per_kwh,status)
      VALUES(${lit(SPOT_SOURCE)},${lit(area)},${lit(month)},0,0,0,'incomplete');`)
  } else {
    psql(`UPDATE public.spot_price_monthly_summaries SET updated_at=now() WHERE source=${lit(SPOT_SOURCE)} AND price_area=${lit(area)} AND billing_month=${lit(month)} AND status<>'locked';`)
  }
  const stub = psqlRows<{ status: string; interval_count: number; expected_interval_count: number; quality_issues: unknown }>(`SELECT status,interval_count,expected_interval_count,quality_issues
    FROM public.spot_price_monthly_summaries WHERE source=${lit(SPOT_SOURCE)} AND price_area=${lit(area)} AND billing_month=${lit(month)}`)[0]
  if (!stub || stub.status !== 'verified') {
    throw new Error(`prepareAndLockSpotMonth: månadssammanställningen blev inte verified: ${JSON.stringify(stub)}`)
  }

  let lockedVia: 'route' | 'rpc' = 'rpc'
  if (session) {
    const t0 = performance.now()
    const res = await session.fetch('/api/internal/spot/lock-month', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ billing_month: month, price_area: area, reason: 'sim term02' }),
    })
    const text = await res.text()
    logPerf('spot/lock-month', session, month, rows.length, res.status, performance.now() - t0)
    if (res.status !== 200) throw new Error(`lock-month svarade ${res.status}: ${text.slice(0, 400)}`)
    lockedVia = 'route'
  } else {
    const { error } = await serviceClient().rpc('gridex_lock_spot_price_month', { p_provider: SPOT_SOURCE, p_price_area: area, p_billing_month: month, p_actor_user_id: null, p_reason: 'sim term02' })
    if (error) throw new Error(`gridex_lock_spot_price_month: ${error.message}`)
  }
  return readLockedMonth(area, month, lockedVia)
}

function readLockedMonth(area: PriceAreaCode, month: string, lockedVia: LockedSpotMonth['lockedVia']): LockedSpotMonth {
  const row = psqlRows<{ status: string; interval_count: number; expected_interval_count: number; average_sek_per_kwh: string; source_checksum: string | null }>(`
    SELECT status,interval_count,expected_interval_count,average_sek_per_kwh::text,source_checksum FROM public.spot_price_monthly_summaries
    WHERE source=${lit(SPOT_SOURCE)} AND price_area=${lit(area)} AND billing_month=${lit(month)}`)[0]
  if (!row || row.status !== 'locked') throw new Error(`spotmånad ${area} ${month} är inte låst: ${JSON.stringify(row)}`)
  return { area, month, status: row.status, intervalCount: row.interval_count, expectedIntervalCount: row.expected_interval_count, averageSekPerKwh: row.average_sek_per_kwh, checksum: row.source_checksum, lockedVia }
}

/** Antal rader i spotimportens köer/körlogg. Ska vara oförändrat under hela scenariot (ingen extern hämtning). */
export function spotImportFootprint(): { runs: number; jobs: number } {
  return {
    runs: Number(psql('SELECT count(*) FROM public.spot_price_import_runs')),
    jobs: Number(psql('SELECT count(*) FROM public.spot_price_import_jobs')),
  }
}

export function assertNoSpotImportSince(before: { runs: number; jobs: number }, what: string): void {
  const after = spotImportFootprint()
  if (after.runs !== before.runs || after.jobs !== before.jobs) {
    throw new Error(`${what}: spotimport startades (spot_price_import_runs ${before.runs}->${after.runs}, spot_price_import_jobs ${before.jobs}->${after.jobs}); scenariot måste förbereda spotdata så att ingen extern hämtning sker`)
  }
}

// ---------------------------------------------------------------- appens rutter

export type HttpResult<T> = { status: number; body: unknown; data: T | null; text: string }

let perfCalls = 0
function companyOf(session: AppSession): string {
  const m = /gridex_admin_selected_company_id=([0-9a-f-]{8})/.exec(session.cookieHeader)
  return m ? m[1] : 'okänt'
}
/** En [PERF]-rad per POST: route, bolag (8 tecken), månad, antal rader, HTTP-status, ms, cold/warm (första anropet i processen = cold). */
function logPerf(route: string, session: AppSession, month: string, rows: number | string, httpStatus: number, ms: number): void {
  const warmCold = perfCalls === 0 ? 'cold' : 'warm'
  perfCalls += 1
  console.info(`[PERF] ${route} company=${companyOf(session)} month=${month} rows=${rows} httpStatus=${httpStatus} ms=${Math.round(ms)} warmCold=${warmCold}`)
}

async function postJson<T>(session: AppSession, path: string, payload: Record<string, unknown>): Promise<HttpResult<T>> {
  const t0 = performance.now()
  const res = await session.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  const text = await res.text()
  const ms = performance.now() - t0
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* ingen JSON-kropp */ }
  const data = body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : null
  const rows = (data as { sourceRows?: number } | null)?.sourceRows
  const month = typeof payload.billing_month === 'string' ? payload.billing_month : 'okänd'
  logPerf(path.replace('/api/internal/', ''), session, month, rows ?? 'okänt', res.status, ms)
  return { status: res.status, body, data, text: text.slice(0, 4000) }
}

export type UnderlayResult = { underlayId: string | null; status: 'ready_for_pricing' | 'needs_review'; sourceTable: string; sourceRows: number; warnings: string[] }
export type GenerateUnderlayData = {
  billingMonth: string
  scope: { customerId: string | null; meteringPointId: string | null }
  sourceTable: string
  sourceRows: number
  underlays: number
  readyForPricing: number
  needsReview: number
  results: UnderlayResult[]
}

/** POST /api/internal/billing/generate-underlay {billing_month} (behörighet billing_underlay.export). */
export async function generateUnderlay(session: AppSession, month: string): Promise<HttpResult<GenerateUnderlayData>> {
  const before = spotImportFootprint()
  const res = await postJson<GenerateUnderlayData>(session, '/api/internal/billing/generate-underlay', { billing_month: month })
  assertNoSpotImportSince(before, 'generate-underlay')
  return res
}

export type PreviewLine = {
  lineType: string
  description: string
  quantity: number | null
  unit: string
  unitPriceExVat: number | null
  amountExVat: number
  vatRate: number
  vatAmount: number
  amountIncVat: number
  sortOrder: number
  metadata?: Record<string, unknown>
}
export type PreviewData = {
  status: 'success' | 'failed' | 'needs_review'
  billingUnderlayId?: string | null
  totalExVat: number
  vatAmount: number
  totalIncVat: number
  lines: PreviewLine[]
  warnings: string[]
  errors: string[]
  pricingRunId?: string | null
}

/**
 * POST /api/internal/pricing/preview (behörighet pricing.write). persist är false som standard (appens egen standard
 * är true, men en persisterad pricing_run kräver ett bundet/kvalificerat underlag som harnessen inte kan skapa, se B2).
 * Kontrollerar att ingen spotimport startades.
 */
export async function pricePreview(session: AppSession, input: { underlayId?: string; month?: string; persist?: boolean }): Promise<HttpResult<PreviewData>> {
  if (!input.underlayId && !input.month) throw new Error('pricePreview: underlayId eller month krävs')
  const before = spotImportFootprint()
  const res = await postJson<PreviewData>(session, '/api/internal/pricing/preview', {
    ...(input.underlayId ? { billing_underlay_id: input.underlayId } : { billing_month: input.month }),
    persist: input.persist ?? false,
  })
  assertNoSpotImportSince(before, 'pricing/preview')
  return res
}

// ---------------------------------------------------------------- läsning av underlag och klassning av varningar

export type UnderlayDbRow = {
  id: string; company_id: string; customer_id: string; metering_point_id: string; contract_id: string | null; supply_period_id: string | null
  status: string; readiness_status: string | null; total_kwh: string | null; underlay_year: number; underlay_month: number
  billing_period_start: string; billing_period_end: string; missing_values_count: number | null; source_meter_value_count: number | null
  price_area: string | null; energy_direction: string; billing_block_reason: string | null; payload: Record<string, unknown>
}

export function readUnderlay(id: string): UnderlayDbRow {
  const rows = psqlRows<UnderlayDbRow>(`SELECT id,company_id,customer_id,metering_point_id,contract_id,supply_period_id,status,readiness_status,total_kwh::text AS total_kwh,
    underlay_year,underlay_month,billing_period_start::text AS billing_period_start,billing_period_end::text AS billing_period_end,missing_values_count,
    source_meter_value_count,price_area,energy_direction,billing_block_reason,payload FROM public.billing_underlays WHERE id=${lit(id)}`)
  if (rows.length !== 1) throw new Error(`readUnderlay: underlag ${id} hittades inte`)
  return rows[0]
}

export type UnderlayItemRow = { id: string; period_start: string; period_end: string; quantity_kwh: string; status: string; resolution: string | null; source_normalized_metering_value_id: string | null }

export function readUnderlayItems(underlayId: string): UnderlayItemRow[] {
  return psqlRows<UnderlayItemRow>(`SELECT id,period_start,period_end,quantity_kwh::text AS quantity_kwh,status,resolution,source_normalized_metering_value_id
    FROM public.billing_underlay_items WHERE billing_underlay_id=${lit(underlayId)} ORDER BY period_start,id`)
}

/** Underlag per mätpunkt i en månad (för att koppla resultat från generate-underlay till avtal). */
export function readUnderlaysForMonth(companyId: string, month: string): UnderlayDbRow[] {
  const [y, m] = month.split('-').map(Number)
  return psqlRows<UnderlayDbRow>(`SELECT id,company_id,customer_id,metering_point_id,contract_id,supply_period_id,status,readiness_status,total_kwh::text AS total_kwh,
    underlay_year,underlay_month,billing_period_start::text AS billing_period_start,billing_period_end::text AS billing_period_end,missing_values_count,
    source_meter_value_count,price_area,energy_direction,billing_block_reason,payload FROM public.billing_underlays
    WHERE company_id=${lit(companyId)} AND underlay_year=${y} AND underlay_month=${m} ORDER BY created_at,id`)
}

/** Koder som harnessens mätvärden (B2) alltid ger: källbevis kan inte kvalificeras utan UTILTS-original. */
export const SUBSTITUTE_BLOCKER_CODES = [
  'source_message_missing', 'source_basis_unqualified', 'quality_not_established', 'source_message_family_not_metering', 'source_message_not_validated',
] as const

const COVERAGE_PATTERN = /Mätvärdeslucka|Överlappande mätintervall|Dubbla aktuella mätvärden|ogiltig start eller sluttid|Mätvärden saknas i fakturasegmentet|source_interval_requires_finer_data|inkonsekvent kund- eller mätpunktskoppling/i

export function classifyUnderlayWarnings(warnings: readonly string[]): { substitute: string[]; coverage: string[]; other: string[] } {
  const substitute: string[] = []
  const coverage: string[] = []
  const other: string[] = []
  for (const w of warnings) {
    if ((SUBSTITUTE_BLOCKER_CODES as readonly string[]).some((code) => w.startsWith(`${code}:`))) substitute.push(w)
    else if (COVERAGE_PATTERN.test(w)) coverage.push(w)
    else other.push(w)
  }
  return { substitute, coverage, other }
}

// ---------------------------------------------------------------- avtalsvillkor och jämförelse mot oraklet

/** Villkor ur avtalets låsta prissnapshot (fixturens källrad), som indata till oraklet. Beloppen räknas inte här. */
export function readContractTerms(contract: SignedContractFixture): OracleTerms {
  const snapshot = contract.sources.snapshotRow
  const components = (Array.isArray(snapshot.price_components_snapshot) ? snapshot.price_components_snapshot : []) as Array<Record<string, unknown>>
  const find = (code: string) => components.find((c) => (c.component_code ?? c.componentCode) === code) ?? null
  const asText = (v: unknown): string | null => {
    if (v === null || v === undefined) return null
    const text = String(v)
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`readContractTerms: ogiltigt belopp ${text}`)
    return text
  }
  const markup = find('spot_markup')
  const monthly = find('monthly_fee')
  const invoice = find('invoice_fee')
  if (markup && markup.unit !== 'ore_per_kwh') throw new Error(`readContractTerms: påslagets enhet är ${String(markup.unit)}, oraklet kan ore_per_kwh`)
  if (monthly && monthly.unit !== 'sek_month') throw new Error(`readContractTerms: månadsavgiftens enhet är ${String(monthly.unit)}`)
  if (invoice && invoice.unit !== 'sek_invoice') throw new Error(`readContractTerms: fakturaavgiftens enhet är ${String(invoice.unit)}`)
  const snapshotJson = (snapshot.snapshot_json ?? {}) as Record<string, unknown>
  const vatRate = Number(snapshotJson.vat_rate ?? 0.25)
  const vatPercent = Math.round(vatRate * 100)
  if (Math.abs(vatRate * 100 - vatPercent) > 1e-9) throw new Error(`readContractTerms: momssats ${vatRate} är inte hela procent`)
  return {
    markupOrePerKwh: markup ? asText(markup.amount) : null,
    monthlyFeeSek: monthly ? asText(monthly.amount) : null,
    invoiceFeeSek: invoice ? asText(invoice.amount) : null,
    vatPercent,
  }
}

export function appLineKind(line: PreviewLine): OracleLineCode | 'other' {
  const code = (line.metadata?.component_code ?? null) as string | null
  if (code === 'monthly_fee') return 'monthly_fee'
  if (code === 'invoice_fee') return 'invoice_fee'
  if (code === 'spot_markup') return 'markup'
  if (line.lineType === 'base_price' || line.metadata?.source_type === 'spot') return 'spot'
  return 'other'
}

export type AppLineOre = { kind: OracleLineCode | 'other'; description: string; exVatOre: bigint; vatOre: bigint; incVatOre: bigint }
export const appLinesOre = (data: PreviewData): AppLineOre[] => data.lines.map((l) => ({
  kind: appLineKind(l), description: l.description,
  exVatOre: sekNumberToOre(l.amountExVat), vatOre: sekNumberToOre(l.vatAmount), incVatOre: sekNumberToOre(l.amountIncVat),
}))

/**
 * Jämför appens preview med oraklets faktura (ett läge). Returnerar en lista med avvikelser; tom lista = lika.
 * `exVat`/`vat`/`incVat` jämförs per rad; VAT-jämförelsen är mot oraklets moms (som räknas på radens avrundade belopp).
 */
export function diffAgainstOracle(app: PreviewData, oracle: OracleInvoice): string[] {
  const diffs: string[] = []
  if (app.status !== 'success') diffs.push(`preview-status ${app.status}; fel: ${app.errors.join(' | ')}`)
  const lines = appLinesOre(app)
  for (const o of oracle.lines) {
    const matches = lines.filter((l) => l.kind === o.code)
    if (matches.length !== 1) { diffs.push(`${o.code}: ${matches.length} rader i appen (väntade 1)`); continue }
    const a = matches[0]
    if (a.exVatOre !== o.exVatOre) diffs.push(`${o.code} exkl. moms: app ${a.exVatOre} öre, orakel ${o.exVatOre} öre (exakt ${o.exVatExactSek} SEK)`)
    if (a.vatOre !== o.vatOre) diffs.push(`${o.code} moms: app ${a.vatOre} öre, orakel ${o.vatOre} öre`)
    if (a.incVatOre !== o.incVatOre) diffs.push(`${o.code} inkl. moms: app ${a.incVatOre} öre, orakel ${o.incVatOre} öre`)
  }
  const extra = lines.filter((l) => !oracle.lines.some((o) => o.code === l.kind))
  for (const e of extra) diffs.push(`extra rad i appen: ${e.kind} "${e.description}" ${e.exVatOre} öre`)
  const totals: Array<[string, number, bigint]> = [['totalExVat', app.totalExVat, oracle.totalExVatOre], ['vatAmount', app.vatAmount, oracle.totalVatOre], ['totalIncVat', app.totalIncVat, oracle.totalIncVatOre]]
  for (const [name, appValue, oracleOre] of totals) {
    const appOre = sekNumberToOre(appValue)
    if (appOre !== oracleOre) diffs.push(`${name}: app ${appOre} öre, orakel ${oracleOre} öre`)
  }
  return diffs
}

/** Läsbar radlista för loggning. */
export function describeApp(app: PreviewData): string {
  return appLinesOre(app).map((l) => `${l.kind}[ex ${l.exVatOre} moms ${l.vatOre} inkl ${l.incVatOre}]`).join(' ') +
    ` | totals ex ${app.totalExVat} moms ${app.vatAmount} inkl ${app.totalIncVat}`
}

/**
 * Intern räkneregelkontroll av en preview (utan orakel): moms per rad = moms på radens belopp exkl. moms i något
 * avrundningsläge (exakt ett värde när beloppet inte ligger på ett halvt öre), inkl = exkl + moms, och totalerna är
 * summan av raderna. Returnerar avvikelser; tom lista = konsekvent.
 */
export function checkInvoiceArithmetic(app: PreviewData, vatPercent: number): string[] {
  const problems: string[] = []
  let sumEx = BigInt("0")
  let sumVat = BigInt("0")
  for (const l of appLinesOre(app)) {
    const allowed = ROUND_MODES.map((m) => vatOnOre(l.exVatOre, vatPercent, m))
    if (!allowed.includes(l.vatOre)) problems.push(`${l.kind}: moms ${l.vatOre} öre är inte ${vatPercent} % av ${l.exVatOre} öre i något avrundningsläge (${allowed.join('/')})`)
    if (l.incVatOre !== l.exVatOre + l.vatOre) problems.push(`${l.kind}: inkl. ${l.incVatOre} != exkl. ${l.exVatOre} + moms ${l.vatOre}`)
    sumEx += l.exVatOre
    sumVat += l.vatOre
  }
  const total = (name: string, value: number, want: bigint) => {
    const got = sekNumberToOre(value)
    if (got !== want) problems.push(`${name}: ${got} öre, summan av raderna är ${want} öre`)
  }
  total('totalExVat', app.totalExVat, sumEx)
  total('vatAmount', app.vatAmount, sumVat)
  total('totalIncVat', app.totalIncVat, sumEx + sumVat)
  return problems
}
