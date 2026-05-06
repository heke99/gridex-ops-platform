// lib/ediel/prodat/builders/z05.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildGenericProdatSegments } from '@/lib/ediel/prodat/builders/generic'

export function buildZ05Segments(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
  mode?: 'test' | 'production'
  variant?: string | null
  routeDecisionReason?: string | null
  selectedVersion?: string | null
  acceptedVersions?: string[]
}): ProdatEngineRenderResult {
  return buildGenericProdatSegments({
    ...input,
    renderer: 'prodat.builders.z05.buildZ05Segments',
  })
}
