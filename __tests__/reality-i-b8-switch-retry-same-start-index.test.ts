// reality-defects: I-B8
// I-B8 (scenario I9): "Försök igen" (owner decision 32) creates a new switch request for the same metering point and
// agreed start as the rejected one. The legacy dedupe index ux_switch_company_meter_start_contract covered every
// status, so each retry job failed with 23505. Migration 20261027100000 leaves requests that ended without effect
// out of the index; live duplicates stay refused. The actual index definition from the original migration and the
// forward migration run in PGlite on a declared minimal table.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const original = readFileSync(resolve('supabase/migrations/02_db1_operations_ediel_billing_dedupe_and_storage.sql'), 'utf8')
const originalIndex = /'(create unique index if not exists ux_switch_company_meter_start_contract[^']*(?:''[^']*)*)'\)/.exec(original)?.[1].replaceAll("''", "'")
const forward = readFileSync(resolve('supabase/migrations/20261027100000_switch_retry_after_failed_same_start.sql'), 'utf8')
let db: PGlite
const insert = (id: number, status: string) => db.query(`INSERT INTO public.supplier_switch_requests(id,company_id,metering_point_id,requested_start_date,status,metadata)
  VALUES($1,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','2026-11-26',$2,'{}')`, [`00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, status])

beforeEach(async () => {
  expect(originalIndex).toBeTruthy()
  db = new PGlite()
  await db.exec(`CREATE TABLE public.supplier_switch_requests(id uuid PRIMARY KEY, company_id uuid, metering_point_id uuid, requested_start_date date, status text, metadata jsonb);
    ${originalIndex};`)
})

it('before the forward migration a failed request blocks the retry for the same start (the defect)', async () => {
  await insert(1, 'failed')
  await expect(insert(2, 'queued')).rejects.toThrow(/ux_switch_company_meter_start_contract/)
})

it('after it, a retry after a failed, rejected or cancelled request is accepted', async () => {
  await db.exec(forward)
  await insert(1, 'failed'); await insert(2, 'rejected'); await insert(3, 'cancelled_before_start'); await insert(4, 'cancelled')
  await expect(insert(5, 'queued')).resolves.toBeTruthy()
})

it('two live requests for the same metering point, start and contract stay refused', async () => {
  await db.exec(forward)
  await insert(1, 'submitted')
  await expect(insert(2, 'queued')).rejects.toThrow(/ux_switch_company_meter_start_contract/)
  // A request that later fails frees the key for the next one.
  await db.query(`UPDATE public.supplier_switch_requests SET status='failed'`)
  await expect(insert(3, 'queued')).resolves.toBeTruthy()
})

it('refuses to run over an index that already filters on status', async () => {
  await db.exec(forward)
  await expect(db.exec(forward)).rejects.toThrow(/ib8_switch_start_index_predecessor_required/)
})
