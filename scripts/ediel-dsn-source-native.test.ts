// masterplan: TR-04, AT-TR-04, SC-062
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { parseDeliveryStatusReport } from '@/lib/inbound-mail/dsnDisposition'

// Pure source parsing on the actual disposable PostgreSQL, without customer
// rows, provider calls or external delivery/authenticity assertions.
const lit = (value: string) => "'" + value.replaceAll("'", "''") + "'"
function sql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw new Error('owned_local_native_only')
  return JSON.parse(execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8', timeout: 10000, maxBuffer: 1_000_000 }).trim()) as T
}
const fields = 'Reporting-MTA: dns; fixture.invalid\r\n\r\nFinal-Recipient: rfc822; recipient@fixture.invalid\r\nAction: failed\r\nStatus: 5.1.1\r\nDiagnostic-Code: smtp; 550 synthetic refusal'
const headers = 'Message-ID: <original@fixture.invalid>\r\n'
const source = (encoding: 'base64' | 'quoted-printable') => {
  const encode = (text: string) => encoding === 'base64' ? Buffer.from(text).toString('base64') : [...Buffer.from(text)].map(b => '=' + b.toString(16).padStart(2, '0')).join('')
  return `Content-Type: multipart/report; report-type=global-delivery-status; boundary=dsn\r\n\r\n--dsn\r\nContent-Type: message/global-delivery-status\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${encode(fields)}\r\n--dsn\r\nContent-Type: message/global-headers\r\nContent-Transfer-Encoding: ${encoding}\r\n\r\n${encode(headers)}\r\n--dsn--\r\n`
}
const matches = (raw: string, report: unknown) => sql<boolean>(`SELECT to_jsonb(gridex_ediel_transport.dsn_source_identity_matches_v1(${lit(raw)},${lit(JSON.stringify(report))}::jsonb))`)
it.each(['base64', 'quoted-printable'] as const)('matches actual parser fields to captured %s MIME and rejects forged status/diagnostics', encoding => {
  const inner = source(encoding)
  const raw = `Content-Type: multipart/mixed; boundary*=UTF-8''outer%2Dboundary\r\n\r\n--outer-boundary\r\nContent-Type: message/rfc822\r\n\r\n${inner}\r\n--outer-boundary--\r\n`
  const report = parseDeliveryStatusReport(raw)!
  expect(report.issues).toEqual([]); expect(report.originalMessageIds).toEqual(['<original@fixture.invalid>'])
  expect(matches(raw, report)).toBe(true)
  expect(matches(raw, { ...report, recipients: [{ ...report.recipients[0], action: 'delivered', status: '2.0.0' }] })).toBe(false)
  expect(matches(raw, { ...report, recipients: [{ ...report.recipients[0], diagnosticCode: { type: 'smtp', text: '250 forged' } }] })).toBe(false)
  expect(matches(raw.replace('boundary*=UTF-8\'\'outer%2Dboundary', 'boundary*=UTF-8\'\'outer%ZZ'), report)).toBe(false)
})
it('keeps every MIME helper private while the existing source RPC remains service scoped', () => {
  const rows = sql<Array<{ name: string; service: boolean; anon: boolean; authenticated: boolean }>>(`SELECT jsonb_agg(jsonb_build_object('name',p.proname,
    'service',has_function_privilege('service_role',p.oid,'execute'),'anon',has_function_privilege('anon',p.oid,'execute'),
    'authenticated',has_function_privilege('authenticated',p.oid,'execute')) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='gridex_ediel_transport' AND p.proname IN
    ('dsn_fields_v1','dsn_field_v1','dsn_typed_field_v1','dsn_decode_body_v1','dsn_boundary_v1','dsn_source_identity_matches_v1')`)
  expect(rows).toHaveLength(6)
  for (const row of rows) expect(row).toMatchObject({ service: false, anon: false, authenticated: false })
  expect(sql(`SELECT jsonb_build_object('service',has_function_privilege('service_role','public.ediel_record_dsn_source_observation_v1(jsonb)','execute'),
    'anon',has_function_privilege('anon','public.ediel_record_dsn_source_observation_v1(jsonb)','execute'),
    'authenticated',has_function_privilege('authenticated','public.ediel_record_dsn_source_observation_v1(jsonb)','execute'))`)).toEqual({ service: true, anon: false, authenticated: false })
})
