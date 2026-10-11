/**
 * Explicit response projection per qualified client profile (package 4).
 *
 * Only profiles whose historical representation differs from the canonical
 * one get an allowlist. Projection runs after business/tenant validation and
 * never strips security fields generically. Today every registered V1 profile
 * shares the canonical representation, so projection is the identity and the
 * representation is labelled with the selected profile.
 */
import type { ApiContractProfile, ApiSurface } from '@/lib/integrations/apiContractCompatibility'

type Allowlist = { topLevel: readonly string[]; item?: readonly string[] }

/** Keyed by `${surface}:${revision}`. Empty until a profile needs one. */
export const API_PROFILE_ALLOWLISTS: Readonly<Record<string, Allowlist>> = {}

function pick(source: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]]))
}

export function projectForProfile<T>(profile: Pick<ApiContractProfile, 'surface' | 'revision'>, body: T, itemKey = 'data'): T {
  const allowlist = API_PROFILE_ALLOWLISTS[`${profile.surface}:${profile.revision}`]
  if (!allowlist || !body || typeof body !== 'object' || Array.isArray(body)) return body
  const projected = pick(body as Record<string, unknown>, allowlist.topLevel)
  const items = (body as Record<string, unknown>)[itemKey]
  if (allowlist.item && Array.isArray(items)) {
    projected[itemKey] = items.map((item) => item && typeof item === 'object' ? pick(item as Record<string, unknown>, allowlist.item!) : item)
  }
  return projected as T
}

/** Cache identity: different profiles never share a representation ETag. */
export function profileRepresentationKey(surface: ApiSurface, revision: string): string {
  return `${surface}:v1:${revision}`
}
