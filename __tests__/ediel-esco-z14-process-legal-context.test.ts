// masterplan: AT-Z13V-ESCO, AT-Z13VH-ESCO, AT-Z14VH-ESCO
// Upstream process correlation: the inbound legal-context capture (actual
// captured gridex_ediel_inbound_context.derive_before_received_err_response_v1
// and the current readiness catalog edition) refuses an ESCO Z14/Z15 response
// that arrives on 23-DDQ-PRODAT; the permission writer then refuses the source
// (permission_frozen_legal_context_required). Tenant/profile tables are minimal
// rowtype ports; the gate under test runs before any of them is read.
import { readFileSync } from 'node:fs'
import { describe, expect, it, beforeAll } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const schema = readFileSync('supabase/schema.sql', 'utf8')
const fn = (name: string) => {
  const a = schema.indexOf('CREATE FUNCTION ' + name + '(')
  if (a < 0) throw new Error(name)
  const tail = schema.slice(a), d = tail.match(/\n\s+AS (\$[\w]*\$)/)![1]
  const b = tail.indexOf(d), e = tail.indexOf(d + ';', b + d.length)
  return tail.slice(0, e + d.length + 1)
}
const table = (name: string) => { const a = schema.indexOf('CREATE TABLE ' + name + ' ('); if (a < 0) throw new Error(name); return schema.slice(a, schema.indexOf('\n);', a) + 4) }
const edition = readFileSync('supabase/migrations/20260930173632_ediel_immutable_source_legal_context.sql', 'utf8').split('\n').slice(4, 6).join('\n')

const wire = (app: string, code = 'Z14', reason = 'S18') => ["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++" + app + "++++1", 'UNH+M+PRODAT:D:97A:UN:E2SE6A', `BGM+${code}+DOC+9`,
  'NAD+FR+54321:160:SVK', 'NAD+DO+12345:160:SVK', 'LIN+1++735123456789099990:::9', 'RFF+LI:ESCO-VH', 'RFF+Z09:Z09-VH', 'NAD+UD+PERSON-A:SE1:260', 'CCI++Z13', 'CAV+' + reason, 'CCI++Z23', 'CAV+A74', 'UNT+12+M', 'UNZ+1+I'].join("'") + "'"

let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await db.exec('CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_readiness;CREATE SCHEMA gridex_ediel_inbound_context;CREATE SCHEMA extensions;')
  await db.exec('CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,related_message_id uuid,message_received_at timestamptz);CREATE TABLE public.tenant_ediel_profiles(id uuid);CREATE TABLE public.tenant_counterparty_relations(id uuid);')
  await db.exec(table('gridex_ediel_inbound_context.receipts'))
  await db.exec(table('gridex_ediel_readiness.source_editions'))
  await db.exec(edition)
  await db.exec(fn('gridex_utilts_binding.wire_tokens_v1'))
  await db.exec(fn('gridex_ediel_inbound_context.derive_before_received_err_response_v1'))
}, 60000)

async function derive(app: string, code = 'Z14', reason = 'S18'): Promise<string> {
  const raw = wire(app, code, reason)
  try {
    await db.query("SELECT gridex_ediel_inbound_context.derive_before_received_err_response_v1(ROW(gen_random_uuid(),gen_random_uuid(),'test','inbound','PRODAT',$1,$2,NULL,now())::public.ediel_messages,now())", [code, raw])
    return 'derived'
  } catch (error) { return (error as Error).message }
}

describe('ESCO permission response process correlation at legal-context capture', () => {
  it('the current catalog binds ESCO Z13/Z14/Z15 V/VH to 23-DGI-PRODAT only', async () => {
    const rows = (await db.query<{ p: { code: string; transactionReasonCode: string; applicationReferences: string[]; receiverRoles?: string[] } }>(
      "SELECT p FROM (SELECT * FROM gridex_ediel_readiness.source_editions ORDER BY recorded_at DESC,source_version LIMIT 1) e CROSS JOIN LATERAL jsonb_array_elements(e.catalog) p WHERE p->>'family'='PRODAT' AND p->>'code' IN('Z13','Z14','Z15') AND p->>'transactionReasonCode' IN('S17','S18')")).rows
    expect(rows.length).toBe(6)
    for (const { p } of rows) expect(p.applicationReferences).toEqual(['23-DGI-PRODAT'])
  })
  it.each([['Z14', 'S17'], ['Z14', 'S18'], ['Z15', 'S17'], ['Z15', 'S18']])('%s %s on 23-DDQ-PRODAT is refused before any role/profile lookup', async (code, reason) => {
    expect(await derive('23-DDQ-PRODAT', code, reason)).toBe('ediel_inbound_legal_context_required')
  })
  it.each([['Z14', 'S17'], ['Z14', 'S18']])('positive contrast: %s %s on 23-DGI-PRODAT passes the process gate', async (code, reason) => {
    const outcome = await derive('23-DGI-PRODAT', code, reason)
    expect(outcome).not.toBe('ediel_inbound_legal_context_required')
    // The next step is the tenant identity lookup, intentionally absent here.
    expect(outcome).toMatch(/tenant_actor_identifiers/)
  })
})
