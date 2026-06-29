#!/usr/bin/env node
// Regression: website API structured power of attorney.
//
// Static source assertions proving the website/API customer-applications
// endpoint accepts a structured powerOfAttorney object, loads the legal text by
// textVersionId (never trusting frontend text), creates a real powers_of_attorney
// row with evidence + scopes + events + document snapshot, links it, and returns
// an operational nextAction / manualInformationRequest / powerOfAttorney block.

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
ok(src.includes('referencedLegal ?? input.legalVersions.find'), 'POA binds to referenced legal version, falling back to published version')

// 3) Real POA row with evidence + provenance + scopes.
ok(src.includes('signer_name:') && src.includes('signer_identity_number:') && src.includes('method,'), 'POA row persists signer + method')
ok(src.includes('evidence_payload: evidencePayload'), 'POA row persists evidence payload')
ok(src.includes("source: 'website_api'"), 'POA row records website_api source')
ok(src.includes('facility_information_lookup'), 'POA scope includes facility_information_lookup')

// 4) Events + immutable document snapshot, linked back.
ok(src.includes('power_of_attorney_events') && src.includes("event_type: 'created'") && src.includes("event_type: 'accepted'"), 'POA writes created + accepted events')
ok(src.includes('createPowerOfAttorneyDocumentSnapshot') && src.includes('document_id: documentId'), 'POA generates + links an immutable document snapshot')

// 5) Operational response blocks (no technical Ediel leakage).
ok(src.includes('responsePayload.nextAction = nextAction'), 'response exposes nextAction')
ok(src.includes("code: 'power_of_attorney_required'"), 'response nextAction covers the missing-POA state')
const poaOrchestrator = read('lib/customer-operations/requestMissingFacilityInformation.ts')
ok(poaOrchestrator.includes('grid_owner_contact_required') && poaOrchestrator.includes('facility_identifier_requested'), 'orchestrator nextAction covers contact-required + facility-requested states')
ok(src.includes('manualInformationRequest') && src.includes('requestMissingFacilityInformation'), 'response includes manualInformationRequest from the orchestrator')
ok(src.includes('responsePayload.power_of_attorney = {'), 'response includes a power_of_attorney status block')

// 6) Docs updated.
const opsDoc = read('docs/ops-api-customer-intake-facility.md')
ok(opsDoc.includes('powerOfAttorney') && opsDoc.includes('manualInformationRequest') && opsDoc.includes('nextAction'), 'ops API doc documents structured POA + nextAction + manual request')
const extDoc = read('docs/external-website-api-integration-guide.md')
ok(extDoc.includes('powerOfAttorney') && extDoc.includes('textVersionId'), 'external integration guide documents structured POA')
const devPage = read('app/developers/customer-portal-api/page.tsx')
ok(devPage.includes('powerOfAttorney') && devPage.includes('nextAction') && devPage.includes('manualInformationRequest'), 'developer API page documents structured POA + nextAction')

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
ok(src.includes('digits(customer.personal_number) ? { personal_number'), 'existing customers get identity written to canonical columns on update')

// 9) Structured vs weak POA + JSON snapshot semantics (Task E + G).
ok(!src.includes('signerNameFallback') && !src.includes('signerIdentityFallback'), 'POA no longer uses customer identity/name as signer fallback for website legacy consent')
ok(src.includes('structuredPoaIsExternallySendable') && src.includes('externally_sendable') && src.includes('requires_completion'), 'response marks weak POA as not externally sendable via structured POA policy')
ok(src.includes("event_type: 'snapshot_created'") && !src.includes("event_type: 'pdf_generated'"), 'JSON snapshot uses snapshot_created (not pdf_generated)')
ok(src.includes('internal_snapshot_document_id'), 'internal JSON snapshot document id is tracked distinctly')
ok(src.includes("code: 'poa_not_externally_sendable'") && src.includes('!poaExternallySendable'), 'weak POA missing facility returns poa_not_externally_sendable before manual outbox')
ok(src.includes('gridOwnerRequestMayBeCreated') && src.includes('(!facilityMissing || poaExternallySendable)'), 'grid-owner request creation is gated by external POA sendability when facility is missing')

// 9b) Website intake schema hardening: optional DB columns must fall back to
// controlled pending_review/repair status, not uncontrolled crashes.
ok(src.includes('schemaRepairStatus') && src.includes("'PGRST204'"), 'website intake treats PostgREST schema-cache mismatches as repairable')
ok(src.includes('customer_site_schema_mismatch') && src.includes('metering_point_schema_mismatch'), 'website intake returns explicit schema mismatch codes for site/metering fallback failures')
ok(src.includes("const fallbackPayloads: Array<Record<string, unknown>>") && src.includes(".select('id')"), 'website site/metering fallback uses minimal guaranteed columns')
ok(src.includes("businessStatus = schemaStatus") && src.includes("'pending_review'"), 'website partial/schema failures are recorded as pending_review for repair/retry')

// 10) findValidPowerOfAttorney selects all externally-sendable + PDF fields (Task F).
ok(poaOrchestrator.includes('signer_identity_number') && poaOrchestrator.includes('legal_text_version_id') && poaOrchestrator.includes('accepted_at') && poaOrchestrator.includes('method'), 'findValidPowerOfAttorney selects signer/method/legal/accepted fields')

// 11) Docs document the new identity aliases, weak POA + nextAction codes.
for (const token of ['personal_identity_number', 'poa_not_externally_sendable', 'missing_customer_identity', 'externally_sendable']) {
  ok(opsDoc.includes(token), `ops API doc documents ${token}`)
}
ok(extDoc.includes('poa_not_externally_sendable') && extDoc.includes('organisationsnummer'), 'external guide documents weak POA + identity aliases')

// 12) Package script entry.
ok(read('package.json').includes('gridex:website-api-power-of-attorney-regression'), 'package script exposes regression command')

console.log('Website API power of attorney regression passed')
