// lib/ediel/prodat/builders/z03.ts

import type {
  ProdatEnginePortalSnapshot,
  ProdatEngineProductionContext,
  ProdatEngineRenderResult,
} from '@/lib/ediel/prodat/types'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'

export function buildZ03Segments(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
  mode?: 'test' | 'production'
  variant?: string | null
  routeDecisionReason?: string | null
  selectedVersion?: string | null
  acceptedVersions?: string[]
}): ProdatEngineRenderResult {
  return buildProfiledProdatSegments({
    ...input,
    renderer: 'prodat.builders.z03.buildZ03Segments',
  })
}
