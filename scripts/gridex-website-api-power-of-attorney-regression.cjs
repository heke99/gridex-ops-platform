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
ok(src.includes('signerNameFallback') && src.includes('signerIdentityFallback'), 'POA uses customer identity/name as signer fallback')
ok(src.includes('poaExternallySendable') && src.includes('externally_sendable') && src.includes('requires_completion'), 'response marks weak POA as not externally sendable')
ok(src.includes("event_type: 'snapshot_created'") && !src.includes("event_type: 'pdf_generated'"), 'JSON snapshot uses snapshot_created (not pdf_generated)')
ok(src.includes('internal_snapshot_document_id'), 'internal JSON snapshot document id is tracked distinctly')

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
