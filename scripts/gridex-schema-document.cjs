// Shared input contract for parity and canonical schema fingerprints.
// Empty object lists are valid; missing lists or missing requested schemas are not.
const fields = {
  relations: 'nspname relname relkind relrowsecurity relforcerowsecurity view_definition partition_key',
  columns: 'nspname relname attnum attname data_type udt_name is_nullable column_default identity generated',
  enums: 'nspname typname enumlabel enumsortorder',
  constraints: 'nspname relname conname contype definition convalidated',
  indexes: 'nspname relname indexname definition indisunique indisprimary',
  functions: 'nspname proname identity_arguments arguments return_type security_definer volatility kind body_md5',
  triggers: 'nspname relname tgname definition enabled',
  policies: 'nspname relname polname command permissive using_expression check_expression roles',
  relation_grants: 'nspname relname grantee privilege_type',
  function_grants: 'nspname proname identity_arguments grantee privilege_type',
  schema_grants: 'nspname grantee privilege_type',
  extensions: 'extname extversion nspname',
}

function validateSchemaDocument(document, requestedSchemas) {
  const reject = detail => { throw new Error(`incomplete schema introspection: ${detail}`) }
  if (!document || typeof document !== 'object' || Array.isArray(document)) reject('expected object')
  if (!Array.isArray(requestedSchemas) || requestedSchemas.length === 0) reject('no requested schemas')
  if (!Array.isArray(document.schemas) || document.schemas.some(name => typeof name !== 'string')) {
    reject('schemas must be an array of names')
  }
  if (new Set(document.schemas).size !== document.schemas.length ||
      JSON.stringify([...document.schemas].sort()) !== JSON.stringify([...new Set(requestedSchemas)].sort())) {
    reject('requested schemas are missing or unexpected schemas were returned')
  }
  for (const [section, required] of Object.entries(fields)) {
    if (!Array.isArray(document[section])) reject(`${section} must be an array`)
    for (const [index, row] of document[section].entries()) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) reject(`${section}[${index}] must be an object`)
      for (const field of required.split(' ')) {
        if (!Object.hasOwn(row, field)) reject(`${section}[${index}].${field} missing`)
      }
    }
  }
  return document
}

module.exports = { validateSchemaDocument }
