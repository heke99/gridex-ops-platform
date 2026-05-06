// lib/ediel/prodat/registry.ts

import type { ProdatEngineAckExpectation, ProdatEngineCode } from '@/lib/ediel/prodat/types'

export const ACTIVE_PRODAT_ENGINE_CODES: readonly ProdatEngineCode[] = [
  'Z01',
  'Z02',
  'Z03',
  'Z04',
  'Z05',
  'Z06',
  'Z09',
  'Z10',
  'Z13',
  'Z14',
  'Z15',
  'Z18',
] as const

export function isProdatEngineCode(value: string | null | undefined): value is ProdatEngineCode {
  return Boolean(value && (ACTIVE_PRODAT_ENGINE_CODES as readonly string[]).includes(value))
}

export function prodatMessageTypeToken(version: string | null | undefined): string {
  const selectedVersion = version && version.trim().length > 0 ? version.trim() : '26A'
  return `PRODAT:D:97A:UN:${selectedVersion === '26A' ? 'E2SE6A' : selectedVersion}`
}

export function deriveProdatAckExpectation(): ProdatEngineAckExpectation {
  return {
    requiresContrl: true,
    requiresAperak: true,
    contrlStatus: 'pending',
    aperakStatus: 'pending',
    utiltsErrStatus: 'not_required',
    ackDueAt: null,
  }
}
