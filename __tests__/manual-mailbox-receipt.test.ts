import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { captureManualMailboxReceipt, qualifyManualMailboxReceipt, readStoredManualMailboxReceipt, MANUAL_MAILBOX_RECEIPT } from '@/lib/inbound-mail/manualMailboxReceipt'

const bytes = Buffer.from('Date: Thu, 1 Jan 1970 00:00:00 +0000\r\n\r\nSynthetic original')
const rawSha256 = createHash('sha256').update(bytes).digest('hex')
const sourceFingerprint = 'a'.repeat(64)
const captureInput = { internalDate: new Date('2026-10-24T22:30:00.000Z'), source: bytes,
  mailbox: 'Manual@Example.invalid', mailboxId: 'mailbox-a', mailboxFingerprint: 'b'.repeat(64), uid: 51, uidValidity: '17' }
function qualified() {
  return qualifyManualMailboxReceipt({ observation: captureManualMailboxReceipt(captureInput), mailbox: 'manual@example.invalid', sourceFingerprint, verifiedRawSha256: rawSha256 })!
}
function persisted() {
  return { manual_automation: { mailboxReceipt: qualified() }, source_fingerprint: sourceFingerprint, source_fingerprint_version: 2,
    sender_verification: { status: 'verified', raw_sha256: rawSha256 } }
}

it('captures the IMAP date and exact raw hash independently of a contradictory sender Date header', () => {
  expect(captureManualMailboxReceipt(captureInput)).toEqual({ version: 1, source: 'imap_internal_date',
    receivedAt: '2026-10-24T22:30:00.000Z', rawSha256, mailbox: 'manual@example.invalid', mailboxId: 'mailbox-a',
    mailboxFingerprint: 'b'.repeat(64), uid: 51, uidValidity: '17' })
})
it('retains the qualified source binding across normal database timestamp formatting', () => {
  const receipt = readStoredManualMailboxReceipt({ payload: persisted(), receivedAt: '2026-10-24T22:30:00+00:00', sourceFingerprint })
  expect(receipt).toEqual(qualified())
})
it('loses the private observation on JSON serialization while retaining ordinary email fields', () => {
  const original = { subject: 'Synthetic reply', [MANUAL_MAILBOX_RECEIPT]: captureManualMailboxReceipt(captureInput) }
  expect(JSON.parse(JSON.stringify(original))).toEqual({ subject: 'Synthetic reply' })
})
it.each([
  { internalDate: undefined }, { internalDate: new Date('invalid') }, { internalDate: '2026-10-24T22:30:00.000Z' },
  { source: Buffer.alloc(0) }, { source: 'sender-controlled text' }, { uid: 0 }, { uid: 0x1_0000_0000 },
  { uidValidity: '0' }, { uidValidity: '4294967296' }, { mailboxFingerprint: '' }, { mailboxId: '' },
])('refuses absent or invalid original IMAP metadata %j', patch => {
  expect(captureManualMailboxReceipt({ ...captureInput, ...patch })).toBeNull()
})
it.each([
  { mailbox: 'other@example.invalid' }, { verifiedRawSha256: 'c'.repeat(64) }, { sourceFingerprint: 'invalid' },
])('does not qualify mismatched source bindings %j', patch => {
  expect(qualifyManualMailboxReceipt({ observation: captureManualMailboxReceipt(captureInput), mailbox: 'manual@example.invalid',
    sourceFingerprint, verifiedRawSha256: rawSha256, ...patch })).toBeNull()
})
it.each([
  { version: 2 }, { source: 'date_header' }, { receivedAt: '2026-02-30T22:30:00.000Z' },
  { receivedAt: '1969-12-31T23:30:00.000Z' }, { sourceFingerprint: 'c'.repeat(64) }, { rawSha256: 'c'.repeat(64) },
])('rejects corrupted persisted receipt fields %j', patch => {
  const payload = persisted(); payload.manual_automation.mailboxReceipt = { ...payload.manual_automation.mailboxReceipt, ...patch } as typeof payload.manual_automation.mailboxReceipt
  expect(readStoredManualMailboxReceipt({ payload, receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })).toBeNull()
})

// This is an in-process PostgreSQL component test of the unchanged deployed
// guard; it starts no server, native workflow, provider or production backend.
describe('receipt namespace uses the existing actual SQL provenance boundary', () => {
  let db: PGlite
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role authenticated;
      create role service_role;
      create role anon;
      create table public.manual_inbound_messages(id uuid primary key, received_at timestamptz, extracted_payload jsonb);
      create table public.grid_owner_information_requests(id uuid primary key);
      grant all on public.manual_inbound_messages to authenticated,service_role;
      alter table public.manual_inbound_messages enable row level security;
      create policy fixture_platform_admin_write on public.manual_inbound_messages for all to authenticated,service_role using(true) with check(true);
    `)
    const original = readFileSync('supabase/migrations/20261018183448_manual_mail_automatic_application.sql', 'utf8')
    const begin = original.indexOf('create or replace function public.gridex_guard_manual_mail_provenance_v1()')
    const end = original.indexOf('-- Current routing authority', begin)
    expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin)
    await db.exec(original.slice(begin, end))
  })
  afterAll(async () => { await db?.close() })
  beforeEach(async () => {
    await db.exec('reset role; truncate public.manual_inbound_messages;')
    await db.query('insert into public.manual_inbound_messages values($1,$2,$3)', [id, '2026-10-24T22:30:00Z', {
      source_fingerprint: sourceFingerprint, source_fingerprint_version: 2,
      sender_verification: { status: 'verified', raw_sha256: rawSha256 }, manual_automation: { version: 1 },
    }])
  })
  async function updateAs(role: 'authenticated' | 'service_role', expression: string, params: unknown[] = []) {
    await db.exec(`set role ${role}`)
    try { return await db.query(`update public.manual_inbound_messages set ${expression} where id='${id}'`, params) }
    finally { await db.exec('reset role') }
  }
  async function read() {
    const result = await db.query<{ extracted_payload: unknown }>('select extracted_payload from public.manual_inbound_messages')
    return readStoredManualMailboxReceipt({ payload: result.rows[0].extracted_payload,
      receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })
  }
  it('does not trust a matching top-level receipt that an authenticated admin can actually inject', async () => {
    // Existing old guard permits this added unprotected root key. It must
    // therefore never be a source of arrival authority in the reader.
    await updateAs('authenticated', "extracted_payload=extracted_payload||jsonb_build_object('mailbox_receipt',$1::jsonb)", [qualified()])
    expect(await read()).toBeNull()
  })
  it('accepts server capture in the protected sibling without losing other stage evidence', async () => {
    await updateAs('service_role', "extracted_payload=jsonb_set(extracted_payload,'{manual_automation,mailboxReceipt}',$1::jsonb)", [qualified()])
    await updateAs('service_role', "extracted_payload=jsonb_set(extracted_payload,'{manual_automation}',(extracted_payload->'manual_automation')||'{\"documentReading\":{\"status\":\"completed\"},\"application\":{\"applied\":true}}'::jsonb)")
    expect(await read()).toEqual(qualified())
    await updateAs('authenticated', "extracted_payload=extracted_payload||'{\"manual_note\":\"Synthetic admin note\"}'::jsonb")
    expect(await read()).toEqual(qualified())
  })
  it.each([
    "extracted_payload=jsonb_set(extracted_payload,'{manual_automation,mailboxReceipt}','{}')",
    "extracted_payload=jsonb_set(extracted_payload,'{manual_automation,mailboxReceipt}','null')",
    "extracted_payload=jsonb_set(extracted_payload,'{manual_automation}','{}')",
    "extracted_payload=extracted_payload-'manual_automation'",
    "received_at=received_at+interval '1 day'",
  ])('denies authenticated mutation of receipt or original binding: %s', async expression => {
    await updateAs('service_role', "extracted_payload=jsonb_set(extracted_payload,'{manual_automation,mailboxReceipt}',$1::jsonb)", [qualified()])
    await expect(updateAs('authenticated', expression)).rejects.toMatchObject({ code: '42501', message: 'manual_mail_provenance_service_role_required' })
    expect(await read()).toEqual(qualified())
  })
  it('denies initial nested proof injection even if no automation namespace existed', async () => {
    await updateAs('service_role', "extracted_payload=extracted_payload-'manual_automation'")
    await expect(updateAs('authenticated', "extracted_payload=extracted_payload||jsonb_build_object('manual_automation',$1::jsonb)", [{ mailboxReceipt: qualified() }]))
      .rejects.toMatchObject({ code: '42501', message: 'manual_mail_provenance_service_role_required' })
    expect(await read()).toBeNull()
  })
  it('does not treat a JWT role string as server execution authority', async () => {
    await db.exec("set role authenticated; select set_config('request.jwt.claim.role','service_role',false)")
    await expect(db.query("update public.manual_inbound_messages set extracted_payload=jsonb_set(extracted_payload,'{manual_automation,mailboxReceipt}',$1::jsonb)", [qualified()]))
      .rejects.toMatchObject({ code: '42501', message: 'manual_mail_provenance_service_role_required' })
    await db.exec('reset role')
    expect(await read()).toBeNull()
  })
  it('cannot mint receipt authority by changing only the unprotected fingerprint version', async () => {
    await updateAs('service_role', "extracted_payload=jsonb_set(extracted_payload,'{source_fingerprint_version}','1')")
    await updateAs('authenticated', "extracted_payload=jsonb_set(extracted_payload,'{source_fingerprint_version}','2')")
    expect(await read()).toBeNull()
  })
})
it('cannot use a persisted receipt with another source or another received_at value', () => {
  expect(readStoredManualMailboxReceipt({ payload: persisted(), receivedAt: '2026-10-25T22:30:00Z', sourceFingerprint })).toBeNull()
  expect(readStoredManualMailboxReceipt({ payload: persisted(), receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint: 'c'.repeat(64) })).toBeNull()
})
it('does not derive missing historical provenance from a current observation', () => {
  expect(readStoredManualMailboxReceipt({ payload: { source_fingerprint: sourceFingerprint, source_fingerprint_version: 2 },
    receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })).toBeNull()
  expect(readStoredManualMailboxReceipt({ payload: { ...persisted(), source_fingerprint_version: 1 },
    receivedAt: '2026-10-24T22:30:00Z', sourceFingerprint })).toBeNull()
})
