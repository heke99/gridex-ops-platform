/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/reality/simulators/smimeUnwrap.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// A counterparty reads what the platform sends in production: S/MIME enveloped to its receiver certificate
// (lib/ediel/transport, smime-type=enveloped-data). The certificate directory simulator issues each actor's
// certificate and key (scripts/reality/simulators/certificateDirectory.ts, actor-<EdielId>.key in its working
// directory); the simulated counterparty decrypts with that key, as the real one does with its own. Plain mail
// (test environment) is returned unchanged.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Every key directory the certificate directory simulator ever issued for this actor, newest first. */
function actorKeyDirectories(edielId: string) {
  return readdirSync(tmpdir())
    .filter(name => name.startsWith('reality-ldap-ca-'))
    .map(name => join(tmpdir(), name))
    .filter(dir => existsSync(join(dir, `actor-${edielId}.key`)) && existsSync(join(dir, `actor-${edielId}.pem`)))
    .sort((a, b) => statSync(join(b, `actor-${edielId}.pem`)).mtimeMs - statSync(join(a, `actor-${edielId}.pem`)).mtimeMs)
}

/** The readable MIME text of a received mail; decrypts S/MIME enveloped data with the actor's own key. */
export function unwrapSmimeForActor(source: Buffer, edielId: string): string {
  const text = source.toString('utf8')
  const head = text.split(/\r?\n\r?\n/)[0] ?? ''
  if (!/content-type:\s*application\/(x-)?pkcs7-mime/i.test(head)) return text
  // A world restart issues a new certificate, but the platform keeps the earlier ones active and earlier tenants'
  // routes pin them. Like a real actor during a certificate rollover, the counterparty still holds its earlier keys
  // (FINDINGS A-B3), newest first.
  const keyDirs = actorKeyDirectories(edielId)
  if (!keyDirs.length) throw new Error(`smime_receiver_key_missing:${edielId}`)
  const work = mkdtempSync(join(tmpdir(), 'reality-smime-'))
  try {
    writeFileSync(join(work, 'mail.eml'), source)
    let lastError: unknown = null
    let decrypted = false
    for (const keyDir of keyDirs) {
      try {
        execFileSync('openssl', ['cms', '-decrypt', '-in', join(work, 'mail.eml'), '-inkey', join(keyDir, `actor-${edielId}.key`),
          '-recip', join(keyDir, `actor-${edielId}.pem`), '-out', join(work, 'inner.eml')], { stdio: ['ignore', 'pipe', 'pipe'] })
        decrypted = true
        break
      } catch (error) { lastError = error }
    }
    if (!decrypted) throw lastError
    let inner = readFileSync(join(work, 'inner.eml'))
    // A signed inner layer (pkcs7 signed-data) carries the content inside the signature.
    if (/content-type:\s*application\/(x-)?pkcs7-mime[^\r\n]*signed-data/i.test(inner.toString('utf8').split(/\r?\n\r?\n/)[0] ?? '')) {
      execFileSync('openssl', ['cms', '-verify', '-noverify', '-in', join(work, 'inner.eml'), '-out', join(work, 'content.eml')], { stdio: ['ignore', 'pipe', 'pipe'] })
      inner = readFileSync(join(work, 'content.eml'))
    }
    return inner.toString('utf8')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
