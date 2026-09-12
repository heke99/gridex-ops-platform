import { z } from 'zod'

// Validate transport types without coercion. Domain authorization, pricing and
// lifecycle decisions remain in the existing guards and business services.
const month = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((value) => !value.startsWith('0000-'))
const reference = z.string().trim().min(1)
const months = { billing_month: month.optional(), billingMonth: month.optional() }
const underlays = { billing_underlay_id: reference.optional(), billingUnderlayId: reference.optional() }
const runs = { pricing_run_id: reference.optional(), pricingRunId: reference.optional() }
const priceArea = z.enum(['SE1', 'SE2', 'SE3', 'SE4'])

function alias(
  body: Record<string, unknown>,
  ctx: z.RefinementCtx,
  snake: string,
  camel: string,
  required = true,
): void {
  const left = body[snake]
  const right = body[camel]
  if (required && left === undefined && right === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [snake], message: 'Fältet krävs.' })
  }
  if (left !== undefined && right !== undefined && JSON.stringify(left) !== JSON.stringify(right)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [snake], message: 'Alias måste ha samma värde.' })
  }
}

export const generateUnderlaySchema = z.object(months).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'billing_month', 'billingMonth')
})

export const billingPeriodSchema = z.object({
  ...months,
  action: z.enum(['lock', 'unlock', 'reopen']).optional(),
  status: z.enum(['locked', 'exported', 'closed']).optional(),
  reason: z.string().optional(),
}).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'billing_month', 'billingMonth')
})

export const pricingPreviewSchema = z.object({
  ...months,
  ...underlays,
  persist: z.boolean().optional(),
}).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'billing_month', 'billingMonth', false)
  alias(body, ctx, 'billing_underlay_id', 'billingUnderlayId', false)
  if (!body.billing_month && !body.billingMonth && !body.billing_underlay_id && !body.billingUnderlayId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['billing_underlay_id'], message: 'Underlag eller månad krävs.' })
  }
})

export const pricingRepriceSchema = z.object(underlays).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'billing_underlay_id', 'billingUnderlayId')
})

export const pricingLockSchema = z.object(runs).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'pricing_run_id', 'pricingRunId')
})

export const spotImportSchema = z.object({
  ...months,
  price_areas: z.array(priceArea).min(1).optional(),
  priceAreas: z.array(priceArea).min(1).optional(),
}).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'billing_month', 'billingMonth')
  alias(body, ctx, 'price_areas', 'priceAreas', false)
})

const normalizedArea = z.string().trim().transform((value) => value.toUpperCase()).pipe(priceArea)
export const spotSettlementSchema = z.object({
  ...months,
  price_area: normalizedArea.optional(),
  priceArea: normalizedArea.optional(),
  provider: z.string().optional(),
  reason: z.string().nullable().optional(),
}).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'billing_month', 'billingMonth')
  alias(body, ctx, 'price_area', 'priceArea')
})

const companies = { company_id: reference.optional(), companyId: reference.optional() }
export const invoiceCreateSchema = z.object({ ...companies, ...months }).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'company_id', 'companyId', false)
  alias(body, ctx, 'billing_month', 'billingMonth')
})
export const invoiceOperationSchema = z.object(companies).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'company_id', 'companyId', false)
})
export const invoiceDisputeSchema = z.object({ companyId: reference.optional(), reason: z.string().optional() }).strict()
const financingMode = z.enum(['factoring_with_recourse', 'factoring_without_recourse'])
const recourseDays = z.number().int().nonnegative().safe().nullable()
export const invoicePurchaseSchema = z.object({
  ...companies,
  financing_mode: financingMode.optional(), financingMode: financingMode.optional(),
  recourse_days: recourseDays.optional(), recourseDays: recourseDays.optional(),
  note: z.string().optional(),
}).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'company_id', 'companyId', false)
  alias(body, ctx, 'financing_mode', 'financingMode', false)
  alias(body, ctx, 'recourse_days', 'recourseDays', false)
})
export const edielRequestAutomationSchema = z.object({
  message_id: reference.optional(), messageId: reference.optional(),
  forceManualReview: z.boolean().optional(),
}).strict().superRefine((body, ctx) => {
  alias(body, ctx, 'message_id', 'messageId')
})
