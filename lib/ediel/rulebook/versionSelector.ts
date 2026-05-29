import { getRulebookRule, messageVersionForFamily } from '@/lib/ediel/rulebook/rulebook'

export type RulebookVersionSelection = {
  selectedVersion: string
  previousVersion: string | null
  acceptedVersions: string[]
  messageTypeToken: string
}

export function selectRulebookVersion(input: {
  family: string | null | undefined
  code?: string | null
  asOf?: Date
}): RulebookVersionSelection {
  const rule = getRulebookRule(input.family, input.code)
  const selectedVersion = rule?.version ?? messageVersionForFamily(input.family, input.code)
  const previousVersion = rule?.previousVersion ?? null
  const family = String(input.family ?? '').toUpperCase()
  const code = String(input.code ?? '').toUpperCase()

  let messageTypeToken = `${family}:${selectedVersion}`
  if (family === 'PRODAT') messageTypeToken = `PRODAT:D:97A:UN:${selectedVersion === '26A' ? 'E2SE6A' : selectedVersion}`
  if (family === 'APERAK' || code === 'APERAK') messageTypeToken = `APERAK:D:96A:UN:${selectedVersion === '16B' ? 'E2SE6A' : selectedVersion}`
  if (family === 'CONTRL' || code === 'CONTRL') messageTypeToken = 'CONTRL:D:96A:UN:1.0'
  if (family === 'UTILTS') messageTypeToken = `UTILTS:D:02B:UN:${selectedVersion}`

  return {
    selectedVersion,
    previousVersion,
    acceptedVersions: [selectedVersion, previousVersion].filter((value): value is string => Boolean(value)),
    messageTypeToken,
  }
}
