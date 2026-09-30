import { createHash } from 'node:crypto'
import { readLockedEffectiveBillingProfile } from '@/lib/billing/effectiveBillingProfile'

/** Preserve the existing compact, sorted-key billing snapshot serialization. */
export function serializeBillingConfigurationSnapshot(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeBillingConfigurationSnapshot).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${serializeBillingConfigurationSnapshot(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function billingConfigurationSnapshotSha256(value: unknown): string {
  return createHash('sha256').update(serializeBillingConfigurationSnapshot(value)).digest('hex')
}

export function readQualifiedLockedBillingProfile(snapshot: unknown, expected: {
  companyId: string; customerId: string; contractId: string; snapshotSha256: unknown
}) {
  if (typeof expected.snapshotSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expected.snapshotSha256)
      || billingConfigurationSnapshotSha256(snapshot) !== expected.snapshotSha256) return null
  return readLockedEffectiveBillingProfile(snapshot, expected)
}
