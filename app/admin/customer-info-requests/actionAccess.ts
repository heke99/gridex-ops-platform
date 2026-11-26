import type { PermissionRequirement } from '@/lib/admin/accessModel'

export const customerInfoRequestActionAccess = {
  createRequest: { anyOf: ['customers.write'] },
  createAuthorization: { anyOf: ['poa.write', 'customers.write'] },
  createMeteringPermissionDraft: { anyOf: ['metering.write', 'customers.write'] },
  prepareRequest: { anyOf: ['customers.write', 'communication.send'] },
  closeRequest: { anyOf: ['customers.write'] },
} satisfies Record<string, PermissionRequirement>
