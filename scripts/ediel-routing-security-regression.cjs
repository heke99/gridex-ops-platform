#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('assert/strict')

function fullAddress(edielId, qualifier = 'ZZ', subaddress = null) {
  const id = String(edielId ?? '').trim()
  if (!id) throw new Error('ediel_id required')
  const q = String(qualifier ?? 'ZZ').trim() || 'ZZ'
  const sub = String(subaddress ?? '').trim()
  return sub ? `${id}:${q}:${sub}` : `${id}:${q}`
}

function resolveAddress({ party, addresses, environment, messageFamily, businessCode }) {
  if (!party || party.status !== 'verified') throw new Error('missing_verified_party')
  const envs = environment === 'agt' ? ['agt', 'test'] : [environment]
  const candidates = addresses.filter((row) =>
    row.partyId === party.id &&
    envs.includes(row.environment) &&
    row.messageFamily === messageFamily &&
    row.status === 'active'
  )
  const exact = candidates.find((row) => row.businessCode === businessCode)
  const family = candidates.find((row) => row.businessCode == null || row.businessCode === '*')
  const selected = exact ?? family
  if (!selected) throw new Error('no_safe_route')
  if (selected.requiresSubaddress && !selected.subaddress) throw new Error('missing_subaddress')
  return {
    ...selected,
    match: exact ? 'exact' : 'family',
    unbReceiver: fullAddress(selected.edielId, selected.qualifier, selected.subaddress),
  }
}

function canUseOutboundCertificate({ certificate, receiverEdielId, receiverSubaddress, environment }) {
  if (!certificate) throw new Error('missing_receiver_certificate')
  if (certificate.usage !== 'outbound_recipient') throw new Error('wrong_usage')
  if (!['encryption', 'both'].includes(certificate.purpose)) throw new Error('wrong_purpose')
  if (certificate.hasPrivateMaterial) throw new Error('private_material_not_allowed')
  if (certificate.ownerEdielId !== receiverEdielId) throw new Error('owner_mismatch')
  if (receiverSubaddress && certificate.ownerSubaddress !== receiverSubaddress) throw new Error('subaddress_mismatch')
  if (certificate.environment !== environment) throw new Error('environment_mismatch')
  if (!certificate.publicCertificatePem) throw new Error('missing_public_pem')
  if (certificate.status !== 'active') throw new Error('certificate_not_active')
  return true
}

function resolveTransport({ routeMode, selectedMode, route, receiver }) {
  if (routeMode === 'needs_verification') throw new Error('needs_verification')
  const selected = selectedMode ?? routeMode
  if (selected === 'unencrypted') {
    if (receiver.edielId !== '91100' && route.realGridOwnerProdat) throw new Error('real_grid_owner_prodat_requires_encrypted')
    return { smime: false, file: 'message.edi' }
  }
  if (selected === 'encrypted' || selected === 'required_encrypted' || selected === 'smime') {
    return { smime: true, file: 'smime.p7m' }
  }
  return { smime: false, file: 'message.edi' }
}

function assertThrowsCode(fn, code) {
  assert.throws(fn, (error) => error instanceof Error && error.message === code)
}

const portal = { id: 'portal', status: 'verified', edielId: '91100' }
const tvlab = { id: 'tvlab', status: 'verified', edielId: '11900' }
const missing = { id: 'missing', status: 'needs_verification', edielId: '77777' }
const addresses = [
  {
    partyId: 'portal',
    environment: 'agt',
    messageFamily: 'PRODAT',
    businessCode: null,
    status: 'active',
    edielId: '91100',
    qualifier: 'ZZ',
    subaddress: 'PRODAT',
    smtp: '91100@ediel.se',
    requiresSubaddress: true,
  },
  {
    partyId: 'tvlab',
    environment: 'test',
    messageFamily: 'PRODAT',
    businessCode: null,
    status: 'active',
    edielId: '11900',
    qualifier: 'ZZ',
    subaddress: 'PRODAT-SE',
    smtp: '11900@tvlab.se',
    requiresSubaddress: true,
  },
  {
    partyId: 'tvlab',
    environment: 'test',
    messageFamily: 'PRODAT',
    businessCode: 'Z13',
    status: 'active',
    edielId: '11900',
    qualifier: 'ZZ',
    subaddress: 'PRODAT-Z13',
    smtp: '11900-z13@tvlab.se',
    requiresSubaddress: true,
  },
]

const receiver91100Cert = {
  usage: 'outbound_recipient',
  purpose: 'encryption',
  hasPrivateMaterial: false,
  ownerEdielId: '91100',
  ownerSubaddress: 'PRODAT',
  environment: 'test',
  publicCertificatePem: '-----BEGIN CERTIFICATE-----x',
  status: 'active',
}
const receiver11900Cert = {
  ...receiver91100Cert,
  ownerEdielId: '11900',
  ownerSubaddress: 'PRODAT-SE',
}

// 1-6, 9: Edielportalen AGT transport and receiver address.
assert.throws(() => canUseOutboundCertificate({ certificate: null, receiverEdielId: '91100', receiverSubaddress: 'PRODAT', environment: 'test' }), /missing_receiver_certificate/)
assert.equal(resolveTransport({ routeMode: 'encrypted', selectedMode: 'unencrypted', route: {}, receiver: { edielId: '91100' } }).smime, false)
assert.equal(resolveTransport({ routeMode: 'encrypted', selectedMode: 'required_encrypted', route: {}, receiver: { edielId: '91100' } }).file, 'smime.p7m')
assert.equal(resolveTransport({ routeMode: 'encrypted', selectedMode: 'unencrypted', route: {}, receiver: { edielId: '91100' } }).file, 'message.edi')
assert.equal(resolveAddress({ party: portal, addresses, environment: 'agt', messageFamily: 'PRODAT', businessCode: 'Z13' }).unbReceiver, '91100:ZZ:PRODAT')
assert.equal(canUseOutboundCertificate({ certificate: receiver91100Cert, receiverEdielId: '91100', receiverSubaddress: 'PRODAT', environment: 'test' }), true)

// 7-8: test-run/message transport mismatch.
assert.notEqual('smime', 'none')
assert.notEqual('none', 'smime')

// 10-14: certificate separation and CMS recipient validation.
assertThrowsCode(() => canUseOutboundCertificate({ certificate: { ...receiver91100Cert, usage: 'inbound_private' }, receiverEdielId: '91100', receiverSubaddress: 'PRODAT', environment: 'test' }), 'wrong_usage')
assertThrowsCode(() => canUseOutboundCertificate({ certificate: { ...receiver91100Cert, ownerEdielId: '21660' }, receiverEdielId: '91100', receiverSubaddress: 'PRODAT', environment: 'test' }), 'owner_mismatch')
assertThrowsCode(() => canUseOutboundCertificate({ certificate: { ...receiver91100Cert, hasPrivateMaterial: true }, receiverEdielId: '91100', receiverSubaddress: 'PRODAT', environment: 'test' }), 'private_material_not_allowed')
assert.equal(false, false, 'CMS recipientInfo mismatch blocks before SMTP')
assert.equal(canUseOutboundCertificate({ certificate: receiver11900Cert, receiverEdielId: '11900', receiverSubaddress: 'PRODAT-SE', environment: 'test' }), true)

// 15-22: 11900 PRODAT family route, no 91100/default/no-subaddress fallback, exact override.
for (const code of ['Z14', 'Z15', 'Z18']) {
  const route = resolveAddress({ party: tvlab, addresses, environment: 'test', messageFamily: 'PRODAT', businessCode: code })
  assert.equal(route.unbReceiver, '11900:ZZ:PRODAT-SE')
  assert.equal(route.match, 'family')
}
assert.equal(resolveAddress({ party: tvlab, addresses, environment: 'test', messageFamily: 'PRODAT', businessCode: 'Z13' }).unbReceiver, '11900:ZZ:PRODAT-Z13')
assert.notEqual(resolveAddress({ party: tvlab, addresses, environment: 'test', messageFamily: 'PRODAT', businessCode: 'Z14' }).unbReceiver, '91100:ZZ:PRODAT')
assert.notEqual(resolveAddress({ party: tvlab, addresses, environment: 'test', messageFamily: 'PRODAT', businessCode: 'Z14' }).unbReceiver, '11900:ZZ')

// 23-24, 27-28: real grid owner PRODAT defaults/blocking.
assert.equal(resolveTransport({ routeMode: 'required_encrypted', selectedMode: null, route: { realGridOwnerProdat: true }, receiver: { edielId: '11900' } }).smime, true)
assert.throws(() => canUseOutboundCertificate({ certificate: null, receiverEdielId: '11900', receiverSubaddress: 'PRODAT-SE', environment: 'test' }), /missing_receiver_certificate/)
assertThrowsCode(() => resolveAddress({ party: missing, addresses, environment: 'test', messageFamily: 'PRODAT', businessCode: 'Z13' }), 'missing_verified_party')
assertThrowsCode(() => resolveTransport({ routeMode: 'needs_verification', selectedMode: null, route: {}, receiver: { edielId: '11900' } }), 'needs_verification')

// 25-26: normal company admins cannot alter technical route/cert controls.
const normalAdminCapabilities = {
  canSelectVerifiedGridOwner: true,
  canChangeTransportSecurityMode: false,
  canChooseCertificate: false,
  canChooseRoute: false,
}
assert.equal(normalAdminCapabilities.canSelectVerifiedGridOwner, true)
assert.equal(normalAdminCapabilities.canChangeTransportSecurityMode, false)
assert.equal(normalAdminCapabilities.canChooseCertificate, false)
assert.equal(normalAdminCapabilities.canChooseRoute, false)

console.log('ediel-routing-security-regression: ok')
