import { normalizeUuidOrNull, requireUuid, UuidValidationError } from '@/lib/validation/uuid'

export type FormUuidField =
  | 'company_id'
  | 'customer_id'
  | 'customer_site_id'
  | 'site_id'
  | 'metering_point_id'
  | 'grid_owner_id'
  | 'selected_grid_owner_id'
  | 'contract_id'
  | 'power_of_attorney_id'
  | 'authorization_document_id'
  | 'document_id'
  | 'operation_id'
  | 'outbound_request_id'
  | 'route_profile_id'
  | 'communication_route_id'
  | 'ediel_message_id'
  | 'customer_info_request_id'
  | string

function valueFromForm(formData: FormData, field: string): FormDataEntryValue | null {
  return formData.get(field)
}

export function formOptionalUuid(formData: FormData, field: FormUuidField): string | null {
  return normalizeUuidOrNull(valueFromForm(formData, field), field)
}

export function formUuid(formData: FormData, field: FormUuidField): string {
  return requireUuid(valueFromForm(formData, field), field)
}

export function formUuidOrThrow(formData: FormData, field: FormUuidField): string {
  return formUuid(formData, field)
}

export function normalizeUuidBoundary(value: unknown, field: FormUuidField): string | null {
  return normalizeUuidOrNull(value, field)
}

export function isUuidValidationError(error: unknown): error is UuidValidationError {
  return error instanceof UuidValidationError
}
