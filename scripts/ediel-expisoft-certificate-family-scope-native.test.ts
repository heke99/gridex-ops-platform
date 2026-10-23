// reality-defects: F96 (CONTRL/APERAK/UTILTS replies to a grid owner were held with receiver_certificate_message_family_mismatch because Expisoft certificates were materialized as PRODAT/PRODAT)
// Native proof against the installed ediel_certificates schema. The real Expisoft
// directory materializer (fetchReceiverCertificatesFromExpisoft) runs end to end and
// writes through PostgREST; only the external LDAP directory (ldapts) is substituted.
// The Expisoft directory publishes one encryption certificate per Ediel mailbox/actor,
// so the stored row must be family-agnostic and pass the unchanged TR-06 message scope
// gate for every family to that owner, while a genuinely family-scoped certificate
// still blocks other families. A legacy PRODAT/PRODAT row is rewritten in place on the
// next directory lookup (same id, no duplicate candidate). Synthetic data only.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyntheticEdielRecipientFixture } from '@/__tests__/helpers/syntheticEdielRecipientFixture'
import { certificateMessageScopeBlocker } from '@/lib/ediel/certificateScope'
import { outboundRecipientCertificateScopeBlocker } from '@/lib/ediel/security/outboundRecipientCertificate'
import { fetchReceiverCertificatesFromExpisoft } from '@/lib/ediel/security/expisoftCertificateDirectory'

type Row = Record<string, unknown>
const directory = vi.hoisted(() => ({ entries: new Map<string, Buffer>(), filters: [] as string[] }))

// External I/O only: the Expisoft LDAP directory answers `(mail=<mailbox>)` with the
// mailbox's userCertificate, exactly the shape the materializer reads.
vi.mock('ldapts', () => ({
  Client: class {
    async search(_baseDn: string, options: { filter: string }) {
      directory.filters.push(options.filter)
      const mail = /^\(mail=(.+)\)$/.exec(options.filter)?.[1]
      const der = mail ? directory.entries.get(mail) : undefined
      return { searchEntries: der ? [{ dn: `mail=${mail},c=se`, mail, userCertificate: der }] : [] }
    }
    async unbind() { /* no connection */ }
  },
}))

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
function sql<T>(input: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 10000 }).trim()
  return (out ? JSON.parse(out) : undefined) as T
}
const literal = (v: unknown) => v === null ? 'NULL' : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`

const token = randomUUID().replaceAll('-', '').slice(0, 10)
const owner = `96${String(parseInt(token.slice(0, 8), 16) % 1_000_000).padStart(6, '0')}F96`
const subaddress = 'F96GO'
const mailboxes: string[] = []
const fixtures: Array<{ dispose(): void }> = []

function syntheticMailboxCertificate(label: string) {
  const mailbox = `f96-${label}-${token}@example.invalid`
  const fixture = createSyntheticEdielRecipientFixture({ subjectEmail: mailbox, commonName: `F96 synthetic grid owner ${label}` })
  fixtures.push(fixture)
  mailboxes.push(mailbox)
  const der = Buffer.from(fixture.leaf.raw)
  return { mailbox, der, pem: fixture.leafPem, fingerprint: createHash('sha256').update(der).digest('hex').toUpperCase() }
}

function rowsByFingerprint(fingerprint: string): Row[] {
  return sql<Row[]>(`SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at),'[]') FROM public.ediel_certificates c WHERE c.fingerprint_sha256=${literal(fingerprint)}`)
}

function messageScope(row: Row, family: string, code: string) {
  return certificateMessageScopeBlocker(
    // Same column-then-metadata reading the outbound resolver performs.
    {
      message_family: row.message_family ?? (row.metadata as Row | null)?.messageFamily ?? null,
      message_type: row.message_type ?? (row.metadata as Row | null)?.messageType ?? null,
    },
    { message_family: family, message_code: code },
  )
}

function recipientScope(row: Row, family: string, code: string, overrides: Partial<{ receiverEdielId: string; certificateEnvironment: string; receiverSubaddress: string }> = {}) {
  return outboundRecipientCertificateScopeBlocker(row, {
    companyId: '10000000-0000-4000-8000-0000000f9600',
    receiverEdielId: owner,
    receiverSubaddress: subaddress,
    messageFamily: family,
    businessCode: code,
    certificateEnvironment: 'production',
    ...overrides,
  })
}

const FAMILIES: Array<[string, string]> = [['PRODAT', 'Z03'], ['CONTRL', 'CONTRL'], ['APERAK', 'APERAK'], ['UTILTS', 'S02']]

beforeEach(() => {
  vi.stubEnv('EDIEL_EXPISOFT_LDAP_HOST', 'ldap.f96.example.invalid')
  vi.stubEnv('EDIEL_EXPISOFT_LDAP_PORT', '389')
  vi.stubEnv('EDIEL_EXPISOFT_LDAP_TIMEOUT_MS', '5000')
})
afterEach(() => { vi.unstubAllEnvs() })
afterAll(() => {
  sql(`DELETE FROM public.ediel_certificate_directory_cache WHERE smtp_email IN (${mailboxes.map(literal).join(',') || 'NULL'});
    DELETE FROM public.ediel_certificates WHERE owner_ediel_id=${literal(owner)};`)
  for (const fixture of fixtures) fixture.dispose()
})

describe('F96 Expisoft directory certificates are mailbox/party scoped', () => {
  it('materializes a fetched certificate family-agnostic so every family to that owner passes the unchanged scope gate', async () => {
    const certificate = syntheticMailboxCertificate('fresh')
    directory.entries.set(certificate.mailbox, certificate.der)

    const lookup = await fetchReceiverCertificatesFromExpisoft({ smtpEmail: certificate.mailbox, edielId: owner, subaddress, forceRefresh: true })
    expect(lookup).toMatchObject({ fetchedFromLdap: true, throttled: false, certificatesFound: 1 })
    expect(directory.filters).toContain(`(mail=${certificate.mailbox})`)

    const rows = rowsByFingerprint(certificate.fingerprint)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row.id).toBe(lookup.certificates[0].certificateId)
    expect(row).toMatchObject({
      source: 'expisoft_ldap', message_family: null, message_type: null,
      owner_ediel_id: owner, owner_subaddress: subaddress, environment: 'production',
      usage: 'outbound_recipient', purpose: 'encryption', status: 'active', company_id: null,
    })
    const metadata = row.metadata as Row
    for (const key of ['messageFamily', 'message_family', 'messageType', 'message_type']) expect(metadata).not.toHaveProperty(key)
    expect(metadata).toMatchObject({ source: 'expisoft_ldap', ownerEdielId: owner, usage: 'outbound_recipient', purpose: 'encryption' })

    for (const [family, code] of FAMILIES) {
      expect(messageScope(row, family, code), `${family} ${code}`).toBeNull()
      expect(recipientScope(row, family, code), `${family} ${code}`).toBeNull()
    }
    // Owner, subaddress and environment binding are unchanged by the family fix.
    expect(recipientScope(row, 'CONTRL', 'CONTRL', { receiverEdielId: `${owner}X` })).toBe('receiver_certificate_owner_mismatch')
    expect(recipientScope(row, 'CONTRL', 'CONTRL', { receiverSubaddress: 'OTHER' })).toBe('receiver_certificate_subaddress_mismatch')
    expect(recipientScope(row, 'CONTRL', 'CONTRL', { certificateEnvironment: 'test' })).toBe('receiver_certificate_environment_mismatch')
  })

  it('keeps a genuinely family-scoped (non-Expisoft) certificate restrictive for other families', () => {
    const certificate = syntheticMailboxCertificate('manual')
    const [row] = sql<Row[]>(`WITH inserted AS (INSERT INTO public.ediel_certificates
      (company_id,owner_ediel_id,owner_subaddress,environment,usage,purpose,certificate_type,display_name,message_family,message_type,source,
       public_certificate_pem,fingerprint_sha256,certificate_fingerprint,secret_reference,status,metadata)
      VALUES (NULL,${literal(owner)},${literal(subaddress)},'production','outbound_recipient','encryption','smime','F96 manual UTILTS-scoped',
       'UTILTS','UTILTS','manual',${literal(certificate.pem)},${literal(certificate.fingerprint)},${literal(certificate.fingerprint)},${literal(`public://ediel-certificates/f96/${certificate.fingerprint}`)},'active','{}'::jsonb)
      RETURNING *) SELECT jsonb_agg(to_jsonb(inserted)) FROM inserted`)

    expect(messageScope(row, 'UTILTS', 'S02')).toBeNull()
    for (const [family, code] of [['PRODAT', 'Z03'], ['CONTRL', 'CONTRL'], ['APERAK', 'APERAK']]) {
      expect(messageScope(row, family, code), family).toBe('receiver_certificate_message_family_mismatch')
      expect(recipientScope(row, family, code), family).toBe('receiver_certificate_message_family_mismatch')
    }
  })

  it('rewrites a legacy PRODAT/PRODAT Expisoft row in place on the next lookup without creating a duplicate candidate', async () => {
    const certificate = syntheticMailboxCertificate('legacy')
    // The row shape the previous materializer produced (F96 reproduction).
    const [legacy] = sql<Row[]>(`WITH inserted AS (INSERT INTO public.ediel_certificates
      (company_id,owner_ediel_id,owner_subaddress,environment,usage,purpose,certificate_type,display_name,message_family,message_type,source,
       public_certificate_pem,fingerprint_sha256,certificate_fingerprint,secret_reference,status,metadata)
      VALUES (NULL,${literal(owner)},${literal(subaddress)},'production','outbound_recipient','encryption','smime','Expisoft legacy',
       'PRODAT','PRODAT','expisoft_ldap',${literal(certificate.pem)},${literal(certificate.fingerprint)},${literal(certificate.fingerprint)},${literal(`public://ediel-certificates/f96/${certificate.fingerprint}`)},'active',
       ${literal({ source: 'expisoft_ldap', messageFamily: 'PRODAT', message_family: 'PRODAT', messageType: 'PRODAT', message_type: 'PRODAT' })}::jsonb)
      RETURNING *) SELECT jsonb_agg(to_jsonb(inserted)) FROM inserted`)
    expect(recipientScope(legacy, 'CONTRL', 'CONTRL')).toBe('receiver_certificate_message_family_mismatch')

    directory.entries.set(certificate.mailbox, certificate.der)
    const lookup = await fetchReceiverCertificatesFromExpisoft({ smtpEmail: certificate.mailbox, edielId: owner, subaddress, forceRefresh: true })
    expect(lookup.certificates.map(entry => entry.certificateId)).toEqual([legacy.id])

    const rows = rowsByFingerprint(certificate.fingerprint)
    expect(rows).toHaveLength(1)
    const [row] = rows
    expect(row).toMatchObject({ id: legacy.id, source: 'expisoft_ldap', message_family: null, message_type: null, owner_ediel_id: owner, status: 'active' })
    for (const key of ['messageFamily', 'message_family', 'messageType', 'message_type']) expect(row.metadata as Row).not.toHaveProperty(key)
    for (const [family, code] of FAMILIES) expect(recipientScope(row, family, code), family).toBeNull()
  })
})
