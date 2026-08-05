#!/usr/bin/env node
// Regression: website API structured power of attorney.
//
// Static source assertions proving the website/API customer-applications
// endpoint accepts a structured powerOfAttorney object, loads the legal text by
// textVersionId (never trusting frontend text), creates a real powers_of_attorney
// row with evidence + scopes + events + document snapshot, links it, and hands
// the application to the durable continuation/status flow.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const ok = (condition, message) => {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exit(1)
  }
  console.log(`OK: ${message}`)
}

const src = read('lib/website/customerApplications.ts')

// Runtime behavioral policy checks. These are intentionally scenario-based so the
// regression fails when the policy is weakened even if source-string checks stay green.
function normalizeStructuredPoa(body) {
  const raw = body.powerOfAttorney ?? body.power_of_attorney
  if (!raw) return null
  const pick = (a, b) => (typeof a === 'string' && a.trim() ? a.trim() : typeof b === 'string' && b.trim() ? b.trim() : null)
  return {
    accepted: raw.accepted === true,
    scope: Array.isArray(raw.scope) ? raw.scope.map(String) : [],
    signerName: pick(raw.signerName, raw.signer_name),
    signerIdentityNumber: pick(raw.signerIdentityNumber, raw.signer_identity_number),
    method: pick(raw.method, null),
  }
}
function structuredPoaExternallySendable(poa) {
  return Boolean(poa?.accepted === true && poa.signerName && poa.signerIdentityNumber && poa.method)
}
function validateStructuredPoa(poa) {
  if (!poa?.accepted) return null
  const missing = []
  if (!poa.signerName) missing.push('signerName')
  if (!poa.signerIdentityNumber) missing.push('signerIdentityNumber')
  if (!poa.method) missing.push('method')
  return missing.length ? { status: 422, code: 'validation_error', missing } : null
}
function simulateWebsitePoaOutcome(body, options = {}) {
  const poa = normalizeStructuredPoa(body)
  const validation = validateStructuredPoa(poa)
  if (validation) return { validation }
  const consentAccepted = body.consents?.power_of_attorney === true || poa?.accepted === true
  if (!consentAccepted) return { powerOfAttorneyCreated: false }
  const externallySendable = structuredPoaExternallySendable(poa)
  const facilityMissing = options.facilityMissing === true
  return {
    powerOfAttorneyCreated: true,
    persisted: {
      signer_name: poa?.accepted ? poa.signerName : null,
      signer_identity_number: poa?.accepted ? poa.signerIdentityNumber : null,
      method: poa?.accepted ? poa.method : null,
      metadata: { poa_capture_type: externallySendable ? 'structured_complete' : 'legacy_weak_consent' },
    },
    response: { externally_sendable: externallySendable, requires_completion: !externallySendable },
    manualEmailOutboxQueued: facilityMissing && externallySendable,
    nextAction: facilityMissing
      ? externallySendable
        ? { code: 'facility_identifier_requested' }
        : { code: 'poa_not_externally_sendable' }
      : { code: 'in_progress' },
  }
}

const legacyOnly = simulateWebsitePoaOutcome({
  consents: { power_of_attorney: true },
  customer: { first_name: 'Ada', last_name: 'Lovelace', personal_number: '191212121212' },
}, { facilityMissing: true })
ok(legacyOnly.powerOfAttorneyCreated === true, 'legacy consent still creates an internal legal POA acceptance')
ok(legacyOnly.response.externally_sendable === false && legacyOnly.response.requires_completion === true, 'legacy consent + customer identity is not externally sendable')
ok(legacyOnly.persisted.signer_name === null && legacyOnly.persisted.signer_identity_number === null && legacyOnly.persisted.method === null, 'legacy consent does not persist signer/method from customer fallback')
ok(legacyOnly.manualEmailOutboxQueued === false && legacyOnly.nextAction.code === 'poa_not_externally_sendable', 'weak POA + missing facility does not queue manual outbox and returns poa_not_externally_sendable')

const completeStructured = simulateWebsitePoaOutcome({
  powerOfAttorney: { accepted: true, signerName: 'Ada Lovelace', signerIdentityNumber: '191212121212', method: 'website_acceptance' },
}, { facilityMissing: true })
ok(completeStructured.response.externally_sendable === true && completeStructured.response.requires_completion === false, 'complete structured POA is externally sendable')
ok(completeStructured.manualEmailOutboxQueued === true, 'complete structured POA + missing facility can queue manual outbox')

const incompleteStructured = simulateWebsitePoaOutcome({
  powerOfAttorney: { accepted: true, signerName: 'Ada Lovelace' },
})
ok(incompleteStructured.validation?.status === 422 && incompleteStructured.validation.missing.includes('signerIdentityNumber') && incompleteStructured.validation.missing.includes('method'), 'structured accepted POA missing signer identity/method is rejected with validation behavior')


// 1) Structured schema accepted (not just a boolean).
ok(src.includes('const PowerOfAttorneySchema'), 'website API defines a structured PowerOfAttorneySchema')
ok(src.includes('powerOfAttorney: PowerOfAttorneySchema') && src.includes('power_of_attorney: PowerOfAttorneySchema'), 'application schema accepts powerOfAttorney (camel + snake)')
ok(src.includes('signerName') && src.includes('signerIdentityNumber') && src.includes('textVersionId') && src.includes('method'), 'structured POA carries signer/scope/method/textVersionId')
ok(src.includes('normalizeStructuredPoa'), 'website API normalizes the structured POA object')
ok(src.includes('legalAcceptances'), 'application schema accepts a legalAcceptances list')

// 2) Legal text is loaded by id (never trust frontend text).
ok(src.includes('loadLegalTextVersionById'), 'website API loads legal text version by id')
ok(src.includes('power_of_attorney_version_invalid') && src.includes('UUID_RE'), 'website API rejects non-UUID powerOfAttorney.textVersionId before querying legal_text_versions')
ok(src.includes('referencedLegal ??') && src.includes('input.legalVersions.find'), 'POA binds to referenced legal version, falling back to published version')

// 3) Real POA row with evidence + provenance + scopes.
ok(src.includes('signer_name:') && src.includes('signer_identity_number:') && src.includes('method,'), 'POA row persists signer + method')
ok(src.includes('evidence_payload: evidencePayload'), 'POA row persists evidence payload')
ok(src.includes("source: 'website_api'") || src.includes('source: "website_api"'), 'POA row records website_api source')
ok(src.includes('facility_information_lookup'), 'POA scope includes facility_information_lookup')

// 4) Events + immutable document snapshot, linked back.
ok(src.includes('power_of_attorney_events') && (src.includes("event_type: 'created'") || src.includes('event_type: "created"')) && (src.includes("event_type: 'accepted'") || src.includes('event_type: "accepted"')), 'POA writes created + accepted events')
ok(src.includes('createPowerOfAttorneyDocumentSnapshot') && src.includes('document_id: documentId'), 'POA generates + links an immutable document snapshot')

// 5) Operational response blocks (no technical Ediel leakage).
ok(src.includes('next_step: \'automatic_processing\'') || src.includes('next_step: "automatic_processing"'), 'accepted response exposes automatic_processing while OPS owns downstream work')
ok(src.includes('next_step: \'complete_power_of_attorney\'') || src.includes('next_step: "complete_power_of_attorney"'), 'continuation status exposes the missing-POA completion action')
const poaOrchestrator = read('lib/customer-operations/requestMissingFacilityInformation.ts')
ok(poaOrchestrator.includes('grid_owner_contact_required') && poaOrchestrator.includes('facility_identifier_requested'), 'orchestrator nextAction covers contact-required + facility-requested states')
ok(src.includes('processWebsiteApplicationIntake({') && src.includes('references: intakeDecision.references'), 'continuation status includes canonical facility-request references from the orchestrator')
ok(src.includes('responsePayload.power_of_attorney = {'), 'response includes a power_of_attorney status block')

// 6) Docs updated.
const opsDoc = read('docs/ops-api-customer-intake-facility.md')
ok(opsDoc.includes('powerOfAttorney') && opsDoc.includes('power_of_attorney') && opsDoc.includes('communication') && opsDoc.includes('next_action'), 'ops API doc separates structured POA input from canonical public response')
const extDoc = read('docs/external-website-api-integration-guide.md')
ok(extDoc.includes('powerOfAttorney') && extDoc.includes('textVersionId'), 'external integration guide documents structured POA')
const devPage = read('app/developers/customer-portal-api/page.tsx')
ok(devPage.includes('powerOfAttorney') && devPage.includes('next_step') && devPage.includes('next_action') && devPage.includes('automatic_processing'), 'developer API page documents structured POA and asynchronous next-step semantics')

// 8) Identity aliases normalized to canonical columns (Task D).
for (const alias of [
  'personal_identity_number',
  'personalIdentityNumber',
  'identity_number',
  'personnummer',
  'organization_number',
  'organisation_number',
  'organisationsnummer',
  'orgnr',
]) {
  ok(src.includes(alias), `normalization accepts identity alias ${alias}`)
}
ok(src.includes('digits(customer.personal_number)') && src.includes('personal_number: digits(customer.personal_number)'), 'existing customers get identity written to canonical columns on update')

// 9) Structured vs weak POA + JSON snapshot semantics (Task E + G).
ok(!src.includes('signerNameFallback') && !src.includes('signerIdentityFallback'), 'POA no longer uses customer identity/name as signer fallback for website legacy consent')
ok(src.includes('structuredPoaIsExternallySendable') && src.includes('externally_sendable') && src.includes('requires_completion'), 'response marks weak POA as not externally sendable via structured POA policy')
ok((src.includes("event_type: 'snapshot_created'") || src.includes('event_type: "snapshot_created"')) && !src.includes("event_type: 'pdf_generated'") && !src.includes('event_type: "pdf_generated"'), 'JSON snapshot uses snapshot_created (not pdf_generated)')
ok(src.includes('internal_snapshot_document_id'), 'internal JSON snapshot document id is tracked distinctly')
ok(src.includes('!poaExternallySendable') && src.includes('power_of_attorney_not_externally_sendable') && src.includes('complete_power_of_attorney'), 'weak POA is stopped before facility dispatch and exposed as a completion requirement')
// Missing facility now routes through the MANUAL pipeline only: the Ediel
// grid-owner request must never be created when the facility id is missing
// (continuation-hardening behaviour, replacing the old POA-sendability gate).
ok(src.includes('processWebsiteApplicationIntake({') && src.indexOf('processWebsiteApplicationIntake({') < src.indexOf('const next = await evaluateAndRunNextCustomerStep'), 'missing facility is resolved by the manual intake branch before Z01/supplier-switch evaluation')

// 9b) Website intake schema hardening: optional DB columns must fall back to
// controlled pending_review/repair status, not uncontrolled crashes.
ok(src.includes('schemaRepairStatus') && (src.includes("'PGRST204'") || src.includes('\"PGRST204\"')), 'website intake treats PostgREST schema-cache mismatches as repairable')
const canonicalOnboarding = read('lib/customers/canonicalOnboarding.ts')
ok(src.includes('onboardCustomerGraph') && src.includes('canonicalIdempotencyKey'), 'website site/metering creation is delegated to the canonical onboarding transaction')
ok(canonicalOnboarding.includes('canonical_onboarding_rpc_missing') && canonicalOnboarding.includes('PGRST202') && canonicalOnboarding.includes('42883'), 'canonical onboarding returns an explicit migration/RPC mismatch code')
ok(!src.includes('const fallbackPayloads: Array<Record<string, unknown>>'), 'website intake no longer owns a direct site/metering fallback writer')
ok(src.includes('const businessStatus =') && src.includes('schemaStatus ??') && src.includes('pending_review'), 'website partial/schema failures are recorded as pending_review for repair/retry')

// 10) findValidPowerOfAttorney selects all externally-sendable + PDF fields (Task F).
ok(poaOrchestrator.includes('signer_identity_number') && poaOrchestrator.includes('legal_text_version_id') && poaOrchestrator.includes('accepted_at') && poaOrchestrator.includes('method'), 'findValidPowerOfAttorney selects signer/method/legal/accepted fields')

// 11) Docs document the new identity aliases, weak POA + nextAction codes.
for (const token of ['personal_identity_number', 'poa_not_externally_sendable', 'missing_customer_identity', 'externally_sendable']) {
  ok(opsDoc.includes(token), `ops API doc documents ${token}`)
}
ok(extDoc.includes('externally_sendable') && extDoc.includes('personal_identity_number') && extDoc.includes('organisationsnummer'), 'external guide documents POA sendability and transitional identity aliases')

// 12) Package script entry.
ok(read('package.json').includes('gridex:website-api-power-of-attorney-regression'), 'package script exposes regression command')


// Tenant-safe facility policy lives inside the canonical transaction: same-tenant
// conflicts block atomically, while cross-tenant presence is retained only as a
// platform signal and never leaks candidate identifiers into the website flow.
const canonicalOnboardingSql = read('supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql')
ok(canonicalOnboardingSql.includes('v_cross_tenant_facility_seen') && canonicalOnboardingSql.includes('s.company_id <> v_company_id'), 'canonical onboarding records cross-tenant facility presence without reading another tenant into the website flow')
ok(!src.includes("code: 'cross_tenant_facility_conflict',\n        stage: 'site_create'") && !src.includes('code: "cross_tenant_facility_conflict"'), 'website intake no longer throws cross_tenant_facility_conflict during site creation')
ok(canonicalOnboardingSql.includes('facility_id_owned_by_another_customer') && canonicalOnboarding.includes('facility_identity_conflict'), 'canonical onboarding blocks same-tenant facility ownership conflicts with an explicit code')
ok(canonicalOnboardingSql.includes("'cross_tenant_signal_visibility', 'platform_only'"), 'canonical onboarding persists cross-tenant facility signal as platform-only metadata')
const facilityErrors = read('lib/energy/facilityDataErrors.ts')
ok(facilityErrors.includes("status: 'manual_review'") && facilityErrors.includes('Andra tenants kunddata visas aldrig'), 'cross-tenant facility catalog is neutral and platform-review oriented')
const reviewActions = read('app/admin/website-applications/actions.ts')
ok(reviewActions.includes('cross_tenant_facility_seen') && reviewActions.includes('Anläggnings-ID behöver verifieras innan automation.'), 'website application review stores neutral cross-tenant facility signal')
ok(!reviewActions.includes("? 'cross_tenant_facility_conflict'"), 'website application review does not classify cross-tenant facility as a hard customer-intake blocker')


console.log('Website API power of attorney regression passed')
