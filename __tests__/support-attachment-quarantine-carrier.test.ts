import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const migrationPath = 'supabase/migrations/20261004205816_support_attachment_quarantine_carrier.sql'
const forward = readFileSync(resolve(root, migrationPath), 'utf8')
const original = readFileSync(resolve(root, 'supabase/migrations/20261002100000_support_case_attachments.sql'), 'utf8')
const bucketBoundary = original.indexOf('CREATE TABLE public.customer_case_attachments')
if (bucketBoundary < 0) throw new Error('Missing original support bucket migration boundary')
const originalBucket = original.slice(0, bucketBoundary) + '\nCOMMIT;'
const bucketId = 'support-case-attachments'
const scope = { companyId: 'local-company', customerId: 'local-customer', caseId: 'local-case' }
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
type Row = Record<string, unknown>
type Bucket = { id: string; name: string; public: boolean | null; file_size_limit: number | null; allowed_mime_types: string[] | null; marker: string }
let db: PGlite
let storage: ReturnType<typeof createClient>['storage']
const rows: Row[] = []
const transitions: unknown[] = []
const objects = new Map<string, Buffer>()
const requests: Array<{ method: string; contentType: string | null }> = []
let storageUnavailable = false

// Only metadata I/O is doubled. The attachment helper, content inspection,
// installed Supabase Storage SDK and actual forward SQL are all exercised.
class MetadataQuery {
  private filters: Array<(row: Row) => boolean>
  private inserted: Row | null = null
  constructor(company: string, private operation: 'select' | 'insert' | 'update', private values: Row = {}, private head = false) {
    this.filters = [row => row.company_id === company]
    if (operation === 'insert') {
      this.inserted = { id: randomUUID(), company_id: company, created_at: new Date().toISOString(), ...values }
      rows.push(this.inserted)
      transitions.push(this.inserted.scan_status)
    }
  }
  eq(field: string, value: unknown) { this.filters.push(row => row[field] === value); return this }
  gte(field: string, value: string) { this.filters.push(row => String(row[field]) >= value); return this }
  select() { return this }
  order() { return this }
  limit() { return this }
  private matched() { return rows.filter(row => this.filters.every(filter => filter(row))) }
  async single() {
    const matched = this.matched()
    if (this.operation === 'update') {
      matched.forEach(row => { Object.assign(row, this.values); transitions.push(row.scan_status) })
    }
    return { data: this.inserted ?? matched[0] ?? null, error: null }
  }
  async maybeSingle() { return { data: this.matched()[0] ?? null, error: null } }
  then(resolveResult: (result: { data: Row[] | null; count: number; error: null }) => unknown) {
    const matched = this.matched()
    return resolveResult({ data: this.head ? null : matched, count: matched.length, error: null })
  }
}

vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantSelect: (company: string, _table: string, _columns: string, options?: { head?: boolean }) => new MetadataQuery(company, 'select', {}, Boolean(options?.head)),
  tenantInsert: (company: string, _table: string, values: Row) => new MetadataQuery(company, 'insert', values),
  tenantUpdate: (company: string, _table: string, values: Row) => new MetadataQuery(company, 'update', values),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { get storage() { return storage } } }))

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY, name text NOT NULL, public boolean,
      file_size_limit bigint, allowed_mime_types text[], marker text NOT NULL DEFAULT 'retained'
    );
    CREATE TABLE storage.objects (id text PRIMARY KEY, bucket_id text, name text);
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON storage.objects TO authenticated;
    CREATE POLICY existing_document_policy ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'customer-documents');
  `)
}, 20_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => {
  await db.exec('DELETE FROM storage.buckets;')
  await db.exec(originalBucket)
  await db.exec("INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES('unrelated','Unchanged',true,123,ARRAY['text/plain']);")
  rows.length = 0
  transitions.length = 0
  objects.clear()
  requests.length = 0
  storageUnavailable = false
  storage = createClient('https://local-attachment.invalid', 'local-test-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      // No network: use the actual SDK request and enforce MIME restrictions
      // from the bucket catalog populated by the checked-in migration SQL.
      fetch: async (input, init) => {
        const url = new URL(String(input))
        expect(url.hostname).toBe('local-attachment.invalid')
        const method = init?.method ?? 'GET'
        const contentType = new Headers(init?.headers).get('content-type')
        requests.push({ method, contentType })
        if (method === 'GET') {
          const bytes = objects.get(url.pathname)
          if (!bytes) return new Response('{}', { status: 404 })
          return new Response(new Uint8Array(bytes), { status: 200 })
        }
        if (storageUnavailable) return new Response('{"error":"StorageUnavailable","message":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } })
        const bucket = await readBucket()
        if (!contentType || !bucket.allowed_mime_types?.includes(contentType)) {
          return new Response(JSON.stringify({ statusCode: '415', error: 'InvalidMimeType', message: `Mime type ${contentType} is not supported` }), { status: 400, headers: { 'content-type': 'application/json' } })
        }
        expect(Buffer.isBuffer(init?.body)).toBe(true)
        objects.set(url.pathname, Buffer.from(init?.body as Buffer))
        return new Response('{"Id":"local-object","Key":"local-object-key"}', { status: 200, headers: { 'content-type': 'application/json' } })
      },
    },
  }).storage
})

async function readBucket() { return (await db.query<Bucket>('SELECT * FROM storage.buckets WHERE id=$1', [bucketId])).rows[0] }
async function applyForward() {
  await db.exec(forward)
}
async function snapshot() {
  return {
    buckets: (await db.query<Bucket>('SELECT * FROM storage.buckets ORDER BY id')).rows,
    security: (await db.query("SELECT relname,relacl::text,relrowsecurity FROM pg_class WHERE oid IN ('storage.buckets'::regclass,'storage.objects'::regclass) ORDER BY relname")).rows,
    policies: (await db.query("SELECT polname,polcmd,polroles::text,pg_get_expr(polqual,polrelid) qual,pg_get_expr(polwithcheck,polrelid) with_check FROM pg_policy WHERE polrelid='storage.objects'::regclass ORDER BY polname")).rows,
  }
}
async function upload(bytes: Buffer, declaredMime: string | null = 'application/pdf') {
  const { addSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
  return addSupportAttachment({ ...scope, bytes, fileName: 'synthetic-e2e.pdf', declaredMime, visibility: 'customer', uploadedBy: { kind: 'staff', userId: 'local-actor', apiClientId: 'local-client' } })
}

describe('guarded private quarantine carrier forward', () => {
  it('changes only the support bucket transport MIME and is idempotent', async () => {
    const before = await snapshot()
    await applyForward()
    const after = await snapshot()
    const expectedBuckets = before.buckets.map(row => row.id === bucketId ? { ...row, allowed_mime_types: ['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'] } : row)
    expect(after).toEqual({ ...before, buckets: expectedBuckets })
    await applyForward()
    expect(await snapshot()).toEqual(after)
  })

  it('accepts the exact original MIME set in another order without rewriting its order', async () => {
    await db.query('UPDATE storage.buckets SET allowed_mime_types=$1 WHERE id=$2', [['image/jpeg', 'application/pdf', 'image/png'], bucketId])
    await applyForward()
    expect((await readBucket()).allowed_mime_types).toEqual(['image/jpeg', 'application/pdf', 'image/png', 'application/octet-stream'])
  })

  it('allows the exact source to be rehearsed inside an outer rollback', async () => {
    const before = await snapshot()
    await db.exec('BEGIN;')
    try {
      await applyForward()
      expect((await readBucket()).allowed_mime_types).toEqual(['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream'])
    } finally { await db.exec('ROLLBACK;') }
    expect(await snapshot()).toEqual(before)
  })

  it('refuses a missing support bucket without changing other buckets', async () => {
    await db.query('DELETE FROM storage.buckets WHERE id=$1', [bucketId])
    const before = await snapshot()
    await expect(applyForward()).rejects.toThrow('support_attachment_bucket_missing')
    expect(await snapshot()).toEqual(before)
  })

  it.each([
    ['public', true, 'support_attachment_bucket_prerequisite_mismatch'],
    ['public', null, 'support_attachment_bucket_prerequisite_mismatch'],
    ['file_size_limit', 1, 'support_attachment_bucket_prerequisite_mismatch'],
    ['file_size_limit', null, 'support_attachment_bucket_prerequisite_mismatch'],
    ['allowed_mime_types', null, 'support_attachment_bucket_mime_prerequisite_mismatch'],
    ['allowed_mime_types', ['application/pdf', 'image/png'], 'support_attachment_bucket_mime_prerequisite_mismatch'],
    ['allowed_mime_types', ['application/pdf', 'image/png', 'image/jpeg', 'text/html'], 'support_attachment_bucket_mime_prerequisite_mismatch'],
    ['allowed_mime_types', ['application/pdf', 'image/png', 'image/jpeg', 'image/jpeg'], 'support_attachment_bucket_mime_prerequisite_mismatch'],
    ['allowed_mime_types', ['application/pdf', 'image/png', 'image/jpeg', null], 'support_attachment_bucket_mime_prerequisite_mismatch'],
    ['allowed_mime_types', ['application/pdf', 'image/png', 'image/jpeg', 'application/octet-stream', 'application/octet-stream'], 'support_attachment_bucket_mime_prerequisite_mismatch'],
  ] as const)('refuses incompatible %s=%j atomically', async (column, value, code) => {
    // Column names are fixed literals in this test table, never request data.
    await db.query(`UPDATE storage.buckets SET ${column}=$1 WHERE id=$2`, [value, bucketId])
    const before = await snapshot()
    await expect(applyForward()).rejects.toThrow(code)
    expect(await snapshot()).toEqual(before)
  })
})

describe('actual attachment helper and installed Storage SDK', () => {
  it('reproduces the pre-forward 503 at the effective SDK upload MIME boundary', async () => {
    await expect(upload(pdf)).rejects.toMatchObject({ code: 'attachment_unavailable', status: 503 })
    expect(requests).toEqual([{ method: 'POST', contentType: 'application/octet-stream' }])
    expect(rows).toEqual([])
    expect(objects.size).toBe(0)
  })

  it.each([
    ['PDF', pdf, 'application/pdf', 'application/pdf'],
    ['PNG', png, 'image/png', 'image/png'],
    ['magic-eligible JPEG', jpeg, 'image/jpeg', 'image/jpeg'],
    ['PDF mislabeled as JPEG', pdf, 'image/jpeg', 'application/pdf'],
  ] as const)('stores, inspects and releases %s using its byte-detected type', async (_name, bytes, declared, detected) => {
    await applyForward()
    const row = await upload(bytes, declared)
    expect(row).toMatchObject({ scan_status: 'released', detected_mime_type: detected, uploaded_by_kind: 'staff' })
    expect(rows[0]).toMatchObject({ company_id: scope.companyId, customer_id: scope.customerId, customer_case_id: scope.caseId, uploaded_by_user_id: 'local-actor', api_client_id: 'local-client', declared_mime_type: declared })
    expect(transitions).toEqual(['quarantined', 'released'])
    expect(requests).toEqual([{ method: 'POST', contentType: 'application/octet-stream' }])
    const { downloadSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
    const download = await downloadSupportAttachment({ ...scope, reference: row.public_reference, audience: 'staff' })
    expect(download.bytes.equals(bytes)).toBe(true)
  })

  it.each([
    ['active PDF', Buffer.from('%PDF-1.4\n/JavaScript\n%%EOF\n'), 'pdf_active_content'],
    ['truncated PDF', Buffer.from('%PDF-1.4\n1 0 obj'), 'pdf_truncated'],
    ['unknown bytes mislabeled as PDF', Buffer.from('MZ executable bytes'), 'type_not_allowed'],
  ] as const)('durably quarantines and rejects %s before either audience can download it', async (_name, bytes, reason) => {
    await applyForward()
    const row = await upload(bytes)
    expect(row).toMatchObject({ scan_status: 'rejected', scan_reason: reason })
    expect(transitions).toEqual(['quarantined', 'rejected'])
    expect(rows).toHaveLength(1)
    expect(objects.size).toBe(1)
    expect([...objects.values()][0].equals(bytes)).toBe(true)
    const { downloadSupportAttachment, listSupportAttachments } = await import('@/lib/customer-service/supportAttachments')
    for (const audience of ['staff', 'customer'] as const) {
      await expect(downloadSupportAttachment({ ...scope, reference: row.public_reference, audience })).rejects.toMatchObject({ status: 409 })
    }
    expect(await listSupportAttachments({ ...scope, audience: 'customer' })).toEqual([])
    expect(requests).toEqual([{ method: 'POST', contentType: 'application/octet-stream' }])
  })

  it('still denies a stored-byte SHA mismatch after the forward', async () => {
    await applyForward()
    const row = await upload(pdf)
    objects.set([...objects.keys()][0], Buffer.from('%PDF-1.4\ntampered\n%%EOF\n'))
    const { downloadSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
    await expect(downloadSupportAttachment({ ...scope, reference: row.public_reference, audience: 'staff' })).rejects.toMatchObject({ code: 'attachment_unavailable', status: 409 })
  })

  it('still reports a genuine Storage refusal without inserting attachment metadata', async () => {
    await applyForward()
    storageUnavailable = true
    await expect(upload(pdf)).rejects.toMatchObject({ code: 'attachment_unavailable', status: 503 })
    expect(rows).toEqual([])
    expect(objects.size).toBe(0)
  })
})
