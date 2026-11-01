import { createHash } from 'node:crypto'
import fs from 'node:fs'

// Säkra stegkvitton per scenario-ID (JSONL i SIM_RECEIPTS, satt av run.sh bredvid rapporten).
// Bara status, sha256, publika/syntetiska ID:n och räknare; aldrig tokens, cookies, secrets eller kroppar i klartext.

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

export function receipt(scenarioId: string, step: string, data: Record<string, unknown>): void {
  const file = process.env.SIM_RECEIPTS
  if (!file) throw new Error('SIM_RECEIPTS saknas (run.sh sätter den)')
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), scenarioId, step, ...data }) + '\n')
}

/** HTTP-kvitto: status och sha256 av kroppen (kroppen sparas inte). */
export const http = (status: number, body: string) => ({ status, bodySha256: sha256(body) })
