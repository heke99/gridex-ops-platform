'use strict'

// Recovery metadata is private. Only actual source privileges missing from
// these five observed vendor bootstrap objects may be replayed. No other
// catalog divergence, changed grant option, owner or grant chain is accepted.
const fs = require('node:fs')
const path = require('node:path')
const { compare } = require('./tenantservice-restore-catalog-diagnostic.cjs')
const objects = new Map([
  ['relation|extensions|geography_columns', 'relation:v'],
  ['relation|extensions|geometry_columns', 'relation:v'],
  ['relation|extensions|spatial_ref_sys', 'relation:r'],
  ['schema|graphql|graphql', 'schema'],
  ['schema|graphql_public|graphql_public', 'schema'],
])
const aclKeys = ['arguments', 'column_name', 'grantee', 'grantor', 'is_grantable', 'kind', 'object_name', 'privilege_type', 'schema_name']
const canonical = value => JSON.stringify(value, function (_key, current) {
  return current && typeof current === 'object' && !Array.isArray(current)
    ? Object.fromEntries(Object.keys(current).sort().map(key => [key, current[key]])) : current
})
const quoteIdentifier = value => '"' + value.replace(/"/g, '""') + '"'
const quoteLiteral = value => "'" + value.replace(/'/g, "''") + "'"
function catalogQuery() {
  const source = fs.readFileSync(path.join(__dirname, 'sql/tenantservice-restore-data-fingerprint.sql'), 'utf8')
  const begin = source.indexOf('with namespaces as (')
  const end = source.indexOf("select case when :'tenantservice_catalog_is_detail'::boolean", begin)
  if (begin < 0 || end < begin) throw new Error('catalog_query_boundary_invalid')
  return source.slice(begin, end)
}
function planBootstrapAclRestore(before, after) {
  for (const document of [before, after]) {
    if (!document || Object.keys(document).sort().join('|') !== 'acl|defaultAcl|owners'
      || !['owners', 'acl', 'defaultAcl'].every(key => Array.isArray(document[key]))) throw new Error('catalog_shape_invalid')
    for (const row of document.acl) {
      if (!row || Object.keys(row).sort().join('|') !== aclKeys.join('|')
        || aclKeys.filter(key => key !== 'is_grantable').some(key => typeof row[key] !== 'string')
        || typeof row.is_grantable !== 'boolean') throw new Error('acl_shape_invalid')
    }
  }
  const differences = compare(before, after)
  if (differences.some(change => change.category !== 'acl')) throw new Error('owner_or_default_acl_divergence')
  const grants = []
  for (const difference of differences) {
    const key = `${difference.kind}|${difference.schema}|${difference.object}`
    const ownerKind = objects.get(key)
    if (!ownerKind || difference.column || difference.argumentsSha256 !== '12ae32cb1ec02d01eda3581b127c1fee3b0dc53572ed6baf239721a03d82e126') {
      throw new Error('unexpected_catalog_divergence')
    }
    const owns = document => document.owners.filter(row => row.kind === ownerKind && row.schema_name === difference.schema
      && row.object_name === difference.object && row.arguments === '')
    const sourceOwners = owns(before), targetOwners = owns(after)
    if (sourceOwners.length !== 1 || targetOwners.length !== 1 || typeof sourceOwners[0].owner_name !== 'string'
      || sourceOwners[0].owner_name !== targetOwners[0].owner_name) throw new Error('object_owner_or_kind_invalid')
    const select = document => document.acl.filter(row => row.kind === difference.kind && row.schema_name === difference.schema
      && row.object_name === difference.object && row.arguments === '' && row.column_name === '')
    const sourceRows = select(before), targetRows = select(after)
    if (sourceRows.length !== difference.beforeCount || targetRows.length !== difference.afterCount) throw new Error('object_identity_invalid')
    const sourceSet = new Set(sourceRows.map(canonical)), targetSet = new Set(targetRows.map(canonical))
    if (sourceSet.size !== sourceRows.length || targetSet.size !== targetRows.length
      || targetRows.some(row => !sourceSet.has(canonical(row)))) throw new Error('extra_target_or_changed_grant_option')
    const owner = sourceOwners[0].owner_name
    if ([...sourceRows, ...targetRows].some(row => row.grantor !== owner)) throw new Error('unsupported_nonowner_grant_chain')
    const privileges = difference.kind === 'schema' ? ['USAGE', 'CREATE'] : ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    for (const row of sourceRows) {
      if (!privileges.includes(row.privilege_type) || !row.grantee || row.grantee.includes('\0') || owner.includes('\0')) throw new Error('privilege_invalid')
      if (targetSet.has(canonical(row))) continue
      const object = difference.kind === 'schema' ? quoteIdentifier(difference.schema)
        : `${quoteIdentifier(difference.schema)}.${quoteIdentifier(difference.object)}`
      const grantee = row.grantee === 'PUBLIC' ? 'PUBLIC' : quoteIdentifier(row.grantee)
      grants.push(`SET LOCAL ROLE ${quoteIdentifier(owner)};\nGRANT ${row.privilege_type} ON ${difference.kind === 'schema' ? 'SCHEMA' : 'TABLE'} ${object} TO ${grantee}${row.is_grantable ? ' WITH GRANT OPTION' : ''};\nRESET ROLE;`)
    }
  }
  // Recheck the complete target catalog inside the transaction before any
  // GRANT. The caller also re-proves the sole disposable administrator and OID.
  const target = JSON.stringify(after)
  let tagIndex = 0, tag = '$bootstrap_acl_guard_0$'
  while (target.includes(tag)) tag = `$bootstrap_acl_guard_${++tagIndex}$`
  const sql = grants.length ? `BEGIN;\nDO ${tag}\nDECLARE actual jsonb;\nBEGIN\n${catalogQuery()}SELECT body INTO actual FROM payload;\nIF actual IS DISTINCT FROM ${quoteLiteral(target)}::jsonb THEN\n RAISE EXCEPTION 'restore_bootstrap_target_catalog_changed';\nEND IF;\nEND\n${tag};\n${grants.join('\n')}\nCOMMIT;\n` : ''
  return { sql, missingPrivileges: grants.length, changedObjects: differences.length }
}
if (require.main === module) {
  try {
    if (process.argv.length !== 5 || process.env.CI !== 'true' || !process.env.RUNNER_TEMP) throw new Error('private_boundary_required')
    const files = process.argv.slice(2).map(filename => path.resolve(filename))
    const directory = path.dirname(files[0])
    if (!files.every(filename => path.dirname(filename) === directory)
      || path.dirname(directory) !== path.resolve(process.env.RUNNER_TEMP)
      || !/^tenantservice-upgrade-restore\.[A-Za-z0-9]+$/.test(path.basename(directory))) throw new Error('private_boundary_required')
    const documents = files.slice(0, 2).map(filename => JSON.parse(fs.readFileSync(filename, 'utf8')))
    const plan = planBootstrapAclRestore(...documents)
    fs.writeFileSync(files[2], plan.sql, { mode: 0o600, flag: 'wx' })
    console.log(`TENANTSERVICE_RESTORE_BOOTSTRAP_ACL_PLAN objects=${plan.changedObjects} missingPrivileges=${plan.missingPrivileges}`)
  } catch {
    console.error('TENANTSERVICE_RESTORE_BOOTSTRAP_ACL_UNSUPPORTED')
    process.exitCode = 1
  }
}
module.exports = { planBootstrapAclRestore }
