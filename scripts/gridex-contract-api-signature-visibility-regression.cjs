#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { currentContractVersion } = require('./lib/current-api-contract.cjs')

const root = process.cwd()
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

// Website application implementation is intentionally split behind the stable
// customerApplications facade. Follow the current characterized module graph
// instead of assuming the former monolithic implementation file.
const applicationProcess = read('lib/website/customerApplicationProcess.ts')
const applicationCommunication = read('lib/website/customerApplicationCommunication.ts')
const applicationOnboarding = read('lib/website/customerApplicationOnboarding.ts')
const applications = [
  applicationProcess,
  applicationCommunication,
  applicationOnboarding,
  read('lib/website/customerApplicationSchemas.ts'),
  read('lib/website/customerApplicationLegal.ts'),
  read('lib/website/customerApplicationPersistence.ts'),
].join('\n')
check(/code:\s*hasLegacyOfferSelector\s*\?\s*['"]offer_reference_required/.test(applications), 'Legacy väljare utan offer_reference blockeras')
check(/code:\s*['"]offer_reference_mismatch/.test(applications), 'Motstridiga avtalsväljare blockeras')
check(/resolvePublicContractOffer\(\{[\s\S]*offerReference:\s*selectedOfferReference[\s\S]*customerType/.test(applicationProcess), 'Tecknande löser avtal från exakt offer_reference')
check(/gridex_finalize_website_contract_signature/.test(applicationCommunication), 'Serverstyrd atomisk signeringsfunktion används')
check(/Browser supplied signed_at is deliberately ignored[\s\S]*signed_at:\s*null|signed_at:\s*null[\s\S]*Browser supplied signed_at is deliberately ignored/.test(applicationOnboarding), 'Klientens signed_at ignoreras')
check(
  /External effects are intentionally deferred until after the durable[\s\S]*commitApplicationProvisioning/.test(applicationProcess) &&
  /dispatchInitialWebsiteApplicationEmails/.test(applicationCommunication),
  'Avtalsmejl och andra externa effekter ligger bakom durable provisioning commit',
)
check(/buildAgreementPdfAttachment\([\s\S]*body:\s*version\.body/.test(applicationCommunication), 'Avtals-PDF innehåller frysta juridiska texter')
check(/agreementConfirmationEligible[\s\S]*responsePayload\.can_send_agreement_confirmation\s*=\s*agreementConfirmationEligible/.test(applicationProcess), 'API-svaret kopplar avtalsbekräftelse till juridisk signering, inte switch')
check(/responsePayload\.signature_snapshot_sha256\s*=[\s\S]*contract\.signature_snapshot_sha256/.test(applicationProcess), 'Kundansökan returnerar serverns signeringshash')
has('lib/website/applicationReview.ts', /canSendAgreementConfirmation\s*=\s*Boolean\([\s\S]*privacyAccepted[\s\S]*withdrawalAccepted[\s\S]*priceTermsAccepted/, 'Readiness kräver fem juridiska accepter men inte anläggnings- eller switchstatus')

const publicContracts = [
  'lib/website/publicContracts.ts',
  'lib/website/publicContracts.part-1.ts',
  'lib/website/publicContracts.part-2.ts',
  'lib/website/publicContracts.part-3.ts',
].map(read).join('\n')
check(/diagnosePublicContractOffers/.test(publicContracts), 'Publiceringsdiagnostik finns per tenant')
check(/loadLegalVersionsByBundle/.test(publicContracts) && /legal_bundle_version_id/.test(publicContracts) && /hasExactCanonicalLegalVersions\(legalVersions\)/.test(publicContracts), 'Erbjudandet verifieras i bulk mot sitt exakta juridikpaket utan latest-fallback')
const route = read('app/api/v1/website/public-contracts/route.ts')
check(/diagnostics/.test(route) && /diagnosePublicContractOffers/.test(route), 'public-contracts stöder diagnostics=1-kompatibilitet och canonical diagnostics')

const migration = read('supabase/migrations/20260713203000_contract_api_visibility_signature_mail_hardening.sql')
for (const column of ['public_contract_offer_id', 'offer_reference', 'legal_versions_snapshot', 'signature_snapshot_sha256', 'withdrawal_deadline_at']) check(migration.includes(column), `Migration innehåller ${column}`)
check(/acceptance_type\s*=\s*case item->>'type'/.test(migration), 'Signerings-RPC mappar varje juridiktyp till rätt acceptanstyp')
check(/grant execute[\s\S]*to service_role/.test(migration), 'Signerings-RPC kan endast köras av service role')
check(/Recover canonical identities[\s\S]*website_customer_applications[\s\S]*customer_contracts/.test(migration), 'Migration backfillar befintliga webbavtals offer-identitet via durable länkar')
check(/Repair historical external intake rows[\s\S]*price_plan_version_id[\s\S]*contract_offer_id = null/.test(migration), 'Migration reparerar äldre intake-rader med fel ID-typ')
check(/migration_exact_evidence_repair/.test(migration) && /gridex_finalize_website_contract_signature\(/.test(migration), 'Migration reparerar äldre pending_signature endast via exakta accepter och signerings-RPC')
check(/Skipped historical contract signature repair/.test(migration), 'Ofullständig äldre signeringsbevisning lämnas säkert för manuell granskning')

const emailEvents = read('lib/email/emailEvents.ts')
check(/exactByPair/.test(emailEvents) && /\.filter\(\(rule\) => !exactByPair\.has/.test(emailEvents) && /never re-enabled or overwritten/.test(emailEvents) && /preserved: DEFAULT_EMAIL_EVENT_RULES\.length - missingRows\.length/.test(emailEvents), 'Standardregler skriver inte över tenantens mejlval')
check(/delayMinutes:\s*rule\.delay_minutes/.test(emailEvents), 'Mejlregelns delay_minutes verkställs')
check(/send_to_customer/.test(emailEvents) && /send_to_admin/.test(emailEvents), 'Kund- och adminmottagarregler verkställs')
const outbox = read('lib/email/emailOutbox.ts')
check(/attachments/.test(outbox) && /getEmailProvider/.test(outbox), 'PDF-bilagor lagras och skickas via durable outbox')

const portalData = read('lib/customer-portal/apiData.ts')
check(/public_contract_offer_id/.test(portalData) && /offer_reference/.test(portalData) && /signature_snapshot_sha256/.test(portalData), 'Kundportalens avtal exponerar kanonisk offer- och signaturkoppling')

const docsPage = read('app/developers/customer-portal-api/page.tsx')
const websiteDocs = read('docs/openapi/website-integration-v1.json')
const portalDocs = read('docs/openapi/customer-portal-v1.json')
check(/WEBSITE_INTEGRATION_CONTRACT_VERSION/.test(docsPage) && /signature_snapshot_sha256/.test(docsPage), 'Publika dokumentationssidan använder canonical kontraktsversion och visar signeringshash')
for (const term of ['diagnostics=1', 'can_send_agreement_confirmation', 'offer_reference_mismatch', currentContractVersion]) {
  check(websiteDocs.includes(term), `Website OpenAPI dokumenterar ${term}`)
}
check(/offer_reference_mismatch/.test(websiteDocs) && /diagnostics/.test(websiteDocs), 'Website OpenAPI dokumenterar strikt offer_reference och diagnostik')
check(/signature_snapshot_sha256/.test(portalDocs) && /2026-08-03\.1/.test(portalDocs), 'Customer portal OpenAPI dokumenterar signeringshash och aktuell dokumentationsversion')

if (failed) process.exit(1)
console.log('Gridex contract API/signature/visibility regression passed.')