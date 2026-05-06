// lib/ediel/prodat/builders/z01.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildGenericProdatSegments } from '@/lib/ediel/prodat/builders/generic'

export function buildZ01Segments(input: {
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
    renderer: 'prodat.builders.z01.buildZ01Segments',
  })
}
