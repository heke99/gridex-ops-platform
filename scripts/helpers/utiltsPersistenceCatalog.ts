import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { expect } from 'vitest'

// Shared by the UTILTS native consumption suite: checksum-bound committed
// migration bodies and the installed persistence catalog receipt shape.
export function committedPersistenceBody(revision: string, migration: string, functionName: string) {
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/migration-history-manifest.json`], { encoding: 'utf8' })) as { files: Record<string, string> }
  expect(createHash('sha256').update(source).digest('hex'), migration).toBe(manifest.files[migration])
  // This extracts one specifically named, checksum-bound migration body. It
  // never treats a search of the installed catalog as dependency proof.
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const headers = [...source.matchAll(new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escapedName}\\s*\\(`, 'gi'))]
  expect(headers, `${migration}:${functionName}`).toHaveLength(1)
  const afterHeader = source.slice(headers[0].index)
  const delimiter = afterHeader.match(/\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)
  expect(delimiter, `${migration}:${functionName}:body delimiter`).not.toBeNull()
  const bodyStart = delimiter!.index! + delimiter![0].length
  const bodyEnd = afterHeader.indexOf(delimiter![0], bodyStart)
  expect(bodyEnd, `${migration}:${functionName}:body end`).toBeGreaterThan(bodyStart)
  return { body: afterHeader.slice(bodyStart, bodyEnd), migrationHash: createHash('sha256').update(source).digest('hex') }
}

// A later checksum-bound migration may rewrite a body by exact needle/replace
// pairs (each needle must occur exactly once, as the migration itself enforces).
// The expected installed body is the committed base body with those same pairs.
export function committedPatchedBody(revision: string, base: { body: string; migrationHash: string }, migration: string, block: string) {
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/migration-history-manifest.json`], { encoding: 'utf8' })) as { files: Record<string, string> }
  expect(createHash('sha256').update(source).digest('hex'), migration).toBe(manifest.files[migration])
  const tag = `$${block}$`
  const start = source.indexOf(tag)
  const end = source.indexOf(tag, start + tag.length)
  expect(start >= 0 && end > start, `${migration}:${block}`).toBe(true)
  const pairs = [...source.slice(start, end).matchAll(/ARRAY\[\$n\$([\s\S]*?)\$n\$,\$n\$([\s\S]*?)\$n\$\]/g)]
  expect(pairs.length, `${migration}:${block}:pairs`).toBeGreaterThan(0)
  let body = base.body
  for (const [, needle, replacement] of pairs) {
    expect(body.split(needle).length - 1, `${migration}:${block}:needle`).toBe(1)
    body = body.replace(needle, () => replacement)
  }
  return { body, migrationHash: createHash('sha256').update(source).digest('hex') }
}

export type PersistenceCatalogFunction = {
  oid: number; signature: string; name: string; schema: string; owner: string; language: string;
  securityDefiner: boolean; kind: string; config: string[] | null; argumentNames: string[] | null;
  defaultCount: number; defaults: string | null; source: string; definition: string | null; publicExecute: boolean;
  acl: { grantee: string; privilege: string; grantable: boolean }[];
}
export type PersistenceCatalogRole = {
  root: string; effectiveRole: string; superuser: boolean; createRole: boolean;
  inheritedPrivileges: boolean; setRoleAllowed: boolean; setRolePath: string[];
}
export type PersistenceCatalogDependency = {
  targetOid: number; target: string; classOid: number; objectOid: number; subId: number;
  kind: string; description: string; functionSignature: string | null; path: string[];
}
export type PersistenceCatalogReceipt = {
  serverVersion: string; serverVersionNumber: string; database: string; capturedAt: string;
  databaseIdentity: { systemIdentifier: string; databaseOid: string; serverAddress: string; serverPort: number; postmasterStartedAt: string };
  roles: PersistenceCatalogRole[]; roleMemberships: Record<string, unknown>[];
  functions: PersistenceCatalogFunction[];
  roleMatrix: { root: string; effectiveRole: string; signature: string; execute: boolean; schemaUsage: boolean }[];
  dependencies: PersistenceCatalogDependency[]; triggers: Record<string, unknown>[]; policies: Record<string, unknown>[];
  migrations: { version: string; name: string }[];
}
