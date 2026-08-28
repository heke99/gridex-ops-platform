// lib/ediel/specRegistry.ts

import type {
  EdielAckStatus,
  EdielMessageFamily,
  EdielMessageStandard,
} from '@/lib/ediel/types'
import { canonicalAckRequirements } from '@/lib/ediel/ack/canonicalAckEngine'
import { PRODAT_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/prodatRulebook'
import { UTILTS_CANONICAL_PROFILES } from '@/lib/ediel/rulebook/utiltsRulebook'

export type EdielInstructionStatus =
  | 'runtime_ready'
  | 'runtime_partial'
  | 'documented_not_enabled'
  | 'future_scope'

export type EdielInstructionSpec = {
  family: EdielMessageFamily
  code: string
  standard: EdielMessageStandard
  currentVersion: string
  validFrom: string | null
  previousVersion?: string | null
  direction: 'inbound' | 'outbound' | 'both'
  requiresContrl: boolean
  requiresAperak: boolean
  supportsNegativeResponse: boolean
  ackDeadlineMinutes: number | null
  status: EdielInstructionStatus
  sourceTitle: string
  sourceVersion: string
  sourceDate: string
  operationalNote: string
}

export type EdielInstructionCoverage = {
  key: string
  label: string
  status: EdielInstructionStatus
  total: number
  runtimeReady: number
  partial: number
  documentedNotEnabled: number
  futureScope: number
  note: string
}

export const EDIEL_ACK_DEADLINE_MINUTES = 30

function canonicalAckFields(family: string, code: string) {
  const ack = canonicalAckRequirements({ family, code })
  return {
    requiresContrl: ack.requiresContrl,
    requiresAperak: ack.requiresAperak,
    supportsNegativeResponse: ack.supportsNegativeAperak || ack.supportsUtiltsErr,
    ackDeadlineMinutes: ack.requiresContrl || ack.requiresAperak ? EDIEL_ACK_DEADLINE_MINUTES : null,
  }
}

/**
 * PRODAT and UTILTS rows are projections only. Version, validity, support and
 * ACK semantics come from the canonical rulebooks; this registry must never
 * carry a second hand-maintained PRODAT/UTILTS matrix.
 */
const CANONICAL_PRODAT_INSTRUCTION_SPECS: EdielInstructionSpec[] = [...PRODAT_CANONICAL_PROFILES]
  .sort((left, right) => left.messageCode.localeCompare(right.messageCode))
  .map((profile) => ({
    family: 'PRODAT',
    code: profile.messageCode,
    standard: 'edifact',
    currentVersion: profile.guideVersion,
    validFrom: profile.effectiveFrom,
    previousVersion: null,
    direction: profile.direction === 'actor_to_portal' ? 'outbound' : 'inbound',
    ...canonicalAckFields('PRODAT', profile.messageCode),
    status: 'runtime_ready',
    sourceTitle: 'Canonical PRODAT guide',
    sourceVersion: profile.guideVersion,
    sourceDate: profile.effectiveFrom,
    operationalNote: `${profile.processGroup}; varianter ${profile.allowedVariants.join(', ')}. Status härleds från kanoniskt PRODAT-register.`,
  }))

const CANONICAL_UTILTS_INSTRUCTION_SPECS: EdielInstructionSpec[] = [...UTILTS_CANONICAL_PROFILES]
  .filter((profile) => profile.messageCode !== 'ERR')
  .sort((left, right) => left.messageCode.localeCompare(right.messageCode))
  .map((profile) => ({
    family: 'UTILTS',
    code: profile.messageCode,
    standard: 'edifact',
    currentVersion: profile.associationAssignedCode,
    validFrom: profile.effectiveFrom,
    previousVersion: null,
    direction: 'both',
    ...canonicalAckFields('UTILTS', profile.messageCode),
    status: profile.productionReadiness === 'partial' ? 'runtime_partial' : 'runtime_ready',
    sourceTitle: 'Canonical UTILTS guide',
    sourceVersion: profile.guideVersion,
    sourceDate: profile.effectiveFrom,
    operationalNote: `${profile.phase}; ${profile.scope}. Status härleds från kanoniskt UTILTS-register.`,
  }))

// Non-PRODAT/UTILTS catalog metadata. These rows do not define the canonical
// PRODAT/UTILTS version, field, code or ACK matrices guarded by this module.
const OTHER_INSTRUCTION_SPECS = [
  {
    family: 'APERAK',
    code: 'APERAK',
    standard: 'edifact',
    currentVersion: 'E2SE3B',
    validFrom: null,
    direction: 'both',
    ...canonicalAckFields('APERAK', 'APERAK'),
    status: 'runtime_ready',
    sourceTitle: 'APERAK-anvisning + generella tekniska regler',
    sourceVersion: '05B revision 4 / E2SE3B där tillämpligt',
    sourceDate: '2011-11-16',
    operationalNote: 'Applikationskvittens. ACK-semantik härleds från canonicalAckEngine.',
  },
  {
    family: 'CONTRL',
    code: 'CONTRL',
    standard: 'edifact',
    currentVersion: 'D96A',
    validFrom: null,
    direction: 'both',
    ...canonicalAckFields('CONTRL', 'CONTRL'),
    status: 'runtime_ready',
    sourceTitle: 'Generella tekniska regler för Ediel',
    sourceVersion: '24.A revision 6',
    sourceDate: '2026-02-20',
    operationalNote: 'Syntaxkvittens. ACK-semantik härleds från canonicalAckEngine.',
  },
  {
    family: 'UTILTS_ERR',
    code: 'UTILTS_ERR',
    standard: 'edifact',
    currentVersion: 'E5SE5A',
    validFrom: '2025-06-01',
    previousVersion: 'E5SE6B',
    direction: 'both',
    ...canonicalAckFields('UTILTS_ERR', 'ERR'),
    status: 'runtime_ready',
    sourceTitle: 'UTILTS & APERAK per objekt elmarknaden',
    sourceVersion: 'E5SE5A',
    sourceDate: '2025-04-30',
    operationalNote: 'Felkvittens kopplad till UTILTS. ACK-semantik härleds från canonicalAckEngine.',
  },
  {
    family: 'AI_LIST',
    code: 'AI',
    standard: 'ai_list',
    currentVersion: 'Ver20140401',
    validFrom: '2025-10-01',
    direction: 'both',
    requiresContrl: false,
    requiresAperak: false,
    supportsNegativeResponse: false,
    ackDeadlineMinutes: null,
    status: 'runtime_ready',
    sourceTitle: 'AI-listan anvisning version 14.A.3',
    sourceVersion: 'Ver20140401',
    sourceDate: '2025-04-01',
    operationalNote: 'Filtyp är .csv från 2025-10-01 men filen är fortfarande semikolonseparerad.',
  },
  {
    family: 'AI_LIST',
    code: 'BI',
    standard: 'ai_list',
    currentVersion: 'Ver20140401',
    validFrom: '2025-10-01',
    direction: 'both',
    requiresContrl: false,
    requiresAperak: false,
    supportsNegativeResponse: false,
    ackDeadlineMinutes: null,
    status: 'runtime_ready',
    sourceTitle: 'AI-listan anvisning version 14.A.3',
    sourceVersion: 'Ver20140401',
    sourceDate: '2025-04-01',
    operationalNote: 'BI-listan används för byte av anläggnings-id/nätområde/nätbolag och bara av elnätsföretag enligt anvisningen.',
  },
  {
    family: 'OTHER',
    code: 'DELFOR',
    standard: 'edifact',
    currentVersion: 'Ediel2',
    validFrom: null,
    direction: 'both',
    requiresContrl: true,
    requiresAperak: true,
    supportsNegativeResponse: true,
    ackDeadlineMinutes: EDIEL_ACK_DEADLINE_MINUTES,
    status: 'documented_not_enabled',
    sourceTitle: 'DELFOR anvisning Ediel2',
    sourceVersion: 'Ediel2 revision 12',
    sourceDate: '2025-09-25',
    operationalNote: 'Dokumenterat men inte aktiverat i Gridex leverantörsbytes-/mätvärdesruntime nu.',
  },
  {
    family: 'OTHER',
    code: 'QUOTES',
    standard: 'edifact',
    currentVersion: 'Ediel2',
    validFrom: null,
    direction: 'both',
    requiresContrl: true,
    requiresAperak: true,
    supportsNegativeResponse: true,
    ackDeadlineMinutes: 6,
    status: 'documented_not_enabled',
    sourceTitle: 'FCR QUOTES anvisning Ediel2',
    sourceVersion: 'Ediel2 revision 17',
    sourceDate: '2024-04-11',
    operationalNote: 'FCR-bud till SvK. Inte huvudscope för elhandelsplattformen och ska inte blandas in i leverantörsbytesruntime.',
  },
  {
    family: 'NBS_XML',
    code: 'ESETT_XML',
    standard: 'xml',
    currentVersion: '2025.A',
    validFrom: '2025-06-01',
    direction: 'both',
    requiresContrl: false,
    requiresAperak: false,
    supportsNegativeResponse: true,
    ackDeadlineMinutes: null,
    status: 'future_scope',
    sourceTitle: 'XML för eSett-utbyten',
    sourceVersion: '2025.A',
    sourceDate: '2024-11-28',
    operationalNote: 'eSett XML är separat XML-spår. Ska byggas senare med XML-schema, UTF-8 och separat acknowledgement document.',
  },
] as const satisfies readonly EdielInstructionSpec[]

export const EDIEL_INSTRUCTION_SPECS: readonly EdielInstructionSpec[] = [
  ...CANONICAL_PRODAT_INSTRUCTION_SPECS,
  ...CANONICAL_UTILTS_INSTRUCTION_SPECS,
  ...OTHER_INSTRUCTION_SPECS,
]

export function getEdielInstructionSpec(params: {
  family?: string | null
  code?: string | null
  standard?: EdielMessageStandard | null
}): EdielInstructionSpec | null {
  const family = (params.family ?? '').toUpperCase()
  const code = (params.code ?? '').toUpperCase()
  const standard = params.standard ?? null

  return EDIEL_INSTRUCTION_SPECS.find((spec) => {
    if (spec.family !== family) return false
    if (spec.code !== code) return false
    if (standard && spec.standard !== standard) return false
    return true
  }) ?? null
}

export function listRuntimeInstructionSpecs(): EdielInstructionSpec[] {
  return EDIEL_INSTRUCTION_SPECS.filter(
    (spec) => spec.status === 'runtime_ready' || spec.status === 'runtime_partial'
  ) as EdielInstructionSpec[]
}

export function deriveSpecDrivenAckDefaults(params: {
  family: string
  code: string
  standard?: EdielMessageStandard | null
}): {
  requiresContrl: boolean
  requiresAperak: boolean
  contrlStatus: 'pending' | 'not_required'
  aperakStatus: 'pending' | 'not_required'
  utiltsErrStatus: EdielAckStatus
} | null {
  const spec = getEdielInstructionSpec(params)
  if (!spec) return null

  return {
    requiresContrl: spec.requiresContrl,
    requiresAperak: spec.requiresAperak,
    contrlStatus: spec.requiresContrl ? 'pending' : 'not_required',
    aperakStatus: spec.requiresAperak ? 'pending' : 'not_required',
    utiltsErrStatus: 'not_required',
  }
}

export function buildInstructionCoverage(): EdielInstructionCoverage[] {
  const groups = new Map<string, EdielInstructionSpec[]>()

  for (const spec of EDIEL_INSTRUCTION_SPECS) {
    const key = spec.family
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(spec)
  }

  return [...groups.entries()].map(([key, rows]) => {
    const runtimeReady = rows.filter((row) => row.status === 'runtime_ready').length
    const partial = rows.filter((row) => row.status === 'runtime_partial').length
    const documentedNotEnabled = rows.filter((row) => row.status === 'documented_not_enabled').length
    const futureScope = rows.filter((row) => row.status === 'future_scope').length
    const status: EdielInstructionStatus =
      futureScope === rows.length
        ? 'future_scope'
        : documentedNotEnabled === rows.length
          ? 'documented_not_enabled'
          : partial > 0
            ? 'runtime_partial'
            : 'runtime_ready'

    return {
      key,
      label: key,
      status,
      total: rows.length,
      runtimeReady,
      partial,
      documentedNotEnabled,
      futureScope,
      note:
        status === 'runtime_ready'
          ? 'Aktivt runtime-scope.'
          : status === 'runtime_partial'
            ? 'Delar är runtime-klara, men full fältmappning/affärslogik återstår.'
            : status === 'documented_not_enabled'
              ? 'Dokumenterat men inte huvudscope för Gridex nu.'
              : 'Framtida separat spår.',
    }
  })
}

export function instructionStatusLabel(status: EdielInstructionStatus): string {
  if (status === 'runtime_ready') return 'Runtime-klar'
  if (status === 'runtime_partial') return 'Delvis klar'
  if (status === 'documented_not_enabled') return 'Dokumenterad / ej aktiverad'
  return 'Senare scope'
}
