export type FieldMatrixImportStatus = 'draft' | 'review' | 'active'

export type ImportedFieldMatrixRule = {
  profileKey: string
  messageFamily: string
  messageCode: string | null
  segment: string
  qualifier: string | null
  ruleType: string
  status: 'active' | 'draft' | 'review'
  source: string
  sourceDocument: string | null
  sourceVersion: string | null
  validFrom: string | null
  validTo: string | null
  market: 'electricity'
  applicationReference: string | null
  actorRole: string | null
  direction: string | null
  ackPolicy: string | null
  errorMapping: string | null
  fieldReferenceCode: string | null
  ruleSeverity: string | null
  canonicalOverrideGuard: boolean
  rulePayload: Record<string, unknown>
}

export type FieldMatrixImportResult = {
  batchKey: string
  version: string
  rows: ImportedFieldMatrixRule[]
  profileKeys: string[]
  warnings: string[]
  sourceRows: number
}

export type ParseFieldMatrixImportInput = {
  rawText: string
  version?: string | null
  source?: string | null
  defaultFamily?: string | null
  defaultStatus?: FieldMatrixImportStatus | null
  sourceDocument?: string | null
  sourceVersion?: string | null
  validFrom?: string | null
  validTo?: string | null
}

const PROFILE_BY_CODE: Record<string, string> = {
  Z01: 'prodat_z01_customer_identity_request',
  Z02: 'prodat_z02_customer_identity_response',
  Z03: 'prodat_z03_supplier_switch',
  Z04: 'prodat_z04_supplier_switch_confirmation',
  Z05: 'prodat_z05_old_supplier_confirmation',
  Z06: 'prodat_z06_masterdata_grid_to_supplier',
  Z08: 'prodat_z08_contract_end',
  Z09: 'prodat_z09_masterdata_supplier_to_grid',
  Z10: 'prodat_z10_meter_change',
  Z13: 'prodat_z13_permission_request',
  Z14: 'prodat_z14_permission_response',
  Z15: 'prodat_z15_permission_ended',
  Z18: 'prodat_z18_permission_end_request',
  E66: 'utilts_e66',
  E31: 'utilts_e31',
  S01: 'utilts_s01',
  S02: 'utilts_s02',
  S03: 'utilts_s03',
  S04: 'utilts_s04',
  CONTRL: 'contrl',
  APERAK: 'aperak',
  UTILTS_ERR: 'utilts_err',
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/^\uFEFF/, '').trim()
}

function upper(value: unknown): string {
  return clean(value).toUpperCase()
}

function slug(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (!quoted && char === delimiter) {
      cells.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5).join('\n')
  const candidates = ['\t', ';', ',']
  return candidates
    .map((delimiter) => ({ delimiter, count: sample.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? '\t'
}

function headerIndex(headers: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  headers.forEach((header, index) => {
    result[slug(header)] = index
  })
  return result
}

function pick(row: string[], indexes: Record<string, number>, names: string[]): string | null {
  for (const name of names) {
    const index = indexes[slug(name)]
    if (typeof index === 'number') {
      const value = clean(row[index])
      if (value) return value
    }
  }
  return null
}

function normalizeFamily(value: unknown, fallback: string | null): string {
  const token = upper(value || fallback || 'PRODAT').replace('-', '_')
  if (token.includes('UTILTS_ERR')) return 'UTILTS_ERR'
  if (token.includes('UTILTS')) return 'UTILTS'
  if (token.includes('APERAK')) return 'APERAK'
  if (token.includes('CONTRL')) return 'CONTRL'
  return 'PRODAT'
}

function normalizeCode(value: unknown, family: string): string | null {
  const token = upper(value)
  if (!token) return family === 'APERAK' || family === 'CONTRL' || family === 'UTILTS_ERR' ? family : null
  const match = token.match(/Z\d{2}|E\d{2}|S\d{2}|APERAK|CONTRL|UTILTS_ERR/)
  return match?.[0] ?? token
}

function inferProfileKey(input: { profileKey?: string | null; family: string; code: string | null }): string {
  const explicit = slug(input.profileKey)
  if (explicit) return explicit
  const codeProfile = input.code ? PROFILE_BY_CODE[input.code] : null
  if (codeProfile) return codeProfile
  if (input.family === 'APERAK') return 'aperak'
  if (input.family === 'CONTRL') return 'contrl'
  if (input.family === 'UTILTS_ERR') return 'utilts_err'
  return `${input.family.toLowerCase()}_${slug(input.code ?? 'unknown')}`
}

function normalizeRuleType(value: unknown): string {
  const token = upper(value)
  if (['M', 'MANDATORY', 'REQUIRED', 'OBLIGATORISK', 'SKA'].includes(token)) return 'required'
  if (['C', 'CONDITIONAL', 'DEPENDENT', 'VILLKORAD', 'BEROENDE'].includes(token)) return 'conditional'
  if (['O', 'OPTIONAL', 'VALFRI', 'KAN'].includes(token)) return 'optional'
  if (['X', 'F', 'FORBIDDEN', 'NOT_ALLOWED', 'FÅR_EJ', 'FORBJUDET'].includes(token)) return 'forbidden'
  if (token.includes('MUST')) return 'required'
  if (token.includes('CONDITION')) return 'conditional'
  if (token.includes('OPTION')) return 'optional'
  if (token.includes('FORBID') || token.includes('NOT ALLOW')) return 'forbidden'
  return token ? slug(token) : 'imported'
}

function normalizeSegment(value: unknown): string | null {
  const token = upper(value)
  if (!token) return null
  const segment = token.match(/[A-Z]{3}(?:\+[A-Z0-9]+)?/)?.[0] ?? token
  return segment.split('+')[0] || segment
}

function normalizeQualifier(value: unknown, segmentPath?: string | null): string | null {
  const explicit = upper(value)
  if (explicit) return explicit
  const path = upper(segmentPath)
  const plus = path.match(/[A-Z]{3}\+([A-Z0-9]+)/)
  if (plus?.[1]) return plus[1]
  const colon = path.match(/:([A-Z0-9]{2,})/)
  return colon?.[1] ?? null
}

function versionName(value: unknown): string {
  const explicit = clean(value)
  if (explicit) return explicit
  const now = new Date()
  const stamp = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)
  return `field_matrix_${stamp}`
}

export function parseFieldMatrixImport(input: ParseFieldMatrixImportInput): FieldMatrixImportResult {
  const lines = clean(input.rawText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) {
    return {
      batchKey: `field_matrix_${Date.now()}`,
      version: versionName(input.version),
      rows: [],
      profileKeys: [],
      warnings: ['Importen behöver rubrikrad och minst en datarad.'],
      sourceRows: 0,
    }
  }

  const delimiter = detectDelimiter(lines)
  const headers = splitDelimitedLine(lines[0] ?? '', delimiter)
  const indexes = headerIndex(headers)
  const warnings: string[] = []
  const rows: ImportedFieldMatrixRule[] = []

  for (const [offset, line] of lines.slice(1).entries()) {
    const sourceRowNumber = offset + 2
    const row = splitDelimitedLine(line, delimiter)
    const family = normalizeFamily(pick(row, indexes, ['message_family', 'family', 'meddelandefamilj']), input.defaultFamily ?? null)
    const messageCode = normalizeCode(pick(row, indexes, ['message_code', 'code', 'bgm', 'message', 'meddelandekod']), family)
    const segmentPath = pick(row, indexes, ['segment_path', 'path', 'field_path', 'segment'])
    const segment = normalizeSegment(pick(row, indexes, ['segment', 'segment_path', 'path', 'field_code', 'field']))
    const qualifier = normalizeQualifier(pick(row, indexes, ['qualifier', 'kvalificerare']), segmentPath)
    const ruleType = normalizeRuleType(pick(row, indexes, ['rule_type', 'requirement', 'req', 'status', 'krav']))
    const profileKey = inferProfileKey({
      profileKey: pick(row, indexes, ['profile_key', 'profile', 'rule_profile', 'regelprofil']),
      family,
      code: messageCode,
    })
    const fieldCode = pick(row, indexes, ['field_code', 'field', 'fältkod'])
    const fieldKey = pick(row, indexes, ['field_key', 'field_name', 'field_name_en', 'field_name_sv', 'fält'])
    const note = pick(row, indexes, ['note', 'notes', 'comment', 'kommentar', 'anvisning'])

    if (!segment) {
      warnings.push(`Rad ${sourceRowNumber}: segment saknas och raden hoppades över.`)
      continue
    }

    rows.push({
      profileKey,
      messageFamily: family,
      messageCode,
      segment,
      qualifier,
      ruleType,
      status: input.defaultStatus === 'draft' ? 'draft' : input.defaultStatus === 'review' ? 'review' : 'active',
      source: clean(input.source) || 'field_matrix_import',
      sourceDocument: clean(input.sourceDocument) || null,
      sourceVersion: clean(input.sourceVersion) || null,
      validFrom: clean(input.validFrom) || null,
      validTo: clean(input.validTo) || null,
      market: 'electricity',
      applicationReference: pick(row, indexes, ['application_reference', 'appref', 'unb_0026']) || null,
      actorRole: pick(row, indexes, ['actor_role', 'role', 'aktorsroll']) || null,
      direction: pick(row, indexes, ['direction', 'riktning']) || null,
      ackPolicy: pick(row, indexes, ['ack_policy', 'ack', 'kvittens']) || null,
      errorMapping: pick(row, indexes, ['error_mapping', 'erc_ftx', 'felkod']) || null,
      fieldReferenceCode: pick(row, indexes, ['field_reference_code', 'fältreferens', 'a904']) || fieldCode,
      ruleSeverity: pick(row, indexes, ['rule_severity', 'severity', 'allvarlighet']) || null,
      canonicalOverrideGuard: ['UNB', 'UNH', 'BGM'].includes(segment),
      rulePayload: {
        sourceRowNumber,
        sourceHeader: headers,
        fieldCode,
        fieldKey,
        segmentPath,
        matrixRequirement: pick(row, indexes, ['requirement', 'req', 'status', 'krav']),
        note,
        rawCells: row,
      },
    })
  }

  const profileKeys = Array.from(new Set(rows.map((row) => row.profileKey))).sort()

  return {
    batchKey: `field_matrix_${Date.now()}`,
    version: versionName(input.version),
    rows,
    profileKeys,
    warnings,
    sourceRows: Math.max(lines.length - 1, 0),
  }
}

export function summarizeFieldMatrixRows(rows: ImportedFieldMatrixRule[]): Record<string, unknown> {
  const byProfile: Record<string, number> = {}
  const byType: Record<string, number> = {}

  for (const row of rows) {
    byProfile[row.profileKey] = (byProfile[row.profileKey] ?? 0) + 1
    byType[row.ruleType] = (byType[row.ruleType] ?? 0) + 1
  }

  return {
    totalRules: rows.length,
    profileCount: Object.keys(byProfile).length,
    byProfile,
    byType,
  }
}
