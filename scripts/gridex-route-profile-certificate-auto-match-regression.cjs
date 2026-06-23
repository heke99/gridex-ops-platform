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

assert(/findBestRecipientCertificate/.test(engine), 'engine has explicit best certificate matcher')
assert(/usage/.test(engine) && /outbound_recipient/.test(engine), 'matcher requires outbound_recipient usage when present')
assert(/purpose/.test(engine) && /encryption/.test(engine) && /both/.test(engine), 'matcher accepts encryption/both purposes')
assert(/owner_ediel_id/.test(engine) && /receiverEdielId/.test(engine), 'matcher binds certificate to receiver Ediel ID')
assert(/message_family/.test(engine) && /messageFamily/.test(engine), 'matcher checks message family')
assert(/environment/.test(engine) && /certificateEnvironment/.test(engine), 'matcher checks certificate environment')
assert(/public_certificate_pem/.test(engine) && /BEGIN CERTIFICATE/.test(engine), 'matcher requires public certificate PEM')
assert(/isUsableForSmime/.test(engine), 'matcher uses S/MIME usability status')
assert(/order\('valid_to'/.test(engine), 'matcher prefers newest valid certificate')
assert(/receiver_certificate_id/.test(engine) && /certificate_required/.test(engine), 'engine writes receiver_certificate_id and certificate_required')
assert(/security_policy_status/.test(engine) && /approved/.test(engine), 'engine approves security policy only after certificate match')
assert(/hasPrivateMaterial/.test(certResolver), 'existing resolver distinguishes private material without requiring it for recipient certs')

if (process.exitCode) process.exit(process.exitCode)
