import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'

const text = z.string().nullable().optional()
const reference = z.string().trim().min(1)
const optionalReference = reference.nullable().optional()
const month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((value) => !value.startsWith('0000-'))
const area = z.string().trim().transform((value) => value.toUpperCase()).pipe(z.enum(['SE1', 'SE2', 'SE3', 'SE4']))

/** Alias values are compared after validation/normalization, never silently preferred. */
function aliases(body: Record<string, unknown>, ctx: z.RefinementCtx, names: string[], required = false): void {
  const present = names.filter((name) => body[name] !== undefined)
  if (required && !present.some((name) => body[name] !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [names[0]], message: 'Fältet krävs.' })
  }
  if (present.length > 1 && present.slice(1).some((name) => !isDeepStrictEqual(body[name], body[present[0]]))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [names[0]], message: 'Alias måste ha samma värde.' })
  }
}

// This platform endpoint intentionally also supports comma-separated strings.
// An explicit invalid/empty selection must never expand to all four areas.
const areas = z.union([z.array(area).min(1), z.string().transform((value) => value.split(',')).pipe(z.array(area).min(1))])
export const platformSpotImportSchema = z.object({
  billing_month: month.optional(), billingMonth: month.optional(),
  price_areas: areas.optional(), priceAreas: areas.optional(),
}).strict().superRefine((body, ctx) => {
  aliases(body, ctx, ['billing_month', 'billingMonth'], true)
  aliases(body, ctx, ['price_areas', 'priceAreas'])
})

const gridRow = z.object({
  grid_owner_name: text, gridOwnerName: text, elnatsforetag: text,
  grid_area_name: text, gridAreaName: text, natomrade_name: text,
  grid_area_code: text, gridAreaCode: text, natomradeskod: text,
  price_area: area.nullable().optional(), priceArea: area.nullable().optional(), elomrade: area.nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
}).strict().superRefine((body, ctx) => {
  for (const names of [
    ['grid_owner_name', 'gridOwnerName', 'elnatsforetag'],
    ['grid_area_name', 'gridAreaName', 'natomrade_name'],
    ['grid_area_code', 'gridAreaCode', 'natomradeskod'],
    ['price_area', 'priceArea', 'elomrade'],
  ]) aliases(body, ctx, names)
})
export const platformGridImportSchema = z.object({
  rows: z.array(gridRow).min(1).optional(), data: z.array(gridRow).min(1).optional(),
}).strict().superRefine((body, ctx) => aliases(body, ctx, ['rows', 'data'], true))

const layer = z.number().int().nonnegative().max(50)
const offset = z.number().int().nonnegative().max(10_000_000)
export const platformSvkImportSchema = z.object({
  action: z.enum(['import', 'retry_reconciliation']).optional(),
  service_url: reference.optional(), serviceUrl: reference.optional(),
  layer_id: layer.optional(), layerId: layer.optional(),
  limit: z.number().int().min(1).max(250).optional(),
  offset: offset.optional(), result_offset: offset.optional(),
  run_id: optionalReference, runId: optionalReference,
}).strict().superRefine((body, ctx) => {
  aliases(body, ctx, ['service_url', 'serviceUrl'])
  aliases(body, ctx, ['layer_id', 'layerId'])
  aliases(body, ctx, ['offset', 'result_offset'])
  aliases(body, ctx, ['run_id', 'runId'], body.action === 'retry_reconciliation')
})

export const platformEnergyResolveSchema = z.object({
  company_id: optionalReference, companyId: optionalReference,
  customer_id: optionalReference, customerId: optionalReference,
  customer_site_id: optionalReference, customerSiteId: optionalReference,
  customer_application_id: optionalReference, customerApplicationId: optionalReference,
  metering_point_id: optionalReference, meteringPointId: optionalReference,
  street: text, address: text, street_number: text, streetNumber: text,
  postal_code: text, postalCode: text, city: text, country: text,
  grid_area_code: text, gridAreaCode: text, facility_id: text, facilityId: text,
  requested_start_mode: text, requestedStartMode: text,
  requested_start_date: text, requestedStartDate: text,
  metadata: z.record(z.unknown()).optional(),
}).strict().superRefine((body, ctx) => {
  for (const names of [
    ['company_id', 'companyId'], ['customer_id', 'customerId'], ['customer_site_id', 'customerSiteId'],
    ['customer_application_id', 'customerApplicationId'], ['metering_point_id', 'meteringPointId'],
    ['street', 'address'], ['street_number', 'streetNumber'], ['postal_code', 'postalCode'],
    ['grid_area_code', 'gridAreaCode'], ['facility_id', 'facilityId'],
    ['requested_start_mode', 'requestedStartMode'], ['requested_start_date', 'requestedStartDate'],
  ]) aliases(body, ctx, names)
})

export const z01RepairSchema = z.object({
  company_id: reference,
  grid_owner_data_request_id: optionalReference,
  customer_info_request_id: optionalReference,
  environment: z.enum(['test', 'production']).nullable().optional(),
  dry_run: z.boolean().optional(), dryRun: z.boolean().optional(),
}).strict().superRefine((body, ctx) => {
  aliases(body, ctx, ['dry_run', 'dryRun'])
  if (!body.grid_owner_data_request_id && !body.customer_info_request_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['grid_owner_data_request_id'], message: 'En begäran måste anges.' })
  }
})
