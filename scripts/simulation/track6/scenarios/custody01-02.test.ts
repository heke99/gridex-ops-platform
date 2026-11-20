// CUSTODY01.02 (orakel 96518c18: "Fysisk originaldata bevaras trots utelämnade två diagnostikkopior"): NOT_APPLICABLE med belagd motivering.
// Spår 6, kampanj 20261029-3f1a8ab1. Kvalificering mot app 6454d540 och stackens DB (skrivskyddat). Ingen webbläsare/Playwright.
//   Koden har inget begrepp "diagnostikkopia" av en faktura-/mätkälla. Närmaste kandidater och varför de inte kvalificerar:
//   (1) Finance-copy-klasserna (lib/ediel/retention/financeCopies.catalog.ts, 16 st, redigeras via ediel_purge_finance_copy_retention_v1) är produktens
//       rättsliga kopior av fakturakroppar (billing_underlay_source_body = gridex_billing_source.underlay_bindings.source_basis, rad 2; billing_underlay_payload_body rad 3).
//       De bär policy (utfärdarkvitto + granskning), inte "diagnostik", och en utrensning ÄNDRAR bindningsraden (redigering) -> kan inte vara "original oförändrat".
//       requireInvoiceSourceCopiesAvailable (lib/ediel/retention/financeCopyRetention.ts:53; SQL 20261001070000_*.sql:167-170) ger finance_copy_retention_tombstoned
//       (23514) först NÄR en tombstone finns: avsiktlig spärr av fakturering, inte falsk "saknad källa"-varning vid utelämnad kopia.
//   (2) ediel_messages.parsed_payload/validation_report är härledda projektioner av raw_payload men har ingen retentionsklass eller omit-väg i någon katalog.
//   (3) ensureDiagnosticEdielMessagesForInboundEmails (lib/inbound-mail/edielMailboxPoller.part-2.ts:814) skapar ediel_messages-rader för oklara mail: ett
//       diagnostiskt MEDDELANDE, inte en kopia av en fakturakälla.
//   Scenariot assertar frånvaron (katalog, schema, funktionsbeteende) och registrerar utfallet NOT_APPLICABLE.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FINANCE_COPY_CATALOG } from '@/lib/ediel/retention/financeCopies.catalog'
import { INVOICE_FILE_CLASSES } from '@/lib/ediel/retention/invoiceFiles.catalog'
import { mode, sqlIn, sqlTry } from '../lib/custody/base'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'

const ev = new Evidence()
const run = newRunContext('custody01-02')
const RECEIVED_ORIGINAL_TABLES = /^(public\.ediel_messages|public\.inbound_email_messages|public\.inbound_email_attachments|public\.inbound_ediel_parse_results|gridex_received_sources\.)/

beforeAll(() => { ev.observe('run', { ...run, mode: mode(), oracle: '96518c18', outcome: 'NOT_APPLICABLE' }) })
afterAll(() => { ev.finalize() })

describe('CUSTODY01.02 NOT_APPLICABLE: koden saknar begreppet diagnostikkopia av en källa', () => {
  it('CUSTODY01.02 katalogerna: 16 finance-copy-klasser, ingen är diagnostik/debug och ingen riktar sig mot ett mottaget original', () => {
    ev.observe('finance_catalog', FINANCE_COPY_CATALOG.map((c) => ({ class: c.retentionClass, table: c.sourceTable, columns: c.bodyColumns, permission: c.permission })))
    expect(FINANCE_COPY_CATALOG).toHaveLength(16)
    for (const c of FINANCE_COPY_CATALOG) {
      expect(`${c.retentionClass} ${c.label}`, c.retentionClass).not.toMatch(/diagnos|debug|dump/i)
      expect(c.sourceTable, `${c.retentionClass} riktar sig mot mottaget original`).not.toMatch(RECEIVED_ORIGINAL_TABLES)
    }
    for (const c of INVOICE_FILE_CLASSES) expect(c).not.toMatch(/diagnos|debug|dump/i)
    ev.observe('invoice_source_gate_classes', ['billing_underlay_source_body', 'billing_underlay_payload_body', 'settlement_calculation_body', 'invoice_calculation_body', 'invoice_export_item_body'])
  })

  it('CUSTODY01.02 schemat: ingen tabell/kolumn för diagnostik-/debugexport eller härledd källkopia; parsade kolumner på ediel_messages saknar retentionsväg', () => {
    const tables = sqlIn<string[]>(`SELECT coalesce(jsonb_agg(table_schema||'.'||table_name ORDER BY 1),'[]') FROM information_schema.tables WHERE table_type='BASE TABLE' AND table_name ~* '(diagnos|debug|dump|derived)'`)
    const columns = sqlIn<string[]>(`SELECT coalesce(jsonb_agg(table_schema||'.'||table_name||'.'||column_name ORDER BY 1),'[]') FROM information_schema.columns WHERE table_schema IN ('public','gridex_received_sources','gridex_billing_source') AND column_name ~* '(diagnos|debug|dump)'`)
    const derived = sqlIn<string[]>(`SELECT coalesce(jsonb_agg(column_name ORDER BY 1),'[]') FROM information_schema.columns WHERE table_schema='public' AND table_name='ediel_messages' AND column_name IN ('parsed_payload','validation_report')`)
    ev.observe('schema', { diagnosticTables: tables, diagnosticColumns: columns, derivedProjectionColumnsOnEdielMessages: derived })
    expect(tables, 'ingen diagnostik-/debugtabell').toEqual([])
    // Enda träffen får vara en cache för certifikatkatalog (inte en källkopia).
    expect(columns.filter((c) => !c.startsWith('public.ediel_certificate_directory_cache.'))).toEqual([])
    expect(derived).toEqual(['parsed_payload', 'validation_report'])
    for (const c of FINANCE_COPY_CATALOG) for (const col of c.bodyColumns) expect(['parsed_payload', 'validation_report']).not.toContain(col)
  })

  it('CUSTODY01.02 ingen falsk "saknad källa"-varning: källkopieportarna ger inget fel utan tombstone (testat mot verkliga RPC:er med slumpade id:n)', async () => {
    const { supabaseService } = await import('@/lib/supabase/service')
    const company = sqlIn<string>(`SELECT to_jsonb(id::text) FROM public.companies ORDER BY created_at LIMIT 1`)
    const rnd = sqlIn<string>(`SELECT to_jsonb(gen_random_uuid()::text)`)
    const gate = await supabaseService.rpc('ediel_require_invoice_source_copies_available_v1', { p_company_id: company, p_underlay_id: rnd, p_invoice_id: rnd, p_export_item_id: rnd })
    ev.observe('gate_without_tombstone', { error: gate.error?.message ?? null, code: gate.error?.code ?? null })
    expect(gate.error).toBeNull()
    // Spärren är knuten till en tombstone, inte till frånvaron av en kopia: ingen tombstone finns för slumpade mål.
    const tomb = sqlTry(`SELECT count(*) FROM gridex_ediel_retention.finance_tombstones WHERE target_id=${"'" + rnd + "'"}`)
    expect(tomb.ok && tomb.stdout).toBe('0')
  })

  it('CUSTODY01.02 utfall: NOT_APPLICABLE (inget kvalificerande diagnostikkopieobjekt finns i koden; inga original rörda eller utelämnade)', () => {
    const outcome = {
      status: 'NOT_APPLICABLE',
      justification: 'Koden har ingen klass, tabell eller kolumn för diagnostikkopior av en faktura-/mätkälla. Finance-copy-klasserna är policystyrda rättsliga kopior vars utrensning ändrar bindningsraden och med avsikt spärrar fakturering (finance_copy_retention_tombstoned); ediel_messages.parsed_payload/validation_report saknar omit-/retentionsväg.',
      evidence: ['lib/ediel/retention/financeCopies.catalog.ts:2-3', 'lib/ediel/retention/financeCopyRetention.ts:53', 'supabase/migrations/20261001070000_ediel_finance_copy_class_retention.sql:167-170', 'lib/inbound-mail/edielMailboxPoller.part-2.ts:814'],
    }
    ev.observe('custody01_02_outcome', outcome)
    expect(outcome.status).toBe('NOT_APPLICABLE')
  })
})
