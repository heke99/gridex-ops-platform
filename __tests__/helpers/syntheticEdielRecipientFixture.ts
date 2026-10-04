import { execFileSync } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Throwaway unit keys and public originals prove actual PKIX/CRL behavior,
// not issuer authorization, database RLS or permission to send live traffic.
export function createSyntheticEdielRecipientFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ediel-preparation-unit-'))
  const dispose = () => rmSync(directory, { recursive: true, force: true })
  const path = (name: string) => join(directory, name)
  const openssl = (args: string[]) => execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('ca.key'), '-out', path('ca.pem'), '-days', '365', '-subj', '/CN=Synthetic preparation CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('leaf.key'), '-out', path('leaf.csr'), '-subj', '/CN=Synthetic preparation recipient'])
    writeFileSync(path('index.txt'), '')
    writeFileSync(path('serial'), '1000')
    writeFileSync(path('crlnumber'), '1000')
    writeFileSync(path('ca.cnf'), `[ca]\ndefault_ca=main\n[main]\ndatabase=${path('index.txt')}\nnew_certs_dir=${directory}\ncertificate=${path('ca.pem')}\nprivate_key=${path('ca.key')}\nserial=${path('serial')}\ncrlnumber=${path('crlnumber')}\ndefault_days=365\ndefault_crl_days=1\ndefault_md=sha256\npolicy=policy\nx509_extensions=recipient\n[policy]\ncommonName=supplied\n[recipient]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=emailProtection\n`)
    openssl(['ca', '-config', path('ca.cnf'), '-batch', '-in', path('leaf.csr'), '-out', path('leaf.pem')])
    openssl(['ca', '-config', path('ca.cnf'), '-gencrl', '-out', path('clean.crl')])
    openssl(['ca', '-config', path('ca.cnf'), '-revoke', path('leaf.pem')])
    openssl(['ca', '-config', path('ca.cnf'), '-gencrl', '-out', path('revoked.crl')])
    const leafPem = readFileSync(path('leaf.pem'), 'utf8')
    const leaf = new X509Certificate(leafPem)
    return {
      leaf, leafPem,
      anchorPem: readFileSync(path('ca.pem'), 'utf8'),
      cleanCrl: readFileSync(path('clean.crl'), 'utf8'),
      revokedCrl: readFileSync(path('revoked.crl'), 'utf8'),
      fingerprint: leaf.fingerprint256.replaceAll(':', '').toLowerCase(),
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
