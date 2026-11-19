import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import forge from 'node-forge'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateEdielP12EnvCertificateAction } from '@/app/admin/ediel/certificates/actions'

const io = vi.hoisted(() => ({
  db: null as PGlite | null,
  userId: '11111111-1111-4111-8111-111111111111',
  platformAdmin: true,
  readCount: 0,
  sqlErrorCodes: [] as string[],
}))

vi.mock('react', () => ({ cache: <T>(fn: T) => fn }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (path: string) => { throw new Error(decodeURIComponent(path)) },
  unstable_rethrow: () => undefined,
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: io.userId } }, error: null }) },
    rpc: async (name: string) => {
      expect(name).toBe('canonical_authenticated_tenant_context')
      return { data: { authorized: true, user_id: io.userId, is_platform_admin: io.platformAdmin, roles: ['company_admin'] }, error: null }
    },
  }),
}))

// Exercise actual SQL column validation and writes behind the action's client port.
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    from(table: string) {
      const identifier = (value: string) => {
        if (!/^[a-z_][a-z_0-9]*$/.test(value)) throw new Error('Invalid SQL fixture identifier')
        return value
      }
      const relation = 'public.' + identifier(table)
      const params: unknown[] = []
      const bind = (value: unknown) => '$' + params.push(value)
      let where = ''
      let columns = '*'
      let update: Record<string, unknown> | undefined
      let insert: Record<string, unknown> | undefined
      async function execute(single: boolean) {
        const statement = update
          ? `UPDATE ${relation} SET ${Object.entries(update).map(([field, value]) => `${identifier(field)} = ${bind(value)}`).join(', ')}${where}`
          : insert
            ? `INSERT INTO ${relation} (${Object.keys(insert).map(identifier).join(', ')}) VALUES (${Object.values(insert).map(bind).join(', ')})`
            : `SELECT ${columns} FROM ${relation}${where}`
        if (!update && !insert) io.readCount += 1
        try {
          const { rows } = await io.db!.query(statement, params)
          return { data: single ? rows[0] ?? null : rows, error: null }
        } catch (error) {
          const pg = error as { code: string; message: string }
          io.sqlErrorCodes.push(pg.code)
          return { data: null, error: { code: pg.code, message: pg.message } }
        }
      }
      const query = {
        select(selection: string) { columns = selection.split(',').map(identifier).join(','); return query },
        eq(name: string, value: unknown) { where = ` WHERE ${identifier(name)} = ${bind(value)}`; return query },
        update(value: Record<string, unknown>) { update = value; return query },
        insert(value: Record<string, unknown>) { insert = value; return query },
        maybeSingle: () => execute(true),
        then: (resolve: (result: unknown) => unknown) => execute(false).then(resolve),
      }
      return query
    },
  },
}))

const certificateId = '22222222-2222-4222-8222-222222222222'
const p12Reference = 'env:GRIDEX_RAD67_SYNTHETIC_P12'
const passwordReference = 'env:GRIDEX_RAD67_SYNTHETIC_PASSWORD'
const syntheticPassword = 'only-for-generated-local-fixture'
let encodedP12: string

function tableDefinition(sql: string, table: string) {
  const definition = sql.match(new RegExp(`^create table (?:if not exists )?public\\.${table} \\(\\n[\\s\\S]*?^\\);`, 'im'))
  if (!definition) throw new Error(`Missing SQL table definition: ${table}`)
  return definition[0]
}

const canonical = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const historical = readFileSync(new URL('../supabase/migrations/20260602090000_ediel_operations_platform_core.sql', import.meta.url), 'utf8')
const currentCertificateTable = tableDefinition(canonical, 'ediel_certificates')

beforeAll(async () => {
  io.db = new PGlite()
  await io.db.exec(currentCertificateTable)
  await io.db.exec(tableDefinition(canonical, 'ediel_certificate_events'))
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01'
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00Z')
  const subject = [{ name: 'commonName', value: 'Synthetic local validation fixture' }]
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.sign(keys.privateKey, forge.md.sha256.create())
  const bag = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], syntheticPassword)
  encodedP12 = forge.util.encode64(forge.asn1.toDer(bag).getBytes())
})

afterAll(async () => { await io.db?.close() })
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

beforeEach(async () => {
  await io.db!.exec('TRUNCATE public.ediel_certificates, public.ediel_certificate_events')
  io.platformAdmin = true
  io.readCount = 0
  io.sqlErrorCodes = []
  vi.stubEnv('GRIDEX_RAD67_SYNTHETIC_P12', encodedP12)
  vi.stubEnv('GRIDEX_RAD67_SYNTHETIC_PASSWORD', syntheticPassword)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request from local fixture') }))
})

function validate() {
  const form = new FormData()
  form.set('certificateId', certificateId)
  return validateEdielP12EnvCertificateAction(form)
}

async function insertCertificate(source: 'columns' | 'metadata' | 'missing') {
  if (source === 'columns') {
    await io.db!.query(`INSERT INTO public.ediel_certificates
      (id, certificate_fingerprint, secret_reference, p12_secret_reference, p12_password_secret_ref)
      VALUES ($1, 'synthetic', $2, $2, $3)`, [certificateId, p12Reference, passwordReference])
    return
  }
  const metadata = source === 'metadata' ? { passwordSecretReference: passwordReference } : {}
  await io.db!.query(`INSERT INTO public.ediel_certificates
    (id, certificate_fingerprint, secret_reference, metadata) VALUES ($1, 'synthetic', $2, $3)`,
  [certificateId, p12Reference, metadata])
}

async function expectValidated() {
  await expect(validate()).rejects.toThrow(/certStatus=success/)
  const { rows } = await io.db!.query('SELECT encryption_status, last_validation_at, updated_by FROM public.ediel_certificates WHERE id = $1', [certificateId])
  expect(rows).toEqual([{ encryption_status: 'valid', last_validation_at: expect.any(Date), updated_by: io.userId }])
  const audit = await io.db!.query('SELECT event_type, created_by FROM public.ediel_certificate_events WHERE certificate_id = $1', [certificateId])
  expect(audit.rows).toEqual([{ event_type: 'validated_env_p12', created_by: io.userId }])
}

async function expectUnchanged() {
  const { rows } = await io.db!.query('SELECT encryption_status, last_validation_at FROM public.ediel_certificates WHERE id = $1', [certificateId])
  expect(rows).toEqual([{ encryption_status: 'unknown', last_validation_at: null }])
  const audit = await io.db!.query('SELECT id FROM public.ediel_certificate_events')
  expect(audit.rows).toEqual([])
}

describe('platform P12 env certificate validation', () => {
  it('reads canonical password references and records successful validation', async () => {
    await insertCertificate('columns')
    await expectValidated()
    expect(io.sqlErrorCodes).toEqual([])
    expect(io.readCount).toBe(1)
    const { rows } = await io.db!.query('SELECT is_private_material_available FROM public.ediel_certificates WHERE id = $1', [certificateId])
    expect(rows).toEqual([{ is_private_material_available: true }])
  })

  it('validates older metadata in the canonical schema', async () => {
    await insertCertificate('metadata')
    await expectValidated()
  })

  it('still validates metadata through the pre-extension schema fallback', async () => {
    await io.db!.exec('DROP TABLE public.ediel_certificates')
    try {
      await io.db!.exec(tableDefinition(historical, 'ediel_certificates'))
      await insertCertificate('metadata')
      await expectValidated()
      expect(io.sqlErrorCodes).toEqual(['42703', '42703'])
    } finally {
      await io.db!.exec('DROP TABLE IF EXISTS public.ediel_certificates')
      await io.db!.exec(currentCertificateTable)
    }
  })

  it('reports a genuinely missing password reference without writes or audit events', async () => {
    await insertCertificate('missing')
    await expect(validate()).rejects.toThrow(/certStatus=error.*saknar P12 secret reference eller password secret reference/)
    await expectUnchanged()
  })

  it('stops before reading certificate data for a tenant-only administrator', async () => {
    await insertCertificate('columns')
    io.platformAdmin = false
    await expect(validate()).rejects.toThrow('Endast platform admin')
    expect(io.readCount).toBe(0)
    await expectUnchanged()
  })

  it('reports a database read denial without treating it as a schema compatibility issue', async () => {
    await insertCertificate('columns')
    await io.db!.exec('CREATE ROLE certificate_fixture_restricted; SET ROLE certificate_fixture_restricted')
    try {
      await expect(validate()).rejects.toThrow(/certStatus=error.*permission denied/)
      expect(io.sqlErrorCodes).toEqual(['42501'])
      expect(io.readCount).toBe(1)
    } finally {
      await io.db!.exec('RESET ROLE')
    }
    await expectUnchanged()
  })
})
