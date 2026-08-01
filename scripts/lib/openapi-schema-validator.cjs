const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function actualType(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function pointerValue(document, reference) {
  if (!reference.startsWith('#/')) return null
  return reference
    .slice(2)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((current, part) => current?.[part], document)
}

function resolveSchema(document, schema) {
  if (!schema?.$ref) return schema
  return pointerValue(document, schema.$ref) ?? schema
}

function formatValid(value, format) {
  if (typeof value !== 'string') return false
  if (format === 'uuid') return UUID_PATTERN.test(value)
  if (format === 'date') return DATE_PATTERN.test(value)
  if (format === 'date-time') return Number.isFinite(Date.parse(value))
  if (format === 'uri') {
    try {
      const parsed = new URL(value)
      return Boolean(parsed.protocol && parsed.host)
    } catch {
      return false
    }
  }
  return true
}

function validateSchema(document, value, unresolvedSchema, location = '$') {
  const schema = resolveSchema(document, unresolvedSchema)
  if (!schema || typeof schema !== 'object') return []

  if (Array.isArray(schema.allOf)) {
    return schema.allOf.flatMap((branch) =>
      validateSchema(document, value, branch, location),
    )
  }
  const alternatives = schema.oneOf ?? schema.anyOf
  if (Array.isArray(alternatives)) {
    const branchErrors = alternatives.map((branch) =>
      validateSchema(document, value, branch, location),
    )
    if (branchErrors.some((errors) => errors.length === 0)) return []
    return [`${location} does not match any documented schema branch.`]
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : []
  const type = actualType(value)
  const typeMatches =
    types.length === 0 ||
    types.includes(type) ||
    (types.includes('integer') && type === 'number' && Number.isInteger(value))
  if (!typeMatches) {
    return [`${location} must be ${types.join(' or ')}, got ${type}.`]
  }

  const failures = []
  if (schema.const !== undefined && value !== schema.const) {
    failures.push(`${location} must equal ${JSON.stringify(schema.const)}.`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    failures.push(`${location} is outside the documented enum.`)
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      failures.push(`${location} does not match ${schema.pattern}.`)
    }
    if (schema.format && !formatValid(value, schema.format)) {
      failures.push(`${location} is not a valid ${schema.format}.`)
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      failures.push(`${location} is shorter than ${schema.minLength}.`)
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      failures.push(`${location} is longer than ${schema.maxLength}.`)
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      failures.push(`${location} is below minimum ${schema.minimum}.`)
    }
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
      failures.push(`${location} must be greater than ${schema.exclusiveMinimum}.`)
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      failures.push(`${location} is above maximum ${schema.maximum}.`)
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      failures.push(`${location} has fewer than ${schema.minItems} items.`)
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      failures.push(`${location} has more than ${schema.maxItems} items.`)
    }
    if (schema.uniqueItems) {
      const serialized = value.map((item) => JSON.stringify(item))
      if (new Set(serialized).size !== serialized.length) {
        failures.push(`${location} contains duplicate items.`)
      }
    }
    if (schema.items) {
      value.forEach((item, index) => {
        failures.push(
          ...validateSchema(document, item, schema.items, `${location}[${index}]`),
        )
      })
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties ?? {}
    for (const field of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, field)) {
        failures.push(`${location} missing required field ${field}.`)
      }
    }
    if (schema.additionalProperties === false) {
      for (const field of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, field)) {
          failures.push(`${location} contains undocumented field ${field}.`)
        }
      }
    }
    for (const [field, item] of Object.entries(value)) {
      if (properties[field]) {
        failures.push(
          ...validateSchema(
            document,
            item,
            properties[field],
            `${location}.${field}`,
          ),
        )
      }
    }
  }
  return failures
}

function responseSchema(document, path, method = 'get', status = '200') {
  return document.paths?.[path]?.[method]?.responses?.[status]?.content?.[
    'application/json'
  ]?.schema
}

function validateResponse(document, path, value, method = 'get', status = '200') {
  const schema = responseSchema(document, path, method, status)
  if (!schema) return [`OpenAPI response schema missing: ${method.toUpperCase()} ${path} ${status}`]
  return validateSchema(document, value, schema, `${method.toUpperCase()} ${path} ${status}`)
}

module.exports = {
  resolveSchema,
  responseSchema,
  validateResponse,
  validateSchema,
}
