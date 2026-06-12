#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}
function assertContains(file, needles) {
  const text = read(file)
  for (const needle of needles) {
    if (!text.includes(needle)) {
      throw new Error(`${file} saknar krav: ${needle}`)
    }
  }
}

assertContains('supabase/migrations/20260613090000_batch_m_ops_master_legal_readiness.sql', [
  'legal_text_versions',
  'customer_legal_acceptances',
  'powers_of_attorney',
  'fullmakt_snapshot',
  'customer_ops_master_readiness_v',
  'customer_ops_timeline_v',
  'tenant_website_readiness_v',
  'gridex_customer_legal_acceptances_immutable',
  'gridex_prevent_published_legal_text_mutation',
])

assertContains('lib/opsMaster/readiness.ts', [
  'evaluateCustomerOpsMasterReadiness',
  'canStartSupplierSwitch',
  'canRequestFacilityData',
  'canSendMail',
  'Villkor saknas',
  'Aktiv fullmakt saknas',
  'Ediel-route saknas',
])

assertContains('app/admin/customers/[id]/page.tsx', [
  'legal-readiness',
  'CustomerLegalReadinessCard',
  'opsMasterReadiness',
  'Juridik och godkännanden',
])

assertContains('components/admin/customers/CustomerLegalReadinessCard.tsx', [
  'Kan starta leverantörsbyte',
  'Kan begära anläggningsuppgifter',
  'Kan skicka kundmail',
  'Eventkedja per kund',
])

assertContains('app/admin/companies/[id]/page.tsx', [
  'CompanyLegalMasterSection',
  'legal-master',
  'Skapa juridisk version',
  'Hemsidan är inte juridiskt redo',
])

assertContains('lib/website/publicContracts.ts', [
  'listPublishedLegalVersions',
  'offerWithLegalVersions',
  'legal_versions',
])

assertContains('lib/website/customerApplications.ts', [
  'legal_acceptance',
  'assertWebsiteLegalAcceptances',
  'persistCustomerLegalAcceptances',
  'legal_versions_missing',
  'legal_acceptance_missing',
])

console.log('Batch M OPS master regression: OK')
