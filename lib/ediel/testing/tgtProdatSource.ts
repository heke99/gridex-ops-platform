import { PRODAT_26A_MESSAGE_CODES } from '@/lib/ediel/prodat/prodat26AFieldMatrix'
import { prodatDateField } from '@/lib/ediel/prodat/prodatDateFields'
import type { EdielTgtCaseTestData, EdielTgtCaseTestDataGroup, EdielTgtExcelColumn } from './tgtTestData'

/** Source adapter, not a second requirement matrix. Every interpreted value
 * retains the original cell and its group/column provenance. */
export type TgtProdatSourceColumn = {
  groupIndex: number
  group: EdielTgtCaseTestDataGroup
  column: EdielTgtExcelColumn
  fields: Record<string, string>
  rawFields: Record<string, string>
  registerIndex: string | null
  explicitIndex: boolean
  identityAgency: string | null
}

export function tgtProdatSourceValue(field: string, value: string | null | undefined): string | null {
  const text = value?.trim()
  if (!text || text === '-') return null
  if (prodatDateField(field)) return text
  // Only known presentation annotations. Punctuation inside identifiers is data.
  return text.replace(/\s+\((?:optional|valfritt|frivilligt)\)$/iu, '').trim()
}

function columnFunction(column: EdielTgtExcelColumn): string | null {
  const match = column.name.toUpperCase().match(/\b(Z\d{2})[A-Z]*\b/)
  return match && (PRODAT_26A_MESSAGE_CODES as readonly string[]).includes(match[1]) ? match[1] : null
}

function labelIndex(name: string): string | null {
  return name.match(/\bregister\s*(?:(?:nr|no)\.?\s*)?(\d+)\b/iu)?.[1] ?? null
}

export function readTgtProdatSourceColumns(data: EdielTgtCaseTestData | null | undefined, code?: string | null): TgtProdatSourceColumn[] {
  if (!data) return []
  const result: TgtProdatSourceColumn[] = []
  for (const [groupIndex, group] of data.groups.entries()) {
    if (group.block.kind !== 'PRODAT') continue
    const names = new Set<string>()
    const rows = [...group.columns].sort((a, b) => (a.sourceOrder ?? a.index) - (b.sourceOrder ?? b.index) || a.index - b.index).map(column => {
      // Cells are keyed by name inside a group, never across different groups.
      if (names.has(column.name)) throw new Error('prodat_register_source_column_ambiguous')
      names.add(column.name)
      const fields: Record<string, string> = {}
      const rawFields: Record<string, string> = {}
      for (const field of group.fields) {
        const number = field.fieldCode.trim().toUpperCase()
        const raw = field.values[column.name]
        if (typeof raw !== 'string') continue
        if (rawFields[number] !== undefined && rawFields[number] !== raw) throw new Error('prodat_register_source_field_ambiguous')
        rawFields[number] = raw
        const value = tgtProdatSourceValue(number, raw)
        if (value != null) fields[number] = value
      }
      const label = labelIndex(column.name)
      const index = fields['258'] ?? label
      if (label && fields['258'] && Number(label) !== Number(fields['258'])) throw new Error('prodat_register_source_index_conflict')
      if (index !== null && (!/^\d{1,6}$/.test(index) || Number(index) < 1)) throw new Error('prodat_register_source_index_invalid')
      const agency = fields['209.AGENCY'] ?? fields['209']?.match(/\s+\(3055=(9|89)\)$/)?.[1] ?? null
      if (agency !== null && !['9', '89'].includes(agency)) throw new Error('prodat_register_source_agency_invalid')
      if (fields['209']) fields['209'] = fields['209'].replace(/\s+\(3055=(9|89)\)$/, '')
      return { groupIndex, group, column, fields, rawFields, registerIndex: index, explicitIndex: fields['258'] !== undefined, identityAgency: agency }
    })
    const matching = rows.filter(row => columnFunction(row.column) === code)
    const labelled = rows.some(row => columnFunction(row.column) !== null)
    const selected = !code ? rows : rows.filter(row => {
      const functionCode = columnFunction(row.column)
      if (functionCode) return functionCode === code
      if (!labelled) return true
      // An unlabelled register requires explicit same-group object evidence.
      return row.registerIndex !== null && Boolean(row.fields['209']) && matching.some(first => first.fields['209'] === row.fields['209'])
    })
    for (const row of selected) {
      if (Object.keys(row.fields).length || row.registerIndex !== null) result.push(row)
    }
  }
  return result
}

export function sourceObjectIds(row: TgtProdatSourceColumn, code?: string | null): string[] {
  if (code === 'Z05' && row.fields['233']) return [row.fields['233']]
  return [...new Set([row.fields['209'], row.fields['233']].filter((v): v is string => Boolean(v)))]
}

/** Same object in two source blocks is ambiguous, not permission to dedupe it. */
export function groupTgtProdatSourceObjects(rows: readonly TgtProdatSourceColumn[]): TgtProdatSourceColumn[][] {
  const objects = new Map<string, TgtProdatSourceColumn[]>()
  for (const row of rows) {
    const id = row.fields['209'] ?? row.fields['233'] ?? null
    const key = JSON.stringify([id, row.identityAgency ?? '9', id ? null : [row.groupIndex, row.column.name]])
    const siblings = objects.get(key) ?? []
    if (siblings.length && siblings[0].groupIndex !== row.groupIndex) throw new Error('prodat_register_source_object_ambiguous')
    siblings.push(row)
    objects.set(key, siblings)
  }
  for (const siblings of objects.values()) {
    if (siblings.length > 1 && siblings.some(row => row.registerIndex === null)) throw new Error('prodat_register_source_index_required')
  }
  return [...objects.values()]
}

export function sourceExpectationIndex(row: TgtProdatSourceColumn, all: readonly TgtProdatSourceColumn[]): string | null {
  if (row.explicitIndex || row.registerIndex !== '1') return row.registerIndex
  // "register 1" alone is a partial first-register expectation, not on-wire258.
  const id = row.fields['209'] ?? row.fields['233']
  return all.some(other => other !== row && other.groupIndex === row.groupIndex && (other.fields['209'] ?? other.fields['233']) === id && other.registerIndex !== null) ? row.registerIndex : null
}
