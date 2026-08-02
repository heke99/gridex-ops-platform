import registry from '@/lib/integrations/public-api-error-registry.json'

export type PublicApiErrorDefinition = {
  http_status: number
  public_message: string
  retryable: boolean
  security_sensitive: boolean
  routes: string[]
}

export const PUBLIC_API_ERROR_REGISTRY = registry as Record<string, PublicApiErrorDefinition>
export type PublicApiErrorCode = keyof typeof registry

export function publicApiErrorDefinition(code: string): PublicApiErrorDefinition | null {
  return PUBLIC_API_ERROR_REGISTRY[code] ?? null
}
