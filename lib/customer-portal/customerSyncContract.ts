import { z } from 'zod'
import { ApiInputError, requireIsoDate } from '@/lib/api/strictRequest'
import type { TenantCustomerSyncPayload } from '@/lib/customer-portal/tenantSync'

const optionalText = (max: number) =>
  z.string().trim().min(1).max(max).optional()

const metadata = z.record(z.unknown()).optional()

const address = z.object({
  street: optionalText(300),
  postal_code: optionalText(20),
  city: optionalText(120),
  country: optionalText(2),
  care_of: optionalText(200),
  apartment_number: optionalText(50),
}).strict()

const facility = z.object({
  facility_reference: optionalText(100),
  facility_id: optionalText(100),
  metering_point_id: optionalText(100),
  move_in_date: optionalText(10),
  requested_start_date: optionalText(10),
  address: address.optional(),
  metadata,
}).strict()

const document = z.object({
  document_reference: optionalText(100),
  document_type: optionalText(100),
  title: optionalText(300),
  status: optionalText(50),
  secure_url: z.string().url().max(2_000).optional(),
  file_name: optionalText(255),
  mime_type: optionalText(120),
  file_size_bytes: z.number().int().nonnegative().max(100_000_000).optional(),
  metadata,
}).strict()

const legalAcceptance = z.object({
  document_reference: z.string().trim().min(20).max(100),
  document_code: z.string().trim().min(1).max(120),
  document_version: z.string().trim().min(1).max(255),
  document_hash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  accepted: z.literal(true),
  accepted_at: z.string().datetime({ offset: true }),
  metadata,
}).strict()

const TENANT_POWER_OF_ATTORNEY_SCOPES = new Set([
  'supplier_switch',
  'facility_information_lookup',
])

const powerOfAttorney = z.object({
  power_of_attorney_reference: optionalText(120),
  document_reference: z.string().trim().min(20).max(100),
  scope: z
    .array(
      z.enum([
        'supplier_switch',
        'facility_information_lookup',
      ]),
    )
    .min(1)
    .max(2),
  accepted: z.literal(true),
  accepted_at: z.string().datetime({ offset: true }),
  signer_name: optionalText(240),
  signer_identity_number: optionalText(100),
  method: optionalText(100),
  ip_address: optionalText(100),
  user_agent: optionalText(2_000),
  valid_from: optionalText(10),
  valid_to: optionalText(10),
  metadata,
}).strict().superRefine((value, context) => {
  const scopes: string[] = Array.from(
    new Set<string>(value.scope.map((scope: string) => scope.trim().toLowerCase())),
  )
  const unsupported = scopes.filter(
    (scope) => !TENANT_POWER_OF_ATTORNEY_SCOPES.has(scope),
  )
  if (unsupported.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Fullmakten innehåller scopes som inte stöds: ${unsupported.join(', ')}.`,
      path: ['scope'],
    })
  }
  if (scopes.length !== value.scope.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Fullmaktens scope får inte innehålla dubbletter.',
      path: ['scope'],
    })
  }
  if (!scopes.includes('supplier_switch')) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Fullmakten måste uttryckligen innehålla supplier_switch.',
      path: ['scope'],
    })
  }
})

const profile = z.object({
  first_name: optionalText(120),
  last_name: optionalText(120),
  full_name: optionalText(240),
  company_name: optionalText(240),
  phone: optionalText(50),
  invoice_email: z.string().trim().email().max(320).optional(),
  language_code: optionalText(10),
  timezone: optionalText(80),
}).strict()

const syncRequest = z.object({
  email: z.string().trim().email().max(320).optional(),
  customer_number: optionalText(100),
  external_customer_id: optionalText(200),
  authenticated_user_reference: optionalText(200),
  profile: profile.optional(),
  facility_data: z.array(facility).max(20).optional(),
  documents: z.array(document).max(100).optional(),
  legal_acceptances: z.array(legalAcceptance).max(100).optional(),
  power_of_attorney: powerOfAttorney.optional(),
  metadata,
}).strict().superRefine((value, context) => {
  if (
    !value.email &&
    !value.customer_number &&
    !value.external_customer_id &&
    !value.authenticated_user_reference
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Minst en kundidentifierare krävs.',
      path: ['external_customer_id'],
    })
  }
})

function validateOptionalDate(value: string | undefined, field: string) {
  if (value !== undefined) requireIsoDate(value, field)
}

export function parseTenantCustomerSyncPayload(
  input: unknown,
): TenantCustomerSyncPayload {
  const parsed = syncRequest.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiInputError(
      issue?.message ?? 'Kundsynk-requesten är ogiltig.',
      issue?.code === 'unrecognized_keys'
        ? 'unknown_field'
        : 'VALIDATION_FAILED',
      422,
      issue?.path.join('.') || null,
    )
  }
  for (const [index, item] of (parsed.data.facility_data ?? []).entries()) {
    validateOptionalDate(item.move_in_date, `facility_data.${index}.move_in_date`)
    validateOptionalDate(
      item.requested_start_date,
      `facility_data.${index}.requested_start_date`,
    )
  }
  if (parsed.data.power_of_attorney) {
    validateOptionalDate(
      parsed.data.power_of_attorney.valid_from,
      'power_of_attorney.valid_from',
    )
    validateOptionalDate(
      parsed.data.power_of_attorney.valid_to,
      'power_of_attorney.valid_to',
    )
  }
  return parsed.data as TenantCustomerSyncPayload
}
