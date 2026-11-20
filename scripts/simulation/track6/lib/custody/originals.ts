// Import av T3:s kohort B (originals-for-t6) OFÖRÄNDRAD. Inga bytes finns i denna repo: filerna läses vid körning med
// `git show <commit>:<path>` ur git-objektlagret, skrivs till SIM_HOME och verifieras mot manifestets sha256 (hårt fel vid avvikelse).
// Peket: fixtures/t3-originals/source.json.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { custodyDir, sha256 } from './base'

const here = fileURLToPath(new URL('.', import.meta.url))
export type OriginalsPointer = { commit: string; dir: string; run: string; expectedInboundEml: number; manifest: string }
export const pointer = (): OriginalsPointer => JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 't3-originals', 'source.json'), 'utf8')) as OriginalsPointer

type ManifestFile = { run: string; relPath: string; published: { path: string; sha256: string; bytes: number }; original: { sha256: string; bytes: number } }
export type Original = { relPath: string; sha256: string; bytes: number; file: string; data: Buffer }

function gitRepos(): string[] {
  const top = spawnSync('git', ['-C', here, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
  return [process.env.T6_ORIGINALS_REPO, process.env.SIM_RUN_DIR, top].filter((x): x is string => !!x && existsSync(x))
}
function gitShow(repo: string, commit: string, path: string): Buffer | null {
  const r = spawnSync('git', ['-C', repo, 'show', `${commit}:${path}`], { maxBuffer: 64_000_000 })
  return r.status === 0 ? r.stdout : null
}

/** Läs manifest + kohort-B-filer ur git, skriv till SIM_HOME/custody/t3-originals/ och verifiera varje sha256. */
export function importOriginals(): { repo: string; commit: string; manifestSha256: string; inbound: Array<{ eml: Original; edi: Original }>; dir: string } {
  const ptr = pointer()
  const repos = gitRepos()
  const repo = repos.find((r) => spawnSync('git', ['-C', r, 'cat-file', '-e', `${ptr.commit}^{commit}`]).status === 0)
  if (!repo) throw new Error(`BLOCKED: commit ${ptr.commit} finns inte i något git-objektlager (${repos.join(', ')}); hämta grenen claude/sim-20261029-track3 i körkatalogen innan körning`)
  const manifestPath = `${ptr.dir}/${ptr.manifest}`
  const manifestBytes = gitShow(repo, ptr.commit, manifestPath)
  if (!manifestBytes) throw new Error(`manifest saknas: ${ptr.commit}:${manifestPath}`)
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as { files: ManifestFile[] }
  const files = manifest.files.filter((f) => f.run === ptr.run && /^inbound\/e66-\d{3}\.(eml|edi)$/.test(f.relPath))
  const out = join(custodyDir('t3-originals'), ptr.run)
  const read = (f: ManifestFile): Original => {
    const data = gitShow(repo, ptr.commit, `${ptr.dir}/${f.published.path}`)
    if (!data) throw new Error(`fil saknas i git: ${ptr.commit}:${ptr.dir}/${f.published.path}`)
    const actual = sha256(data)
    if (actual !== f.original.sha256 || actual !== f.published.sha256 || data.length !== f.original.bytes) {
      throw new Error(`HÅRT FEL: sha256/bytes avviker för ${f.relPath}: ${actual} (${data.length} B) != manifest ${f.original.sha256} (${f.original.bytes} B)`)
    }
    const file = join(out, f.relPath)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, data, { mode: 0o600 })
    return { relPath: f.relPath, sha256: actual, bytes: data.length, file, data }
  }
  const byBase = new Map<string, { eml?: Original; edi?: Original }>()
  for (const f of files) {
    const base = f.relPath.replace(/\.(eml|edi)$/, '')
    const e = byBase.get(base) ?? {}
    e[f.relPath.endsWith('.eml') ? 'eml' : 'edi'] = read(f)
    byBase.set(base, e)
  }
  const inbound = [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([base, v]) => {
    if (!v.eml || !v.edi) throw new Error(`par saknas för ${base}`)
    return { eml: v.eml, edi: v.edi }
  })
  if (inbound.length !== ptr.expectedInboundEml) throw new Error(`förväntade ${ptr.expectedInboundEml} inbound .eml, fick ${inbound.length}`)
  return { repo: resolve(repo), commit: ptr.commit, manifestSha256: sha256(manifestBytes), inbound, dir: out }
}
