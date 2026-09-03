from pathlib import Path

scope = Path('lib/ediel/certificateScope.ts')
s = scope.read_text()
addition = """

export function certificateSubaddressScopeBlocker(
  certificateOwnerSubaddress: unknown,
  receiverSubaddress: unknown,
): 'receiver_certificate_subaddress_mismatch' | null {
  const certificateSubaddress = upper(certificateOwnerSubaddress)
  const routeSubaddress = upper(receiverSubaddress)

  // Recipient X.509 certificates are commonly party-scoped in the production
  // registry. A missing certificate subaddress therefore means general scope
  // for that Ediel owner. When a certificate explicitly carries a subaddress,
  // it remains restrictive and must match the route exactly.
  if (!certificateSubaddress || !routeSubaddress) return null
  return certificateSubaddress === routeSubaddress ? null : 'receiver_certificate_subaddress_mismatch'
}
"""
assert 'certificateSubaddressScopeBlocker' not in s
scope.write_text(s.rstrip() + addition)

target = Path('lib/ediel/security/outboundRecipientCertificate.ts')
s = target.read_text()
old = "import { supabaseService } from '@/lib/supabase/service'\n"
new = "import { certificateSubaddressScopeBlocker } from '@/lib/ediel/certificateScope'\nimport { supabaseService } from '@/lib/supabase/service'\n"
assert s.count(old) == 1
s = s.replace(old, new, 1)

old = "    if (certificateEnvironment) query = query.eq('environment', certificateEnvironment)\n    if (receiverSubaddress) query = query.eq('owner_subaddress', receiverSubaddress)\n"
new = "    if (certificateEnvironment) query = query.eq('environment', certificateEnvironment)\n"
assert s.count(old) == 1
s = s.replace(old, new, 1)

old = "      const code = normalize(textFrom(candidate, 'business_code', 'businessCode'))\n      if (family && messageFamily && family !== normalize(messageFamily)) return false\n      if (code && businessCode && code !== normalize(businessCode) && code !== '*') return false\n"
new = "      const code = normalize(textFrom(candidate, 'business_code', 'businessCode'))\n      const candidateSubaddress = inferOwnerSubaddress(candidate)\n      if (family && messageFamily && family !== normalize(messageFamily)) return false\n      if (code && businessCode && code !== normalize(businessCode) && code !== '*') return false\n      if (certificateSubaddressScopeBlocker(candidateSubaddress, receiverSubaddress)) return false\n"
assert s.count(old) == 1
s = s.replace(old, new, 1)

old = """  if (receiverSubaddress && !ownerSubaddress) {
    throw new Error(
      `Sändning stoppad: mottagaren kräver subadress ${receiverSubaddress}, men certifikatet saknar owner_subaddress.`,
    )
  }

  if (receiverSubaddress && ownerSubaddress && normalize(ownerSubaddress) !== normalize(receiverSubaddress)) {
    throw new Error(
      `Sändning stoppad: valt S/MIME-certifikat har subadress ${ownerSubaddress}, men routen kräver ${receiverSubaddress}.`,
    )
  }
"""
new = """  if (certificateSubaddressScopeBlocker(ownerSubaddress, receiverSubaddress)) {
    throw new Error(
      `Sändning stoppad: valt S/MIME-certifikat har subadress ${ownerSubaddress}, men routen kräver ${receiverSubaddress}.`,
    )
  }
"""
assert s.count(old) == 1
s = s.replace(old, new, 1)
target.write_text(s)

test = Path('__tests__/ediel-transport-security-resolution.test.ts')
s = test.read_text()
old = "import { certificateMessageScopeBlocker } from '@/lib/ediel/certificateScope'"
new = "import { certificateMessageScopeBlocker, certificateSubaddressScopeBlocker } from '@/lib/ediel/certificateScope'"
assert s.count(old) == 1
s = s.replace(old, new, 1)
addition = """

describe('Ediel recipient certificate subaddress scope', () => {
  it('accepts a party-scoped recipient certificate without owner_subaddress for a subaddressed route', () => {
    expect(certificateSubaddressScopeBlocker(null, 'PRODAT')).toBeNull()
  })

  it('accepts an explicitly matching certificate subaddress', () => {
    expect(certificateSubaddressScopeBlocker('PRODAT', 'PRODAT')).toBeNull()
  })

  it('fails closed when an explicit certificate subaddress conflicts with the route', () => {
    expect(certificateSubaddressScopeBlocker('UTILTS', 'PRODAT')).toBe('receiver_certificate_subaddress_mismatch')
  })
})
"""
assert "describe('Ediel recipient certificate subaddress scope'" not in s
test.write_text(s.rstrip() + addition)
