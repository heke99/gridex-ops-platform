import type { ProdatEnginePortalSnapshot, ProdatEngineProductionContext, ProdatEngineRenderResult } from '@/lib/ediel/prodat/types'
import { buildProfiledProdatSegments } from '@/lib/ediel/prodat/builders/profileRenderer'

export function buildZ08Segments(input: {
  context: ProdatEngineProductionContext
  portalSnapshot?: ProdatEnginePortalSnapshot
  generatedAt?: Date
  mode?: 'test' | 'production'
  variant?: string | null
  routeDecisionReason?: string | null
  selectedVersion?: string | null
  acceptedVersions?: string[]
}): ProdatEngineRenderResult {
  return buildProfiledProdatSegments({ ...input, variant: input.variant ?? 'H', renderer: 'prodat.builders.z08.buildZ08Segments' })
}
