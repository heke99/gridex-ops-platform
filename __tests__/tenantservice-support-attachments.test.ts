import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const rows: Row[] = []
const objects = new Map<string, Buffer>()
let uploadFails = false

function query(op: 'select' | 'insert' | 'update', values?: Row) {
  const filters: Array<(row: Row) => boolean> = []
  let head = false
  let inserted: Row | null = null
  const api: Record<string, unknown> = {
    eq: (field: string, value: unknown) => { filters.push((row) => row[field] === value); return api },
    gte: (field: string, value: string) => { filters.push((row) => String(row[field]) >= value); return api },
    order: () => api,
    limit: () => api,
    select: () => api,
    matched: () => rows.filter((row) => filters.every((f) => f(row))),
    single: async () => {
      if (op === 'insert') return { data: inserted, error: null }
      const hit = (api.matched as () => Row[])()
      if (op === 'update') hit.forEach((row) => Object.assign(row, values))
      return { data: hit[0] ?? null, error: null }
    },
    maybeSingle: async () => ({ data: (api.matched as () => Row[])()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => unknown) => {
      const hit = (api.matched as () => Row[])()
      return resolve({ data: head ? null : hit, count: hit.length, error: null })
    },
  }
  if (op === 'insert') {
    inserted = { id: `att-${rows.length + 1}`, created_at: new Date().toISOString(), ...values }
    rows.push(inserted)
  }
  return Object.assign(api, { setHead: (h: boolean) => { head = h } })
}

vi.mock('@/lib/supabase/tenantQuery', () => ({
  tenantSelect: (companyId: string, _t: string, _c: string, options?: { head?: boolean }) => {
    const q = query('select') as Record<string, unknown> & { setHead: (h: boolean) => void }
    q.setHead(Boolean(options?.head))
    return (q.eq as (f: string, v: unknown) => unknown)('company_id', companyId)
  },
  tenantInsert: (companyId: string, _t: string, values: Row) => query('insert', { company_id: companyId, ...values }),
  tenantUpdate: (companyId: string, _t: string, values: Row) => (query('update', values).eq as (f: string, v: unknown) => unknown)('company_id', companyId),
}))
vi.mock('@/lib/supabase/service', () => ({
  supabaseService: {
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer) => {
          if (uploadFails) return { error: { message: 'down' } }
          objects.set(path, Buffer.from(bytes)); return { error: null }
        },
        remove: async (paths: string[]) => { paths.forEach((p) => objects.delete(p)); return { error: null } },
        download: async (path: string) => {
          const bytes = objects.get(path)
          return bytes ? { data: new Blob([new Uint8Array(bytes)]), error: null } : { data: null, error: { message: 'missing' } }
        },
      }),
    },
  },
}))

const COMPANY = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000b1'
const scope = { companyId: COMPANY, customerId: 'cust-1', caseId: 'case-1' }
const pdf = (body = '1 0 obj << /Type /Catalog >> endobj') => Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`, 'latin1')
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])

beforeEach(() => { rows.length = 0; objects.clear(); uploadFails = false })

describe('content inspection', () => {
  it('detects the real type from bytes, not the name', async () => {
    const { inspectAttachment } = await import('@/lib/customer-service/supportAttachments')
    expect(inspectAttachment(pdf())).toEqual({ ok: true, mime: 'application/pdf' })
    expect(inspectAttachment(png)).toEqual({ ok: true, mime: 'image/png' })
    expect(inspectAttachment(jpeg)).toEqual({ ok: true, mime: 'image/jpeg' })
    expect(inspectAttachment(Buffer.from('MZ\x90\x00 executable'))).toEqual({ ok: false, reason: 'type_not_allowed' })
    expect(inspectAttachment(Buffer.from('<html><script>'))).toEqual({ ok: false, reason: 'type_not_allowed' })
    expect(inspectAttachment(Buffer.alloc(0))).toEqual({ ok: false, reason: 'empty' })
  })

  it.each([
    '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>',
    '/AA << /O 3 0 R >>',
    '/Launch << /F (cmd.exe) >>',
    '/EmbeddedFile 4 0 R',
    '/#4A#61vaScript (x)',
  ])('rejects a PDF with active content: %s', async (body) => {
    const { inspectAttachment } = await import('@/lib/customer-service/supportAttachments')
    expect(inspectAttachment(pdf(body))).toEqual({ ok: false, reason: 'pdf_active_content' })
  })

  it('rejects a truncated PDF', async () => {
    const { inspectAttachment } = await import('@/lib/customer-service/supportAttachments')
    expect(inspectAttachment(Buffer.from('%PDF-1.7\n1 0 obj', 'latin1'))).toEqual({ ok: false, reason: 'pdf_truncated' })
  })

  it('sanitizes file names and forces the detected extension', async () => {
    const { sanitizeFileName } = await import('@/lib/customer-service/supportAttachments')
    expect(sanitizeFileName('../../etc/faktura maj.exe', 'application/pdf')).toBe('faktura maj.pdf')
    expect(sanitizeFileName('räkning"<script>.png', 'image/png')).toBe('räkning__script_.png')
    expect(sanitizeFileName('', 'image/jpeg')).toBe('bilaga.jpg')
  })
})

describe('quarantine flow', () => {
  it('stores quarantined, then releases a clean file; the download re-verifies the hash', async () => {
    const { addSupportAttachment, downloadSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
    const row = await addSupportAttachment({ ...scope, bytes: pdf(), fileName: 'avtal.pdf', declaredMime: 'application/pdf', visibility: 'customer', uploadedBy: { kind: 'staff', userId: 'u1' } })
    expect(row).toMatchObject({ scan_status: 'released', detected_mime_type: 'application/pdf', sha256: createHash('sha256').update(pdf()).digest('hex') })
    expect(row.storage_path.startsWith(`${COMPANY}/case-1/support_attachment_`)).toBe(true)
    const { bytes } = await downloadSupportAttachment({ ...scope, reference: row.public_reference, audience: 'customer' })
    expect(bytes.equals(pdf())).toBe(true)
    objects.set(row.storage_path, Buffer.from('%PDF-tampered'))
    await expect(downloadSupportAttachment({ ...scope, reference: row.public_reference, audience: 'staff' })).rejects.toMatchObject({ code: 'attachment_unavailable' })
  })

  it('rejects a dangerous file, keeps the record and never serves it', async () => {
    const { addSupportAttachment, downloadSupportAttachment, listSupportAttachments } = await import('@/lib/customer-service/supportAttachments')
    const row = await addSupportAttachment({ ...scope, bytes: pdf('/JS (x)'), fileName: 'x.pdf', declaredMime: 'application/pdf', visibility: 'customer', uploadedBy: { kind: 'customer', apiClientId: 'c1' } })
    expect(row).toMatchObject({ scan_status: 'rejected', scan_reason: 'pdf_active_content' })
    await expect(downloadSupportAttachment({ ...scope, reference: row.public_reference, audience: 'staff' })).rejects.toMatchObject({ status: 409 })
    expect(await listSupportAttachments({ ...scope, audience: 'customer' })).toEqual([])
    expect(await listSupportAttachments({ ...scope, audience: 'staff' })).toHaveLength(1)
  })

  it('customers never see internal files, and other tenants or cases see nothing', async () => {
    const { addSupportAttachment, downloadSupportAttachment, listSupportAttachments } = await import('@/lib/customer-service/supportAttachments')
    const internal = await addSupportAttachment({ ...scope, bytes: png, fileName: 'note.png', declaredMime: 'image/png', visibility: 'internal', uploadedBy: { kind: 'staff', userId: 'u1' } })
    expect(await listSupportAttachments({ ...scope, audience: 'customer' })).toEqual([])
    await expect(downloadSupportAttachment({ ...scope, reference: internal.public_reference, audience: 'customer' })).rejects.toMatchObject({ status: 404 })
    await expect(downloadSupportAttachment({ ...scope, companyId: OTHER, reference: internal.public_reference, audience: 'staff' })).rejects.toMatchObject({ status: 404 })
    await expect(downloadSupportAttachment({ ...scope, caseId: 'case-2', reference: internal.public_reference, audience: 'staff' })).rejects.toMatchObject({ status: 404 })
  })

  it('a customer cannot upload an internal-only file', async () => {
    const { addSupportAttachment } = await import('@/lib/customer-service/supportAttachments')
    await expect(addSupportAttachment({ ...scope, bytes: png, fileName: 'a.png', declaredMime: null, visibility: 'internal', uploadedBy: { kind: 'customer', apiClientId: null } }))
      .rejects.toMatchObject({ code: 'attachment_rejected' })
  })

  it('enforces size and daily quota, and cleans up storage when the record cannot be written', async () => {
    const mod = await import('@/lib/customer-service/supportAttachments')
    await expect(mod.addSupportAttachment({ ...scope, bytes: Buffer.alloc(mod.SUPPORT_ATTACHMENT_MAX_BYTES + 1), fileName: 'big.pdf', declaredMime: null, visibility: 'internal', uploadedBy: { kind: 'staff', userId: 'u1' } }))
      .rejects.toMatchObject({ code: 'attachment_too_large', status: 413 })
    for (let i = 0; i < mod.SUPPORT_ATTACHMENT_QUOTA_PER_DAY; i += 1) {
      await mod.addSupportAttachment({ ...scope, bytes: png, fileName: `${i}.png`, declaredMime: null, visibility: 'internal', uploadedBy: { kind: 'staff', userId: 'u1' } })
    }
    await expect(mod.addSupportAttachment({ ...scope, bytes: png, fileName: 'x.png', declaredMime: null, visibility: 'internal', uploadedBy: { kind: 'staff', userId: 'u1' } }))
      .rejects.toMatchObject({ code: 'attachment_quota_exceeded', status: 429 })
    rows.length = 0
    uploadFails = true
    await expect(mod.addSupportAttachment({ ...scope, bytes: png, fileName: 'x.png', declaredMime: null, visibility: 'internal', uploadedBy: { kind: 'staff', userId: 'u1' } }))
      .rejects.toMatchObject({ code: 'attachment_unavailable' })
    expect(rows).toHaveLength(0)
  })
})

describe('migration 20261002100000', () => {
  const sql = readFileSync('supabase/migrations/20261002100000_support_case_attachments.sql', 'utf8')
  it('private bucket, quarantine default, composite tenant ownership, service-role only, no deletes', () => {
    expect(sql).toContain("'support-case-attachments', 'support-case-attachments', false, 10485760")
    expect(sql).toContain("scan_status text NOT NULL DEFAULT 'quarantined'")
    expect(sql).toContain('REFERENCES public.customer_cases(id, company_id, customer_id)')
    expect(sql).toContain('REVOKE ALL ON TABLE public.customer_case_attachments FROM PUBLIC, anon, authenticated')
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/)
  })
})
