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
  expected_address_revision: z.number().int().nonnegative().safe().optional(),
  address: addressSchema,
  external_request_id: optionalText(200),
}).strict()

const profileUpdateSchema = z.object({
  profile: profileSchema.optional(),
  facility_data: facilityDataSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
  expected_contact_revision: z.number().int().nonnegative().safe().optional(),
  expected_billing_revision: z.number().int().nonnegative().safe().optional(),
  expected_profile_revision: z.number().int().nonnegative().safe().optional(),
}).strict().superRefine((value, context) => {
  if (!value.profile && !value.facility_data) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['profile'],
      message: 'profile eller facility_data krävs.',
    })
  }
  if (value.profile && value.facility_data) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['facility_data'],
      message: 'Profil och anläggningsadress måste skickas som separata operationer.',
    })
  }
  if (value.profile && ('email' in value.profile || 'phone' in value.profile)) {
    // New commands require a saved revision at the transactional boundary.
    // Omission is parsed only so an authorized historical completed claim can replay.
    if (value.facility_data || value.metadata ||
        Object.keys(value.profile).some((key) => key !== 'email' && key !== 'phone')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profile'],
        message: 'Kontaktändring måste skickas separat från övriga profil- och anläggningsfält.',
      })
    }
  } else if (value.expected_contact_revision !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['expected_contact_revision'],
      message: 'Kontaktrevision får endast skickas med e-post eller telefon.',
    })
  }
  if (value.profile && 'invoice_email' in value.profile) {
    // The atomic command requires a saved revision for new billing writes.
    // Revision omission and historical metadata reach only that completed-claim
    // lookup. The command rejects metadata before every fresh billing mutation.
    if (value.facility_data || Object.keys(value.profile).some((key) => key !== 'invoice_email')) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['profile'],
        message: 'Faktureringsändring måste skickas separat från kontakt- och anläggningsuppgifter.' })
    }
  } else if (value.expected_billing_revision !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expected_billing_revision'],
      message: 'Faktureringsrevision får endast skickas med invoice_email.' })
  }
  if (value.expected_profile_revision !== undefined &&
      (!value.profile || Object.keys(value.profile).some((field) => field !== 'language_code' && field !== 'timezone'))) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['expected_profile_revision'],
      message: 'Profilrevision får endast skickas med språk eller tidszon.' })
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
