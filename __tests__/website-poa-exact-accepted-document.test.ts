/* eslint-disable @typescript-eslint/no-explicit-any -- loose test doubles for Supabase/PostgREST ports */
// ops-api-review: F28, F42 (permanent regression from evidence/remaining-poa-native-phase.{sql,mjs})
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const company = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const bundle = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const otherBundle = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const doc = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const alternate = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const migration = 'supabase/migrations/20261009090000_ops_api_exact_accepted_poa_document.sql'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated;`)
  await db.exec(fs.readFileSync(path.join(__dirname, 'fixtures/ops-api-review/poa-native-phase.sql'), 'utf8'))
  await db.exec(`
    create table public.customer_onboarding_legal_snapshots(
      id uuid primary key default gen_random_uuid(), company_id uuid not null,
      power_of_attorney_id uuid, legal_bundle_version_id uuid);
    -- Same ordering as the onboarding core: POA insert, legal snapshot insert, snapshot link.
    create function public.audit_native_poa_with_snapshot(p_command jsonb) returns jsonb language plpgsql as $$
    declare v_poa jsonb; v_snapshot uuid;
    begin
      v_poa := public.audit_native_poa_phase(p_command);
      insert into public.customer_onboarding_legal_snapshots(company_id, power_of_attorney_id, legal_bundle_version_id)
      values ((p_command->>'company_id')::uuid, (v_poa->>'id')::uuid, (p_command#>>'{legal,legal_bundle_version_id}')::uuid)
      returning id into v_snapshot;
      update public.powers_of_attorney set legal_snapshot_id = v_snapshot where id = (v_poa->>'id')::uuid;
      return v_poa;
    end $$;
  `)
  await db.exec(fs.readFileSync(path.join(process.cwd(), migration), 'utf8'))
  const bundles: Array<[string, string, boolean]> = [
    [bundle, company, true],
    [otherBundle, company, true],
    ['11111111-1111-4111-8111-111111111111', 'ffffffff-ffff-4fff-8fff-ffffffffffff', true],
    ['22222222-2222-4222-8222-222222222222', company, false],
  ]
  for (const [id, tenant, locked] of bundles) {
    await db.query(`insert into legal_bundle_versions values($1,$2,'published',$3,now())`, [id, tenant, locked ? '2026-10-01T00:00:00Z' : null])
  }
  const docs: Array<[string, string, string]> = [
    [doc, bundle, 'power_of_attorney'],
    [alternate, otherBundle, 'power_of_attorney'],
    ['33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'power_of_attorney'],
    ['44444444-4444-4444-8444-444444444444', bundle, 'privacy'],
    ['55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222', 'power_of_attorney'],
  ]
  for (const [id, b, module] of docs) {
    await db.query(`insert into legal_bundle_version_documents values($1,$2,$3,null,'v1','Synthetic fullmakt','Synthetic immutable legal text','synthetic-hash','{}')`, [id, b, module])
  }
})

afterAll(async () => { await db?.close() })

function command(selected: string) {
  return {
    company_id: company,
    legal: { legal_bundle_version_id: bundle, signed_scopes: ['supplier_switch'] },
    power_of_attorney: {
      status: 'signed', source: 'website_api', legal_text_version_id: selected,
      signer_name: 'Synthetic Signer', signer_identity_number: '199001011234', method: 'website_acceptance',
      signed_at: '2026-10-07T00:00:00Z', accepted_at: '2026-10-07T00:00:00Z',
      evidence_payload: { externally_sendable_at_capture: true }, metadata: { application_id: 'synthetic-application' },
    },
  }
}

async function run(selected: string) {
  return db.transaction(async (tx) => {
    const r = await tx.query<{ result: Record<string, any> }>('select audit_native_poa_with_snapshot($1::jsonb) as result', [JSON.stringify(command(selected))])
    return r.rows[0].result
  })
}

async function rejection(selected: string) {
  try { await run(selected) } catch (error) { return error as { code?: string; message?: string } }
  return null
}

describe('exact accepted POA document (native)', () => {
  it('accepts the exact accepted-bundle document and materializes its snapshot', async () => {
    const r = await run(doc)
    expect(r.legal_bundle_version_document_id).toBe(doc)
    expect(r.legal_text_version_id).toBeNull()
    expect(r.fullmakt_snapshot.legal_bundle_version_id).toBe(bundle)
  })

  it('F28: rejects another published locked same-tenant POA document and rolls back', async () => {
    const before = await db.query<{ n: number }>('select count(*)::int n from powers_of_attorney')
    const error = await rejection(alternate)
    expect(error).toMatchObject({ code: '23514', message: 'power_of_attorney_offer_version_mismatch' })
    const after = await db.query<{ n: number }>('select count(*)::int n from powers_of_attorney')
    expect(after.rows[0].n).toBe(before.rows[0].n)
  })

  it('F42: versioned normalization keeps tenant/module/lock/FK guards', async () => {
    expect(await rejection('33333333-3333-4333-8333-333333333333')).toMatchObject({ code: '23514', message: 'power_of_attorney_legal_document_tenant_mismatch' })
    expect(await rejection('44444444-4444-4444-8444-444444444444')).toMatchObject({ code: '23514', message: 'power_of_attorney_legal_document_type_mismatch' })
    expect(await rejection('55555555-5555-4555-8555-555555555555')).toMatchObject({ code: '23514', message: 'power_of_attorney_legal_document_not_locked' })
    expect(await rejection('66666666-6666-4666-8666-666666666666')).toMatchObject({ code: '23503' })
  })

  it('F42: normalization trigger is installed by the migration', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int n from pg_trigger where tgname = 'powers_of_attorney_legal_reference_normalize_tg'`)
    expect(r.rows[0].n).toBe(1)
  })
})
