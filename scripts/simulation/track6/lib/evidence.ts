// Evidens till SIM_HOME/evidence/<run-id>/<scenario>/ med sha256-manifest och observations.json.
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export class Evidence {
  readonly dir: string
  readonly observations: Record<string, unknown> = {}
  constructor(dir = process.env.T6_EVIDENCE_DIR ?? join(process.env.T6_SIM_HOME ?? '/tmp', 'evidence', 'adhoc')) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
  }
  /** Spara en fil (Buffer eller JSON-serialiserbart värde). */
  save(name: string, data: Buffer | string | unknown): string {
    const path = join(this.dir, name)
    mkdirSync(dirname(path), { recursive: true })
    const payload = Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(data) : Buffer.from(JSON.stringify(data, null, 2))
    writeFileSync(path, payload, { mode: 0o600 })
    return path
  }
  /** Registrera ett observerat utfall (loggas i rapporten, asserteras inte). */
  observe(key: string, value: unknown) { this.observations[key] = value }
  /** Skriv observations.json + MANIFEST.sha256 över alla filer. */
  finalize(): string {
    writeFileSync(join(this.dir, 'observations.json'), JSON.stringify(this.observations, null, 2), { mode: 0o600 })
    const lines: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(d).sort()) {
        const p = join(d, e)
        if (statSync(p).isDirectory()) walk(p)
        else if (e !== 'MANIFEST.sha256') lines.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(this.dir, p)}`)
      }
    }
    walk(this.dir)
    const manifest = join(this.dir, 'MANIFEST.sha256')
    writeFileSync(manifest, lines.join('\n') + '\n', { mode: 0o600 })
    return manifest
  }
}
