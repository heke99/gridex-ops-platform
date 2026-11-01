// EDIEL02: tillståndsläsning (skrivskyddad SQL via psql mot lokala stacken) för före/efter-räkning och orakel.
// Allt avgränsas till en körnings egna mätpunkt/prefix så att andra scenarier i samma tenant inte stör räkningen.
import { lit, sql, sqlJson } from './seed.mjs'
import type { E02Fixture } from './e02-seed'

export type E02Counts = {
  inboundEmails: number; parseResults: number; edielInbound: number
  contrl: number; aperak: number; utiltsErr: number; outbox: number
  series: number; seriesCurrent: number; meterReadingValues: number; meteringValues: number
  normalized: number; normalizedCurrent: number; billingUnderlays: number
  tasks: number; protocolDuplicateTasks: number; invoices: number
}
const n = (q: string) => Number(sql(q))

/** Räkna rader för körningen: e-post via ämnesprefix, ediel-meddelanden via prefix i BGM/IDE (external_reference/raw), affärsrader via mätpunkten. */
export function e02Counts(fx: E02Fixture, prefix: string): E02Counts {
  const company = lit(fx.companyId), pt = lit(fx.pointId), like = lit(`%${prefix}%`)
  const src = `(SELECT id FROM public.ediel_messages WHERE company_id=${company} AND direction='inbound' AND message_family='UTILTS' AND metering_point_id=${pt})`
  return {
    inboundEmails: n(`SELECT count(*) FROM public.inbound_email_messages WHERE subject LIKE ${like} AND duplicate_of_id IS NULL`),
    parseResults: n(`SELECT count(*) FROM public.inbound_ediel_parse_results p JOIN public.inbound_email_messages e ON e.id=p.inbound_email_message_id WHERE e.subject LIKE ${like}`),
    edielInbound: n(`SELECT count(*) FROM ${src} s`),
    contrl: n(`SELECT count(*) FROM public.ediel_messages WHERE company_id=${company} AND direction='outbound' AND message_family='CONTRL' AND related_message_id IN ${src}`),
    aperak: n(`SELECT count(*) FROM public.ediel_messages WHERE company_id=${company} AND direction='outbound' AND message_family='APERAK' AND related_message_id IN ${src}`),
    utiltsErr: n(`SELECT count(*) FROM public.ediel_messages WHERE company_id=${company} AND direction='outbound' AND message_family='UTILTS_ERR' AND related_message_id IN ${src}`),
    outbox: n(`SELECT count(*) FROM public.ediel_outbox o WHERE o.company_id=${company} AND o.source_message_id IN (SELECT id FROM public.ediel_messages WHERE company_id=${company} AND related_message_id IN ${src})`),
    series: n(`SELECT count(*) FROM public.meter_reading_series WHERE company_id=${company} AND metering_point_id=${pt}`),
    seriesCurrent: n(`SELECT count(*) FROM public.meter_reading_series WHERE company_id=${company} AND metering_point_id=${pt} AND is_current`),
    meterReadingValues: n(`SELECT count(*) FROM public.meter_reading_values v JOIN public.meter_reading_series s ON s.id=v.series_id WHERE s.company_id=${company} AND s.metering_point_id=${pt}`),
    meteringValues: n(`SELECT count(*) FROM public.metering_values WHERE company_id=${company} AND metering_point_id=${pt}`),
    normalized: n(`SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${company} AND metering_point_id=${pt}`),
    normalizedCurrent: n(`SELECT count(*) FROM public.normalized_metering_values WHERE company_id=${company} AND metering_point_id=${pt} AND revision_status='current'`),
    billingUnderlays: n(`SELECT count(*) FROM public.billing_underlays WHERE company_id=${company} AND metering_point_id=${pt}`),
    invoices: n(`SELECT count(*) FROM public.customer_invoices WHERE company_id=${company} AND customer_id=${lit(fx.customerId)}`),
    tasks: n(`SELECT count(*) FROM public.customer_operation_tasks WHERE company_id=${company} AND customer_id=${lit(fx.customerId)}`),
    protocolDuplicateTasks: n(`SELECT count(*) FROM public.customer_operation_tasks WHERE company_id=${company} AND customer_id=${lit(fx.customerId)} AND task_type='ediel_duplicate_response_held'`),
  }
}
export { sqlJson }

/** Mottagningsklasser (first_reception/protocol_duplicate/identity_conflict) och svarsbegäranden för körningens mätpunkt. */
export function e02Receptions(fx: E02Fixture) {
  const pt = lit(fx.pointId)
  return {
    receptions: sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('classification',r.classification,'inbound',r.inbound_email_message_id,'src',r.source_message_id) ORDER BY r.received_at),'[]')
      FROM gridex_ediel_inbound_receptions.receptions r JOIN public.ediel_messages m ON m.id=r.source_message_id WHERE m.metering_point_id=${pt}`) as Array<{ classification: string; inbound: string; src: string }>,
    responseRequests: sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('reason',q.reason,'src',q.source_message_id)),'[]')
      FROM gridex_ediel_inbound_receptions.response_requests q JOIN public.ediel_messages m ON m.id=q.source_message_id WHERE m.metering_point_id=${pt}`) as Array<{ reason: string; src: string }>,
  }
}
/** Mätvärdesläget: kvantiteter per tabell (för "ingen tyst överskrivning"). */
export function e02Quantities(fx: E02Fixture) {
  const company = lit(fx.companyId), pt = lit(fx.pointId)
  return sqlJson(`SELECT jsonb_build_object(
    'metering',(SELECT coalesce(jsonb_agg(jsonb_build_object('kwh',value_kwh,'current',is_current,'rev',revision_status,'n',revision_number) ORDER BY revision_number,created_at),'[]') FROM public.metering_values WHERE company_id=${company} AND metering_point_id=${pt}),
    'normalized',(SELECT coalesce(jsonb_agg(jsonb_build_object('kwh',quantity_kwh,'rev',revision_status,'n',revision_number) ORDER BY revision_number,created_at),'[]') FROM public.normalized_metering_values WHERE company_id=${company} AND metering_point_id=${pt}),
    'series',(SELECT coalesce(jsonb_agg(jsonb_build_object('tx',s.source_transaction_reference,'current',s.is_current,'ver',s.version_no,'upd',s.latest_update_date,'qty',(SELECT v.quantity::text FROM public.meter_reading_values v WHERE v.series_id=s.id ORDER BY source_order LIMIT 1)) ORDER BY s.version_no,s.created_at),'[]') FROM public.meter_reading_series s WHERE s.company_id=${company} AND s.metering_point_id=${pt}),
    'billing',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'kwh',total_kwh) ORDER BY created_at),'[]') FROM public.billing_underlays WHERE company_id=${company} AND metering_point_id=${pt}))`) as {
    metering: Array<{ kwh: number; current: boolean; rev: string; n: number }>; normalized: Array<{ kwh: number; rev: string; n: number }>
    series: Array<{ tx: string; current: boolean; ver: number; upd: string; qty: string }>; billing: Array<{ id: string; kwh: number }> }
}
