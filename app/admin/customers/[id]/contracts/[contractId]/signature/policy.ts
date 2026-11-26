import 'server-only'
import type { PermissionRequirement } from '@/lib/admin/accessModel'

export const SEND_CONTRACT_SIGNATURE_REQUIREMENT: PermissionRequirement = {
  allOf: ['contracts.write', 'contracts.create'],
}

export const SIGNATURE_COMPANY_NOT_OPERATIONAL =
  'Bolaget måste vara aktivt innan signeringslänken kan skickas.'
