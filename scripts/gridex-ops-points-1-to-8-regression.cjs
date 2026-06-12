#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const failures = []

function read(rel) {
  const full = path.join(root, rel)
  if (!fs.existsSync(full)) {
    failures.push(`${rel} saknas`)
    return ''
  }
  return fs.readFileSync(full, 'utf8')
}

function assertContains(rel, needle, message) {
  const text = read(rel)
  if (!text.includes(needle)) failures.push(message || `${rel} saknar ${needle}`)
}

function assertNotContains(rel, needle, message) {
  const text = read(rel)
  if (text.includes(needle)) failures.push(message || `${rel} innehåller förbjudet ${needle}`)
}

function assertAny(rel, needles, message) {
  const text = read(rel)
  if (!needles.some((needle) => text.includes(needle))) failures.push(message || `${rel} saknar något av ${needles.join(', ')}`)
}

// Punkt 1: RBAC-scriptet ska inte längre varna på gamla support/customer-cases och ska granska nya service-client ytor.
assertContains('scripts/security-audit-rbac.mjs', 'app/admin/ediel/actors/actions.ts', 'RBAC-listan ska omfatta aktörsactions med service-client')
assertContains('scripts/security-audit-rbac.mjs', 'app/admin/website-applications/actions.ts', 'RBAC-listan ska omfatta website applications actions')
assertContains('scripts/security-audit-rbac.mjs', 'app/admin/webhooks/actions.ts', 'RBAC-listan ska omfatta webhook actions')
assertNotContains('scripts/security-audit-rbac.mjs', 'app/admin/customer-cases/actions.ts', 'Gamla support-actions ska inte ligga kvar i service-client review-listan')
assertNotContains('scripts/security-audit-rbac.mjs', 'app/admin/customer-cases/page.tsx', 'Gammal support-sida ska inte ligga kvar i service-client review-listan')

// Punkt 2: support/customer-cases ska vara bortstyrt från OPS UI/API-flöde.
assertContains('app/admin/customer-cases/actions.ts', 'OPS hanterar inte supportflöden', 'Support-actions ska blockeras i OPS')
assertContains('app/admin/customer-cases/page.tsx', "redirect('/admin/operations/tasks')", 'Support-route ska redirecta till driftuppgifter')
assertContains('scripts/gridex-batch-6-api-client-regression.cjs', 'support_out_of_scope', 'API-regression ska fortsätta blockera support/case-events')

// Punkt 3–4: audit och usage för kundintag/website applications.
assertContains('app/admin/website-applications/actions.ts', 'logAdminActionAndUsage', 'Website applications actions ska logga audit/usage')
assertContains('app/admin/website-applications/actions.ts', 'contract.created', 'Nya avtal från ansökan ska skapa usage-event')
assertContains('app/admin/website-applications/actions.ts', 'facility_data_requested', 'Begärda anläggningsuppgifter ska skapa audit/usage-event')
assertContains('app/admin/website-applications/actions.ts', 'facility_data_received', 'Mottagna anläggningsuppgifter ska audit-loggas')
assertContains('lib/audit/actionLogger.ts', 'platform_usage_events', 'Usage-events ska lagras i platform_usage_events')

// Punkt 5–6: import-preview/approve och nätägarverifiering.
assertContains('app/admin/ediel/actors/actions.ts', 'buildActorImportPreview', 'Aktörsimport ska ha preview/diff innan import')
assertContains('app/admin/ediel/actors/actions.ts', 'actor_import.previewed', 'Förhandsgranskning ska audit-/usage-loggas')
assertContains('app/admin/ediel/actors/actions.ts', "confirmApply !== 'IMPORTERA'", 'Import till masterdata ska kräva explicit bekräftelse')
assertContains('app/admin/ediel/actors/actions.ts', 'protectedManualFields', 'Import ska dokumentera skyddade manuella fält')
assertContains('app/admin/ediel/actors/actions.ts', 'auto_send_allowed: false', 'Importerade/verifierade routes får inte autosändas utan separat readiness')
assertContains('app/admin/ediel/actors/actions.ts', 'grid_owner_verified', 'Verifierad nätägare ska skapa usage-event')
assertContains('app/admin/ediel/actors/page.tsx', 'Förhandsgranska diff', 'Aktörsregister UI ska erbjuda förhandsgranskning')
assertContains('app/admin/ediel/actors/page.tsx', 'Godkänn och importera', 'Aktörsregister UI ska ha separat godkännande/import')
assertContains('app/admin/ediel/actors/page.tsx', 'platform_actor_import_runs', 'Aktörsregister UI ska visa importkörningar/förhandsgranskningar')

// Punkt 7–8: kundintag/kundkort måste ha begriplig status, arkivering och säkra farliga actions.
assertContains('app/admin/customers/[id]/profile-actions.ts', 'customer.archived', 'Arkivering ska audit/usage-loggas')
assertContains('app/admin/customers/[id]/profile-actions.ts', 'customer.deleted_test', 'Testkundsradering ska audit/usage-loggas')
assertContains('app/admin/customers/[id]/profile-actions.ts', 'switch.cancelled', 'Ånger/arkivering ska stoppa leverantörsbyte')
assertContains('app/admin/customers/[id]/profile-actions.ts', 'confirmText !== "ARKIVERA"', 'Arkivering ska kräva bekräftelsetext')
assertContains('app/admin/customers/[id]/profile-actions.ts', 'confirmText !== "RADERA"', 'Testkundsradering ska kräva bekräftelsetext')
assertContains('lib/customers/statusLabels.ts', 'Anläggningsuppgifter saknas', 'Råstatus needs_facility_data ska vara kundvänlig')
assertContains('lib/customers/statusLabels.ts', 'Uppgifter begärda från nätägare', 'Råstatus facility_data_requested ska vara kundvänlig')
assertContains('app/admin/customers/intake/page.tsx', 'Nästa åtgärd', 'Kundintag ska visa nästa åtgärd')
assertAny('app/admin/customers/intake/page.tsx', ['Föreslagen nätägare', 'Verifierad nätägare', 'Nätägare'], 'Kundintag ska visa nätägare på begripligt sätt')

// DB-stöd för usage/statistik och import-review ska finnas migrationsmässigt.
assertContains('supabase/migrations/20260612193000_ops_j_to_n_governance_audit_cleanup_docs_v2.sql', 'create table if not exists public.platform_usage_events', 'Usage-events tabellen ska finnas i migration')
assertContains('supabase/migrations/20260612170000_ops_multitenant_website_contracts_events.sql', 'public_contract_offers', 'Website/publicerade avtal ska finnas per tenant')
assertContains('supabase/migrations/20260612183000_ops_e_f_facility_work_queue_customer_cards.sql', 'facility_data_requested', 'Facility/kundintag migration ska stödja begärda anläggningsuppgifter')
assertContains('supabase/migrations/20260612160000_ops_points_1_to_8_hardening.sql', 'gridex_tenant_usage_monthly_v', 'Slutbatchen ska lägga till usage månads-vy')
assertContains('supabase/migrations/20260612160000_ops_points_1_to_8_hardening.sql', 'gridex_actor_import_preview_v', 'Slutbatchen ska lägga till import-preview view')
assertContains('supabase/migrations/20260612160000_ops_points_1_to_8_hardening.sql', 'support.case_message', 'Slutbatchen ska neutralisera support case event templates')

if (failures.length) {
  console.error('OPS points 1–8 regression failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('OPS points 1–8 regression passed.')
