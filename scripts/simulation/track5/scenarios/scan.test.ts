// executionScope: ISOLATED_NATIVE
// masterplan-sim: AUTH01.06
// Spår 5, AUTH01.06 "Service-role nyckel exponeras inte i klient/kvittoutdata": körs SIST, efter alla andra
// scenariofiler, och skannar hela körningens kvittoutdata (rapporter, kvitton, run- och vitest-loggar i
// evidenskatalogen inklusive tidigare försök), stackens rapport- och loggkataloger och spårets paketkatalog i
// körkatalogen efter nyckelns värde och efter JWT-/tokenmönster. Paketen skrivs efter körningarna, så skanningen körs om
// efter packet.py med SIM_PACKETS_DIR satt till den levererade paketkatalogen (runs/<run>/claude-track5).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireEnv, SIM_HOME } from '../lib'
import { receipt } from '../lib/receipts'

const TOKEN_PATTERNS: [string, RegExp][] = [
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['partner-token', /\bgdxp_[0-9a-f]{7}\.[A-Za-z0-9_-]{20,}/],
  ['svix-secret', /\bwhsec_[A-Za-z0-9+/=]{20,}/],
  ['sb-cookie', /sb-[a-z0-9-]+-auth-token=/],
]

function scan(dir: string, needles: string[], opts: { tokens: boolean }) {
  let files = 0, bytes = 0
  const hits: { file: string; kind: string }[] = []
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
      if (!e.isFile()) continue
      const body = fs.readFileSync(p, 'latin1')
      files++; bytes += body.length
      for (const n of needles) if (body.includes(n)) hits.push({ file: path.relative(dir, p), kind: 'service-role' })
      if (opts.tokens) for (const [kind, re] of TOKEN_PATTERNS) if (re.test(body)) hits.push({ file: path.relative(dir, p), kind })
    }
  }
  walk(dir)
  return { dir, files, bytes, hits }
}

describe('AUTH01.06 kvittoutdata', () => {
  it('AUTH01.06 kvittoutdata efter alla körningar innehåller inte service-role-nyckeln eller tokens', () => {
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const evidence = path.dirname(process.env.SIM_RECEIPTS ?? '')
    const runDir = process.env.RUN_DIR ?? '/root/sim/track5'
    const packets = process.env.SIM_PACKETS_DIR || path.join(runDir, 'quality/simulation-campaign/20261029-3f1a8ab1/runs')
    // Kvittoutdata som publiceras eller delas: evidenskatalogen (rapporter, kvitton, loggar) och paketen. Där krävs
    // även frånvaro av tokenmönster. Stackens råa app-/run-loggar är privata men skannas också efter nyckeln.
    const results = [
      scan(evidence, [service], { tokens: true }),
      scan(packets, [service], { tokens: true }),
      scan(path.join(SIM_HOME, 'reports'), [service], { tokens: true }),
      scan(path.join(SIM_HOME, 'logs'), [service], { tokens: false }),
    ]
    receipt('AUTH01.06', 'post-run scan', { scans: results.map((r) => ({ dir: r.dir, files: r.files, bytes: r.bytes, hits: r.hits })) })
    const ev = results[0]
    // Kontroll att skanningen ser hela körningen: övriga scenariofilers rapporter och kvitton finns.
    const names = fs.readdirSync(evidence)
    for (const group of ['auth01', 'api01', 'api01-poa', 'event01']) {
      expect(names, `rapport för ${group}`).toContain(`${group}-report.json`)
      expect(names, `kvitton för ${group}`).toContain(`${group}-report.receipts.jsonl`)
    }
    expect(ev.files).toBeGreaterThanOrEqual(8)
    expect(results[1].files, 'paketkatalogen').toBeGreaterThan(0)
    if (process.env.SIM_PACKETS_DIR) {
      // Den levererade paketkatalogen: ett status.json per ID i spåret och FINDINGS.md.
      const ids = fs.readdirSync(packets, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(packets, e.name, 'status.json')))
      expect(ids.length, 'status.json per ID').toBe(16)
      expect(fs.existsSync(path.join(packets, 'FINDINGS.md')), 'FINDINGS.md').toBe(true)
    }
    for (const r of results) expect(r.hits, `träffar i ${r.dir}`).toEqual([])
  })
})
