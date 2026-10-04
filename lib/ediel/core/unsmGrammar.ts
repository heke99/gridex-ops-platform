import directoryFacts from './unsmGrammar.generated.json'
import { segmentComposite, tokenizeEdifact, type EdifactTokenizeResult, type EdifactTokenizedSegment } from './edifactTokenizer'

type Field = { id: string; min: number; max: number; representation?: string }
type Node = { position: string; min: number; max: number; tag?: string; group?: number; children?: Node[] }
type Grammar = {
  key: string; archiveSha256: string; sources: { archiveMember: string; sha256: string }[]
  structure: Node[]; segments: Record<string, Field[]>; composites: Record<string, Field[]>
}
const grammars: readonly Grammar[] = directoryFacts.grammars as unknown as readonly Grammar[]
const directoryFamilies = new Set(['PRODAT', 'UTILTS', 'APERAK'])

export type UnsmGrammarIssue = {
  severity: 'error' | 'warning'; code: string; description: string; segmentIndex: number; field?: string
}
export type UnsmGrammarResult = {
  qualification: 'qualified' | 'unavailable' | 'not_applicable'
  syntaxOk: boolean
  issues: UnsmGrammarIssue[]
  sources: { messageIndex: number; key: string; archiveSha256: string; members: Grammar['sources'] }[]
}

/** P16B_APERAK96A_OWN_Z07_LI_CARDINALITY, resolved by owner decision
 * (2026-10-02) per the national guide (P26A/16B p105): the Swedish subset
 * APERAK E2SE6A carries both own references of one acknowledged PRODAT object,
 * RFF+Z07 then RFF+LI, in SG4 of one ERC. Only that pair widens D.96A SG4 from
 * C1 to two repetitions; every other shape keeps the directory cardinality. */
function withProdatOwnReferencePair(nodes: Node[]): Node[] {
  return nodes.map(node => node.group === 4 ? { ...node, max: 2 }
    : node.children ? { ...node, children: withProdatOwnReferencePair(node.children) } : node)
}
function ownReferencePairIssues(segments: EdifactTokenizedSegment[], tokens: EdifactTokenizeResult): UnsmGrammarIssue[] {
  const issues: UnsmGrammarIssue[] = []
  segments.forEach((segment, at) => {
    if (segment.tag !== 'ERC') return
    const end = segments.findIndex((next, i) => i > at && (next.tag === 'ERC' || next.tag === 'UNT'))
    const refs = segments.slice(at + 1, end < 0 ? segments.length : end).filter(next => next.tag === 'RFF')
    if (refs.length === 2 && (segmentComposite(refs[0], 1, tokens.una)[0] !== 'Z07' || segmentComposite(refs[1], 1, tokens.una)[0] !== 'LI'))
      issues.push({ severity: 'error', code: 'UNSM_MESSAGE_STRUCTURE_INVALID', segmentIndex: refs[1].index,
        description: 'APERAK:D:96A:UN:E2SE6A: två RFF i SG4 är endast tillåtna som eget RFF+Z07 följt av RFF+LI (P26A/16B s.105).' })
  })
  return issues
}

/** Match the complete directory tree, including optional groups with mandatory
 * children and repeated nested groups. End-position sets retain ambiguities;
 * an early optional RFF/NAD must not greedily consume a later group's trigger.
 * Repetitions are bounded by actual segment count, never directory max alone. */
function matchStructure(nodes: Node[], message: EdifactTokenizedSegment[]): { ok: boolean; furthest: number } {
  const cache = new Map<Node, Map<number, Set<number>>>()
  let furthest = 0
  const sequence = (children: Node[], start: number): Set<number> => {
    let positions = new Set([start])
    for (const child of children) {
      const next = new Set<number>()
      for (const position of positions) for (const end of repeated(child, position)) next.add(end)
      positions = next
      if (!positions.size) break
    }
    return positions
  }
  const repeated = (node: Node, start: number): Set<number> => {
    let nodeCache = cache.get(node)
    if (!nodeCache) { nodeCache = new Map(); cache.set(node, nodeCache) }
    const known = nodeCache.get(start)
    if (known) return known
    const ends = new Set<number>(node.min ? [] : [start])
    let positions = new Set([start])
    for (let count = 1; count <= Math.min(node.max, message.length - start); count += 1) {
      const next = new Set<number>()
      for (const position of positions) {
        if (node.tag) {
          if (message[position]?.tag === node.tag) next.add(position + 1)
        } else if (node.children) {
          for (const end of sequence(node.children, position)) if (end > position) next.add(end)
        }
      }
      if (!next.size) break
      positions = next
      for (const end of positions) {
        furthest = Math.max(furthest, end)
        if (count >= node.min) ends.add(end)
      }
    }
    nodeCache.set(start, ends)
    return ends
  }
  return { ok: sequence(nodes, 0).has(message.length), furthest }
}

function fieldIssues(grammar: Grammar, segment: EdifactTokenizedSegment, tokens: EdifactTokenizeResult): UnsmGrammarIssue[] {
  const definitionFields = grammar.segments[segment.tag]
  if (!definitionFields) return [] // Service UNH/UNT remain separately owned by the envelope.
  // UNTDID Part4 chapter2.2 clause8.2 specifies version3 data-element repeats
  // as adjacent element positions, with omission/truncation for unused repeats.
  // This is distinct from syntax4's repetition separator. Each used composite
  // occurrence retains its own mandatory components from its selected edition.
  const fields = definitionFields.flatMap(field => Array.from({ length: field.max }, (_, repeat) =>
    ({ ...field, min: repeat === 0 ? field.min : 0 })))
  const issues: UnsmGrammarIssue[] = []
  const fail = (code: string, field: string, description: string) => issues.push({ severity: 'error' as const, code, field, description, segmentIndex: segment.index })
  const scalar = (value: string | undefined, field: Field, path: string) => {
    if (!value) {
      if (field.min) fail('UNSM_MANDATORY_ELEMENT_MISSING', path, `${grammar.key}: obligatoriskt ${path} saknas.`)
      return
    }
    if (!field.representation) return
    const match = /^(an|a|n)(\.\.)?(\d+)$/.exec(field.representation)
    if (!match) throw new Error('unsm_compiled_representation_invalid')
    const digits = Array.from(value).length
    const maximum = Number(match[3])
    // The syntax decimal mark and leading sign do not count as numeric digits.
    const size = match[1] === 'n' ? Array.from(value.replace(/^-/, '').replace(tokens.una.decimalMark, '')).length : digits
    if ((match[2] && size > maximum) || (!match[2] && size !== maximum)) fail('UNSM_ELEMENT_LENGTH_INVALID', path,
      `${grammar.key}: ${path} följer inte representation ${field.representation}.`)
    const validNumeric = () => {
      const body = value.startsWith('-') ? value.slice(1) : value
      const parts = body.split(tokens.una.decimalMark)
      return parts.length <= 2 && parts.every(part => /^\d+$/.test(part))
    }
    if ((match[1] === 'n' && !validNumeric()) || (match[1] === 'a' && !/^\p{L}+$/u.test(value))) {
      fail('UNSM_ELEMENT_REPRESENTATION_INVALID', path, `${grammar.key}: ${path} följer inte representation ${field.representation}.`)
    }
  }
  if (segment.elements.length - 1 > fields.length) fail('UNSM_ELEMENT_CARDINALITY_INVALID', segment.tag,
    `${grammar.key}: ${segment.tag} har fler elementpositioner än dess egen directory.`)
  for (const [index, field] of fields.entries()) {
    const components = segmentComposite(segment, index + 1, tokens.una)
    const path = `${segment.tag}/${field.id}`
    const definition = field.id.startsWith('C') ? grammar.composites[field.id] : null
    if (field.id.startsWith('C') && !definition) throw new Error('unsm_compiled_composite_missing')
    if (definition && components.length > definition.length) fail('UNSM_COMPONENT_CARDINALITY_INVALID', path,
      `${grammar.key}: ${path} har fler komponentpositioner än dess egen directory.`)
    if (!definition && components.length > 1) fail('UNSM_SIMPLE_ELEMENT_COMPOSITE_INVALID', path, `${grammar.key}: ${path} är ett enkelt element.`)
    const present = components.some(value => value.length > 0)
    if (!present) {
      if (field.min) fail('UNSM_MANDATORY_ELEMENT_MISSING', path, `${grammar.key}: obligatoriskt ${path} saknas.`)
      continue
    }
    if (definition) {
      definition.forEach((component, componentIndex) => scalar(components[componentIndex], component, `${path}/${component.id}[${componentIndex + 1}]`))
    } else {
      scalar(components[0], field, path)
    }
  }
  return issues
}

/** Full selected business-directory syntax. Caller family/code/parsed metadata
 * cannot select a grammar. Unknown national editions are held, not guessed from
 * a neighbouring release and not reported as invented negative syntax ACKs.
 * CONTRL's older 2:2 service grammar is explicitly outside these four sources. */
export function validateUnsmGrammar(input: string | EdifactTokenizeResult): UnsmGrammarResult {
  const tokens = typeof input === 'string' ? tokenizeEdifact(input) : input
  const result: UnsmGrammarResult = { qualification: 'not_applicable', syntaxOk: true, issues: [], sources: [] }
  let message: EdifactTokenizedSegment[] | null = null
  const check = (segments: EdifactTokenizedSegment[]) => {
    const unh = segments[0]
    const identifier = segmentComposite(unh, 2, tokens.una)
    const family = identifier[0]?.toUpperCase()
    if (!directoryFamilies.has(family)) return
    const key = identifier.slice(0, 4).join(':')
    const grammar = grammars.find(candidate => candidate.key === key)
    const syntaxVersion = segmentComposite(tokens.segments.find(segment => segment.tag === 'UNB'), 1, tokens.una)[1]
    if (!grammar || syntaxVersion === '4') {
      result.qualification = 'unavailable'
      result.issues.push({ severity: 'warning', code: 'UNSM_DIRECTORY_SOURCE_UNAVAILABLE', segmentIndex: unh.index,
        description: `Full, kvalificerad directory för fysisk ${key} / syntax ${syntaxVersion ?? 'okänd'} saknas; ingen närliggande version får användas.` })
      return
    }
    if (result.qualification !== 'unavailable') result.qualification = 'qualified'
    result.sources.push({ messageIndex: unh.index, key, archiveSha256: grammar.archiveSha256, members: grammar.sources })
    const nationalOwnReferences = key === 'APERAK:D:96A:UN' && identifier[4]?.toUpperCase() === 'E2SE6A'
    const matched = matchStructure(nationalOwnReferences ? withProdatOwnReferencePair(grammar.structure) : grammar.structure, segments)
    if (nationalOwnReferences) result.issues.push(...ownReferencePairIssues(segments, tokens))
    if (!matched.ok) result.issues.push({ severity: 'error', code: 'UNSM_MESSAGE_STRUCTURE_INVALID',
      segmentIndex: segments[Math.min(matched.furthest, segments.length - 1)].index,
      description: `${key}: fysisk segmentordning, obligatoriska segment/grupper eller kardinalitet avviker från full directory.` })
    for (const segment of segments) result.issues.push(...fieldIssues(grammar, segment, tokens))
  }
  for (const segment of tokens.segments) {
    if (segment.tag === 'UNH') {
      if (message) check(message)
      message = [segment]
    }
    else if (message) {
      message.push(segment)
      if (segment.tag === 'UNT') { check(message); message = null }
    }
  }
  if (message) check(message)
  result.syntaxOk = !result.issues.some(issue => issue.severity === 'error')
  return result
}
