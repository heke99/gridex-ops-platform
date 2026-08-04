#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
let failed = false
function check(condition, label) {
  if (condition) console.log(`✅ ${label}`)
  else { console.error(`❌ ${label}`); failed = true }
}
function has(file, pattern, label) { check(pattern.test(read(file)), label) }

const customerPage = read('app/admin/customers/[id]/page.tsx')
check(/canReadContracts\s*=\s*isPlatformAdmin\s*\|\|\s*access\.permissions\.includes\(['"]contracts\.read/.test(customerPage), 'Tenant med contracts.read får se avtalsfliken')
check(/canWriteContracts\s*=\s*isPlatformAdmin\s*\|\|\s*access\.permissions\.includes\(['"]contracts\.write/.test(customerPage), 'Skrivbehörighet är separat från läsbehörighet')
check(/canReadContracts\s*&&\s*activeTab\s*===\s*['"]contracts/.test(customerPage), 'Kundens tecknade avtal renderas för behörig tenant')
check(!/CustomerCardLegacyTabRedirect/.test(customerPage), 'Kundkortet tar inte bort aktiv avtalsflik efter laddning')
check(/\?tab=\$\{encodeURIComponent\(tab\)\}#\$\{encodeURIComponent\(tab\)\}/.test(customerPage), 'Tabblänkar är stabila vid omladdning och använder verkligt sektions-ID')
check(/customerId=\{id\}/.test(customerPage), 'Avtalsmallskortet får kund-ID för stabil avtalsnavigering')
const eligibilityCard = read('components/admin/customers/CustomerContractOfferEligibilityCard.tsx')
check(/\?tab=contracts#contracts/.test(eligibilityCard) && !/href=[\"']#contracts/.test(eligibilityCard), 'Avtalsmallskortet länkar till verklig avtalsflik, inte dött ankare')
has('app/admin/contracts/page.tsx', /requireAdminPageAccess\([\s\S]*contracts\.read/, 'Tenantens avtalsregister kräver contracts.read, inte plattformsadmin')
has('app/admin/contracts/page.tsx', /customer_contracts/, 'Tenantens avtalsregister läser tecknade customer_contracts')

const applications = read('lib/website/customerApplications.ts')
check(/code:\s*hasLegacyOfferSelector\s*\?\s*['"]offer_reference_required/.test(applications), 'Legacy väljare utan offer_reference blockeras')
check(/code:\s*['"]offer_reference_mismatch/.test(applications), 'Motstridiga avtalsväljare blockeras')
check(/resolvePublicContractOffer\(\{[\s\S]*offerReference:\s*selectedOfferReference[\s\S]*customerType/.test(applications), 'Tecknande löser avtal från exakt offer_reference')
check(/gridex_finalize_website_contract_signature/.test(applications), 'Serverstyrd atomisk signeringsfunktion används')
check(/signed_at:\s*null,[\s\S]*Browser supplied signed_at is deliberately ignored|Browser supplied signed_at[\s\S]*signed_at:\s*null/.test(applications), 'Klientens signed_at ignoreras')
const dispatchPos = applications.indexOf('dispatchInitialWebsiteApplicationEmails')
const poaPos = applications.indexOf('ensureWebsitePowerOfAttorney', dispatchPos)
check(dispatchPos > -1 && poaPos > dispatchPos, 'Avtalsmejl köas före operativ POA/nätägar-/switchhantering')
check(/buildAgreementPdfAttachment\([\s\S]*body:\s*version\.body/.test(applications), 'Avtals-PDF innehåller frysta juridiska texter')
check(/agreementConfirmationEligible[\s\S]*responsePayload\.can_send_agreement_confirmation\s*=\s*agreementConfirmationEligible/.test(applications), 'API-svaret kopplar avtalsbekräftelse till juridisk signering, inte switch')
check(/responsePayload\.signature_snapshot_sha256\s*=\s*contract\.signature_snapshot_sha256/.test(applications), 'Kundansökan returnerar serverns signeringshash')
has('lib/website/applicationReview.ts', /canSendAgreementConfirmation\s*=\s*Boolean\([\s\S]*privacyAccepted[\s\S]*withdrawalAccepted[\s\S]*priceTermsAccepted/, 'Readiness kräver fem juridiska accepter men inte anläggnings- eller switchstatus')

const publicContracts = read('lib/website/publicContracts.ts')
check(/diagnosePublicContractOffers/.test(publicContracts), 'Publiceringsdiagnostik finns per tenant')
check(/loadLegalVersionsByBundle/.test(publicContracts) && /legal_bundle_version_id/.test(publicContracts) && /hasExactCanonicalLegalVersions\(legalVersions\)/.test(publicContracts), 'Erbjudandet verifieras i bulk mot sitt exakta juridikpaket utan latest-fallback')
const route = read('app/api/v1/website/public-contracts/route.ts')
check(/diagnostics/.test(route) && /diagnosePublicContractOffers/.test(route), 'public-contracts stöder diagnostics=1')

const migration = read('supabase/migrations/20260713203000_contract_api_visibility_signature_mail_hardening.sql')
for (const column of ['public_contract_offer_id', 'offer_reference', 'legal_versions_snapshot', 'signature_snapshot_sha256', 'withdrawal_deadline_at']) {
  check(migration.includes(column), `Migration innehåller ${column}`)
}
check(/acceptance_type\s*=\s*case item->>'type'/.test(migration), 'Signerings-RPC mappar varje juridiktyp till rätt acceptanstyp')
check(/grant execute[\s\S]*to service_role/.test(migration), 'Signerings-RPC kan endast köras av service role')
check(/Recover canonical identities[\s\S]*website_customer_applications[\s\S]*customer_contracts/.test(migration), 'Migration backfillar befintliga webbavtals offer-identitet via durable länkar')
check(/Repair historical external intake rows[\s\S]*price_plan_version_id[\s\S]*contract_offer_id = null/.test(migration), 'Migration reparerar äldre intake-rader med fel ID-typ')
check(/migration_exact_evidence_repair/.test(migration) && /gridex_finalize_website_contract_signature\(/.test(migration), 'Migration reparerar äldre pending_signature endast via exakta accepter och signerings-RPC')
check(/Skipped historical contract signature repair/.test(migration), 'Ofullständig äldre signeringsbevisning lämnas säkert för manuell granskning')

const emailEvents = read('lib/email/emailEvents.ts')
// Seeding evolved from ignoreDuplicates to a preserve-tenant-choices upsert:
// tenant-configured delay/admin-copy survive, only broken rules are repaired.
check(/exactByPair/.test(emailEvents) && /\.filter\(\(rule\) => !exactByPair\.has/.test(emailEvents) && /never re-enabled or overwritten/.test(emailEvents) && /preserved: DEFAULT_EMAIL_EVENT_RULES\.length - missingRows\.length/.test(emailEvents), 'Standardregler skriver inte över tenantens mejlval')
check(/delayMinutes:\s*rule\.delay_minutes/.test(emailEvents), 'Mejlregelns delay_minutes verkställs')
check(/send_to_customer/.test(emailEvents) && /send_to_admin/.test(emailEvents), 'Kund- och adminmottagarregler verkställs')
const outbox = read('lib/email/emailOutbox.ts')
check(/attachments/.test(outbox) && /getEmailProvider/.test(outbox), 'PDF-bilagor lagras och skickas via durable outbox')

const portalData = read('lib/customer-portal/apiData.ts')
check(/public_contract_offer_id/.test(portalData) && /offer_reference/.test(portalData) && /signature_snapshot_sha256/.test(portalData), 'Kundportalens avtal exponerar kanonisk offer- och signaturkoppling')

const docsPage = read('app/developers/customer-portal-api/page.tsx')
for (const term of ['diagnostics=1', 'can_send_agreement_confirmation', 'offer_reference_mismatch', 'signature_snapshot_sha256', '2026-08-04.2']) {
  check(docsPage.includes(term), `Publika dokumentationssidan innehåller ${term}`)
}
const websiteDocs = read('docs/openapi/website-integration-v1.json')
const portalDocs = read('docs/openapi/customer-portal-v1.json')
check(/offer_reference_mismatch/.test(websiteDocs) && /diagnostics/.test(websiteDocs), 'Website OpenAPI dokumenterar strikt offer_reference och diagnostik')
check(/signature_snapshot_sha256/.test(portalDocs) && /2026-08-03\.1/.test(portalDocs), 'Customer portal OpenAPI dokumenterar signeringshash och aktuell dokumentationsversion')

if (failed) process.exit(1)
console.log('Gridex contract API/signature/visibility regression passed.')
