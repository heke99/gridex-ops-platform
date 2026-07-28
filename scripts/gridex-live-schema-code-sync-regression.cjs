const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const migrationPath = path.join(
  root,
  'supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql',
)
const migration = fs.readFileSync(migrationPath, 'utf8')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

const requiredMigrationTokens = [
  'company_onboarding_tasks',
  'communication_log_events',
  'customer_invoices_status_check',
  'customer_invoice_lines',
  'vat_amount',
  'amount_inc_vat',
  'partner_invoice_reference',
  'canonical_public_contract_offers_v',
  'contract_publication_graph_integrity_v',
  'snapshot_hash_valid',
  'energy_direction_valid',
  'contract_type_valid',
  'successor_chain_valid',
  'gridex_retry_website_contract_signature',
  'gridex_end_contract_channel',
  'gridex_onboard_customer_graph_core(jsonb)',
  'gridex_create_invoice_export_graph_v1_core',
  'backfill_customer_sites',
  'backfill_contracts',
  'backfill_customers',
  'backfill_metering_points',
]
for (const token of requiredMigrationTokens) {
  assert(migration.includes(token), `repair migration is missing ${token}`)
}

assert(
  migration.includes(
    'revoke all on function public.gridex_onboard_customer_graph_core(jsonb)',
  ),
  'canonical onboarding core must not be directly executable',
)
assert(
  migration.includes(
    'revoke all on function public.gridex_upsert_internal_contract_offer(',
  ),
  'legacy internal-offer entry point must not be directly executable',
)
assert(
  migration.includes(
    "case when o.valid_to is null then null else (o.valid_to + 1)::timestamptz end",
  ),
  'inclusive date must map to an exclusive next-day timestamp',
)

const quotes = read('lib/pricing/websiteQuotes.ts')
assert(
  !quotes.includes(
    "details: { consumed_application_id: quote.consumed_application_id }",
  ),
  'public quote errors must not leak another application UUID',
)
const onboarding = read('lib/customers/canonicalOnboarding.ts')
assert(
  onboarding.includes("if (code === '42883') return 'canonical_onboarding_dependency_missing'"),
  'nested undefined-function errors must not be mislabeled as a missing wrapper',
)
const contractTypes = read('lib/customer-contracts/types.ts')
assert(
  contractTypes.includes('| "signature_failed"') &&
    contractTypes.includes('| "signature_retry_requested"'),
  'runtime contract lifecycle must include signature failure and retry',
)
const contractActions = read('app/admin/contracts/actions.ts')
assert(
  contractActions.includes('"gridex_end_contract_channel"'),
  'ended channel state must use its terminal RPC',
)
const diagnostics = read(
  'app/api/v1/website/public-contracts/diagnostics/route.ts',
)
assert(
  diagnostics.includes('offer.graph?.canonical_graph_consistent === true') &&
    !diagnostics.includes('canonical_graph_consistent: publication.hidden === 0'),
  'diagnostics must derive graph consistency from graph integrity',
)

function parseSqlString(source, start) {
  let index = start
  while (/\s/.test(source[index])) index += 1
  if (source.startsWith('$$', index)) {
    const end = source.indexOf('$$', index + 2)
    assert(end >= 0, 'unterminated dollar-quoted migration string')
    return [source.slice(index + 2, end), end + 2]
  }
  assert(source[index] === "'", 'expected SQL string in repair helper call')
  index += 1
  let value = ''
  while (index < source.length) {
    if (source[index] === "'") {
      if (source[index + 1] === "'") {
        value += "'"
        index += 2
        continue
      }
      return [value, index + 1]
    }
    value += source[index]
    index += 1
  }
  throw new Error('unterminated SQL string in repair helper call')
}

function repairCalls() {
  const marker = 'select public.gridex__repair_replace_function_text('
  const calls = []
  let position = 0
  while ((position = migration.indexOf(marker, position)) >= 0) {
    let index = position + marker.length
    const values = []
    for (let argument = 0; argument < 3; argument += 1) {
      let value
      ;[value, index] = parseSqlString(migration, index)
      values.push(value)
      while (/\s/.test(migration[index])) index += 1
      if (argument < 2) {
        assert(migration[index] === ',', 'malformed repair helper call')
        index += 1
      }
    }
    calls.push(values)
    position = index
  }
  return calls
}

const auditDir = process.env.GRIDEX_LIVE_AUDIT_DIR
if (auditDir) {
  const schemaPath = path.join(auditDir, '01-live-schema.sql')
  const functionsPath = path.join(auditDir, '02-active-functions.sql')
  const lintPath = path.join(auditDir, '17-live-db-lint.txt')
  assert(fs.existsSync(schemaPath), `missing live schema export: ${schemaPath}`)
  assert(fs.existsSync(functionsPath), `missing live functions export: ${functionsPath}`)
  assert(fs.existsSync(lintPath), `missing live lint export: ${lintPath}`)

  const activeFunctions = fs.readFileSync(functionsPath, 'utf8')
  const states = new Map()
  for (const [signature, oldText, newText] of repairCalls()) {
    const routineName = signature.slice(
      signature.indexOf('.') + 1,
      signature.indexOf('('),
    )
    const header = `-- FUNCTION public.${routineName}(`
    const candidates = []
    let start = 0
    while ((start = activeFunctions.indexOf(header, start)) >= 0) {
      const end = activeFunctions.indexOf('-- FUNCTION public.', start + 5)
      candidates.push(
        activeFunctions.slice(start, end >= 0 ? end : activeFunctions.length),
      )
      start += header.length
    }
    assert(candidates.length > 0, `live function is missing: ${signature}`)
    const argumentText = signature.slice(signature.indexOf('(') + 1, -1)
    const argumentCount = argumentText ? argumentText.split(',').length : 0
    const candidate =
      candidates.find((block) => {
        const firstLine = block.slice(0, block.indexOf('\n'))
        const liveArguments = firstLine.slice(
          firstLine.indexOf('(') + 1,
          firstLine.lastIndexOf(')'),
        )
        const liveCount = liveArguments ? liveArguments.split(',').length : 0
        return liveCount === argumentCount
      }) ?? candidates[0]
    const current = states.get(signature) ?? candidate
    if (current.includes(oldText)) {
      states.set(signature, current.split(oldText).join(newText))
    } else {
      assert(
        current.includes(newText),
        `audited definition mismatch for ${signature}: ${oldText.slice(0, 120)}`,
      )
    }
  }

  const lintRaw = fs.readFileSync(lintPath, 'utf8')
  const jsonStart = lintRaw.indexOf('[')
  assert(jsonStart >= 0, 'live lint JSON was not found')
  const lint = JSON.parse(lintRaw.slice(jsonStart))
  const liveErrors = lint
    .filter((routine) =>
      routine.issues.some((issue) => issue.level === 'error'),
    )
    .map((routine) => routine.function.replace(/^public\./, ''))
  assert(liveErrors.length === 23, `expected 23 audited live errors, got ${liveErrors.length}`)
  for (const routine of liveErrors) {
    assert(
      migration.includes(routine),
      `live lint error has no migration coverage: ${routine}`,
    )
  }

  const liveSchema = fs.readFileSync(schemaPath, 'utf8')
  const relations = new Set(
    [...liveSchema.matchAll(
      /CREATE (?:TABLE|VIEW|MATERIALIZED VIEW) public\.([a-zA-Z0-9_]+)/g,
    )].map((match) => match[1]),
  )
  for (const match of migration.matchAll(
    /create (?:or replace )?(?:table|view|materialized view)(?: if not exists)? public\.([a-zA-Z0-9_]+)/gi,
  )) {
    relations.add(match[1])
  }
  const functions = new Set(
    [...activeFunctions.matchAll(
      /^-- FUNCTION public\.([a-zA-Z0-9_]+)\(/gm,
    )].map((match) => match[1]),
  )
  for (const match of migration.matchAll(
    /create or replace function public\.([a-zA-Z0-9_]+)\(/gi,
  )) {
    functions.add(match[1])
  }

  const tableColumns = new Map()
  function addColumn(table, column) {
    if (!tableColumns.has(table)) tableColumns.set(table, new Set())
    tableColumns.get(table).add(column)
  }
  function collectCreateTableColumns(sql) {
    for (const match of sql.matchAll(
      /create table(?: if not exists)? public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\n\);/gi,
    )) {
      for (const line of match[2].split('\n')) {
        const column = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+/)?.[1]
        if (
          column &&
          !['constraint', 'primary', 'foreign', 'unique', 'check'].includes(
            column.toLowerCase(),
          )
        ) {
          addColumn(match[1], column)
        }
      }
    }
  }
  collectCreateTableColumns(liveSchema)
  collectCreateTableColumns(migration)
  for (const alter of migration.matchAll(
    /alter table(?: if exists)? public\.([a-zA-Z0-9_]+)([\s\S]*?);/gi,
  )) {
    for (const addition of alter[2].matchAll(
      /add column(?: if not exists)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi,
    )) {
      addColumn(alter[1], addition[1])
    }
  }

  function sourceFiles(directory, result = []) {
    for (const entry of fs.readdirSync(path.join(root, directory), {
      withFileTypes: true,
    })) {
      const relative = path.join(directory, entry.name)
      if (entry.isDirectory()) sourceFiles(relative, result)
      else if (/\.(ts|tsx)$/.test(entry.name)) result.push(relative)
    }
    return result
  }
  const referencedRelations = new Map()
  const referencedFunctions = new Map()
  const selectedColumns = []
  const accessedColumns = []
  function splitTopLevelSelection(value) {
    const tokens = []
    let depth = 0
    let token = ''
    for (const character of value) {
      if (character === '(') depth += 1
      if (character === ')') depth = Math.max(0, depth - 1)
      if (character === ',' && depth === 0) {
        tokens.push(token)
        token = ''
      } else {
        token += character
      }
    }
    if (token) tokens.push(token)
    return tokens
  }
  const sourcePaths = [...sourceFiles('app'), ...sourceFiles('lib')]
  for (const relative of sourcePaths) {
    const source = read(relative)
    for (const match of source.matchAll(
      /\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g,
    )) {
      referencedRelations.set(match[1], relative)
    }
    for (const match of source.matchAll(
      /\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g,
    )) {
      referencedFunctions.set(match[1], relative)
    }
    for (const match of source.matchAll(
      /\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)([\s\S]{0,1600}?)\.select\(\s*(["'`])([\s\S]*?)\3/g,
    )) {
      const table = match[1]
      if (!tableColumns.has(table) || /\.from\(/.test(match[2])) continue
      for (const rawToken of splitTopLevelSelection(
        match[4].replace(/\s+/g, ''),
      )) {
        if (
          !rawToken ||
          rawToken === '*' ||
          rawToken.includes('(') ||
          rawToken.includes(')')
        ) {
          continue
        }
        const column = rawToken.includes(':')
          ? rawToken.slice(rawToken.lastIndexOf(':') + 1)
          : rawToken
        if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
          selectedColumns.push({ table, column, relative })
        }
      }
    }
  }

  function propertyName(node) {
    if (
      node &&
      (ts.isIdentifier(node) ||
        ts.isStringLiteral(node) ||
        ts.isNumericLiteral(node))
    ) {
      return node.text
    }
    return null
  }
  function tableFromChain(node) {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression)
    ) {
      return null
    }
    if (
      node.expression.name.text === 'from' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      return node.arguments[0].text
    }
    return tableFromChain(node.expression.expression)
  }
  function chainHasEmbeddedAlias(node, alias) {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression)
    ) {
      return false
    }
    if (
      node.expression.name.text === 'select' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (
        new RegExp(`(?:^|,)\\s*${escaped}:`).test(node.arguments[0].text)
      ) {
        return true
      }
    }
    return chainHasEmbeddedAlias(node.expression.expression, alias)
  }
  const filterMethods = new Set([
    'eq','neq','gt','gte','lt','lte','like','ilike','is','in',
    'contains','containedBy','overlaps','textSearch','order','not','filter',
  ])
  const writeMethods = new Set(['insert','update','upsert'])
  for (const relative of sourcePaths) {
    const source = read(relative)
    const sourceFile = ts.createSourceFile(
      relative,
      source,
      ts.ScriptTarget.Latest,
      true,
      relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.text
        const table = tableFromChain(node.expression.expression)
        if (tableColumns.has(table)) {
          if (
            writeMethods.has(method) &&
            node.arguments[0] &&
            ts.isObjectLiteralExpression(node.arguments[0])
          ) {
            for (const property of node.arguments[0].properties) {
              if (
                !ts.isPropertyAssignment(property) &&
                !ts.isShorthandPropertyAssignment(property)
              ) {
                continue
              }
              const column = propertyName(property.name)
              if (column) {
                accessedColumns.push({
                  table,
                  column,
                  relative,
                  operation: method,
                })
              }
            }
          }
          if (
            filterMethods.has(method) &&
            node.arguments[0] &&
            ts.isStringLiteralLike(node.arguments[0])
          ) {
            const column = node.arguments[0].text
            if (
              /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column) &&
              !chainHasEmbeddedAlias(node.expression.expression, column)
            ) {
              accessedColumns.push({
                table,
                column,
                relative,
                operation: method,
              })
            }
          }
          if (
            method === 'match' &&
            node.arguments[0] &&
            ts.isObjectLiteralExpression(node.arguments[0])
          ) {
            for (const property of node.arguments[0].properties) {
              if (
                !ts.isPropertyAssignment(property) &&
                !ts.isShorthandPropertyAssignment(property)
              ) {
                continue
              }
              const column = propertyName(property.name)
              if (column) {
                accessedColumns.push({
                  table,
                  column,
                  relative,
                  operation: method,
                })
              }
            }
          }
          if (
            method === 'or' &&
            node.arguments[0] &&
            ts.isStringLiteralLike(node.arguments[0])
          ) {
            for (const filter of node.arguments[0].text.matchAll(
              /(?:^|[,(])([a-zA-Z_][a-zA-Z0-9_]*)\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|fts|plfts|phfts|wfts)\./g,
            )) {
              accessedColumns.push({
                table,
                column: filter[1],
                relative,
                operation: method,
              })
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  const allowedMissingRelations = new Set(['customer_profiles'])
  const unexpectedRelations = [...referencedRelations]
    .filter(([name]) => !relations.has(name) && !allowedMissingRelations.has(name))
  assert(
    unexpectedRelations.length === 0,
    `runtime relations missing from live+repair schema: ${unexpectedRelations
      .map(([name, file]) => `${name} (${file})`)
      .join(', ')}`,
  )
  const customerResolver = read('lib/customer-portal/customerResolver.ts')
  assert(
    customerResolver.includes("from('customer_profiles')") &&
      customerResolver.includes('isMissingPortalSchemaError'),
    'the only allowed legacy relation must remain explicitly schema-tolerant',
  )
  const unexpectedRpcs = [...referencedFunctions]
    .filter(([name]) => !functions.has(name))
  assert(
    unexpectedRpcs.length === 0,
    `runtime RPCs missing from live+repair schema: ${unexpectedRpcs
      .map(([name, file]) => `${name} (${file})`)
      .join(', ')}`,
  )
  const missingSelectedColumns = selectedColumns.filter(
    ({ table, column }) => !tableColumns.get(table).has(column),
  )
  assert(
    missingSelectedColumns.length === 0,
    `runtime select columns missing from live+repair schema: ${missingSelectedColumns
      .map(({ table, column, relative }) => `${table}.${column} (${relative})`)
      .join(', ')}`,
  )
  const missingAccessedColumns = accessedColumns.filter(
    ({ table, column }) => !tableColumns.get(table).has(column),
  )
  assert(
    missingAccessedColumns.length === 0,
    `runtime write/filter columns missing from live+repair schema: ${missingAccessedColumns
      .map(
        ({ table, column, operation, relative }) =>
          `${table}.${column} ${operation} (${relative})`,
      )
      .join(', ')}`,
  )

  function collectFunctionHeaders(sql) {
    const headers = []
    const marker =
      /create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi
    let match
    while ((match = marker.exec(sql))) {
      let index = marker.lastIndex
      let depth = 1
      let quote = null
      let escaped = false
      for (; index < sql.length; index += 1) {
        const character = sql[index]
        if (quote) {
          if (escaped) escaped = false
          else if (character === '\\') escaped = true
          else if (character === quote) quote = null
          continue
        }
        if (character === "'" || character === '"') {
          quote = character
          continue
        }
        if (character === '(') depth += 1
        else if (character === ')' && --depth === 0) break
      }
      headers.push([match[1], sql.slice(marker.lastIndex, index)])
      marker.lastIndex = index + 1
    }
    return headers
  }
  function splitSqlArguments(value) {
    const argumentsList = []
    let token = ''
    let depth = 0
    let quote = null
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]
      if (quote) {
        token += character
        if (character === quote && value[index - 1] !== '\\') quote = null
      } else if (character === "'" || character === '"') {
        quote = character
        token += character
      } else if (character === '(' || character === '[') {
        depth += 1
        token += character
      } else if (character === ')' || character === ']') {
        depth -= 1
        token += character
      } else if (character === ',' && depth === 0) {
        argumentsList.push(token.trim())
        token = ''
      } else {
        token += character
      }
    }
    if (token.trim()) argumentsList.push(token.trim())
    return argumentsList
  }
  const functionParameters = new Map()
  for (const [name, header] of [
    ...collectFunctionHeaders(liveSchema),
    ...collectFunctionHeaders(migration),
  ]) {
    const parameters = splitSqlArguments(header)
      .map((argument) => {
        const normalized = argument.replace(
          /^\s*(?:inout|in|out|variadic)\s+/i,
          '',
        )
        const nameMatch = normalized.match(
          /^"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+/,
        )
        return nameMatch
          ? {
              name: nameMatch[1],
              required: !/(?:\bdefault\b|=)/i.test(normalized),
            }
          : null
      })
      .filter(Boolean)
    if (!functionParameters.has(name)) functionParameters.set(name, [])
    functionParameters.get(name).push(parameters)
  }
  const rpcArgumentFailures = []
  for (const relative of sourcePaths) {
    const source = read(relative)
    const sourceFile = ts.createSourceFile(
      relative,
      source,
      ts.ScriptTarget.Latest,
      true,
      relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    function visitRpc(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'rpc' &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const functionName = node.arguments[0].text
        const input = node.arguments[1]
        if (input && ts.isObjectLiteralExpression(input)) {
          const hasSpread = input.properties.some(ts.isSpreadAssignment)
          if (!hasSpread) {
            const keys = input.properties.map((property) =>
              propertyName(property.name),
            ).filter(Boolean)
            const overloads = functionParameters.get(functionName) ?? []
            const matches = overloads.some(
              (parameters) =>
                keys.every((key) =>
                  parameters.some((parameter) => parameter.name === key),
                ) &&
                parameters
                  .filter((parameter) => parameter.required)
                  .every((parameter) => keys.includes(parameter.name)),
            )
            if (!matches) {
              rpcArgumentFailures.push(
                `${functionName}(${keys.join(',')}) (${relative})`,
              )
            }
          }
        }
      }
      ts.forEachChild(node, visitRpc)
    }
    visitRpc(sourceFile)
  }
  assert(
    rpcArgumentFailures.length === 0,
    `runtime RPC argument names do not match live+repair signatures: ${rpcArgumentFailures.join(', ')}`,
  )
}

console.log(
  `Live schema/code sync regression passed (${repairCalls().length} exact active-definition patches${auditDir ? ', audited live inputs verified' : ''}).`,
)
