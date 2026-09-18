import type { Parts } from './prodat-register'

// Synthetic P26.A p79 NAD fixture, independent of runtime renderer.
export function ud(overrides: Record<number, string | readonly string[]> = {}): Parts {
  const parts: (string | readonly string[])[] = ['NAD', 'UD', ['00-CUSTOMER', '', '89'], '', ['Name', 'Second'], ['Street', '', 'Box'], 'Town', '', '001 23', 'SE']
  for (const [key, value] of Object.entries(overrides)) parts[Number(key)] = value
  return parts
}
