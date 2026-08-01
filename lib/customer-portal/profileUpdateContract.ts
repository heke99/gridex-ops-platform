import { z } from 'zod'
import { ApiInputError } from '@/lib/api/strictRequest'

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional()

const profileSchema = z.object({
  first_name: optionalText(120),
  last_name: optionalText(120),
  full_name: optionalText(240),
  company_name: optionalText(240),
  email: z.string().trim().email().max(320).optional(),
  phone: optionalText(50),
  invoice_email: z.string().trim().email().max(320).optional(),
  language_code: optionalText(10),
  timezone: optionalText(80),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'profile måste innehålla minst ett uppdateringsfält.',
})

const addressSchema = z.object({
  street: optionalText(300),
  postal_code: optionalText(20),
  city: optionalText(120),
  country: optionalText(2),
  care_of: optionalText(200),
  apartment_number: optionalText(50),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'facility_data.address måste innehålla minst ett adressfält.',
})

const facilityDataSchema = z.object({
  facility_reference: z.string().trim().min(1).max(120),
  address: addressSchema,
  external_request_id: optionalText(200),
}).strict()

const profileUpdateSchema = z.object({
  profile: profileSchema.optional(),
  facility_data: facilityDataSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  if (!value.profile && !value.facility_data) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['profile'],
      message: 'profile eller facility_data krävs.',
    })
  }
})

export type CustomerProfileUpdateRequest = z.infer<typeof profileUpdateSchema>

export function parseCustomerProfileUpdateRequest(value: unknown): CustomerProfileUpdateRequest {
  const parsed = profileUpdateSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ApiInputError(
      issue?.message ?? 'Profiluppdateringen är ogiltig.',
      issue?.code === 'unrecognized_keys' ? 'unknown_field' : 'validation_failed',
      422,
      issue?.path.join('.') || null,
    )
  }
  return parsed.data
}
