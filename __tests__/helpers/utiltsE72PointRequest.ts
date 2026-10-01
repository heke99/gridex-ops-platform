import type { EdielMessageRow } from '@/lib/ediel/types'

/** Synthetic E72 request for E30: no quantities or optional grid-area facts.
 * U25-A-4 request field 209 is required; agency 89 is valid national syntax,
 * but it does not establish the distributor's tenant/point assignment. */
export function e72PointRequestMessage(company = 'tenant-a', agency: '9' | '89' = '9'): EdielMessageRow {
  const raw = [
    "UNA:+.? '",
    "UNB+UNOC:3+91100:ZZ+21660:ZZ+261001:1811+261001181101++23-MDR-E30-S++1'",
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    "BGM+E72::260+GRIDEXE72MSG001+9+AB'",
    "DTM+137:202610011811:203'", "DTM+735:?+0100:406'", "MKS+23+E02::260'",
    "NAD+MS+91100:SVK:260'", "NAD+MR+21660:SVK:260'", "NAD+MDR'",
    "IDE+24+GRIDEXE72TX001'", `LOC+172+735999260731000007::${agency}'`,
    "DTM+324:202607010000202607010015:719'", "STS+7++E88::260'", "RFF+E30'",
    "UNT+14+1'", "UNZ+1+261001181101'",
  ].join('\n')
  return {
    id: `e72-request-${company}`, company_id: company, environment: 'test',
    direction: 'inbound', message_standard: 'edifact', message_family: 'UTILTS', message_code: 'E72',
    message_version: 'E5SE5A', application_reference: '23-MDR-E30-S', raw_payload: raw,
    message_received_at: '2026-10-01T20:00:00Z', created_at: '2026-10-01T20:00:00Z',
    sender_ediel_id: '91100', receiver_ediel_id: '21660',
    customer_id: null, site_id: null, metering_point_id: null,
    parsed_payload: {}, validation_report: null,
  } as unknown as EdielMessageRow
}
