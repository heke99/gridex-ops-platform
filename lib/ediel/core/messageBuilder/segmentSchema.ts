// lib/ediel/core/messageBuilder/segmentSchema.ts

export type EdielBuilderFamily = 'PRODAT' | 'UTILTS' | 'APERAK' | 'CONTRL' | 'UTILTS_ERR' | 'AI_LIST' | 'BI_LIST' | 'NBS_XML' | 'OTHER'

export type SegmentRequirement = {
  tag: string
  min?: number
  max?: number | null
  description: string
}

export type SegmentFieldLimit = {
  segment: string
  elementIndex: number
  componentIndex?: number | null
  max: number
  label: string
  severity?: 'warning' | 'error'
}

export type EdielMessageProfile = {
  key: string
  family: EdielBuilderFamily
  codes: string[] | '*'
  versionLabel: string
  expectedUnhTokens: string[]
  allowedBgmCodes: string[] | '*'
  requiredSegments: SegmentRequirement[]
  forbiddenSegments?: SegmentRequirement[]
  orderedTags: string[]
  fieldLimits: SegmentFieldLimit[]
  description: string
}

const COMMON_EDIFACT_LIMITS: SegmentFieldLimit[] = [
  { segment: 'UNB', elementIndex: 2, componentIndex: 0, max: 35, label: 'UNB avsändare' },
  { segment: 'UNB', elementIndex: 2, componentIndex: 2, max: 14, label: 'UNB avsändar-subadress' },
  { segment: 'UNB', elementIndex: 3, componentIndex: 0, max: 35, label: 'UNB mottagare' },
  { segment: 'UNB', elementIndex: 3, componentIndex: 2, max: 14, label: 'UNB mottagar-subadress' },
  { segment: 'UNB', elementIndex: 5, max: 14, label: 'UNB interchange reference' },
  { segment: 'UNB', elementIndex: 7, max: 14, label: 'Application Reference' },
  { segment: 'UNH', elementIndex: 1, max: 14, label: 'UNH message reference' },
  { segment: 'BGM', elementIndex: 2, max: 35, label: 'BGM dokumentreferens' },
]

const ACK_REQUIRED_PARTIES: SegmentRequirement[] = [
  { tag: 'NAD', min: 2, description: 'APERAK/UTILTS_ERR ska identifiera avsändare och mottagare.' },
]

export const EDIEL_MESSAGE_PROFILES: EdielMessageProfile[] = [
  {
    key: 'PRODAT_26A',
    family: 'PRODAT',
    codes: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'],
    versionLabel: 'PRODAT 26.A / E2SE6A',
    expectedUnhTokens: ['PRODAT:D:97A:UN:E2SE6A'],
    allowedBgmCodes: ['Z01', 'Z02', 'Z03', 'Z04', 'Z05', 'Z06', 'Z08', 'Z09', 'Z10', 'Z13', 'Z14', 'Z15', 'Z18'],
    requiredSegments: [
      { tag: 'UNB', min: 1, max: 1, description: 'Interchange header krävs.' },
      { tag: 'UNH', min: 1, max: 1, description: 'Message header krävs.' },
      { tag: 'BGM', min: 1, max: 1, description: 'PRODAT-funktion krävs i BGM.' },
      { tag: 'DTM', min: 1, description: 'PRODAT ska innehålla datum/tid-segment.' },
      { tag: 'NAD', min: 2, description: 'PRODAT ska innehålla minst avsändare/mottagare.' },
      { tag: 'LIN', min: 1, description: 'PRODAT ska innehålla minst en transaktion/anläggningsrad.' },
      { tag: 'UNT', min: 1, max: 1, description: 'Message trailer krävs.' },
      { tag: 'UNZ', min: 1, max: 1, description: 'Interchange trailer krävs.' },
    ],
    orderedTags: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'LIN', 'UNT', 'UNZ'],
    fieldLimits: COMMON_EDIFACT_LIMITS,
    description: 'PRODAT ska byggas med huvudfunktionen i BGM, t.ex. Z03/Z13. Undertyp ligger inte i BGM.',
  },
  {
    key: 'UTILTS_E5SE5A',
    family: 'UTILTS',
    codes: ['E66', 'E73', 'E31', 'S01', 'S02', 'S03', 'S04'],
    versionLabel: 'UTILTS E5SE5A',
    expectedUnhTokens: ['UTILTS:D:02B:UN:E5SE5A'],
    allowedBgmCodes: ['E66', 'E73', 'E31', 'S01', 'S02', 'S03', 'S04', 'ERR'],
    requiredSegments: [
      { tag: 'UNB', min: 1, max: 1, description: 'Interchange header krävs.' },
      { tag: 'UNH', min: 1, max: 1, description: 'Message header krävs.' },
      { tag: 'BGM', min: 1, max: 1, description: 'UTILTS-funktion krävs i BGM.' },
      { tag: 'DTM', min: 1, description: 'UTILTS ska innehålla datum/tid-segment.' },
      { tag: 'NAD', min: 2, description: 'UTILTS ska identifiera avsändare och mottagare.' },
      { tag: 'UNT', min: 1, max: 1, description: 'Message trailer krävs.' },
      { tag: 'UNZ', min: 1, max: 1, description: 'Interchange trailer krävs.' },
    ],
    orderedTags: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'IDE', 'LOC', 'LIN', 'SEQ', 'QTY', 'UNT', 'UNZ'],
    fieldLimits: COMMON_EDIFACT_LIMITS,
    description: 'UTILTS-profil för E5SE5A. E66 kan vara SCH/kvart och får inte valideras som en enda rigid form.',
  },
  {
    key: 'APERAK_PRODAT_16B',
    family: 'APERAK',
    codes: ['APERAK'],
    versionLabel: 'APERAK PRODAT 16.B / E2SE6A',
    expectedUnhTokens: ['APERAK:D:96A:UN:E2SE6A'],
    allowedBgmCodes: ['27', '34', '312', '313'],
    requiredSegments: [
      { tag: 'UNB', min: 1, max: 1, description: 'Interchange header krävs.' },
      { tag: 'UNH', min: 1, max: 1, description: 'Message header krävs.' },
      { tag: 'BGM', min: 1, max: 1, description: 'APERAK ska innehålla BGM.' },
      { tag: 'DTM', min: 1, description: 'APERAK ska innehålla dokumentdatum.' },
      ...ACK_REQUIRED_PARTIES,
      { tag: 'ERC', min: 1, description: 'APERAK ska innehålla minst en applikationsstatus/felkod.' },
      { tag: 'FTX', min: 1, description: 'Varje APERAK-status ska ha kort, mottagarvänlig FTX-text.' },
      { tag: 'UNT', min: 1, max: 1, description: 'Message trailer krävs.' },
      { tag: 'UNZ', min: 1, max: 1, description: 'Interchange trailer krävs.' },
    ],
    orderedTags: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'ERC', 'FTX', 'UNT', 'UNZ'],
    fieldLimits: [
      ...COMMON_EDIFACT_LIMITS,
      { segment: 'FTX', elementIndex: 4, componentIndex: 0, max: 70, label: 'APERAK FTX fri text' },
    ],
    description: 'APERAK för PRODAT ska byggas från responsePlan, inte bestämma outcome själv.',
  },
  {
    key: 'APERAK_UTILTS_E5SE5A',
    family: 'APERAK',
    codes: ['APERAK'],
    versionLabel: 'APERAK UTILTS E5SE5A',
    expectedUnhTokens: ['APERAK:D:04A:UN:E5SE5A'],
    allowedBgmCodes: ['312', '313'],
    requiredSegments: [
      { tag: 'UNB', min: 1, max: 1, description: 'Interchange header krävs.' },
      { tag: 'UNH', min: 1, max: 1, description: 'Message header krävs.' },
      { tag: 'BGM', min: 1, max: 1, description: 'UTILTS-APERAK ska innehålla BGM 312/313.' },
      { tag: 'DTM', min: 1, description: 'APERAK ska innehålla dokumentdatum.' },
      ...ACK_REQUIRED_PARTIES,
      { tag: 'ERC', min: 1, description: 'UTILTS-APERAK ska innehålla ERC 100/40/41/42.' },
      { tag: 'FTX', min: 1, description: 'UTILTS-APERAK ska innehålla FTX, normalt OK eller kort feltext.' },
      { tag: 'UNT', min: 1, max: 1, description: 'Message trailer krävs.' },
      { tag: 'UNZ', min: 1, max: 1, description: 'Interchange trailer krävs.' },
    ],
    orderedTags: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'ERC', 'FTX', 'UNT', 'UNZ'],
    fieldLimits: [
      ...COMMON_EDIFACT_LIMITS,
      { segment: 'FTX', elementIndex: 4, componentIndex: 0, max: 70, label: 'APERAK FTX fri text' },
    ],
    description: 'APERAK för UTILTS: positiv BGM 312/ERC 100/OK, negativ BGM 313/ERC 40/41/42.',
  },
  {
    key: 'CONTRL_EDIEL2',
    family: 'CONTRL',
    codes: ['CONTRL'],
    versionLabel: 'CONTRL EDIEL2',
    expectedUnhTokens: ['CONTRL:2:2:UN:EDIEL2'],
    allowedBgmCodes: '*',
    requiredSegments: [
      { tag: 'UNB', min: 1, max: 1, description: 'Interchange header krävs.' },
      { tag: 'UNH', min: 1, max: 1, description: 'Message header krävs.' },
      { tag: 'UCI', min: 1, description: 'CONTRL ska innehålla UCI.' },
      { tag: 'UNT', min: 1, max: 1, description: 'Message trailer krävs.' },
      { tag: 'UNZ', min: 1, max: 1, description: 'Interchange trailer krävs.' },
    ],
    forbiddenSegments: [{ tag: 'BGM', max: 0, description: 'CONTRL ska inte innehålla BGM.' }],
    orderedTags: ['UNB', 'UNH', 'UCI', 'UCM', 'UCS', 'UCD', 'UCF', 'UNT', 'UNZ'],
    fieldLimits: COMMON_EDIFACT_LIMITS,
    description: 'CONTRL är teknisk syntaxkvittens per mottaget meddelande, inte per transaktion/anläggning.',
  },
  {
    key: 'UTILTS_ERR_E5SE5A',
    family: 'UTILTS_ERR',
    codes: ['UTILTS_ERR', 'ERR'],
    versionLabel: 'UTILTS_ERR E5SE5A',
    expectedUnhTokens: ['UTILTS:D:02B:UN:E5SE5A'],
    allowedBgmCodes: ['ERR'],
    requiredSegments: [
      { tag: 'UNB', min: 1, max: 1, description: 'Interchange header krävs.' },
      { tag: 'UNH', min: 1, max: 1, description: 'Message header krävs.' },
      { tag: 'BGM', min: 1, max: 1, description: 'UTILTS_ERR ska ha BGM+ERR.' },
      { tag: 'DTM', min: 1, description: 'UTILTS_ERR ska innehålla dokumentdatum.' },
      ...ACK_REQUIRED_PARTIES,
      { tag: 'STS', min: 1, description: 'UTILTS_ERR ska innehålla STS med process-/funktionsfel.' },
      { tag: 'RFF', min: 1, description: 'UTILTS_ERR ska referera till transaktion/ursprungsmeddelande.' },
      { tag: 'UNT', min: 1, max: 1, description: 'Message trailer krävs.' },
      { tag: 'UNZ', min: 1, max: 1, description: 'Interchange trailer krävs.' },
    ],
    orderedTags: ['UNB', 'UNH', 'BGM', 'DTM', 'NAD', 'IDE', 'STS', 'RFF', 'UNT', 'UNZ'],
    fieldLimits: COMMON_EDIFACT_LIMITS,
    description: 'UTILTS_ERR används vid UTILTS process-/funktionsfel och byggs från responsePlan.',
  },
]

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

export function tagOf(segment: string | null | undefined): string {
  return normalize(String(segment ?? '').split('+')[0] ?? '')
}

export function segmentCount(rawSegments: readonly string[], tag: string): number {
  const normalizedTag = normalize(tag)
  return rawSegments.filter((segment) => tagOf(segment) === normalizedTag).length
}

export function profileForMessage(input: {
  family?: string | null
  code?: string | null
  messageTypeToken?: string | null
  rawSegments?: readonly string[] | null
}): EdielMessageProfile | null {
  const family = normalize(input.family)
  const code = normalize(input.code)
  const token = normalize(input.messageTypeToken)
  const bgm = input.rawSegments?.find((segment) => tagOf(segment) === 'BGM')?.split('+')[1]?.split(':')[0]?.trim().toUpperCase() ?? code

  if (family === 'APERAK' || token.startsWith('APERAK')) {
    if (token.includes('D:04A') || token.includes('E5SE5A') || bgm === '312' || bgm === '313') {
      return EDIEL_MESSAGE_PROFILES.find((profile) => profile.key === 'APERAK_UTILTS_E5SE5A') ?? null
    }
    return EDIEL_MESSAGE_PROFILES.find((profile) => profile.key === 'APERAK_PRODAT_16B') ?? null
  }

  if (family === 'UTILTS_ERR' || (token.startsWith('UTILTS') && bgm === 'ERR')) {
    return EDIEL_MESSAGE_PROFILES.find((profile) => profile.key === 'UTILTS_ERR_E5SE5A') ?? null
  }

  return EDIEL_MESSAGE_PROFILES.find((profile) => {
    if (profile.family !== family && !(family === 'UTILTS' && profile.family === 'UTILTS')) return false
    if (profile.codes === '*') return true
    return profile.codes.includes(code) || profile.codes.includes(bgm)
  }) ?? null
}

export function expectedProfileKeysForFamily(family: string | null | undefined): string[] {
  const normalizedFamily = normalize(family)
  return EDIEL_MESSAGE_PROFILES.filter((profile) => profile.family === normalizedFamily).map((profile) => profile.key)
}
