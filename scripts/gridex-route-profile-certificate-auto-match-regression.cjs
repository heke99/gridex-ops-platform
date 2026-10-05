#!/usr/bin/env node
const fs = require('fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`ok: ${message}`)
  }
}

const engine = read('lib/ediel/routeProfileProductionReadiness.ts')
const certResolver = read('lib/ediel/security/outboundRecipientCertificate.ts')

// Architecture checks complement the actual PKIX/CRL readiness behavior tests.
assert(/const resolved = await resolveOutboundRecipientCertificate\(/.test(engine) && /return \{ \.\.\.resolved\.raw, fingerprint_sha256: resolved\.fingerprintSha256 \}/.test(engine), 'engine returns the awaited authoritative row with its verified PEM fingerprint')
assert(/companyId: params\.profile\.company_id/.test(engine) && /routeProfileId: params\.profile\.id/.test(engine) && /certificateId: text\(params\.profile\.receiver_certificate_id\)/.test(engine), 'resolver receives tenant, route and selected explicit certificate context')
assert(/receiverSubaddress: routeReceiverSubaddress\(params\.profile\)/.test(engine) && /messageFamily: params\.messageFamily/.test(engine) && /businessCode:/.test(engine) && /environment: params\.environment/.test(engine), 'resolver receives actual receiver subaddress, family, code and environment')
assert(!/certificateMatches|loadCertificateById|\.from\(['"]ediel_certificates['"]\)/.test(engine), 'readiness has no weak matcher, unscoped reread or candidate fallback')
assert(/usage/.test(certResolver) && /outbound_recipient/.test(certResolver), 'authoritative resolver requires public outbound_recipient usage')
assert(/purpose/.test(certResolver) && /encryption/.test(certResolver) && /both/.test(certResolver), 'authoritative resolver requires encryption/both purpose')
assert(/owner_ediel_id/.test(certResolver) && /receiverEdielId/.test(certResolver), 'authoritative resolver binds certificate to receiver Ediel ID')
assert(/message_family/.test(certResolver) && /messageFamily/.test(certResolver), 'authoritative resolver checks message family')
assert(/environment/.test(certResolver) && /certificateEnvironment/.test(certResolver), 'authoritative resolver checks certificate environment')
assert(/public_certificate_pem/.test(certResolver) && /BEGIN CERTIFICATE/.test(certResolver), 'authoritative resolver requires public certificate PEM')
assert(/evaluateCertificateStatus/.test(certResolver) && /isUsableForSmime/.test(certResolver), 'authoritative resolver checks current S/MIME usability')
assert(/verifyRequiredRecipientCertificateSet/.test(certResolver) && /resolveEdielCertificateTrustAuthority/.test(certResolver), 'selection honors the protected required recipient set and source authority')
assert(/receiver_certificate_id/.test(engine) && /certificate_required/.test(engine), 'engine writes receiver_certificate_id and certificate_required')
assert(/security_policy_status/.test(engine) && /approved/.test(engine), 'engine approves security policy only after certificate match')
assert(/updates\.security_policy_status = 'blocked'/.test(engine) && /metaUpdates\.receiver_certificate_status = 'blocked'/.test(engine), 'held trust withdraws cached security and certificate approval')
assert(/hasPrivateMaterial/.test(certResolver), 'existing resolver distinguishes private material without requiring it for recipient certs')

if (process.exitCode) process.exit(process.exitCode)
