// Syntetisk "främmande körning" för CUSTODY01.05: en egen process (testprocessens händelseloop blockeras av spawnSync under pg_dump/pg_restore) som i en
// SEPARAT tenant loopar normala, autentiserade och DB-berörande operationer med skrivningar som committas.
// Val av operation (motivering): produktens egen kod gör autentiserade PostgREST-skrivningar med användarens session mot public.customer_operation_tasks
// (lib/operations/db.part-2.ts:196-213 syncOperationTasksFromReadiness: .insert/.update/.select med session-klienten). Tabellen har authenticated INSERT/UPDATE/SELECT-grant och RLS
// gridex_db1_customer_operation_tasks_{insert,update,select} (gridex_can_write_company/read_company: aktivt bolag + medlemskap owner/admin/company_admin/operations) samt
// tenant_lifecycle_*_guard; FK (customer_id,company_id) -> customers. En direkt INSERT i public.customers är INTE en supportad väg (EXECUTE saknas på gridex_new_public_resource_reference).
// Per iteration: INSERT -> SELECT -> UPDATE (tre separata committade requests). Latens och status per request skrivs till fil.
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { custodyDir, env } from './base'

export type ForeignIteration = { i: number; t0: number; t1: number; ok: boolean; id: string | null; statuses: number[]; insertMs: number; selectMs: number; updateMs: number; error?: string }

const CHILD = `
const fs = require('node:fs')
const { FR_BASE, FR_ANON, FR_TOKEN, FR_COMPANY, FR_CUSTOMER, FR_FILE, FR_TAG, FR_INTERVAL } = process.env
let stop = false
process.on('SIGTERM', () => { stop = true })
const h = { apikey: FR_ANON, authorization: 'Bearer ' + FR_TOKEN, 'content-type': 'application/json', prefer: 'return=representation' }
async function call(method, path, body) {
  const t = Date.now()
  const r = await fetch(FR_BASE + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: r.status, ms: Date.now() - t, json, text }
}
;(async () => {
  for (let i = 1; !stop; i++) {
    const rec = { i, t0: Date.now(), t1: 0, ok: false, id: null, statuses: [], insertMs: 0, selectMs: 0, updateMs: 0 }
    const name = FR_TAG + '-' + i
    try {
      const ins = await call('POST', 'customer_operation_tasks', { company_id: FR_COMPANY, customer_id: FR_CUSTOMER, task_type: 'custody05_foreign', status: 'open', priority: 'normal', title: name, metadata: { tag: FR_TAG } })
      rec.statuses.push(ins.status); rec.insertMs = ins.ms
      rec.id = Array.isArray(ins.json) && ins.json[0] ? ins.json[0].id : null
      if (!rec.id) throw new Error('insert: ' + ins.status + ' ' + ins.text.slice(0, 300))
      const sel = await call('GET', 'customer_operation_tasks?id=eq.' + rec.id + '&select=id,title,company_id')
      rec.statuses.push(sel.status); rec.selectMs = sel.ms
      if (!Array.isArray(sel.json) || sel.json.length !== 1 || sel.json[0].title !== name) throw new Error('select: ' + sel.status + ' ' + sel.text.slice(0, 300))
      const upd = await call('PATCH', 'customer_operation_tasks?id=eq.' + rec.id, { status: 'in_progress', title: name + ':u' })
      rec.statuses.push(upd.status); rec.updateMs = upd.ms
      if (!Array.isArray(upd.json) || upd.json.length !== 1 || upd.json[0].title !== name + ':u') throw new Error('update: ' + upd.status + ' ' + upd.text.slice(0, 300))
      rec.ok = rec.statuses.every((s) => s >= 200 && s < 300)
    } catch (e) { rec.error = String(e && e.message || e) }
    rec.t1 = Date.now()
    fs.appendFileSync(FR_FILE, JSON.stringify(rec) + '\\n')
    await new Promise((res) => setTimeout(res, Number(FR_INTERVAL)))
  }
})()
`

export function startForeignRun(o: { companyId: string; customerId: string; accessToken: string; tag: string; intervalMs?: number }) {
  const file = join(custodyDir('foreign'), `${o.tag}.jsonl`)
  writeFileSync(file, '', { mode: 0o600 })
  const child = spawn(process.execPath, ['-e', CHILD], {
    stdio: 'ignore',
    env: { ...process.env, FR_BASE: env('NEXT_PUBLIC_SUPABASE_URL'), FR_ANON: env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), FR_TOKEN: o.accessToken, FR_COMPANY: o.companyId, FR_CUSTOMER: o.customerId, FR_FILE: file, FR_TAG: o.tag, FR_INTERVAL: String(o.intervalMs ?? 100) },
  })
  const read = (): ForeignIteration[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as ForeignIteration)
  return {
    file, read,
    waitForFirst: async (n: number, timeoutMs = 20_000) => { const end = Date.now() + timeoutMs; while (read().length < n && Date.now() < end) await new Promise((r) => setTimeout(r, 200)); return read() },
    stop: async () => {
      const exited = new Promise((res) => child.once('exit', res))
      child.kill('SIGTERM')
      await Promise.race([exited, new Promise((res) => setTimeout(res, 20_000))])
      if (child.exitCode === null) child.kill('SIGKILL')
      return read()
    },
  }
}

export const overlaps = (it: ForeignIteration, w: { start: number; end: number }) => it.t0 <= w.end && it.t1 >= w.start
export const maxOpMs = (it: ForeignIteration) => Math.max(it.insertMs, it.selectMs, it.updateMs)
