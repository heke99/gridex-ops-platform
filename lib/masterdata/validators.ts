import { z } from 'zod'

export const priceAreaCodeSchema = z.enum(['SE1', 'SE2', 'SE3', 'SE4'])

export const siteTypeSchema = z.enum(['consumption', 'production', 'mixed'])
export const siteStatusSchema = z.enum([
  'draft',
  'active',
  'pending_move',
  'inactive',
  'closed',
])

export const meteringPointStatusSchema = z.enum([
  'draft',
  'active',
  'pending_validation',
  'inactive',
  'closed',
])

export const measurementTypeSchema = z.enum([
  'consumption',
  'production',
  'mixed',
])

export const readingFrequencySchema = z.enum([
  'hourly',
  'daily',
  'monthly',
  'manual',
])

const nullableTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => {
    if (!value) return null
    return value
  })

const requiredTrimmedString = z
  .string()
  .trim()
  .min(1, 'Fältet är obligatoriskt')

export const gridOwnerInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: requiredTrimmedString,
  owner_code: requiredTrimmedString,
  ediel_id: nullableTrimmedString,
  org_number: nullableTrimmedString,
  contact_name: nullableTrimmedString,
  email: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value) return null
      return value.toLowerCase()
    })
    .refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'Ogiltig e-postadress',
    }),
  phone: nullableTrimmedString,
  address_line_1: nullableTrimmedString,
  address_line_2: nullableTrimmedString,
  postal_code: nullableTrimmedString,
  city: nullableTrimmedString,
  country: z.string().trim().default('SE'),
  notes: nullableTrimmedString,
  is_active: z.boolean().default(true),
})

export type GridOwnerInput = z.infer<typeof gridOwnerInputSchema>

export const customerSiteInputSchema = z.object({
  id: z.string().uuid().optional(),
  customer_id: z.string().uuid(),
  site_name: requiredTrimmedString,
  facility_id: nullableTrimmedString,
  site_type: siteTypeSchema,
  status: siteStatusSchema.default('draft'),
  grid_owner_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  price_area_code: priceAreaCodeSchema.nullable().optional().transform((v) => v ?? null),
  move_in_date: nullableTrimmedString,
  annual_consumption_kwh: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined || value === '') return null
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : NaN
    })
    .refine((value) => value === null || !Number.isNaN(value), {
      message: 'Årsförbrukning måste vara ett giltigt nummer',
    }),
  current_supplier_name: nullableTrimmedString,
  current_supplier_org_number: nullableTrimmedString,
  street: nullableTrimmedString,
  care_of: nullableTrimmedString,
  postal_code: nullableTrimmedString,
  city: nullableTrimmedString,
  country: z.string().trim().default('SE'),
  internal_notes: nullableTrimmedString,
})

export type CustomerSiteInput = z.infer<typeof customerSiteInputSchema>

export const meteringPointInputSchema = z.object({
  id: z.string().uuid().optional(),
  site_id: z.string().uuid(),
  meter_point_id: requiredTrimmedString,
  site_facility_id: nullableTrimmedString,
  ediel_reference: nullableTrimmedString,
  status: meteringPointStatusSchema.default('draft'),
  measurement_type: measurementTypeSchema,
  reading_frequency: readingFrequencySchema,
  grid_owner_id: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  price_area_code: priceAreaCodeSchema.nullable().optional().transform((v) => v ?? null),
  start_date: nullableTrimmedString,
  end_date: nullableTrimmedString,
  is_settlement_relevant: z.boolean().default(true),
})

export type MeteringPointInput = z.infer<typeof meteringPointInputSchema>

export function parseCheckbox(value: FormDataEntryValue | null): boolean {
  return value === 'on' || value === 'true' || value === '1'
}