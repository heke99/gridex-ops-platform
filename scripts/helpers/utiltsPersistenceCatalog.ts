import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { expect } from 'vitest'

// Shared by the UTILTS native consumption suite: checksum-bound committed
// migration bodies and the installed persistence catalog receipt shape.
export function committedPersistenceBody(revision: string, migration: string, functionName: string,
  manifestName = 'migration-history-manifest.json') {
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/${manifestName}`], { encoding: 'utf8' })) as { files: Record<string, string> }
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

function sc046ExpectedWrapperBody(baseBody: string, migrationSource: string): string {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  if (hash(migrationSource) !== '84602eca793c51180d838679e8019001bc0e9f1d82e2e6e8861ca2d404de5b34') {
    throw Error('native_sc046_migration_checksum_conflict')
  }
  if (hash(baseBody) !== 'd1072ccfd2c9ed9d7edd8e4bf780c0809bb4d904fe61a579be5239dfa6f220b1') {
    throw Error('native_sc046_predecessor_conflict')
  }
  const block = (name: 'declarations' | 'classification') => {
    const start = `${name} text := $${name}$`, end = `$${name}$;`
    if (migrationSource.split(start).length !== 2 || migrationSource.split(end).length !== 2) {
      throw Error('native_sc046_block_conflict')
    }
    const at = migrationSource.indexOf(start) + start.length, stop = migrationSource.indexOf(end, at)
    if (stop < at) throw Error('native_sc046_block_conflict')
    return migrationSource.slice(at, stop)
  }
  const declarationAnchor = 'DECLARE source public.ediel_messages%rowtype;result jsonb;'
  const returnAnchor = ' -- The preserved owner may wait on its source/advisory locks.'
  const declarations = block('declarations'), classification = block('classification')
  if (baseBody.split(declarationAnchor).length !== 2 || baseBody.split(returnAnchor).length !== 2 || baseBody.includes('sc046_')) {
    throw Error('native_sc046_anchor_conflict')
  }
  // Callback replacements keep every literal $ inside the PL/pgSQL untouched.
  const body = baseBody.replace(declarationAnchor, () => declarationAnchor + declarations)
    .replace(returnAnchor, () => classification + returnAnchor)
  const inverse = body.replace(declarationAnchor + declarations, () => declarationAnchor).replace(classification, () => '')
  if (inverse !== baseBody || inverse.replace(declarationAnchor, () => declarationAnchor + declarations)
    .replace(returnAnchor, () => classification + returnAnchor) !== body) throw Error('native_sc046_inverse_conflict')
  return body
}
export function committedSc046ReturnStateBody(revision: string, base: { body: string; migrationHash: string }) {
  const migration = '20261013141048_ediel_sc046_persistence_return_state_cb17b044.sql'
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/migration-history-manifest.json`], { encoding: 'utf8' })) as { files: Record<string, string> }
  const migrationHash = createHash('sha256').update(source).digest('hex')
  expect(migrationHash, migration).toBe(manifest.files[migration])
  return { body: sc046ExpectedWrapperBody(base.body, source), migrationHash }
}
export function committedDurableE66WrapperBody(revision: string, predecessorBody: string) {
  const migration = '20261123203100_install_durable_e66_work_and_cutover.sql'
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/migration-history-manifest.additions.json`], { encoding: 'utf8' })) as { files: Record<string, string> }
  const migrationHash = createHash('sha256').update(source).digest('hex')
  expect(migrationHash, migration).toBe(manifest.files[migration])
  const owners = [...source.matchAll(/DO \$migration\$([\s\S]*?)END\n\$migration\$;/g)]
    .map(match => match[1])
    .filter(block => block.includes("owned_signature constant text := 'FUNCTION gridex_e66_intake.persist_owned_utilts_v1('"))
  expect(owners, migration).toHaveLength(1)
  const predecessorHash = owners[0].match(/md5\(original\.prosrc\) IS DISTINCT FROM '([0-9a-f]{32})'/)?.[1]
  expect(createHash('md5').update(predecessorBody).digest('hex'), 'durable cutover predecessor').toBe(predecessorHash)
  const bodies = [...owners[0].matchAll(/public_body constant text := \$body\$([\s\S]*?)\$body\$;/g)]
  expect(bodies, migration).toHaveLength(1)
  return { migration, migrationHash, body: bodies[0][1] }
}
export function committedSg11E66WrapperBody(revision: string, baseBody: string) {
  const migration = '20261124152200_hold_e66_sg11_timestamp_for_review.sql'
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/migration-history-manifest.additions.json`], { encoding: 'utf8' })) as { files: Record<string, string> }
  const migrationHash = createHash('sha256').update(source).digest('hex')
  expect(migrationHash, migration).toBe(manifest.files[migration])

  const owner = "owner:='public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb,uuid)'::regprocedure;"
  const owners = [...source.matchAll(/DO \$owners\$([\s\S]*?)\$owners\$;/g)]
  expect(owners, migration).toHaveLength(1)
  const blocks = owners[0][1].split(owner)
  expect(blocks, `${migration}:public wrapper`).toHaveLength(2)
  const block = blocks[1].split("\n owner:=")[0]
  const guardHash = block.match(/encode\(sha256\(convert_to\(body,'UTF8'\)\),'hex'\)<>'([0-9a-f]{64})'/)?.[1]
  const prefix = block.match(/prefix:='([^']+)';/)?.[1]
  const transition = block.match(/transition:=\$write\$([\s\S]+?)\$write\$;/)?.[1]
  if (!guardHash || !prefix || !transition
    || !block.includes('EXECUTE replace(definition,body,replace(body,prefix,transition||prefix));')) {
    throw Error('native_e66_sg11_wrapper_source_chain_conflict')
  }
  expect(createHash('sha256').update(baseBody).digest('hex'), `${migration}:predecessor`).toBe(guardHash)
  expect(baseBody.split(prefix), `${migration}:replacement anchor`).toHaveLength(2)
  return { migration, migrationHash, body: baseBody.replace(prefix, () => transition + prefix) }
}
export function committedMixedE66SealBody(revision: string, baseBody: string) {
  const migration = '20261125100114_bound_mixed_e66_e73_coverage_revalidation.sql'
  const source = execFileSync('git', ['show', `${revision}:supabase/migrations/${migration}`], { encoding: 'utf8' })
  const manifest = JSON.parse(execFileSync('git', ['show', `${revision}:scripts/migration-history-manifest.additions.json`], { encoding: 'utf8' })) as { files: Record<string, string> }
  const migrationHash = createHash('sha256').update(source).digest('hex')
  expect(migrationHash, migration).toBe(manifest.files[migration])

  const target = "target regprocedure:='gridex_e66_intake.seal_mixed_billing_multisource_coverage_v1(uuid,uuid,uuid)';"
  const patches = [...source.matchAll(/DO \$patch\$([\s\S]*?)\$patch\$;/g)].map(match => match[1])
    .filter(block => block.includes(target))
  expect(patches, migration).toHaveLength(1)
  const block = patches[0]
  const guardHash = block.match(/encode\(sha256\(convert_to\(original\.prosrc,'UTF8'\)\),'hex'\) <> '([0-9a-f]{64})'/)?.[1]
  const previous = block.match(/previous constant text:=\$previous\$([\s\S]+?)\$previous\$;/)?.[1]
  const replacement = block.match(/replacement constant text:=\$replacement\$([\s\S]+?)\$replacement\$;/)?.[1]
  if (!guardHash || !previous || !replacement || !block.includes('changed:=replace(original.prosrc,previous,replacement);')) {
    throw Error('native_mixed_e66_seal_source_chain_conflict')
  }
  expect(createHash('sha256').update(baseBody).digest('hex'), `${migration}:predecessor`).toBe(guardHash)
  expect(baseBody.split(previous), `${migration}:replacement anchor`).toHaveLength(2)
  return baseBody.replace(previous, () => replacement)
}
function s01AreaExpectedPrecisionBody(baseBody: string, source: string) {
  const signature='gridex_utilts_binding.persist_consumption_before_precision_v1(uuid,text,uuid,text,text,jsonb)'
  const patches=[...source.matchAll(/DO \$patch\$([\s\S]*?)END \$patch\$;/g)]
    .map(match=>match[1]).filter(block=>block.includes("pg_get_functiondef('"+signature+"'::regprocedure)"))
  if (patches.length!==1) throw Error('native_s01_precision_patch_identity_conflict')
  const block=patches[0],old=block.match(/old_body:=\$old\$([\s\S]*?)\$old\$/)?.[1],next=block.match(/new_body:=\$new\$([\s\S]*?)\$new\$/)?.[1]
  if (!old||!next||old!==baseBody
    ||createHash('sha256').update(old).digest('hex')!=='ac53c3f07f74dc8829e4b5d8d6407c7b96f57f5a8c4d44147ab660b62c06c892'
    ||createHash('sha256').update(next).digest('hex')!=='347be38f343292dc1993b506b9d30fc359e8688f5a9103cc411f524538c72f4a'
    ||!block.includes('EXECUTE replace(ddl,old_body,new_body);')
    ||!block.includes("<>'"+'347be38f343292dc1993b506b9d30fc359e8688f5a9103cc411f524538c72f4a'+"'")) {
    throw Error('native_s01_precision_source_chain_conflict')
  }
  return next
}
export function committedS01AreaPrecisionBody(revision: string, base: {body: string; migrationHash: string}) {
  const migration='20261023201053_ediel_s01_area_aggregate_identity.sql'
  const source=execFileSync('git',['show',`${revision}:supabase/migrations/${migration}`],{encoding:'utf8'})
  // This new forward is outside the frozen historical manifest. Bind its
  // entire committed file explicitly; the predecessor remains manifest-bound.
  const migrationHash=createHash('sha256').update(source).digest('hex')
  expect(migrationHash,migration).toBe('ae647d1d240a2e3cfa202906766eed3b13f6d5d15a0afd14885fe36b63da4a5d')
  return {body:s01AreaExpectedPrecisionBody(base.body,source),migrationHash}
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
