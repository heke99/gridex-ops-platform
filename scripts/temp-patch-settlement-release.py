from pathlib import Path
import re

OLD = '2026-08-22.1'
NEW = '2026-08-22.2'

excluded_prefixes = (
    'docs/openapi/releases/2026-08-22.1/',
    'app/api/v1/openapi/2026-08-22.1/',
)
excluded_exact = {
    'docs/fixtures/public-contracts-response-2026-08-22.1.json',
    'lib/api/publicRouteRegistry.ts',
    '.github/workflows/temp-settlement-contract-release.yml',
}
for path in Path('.').rglob('*'):
    if not path.is_file() or '.git' in path.parts or 'node_modules' in path.parts:
        continue
    rel = path.as_posix()
    if rel in excluded_exact or any(rel.startswith(prefix) for prefix in excluded_prefixes):
        continue
    try:
        text = path.read_text()
    except UnicodeDecodeError:
        continue
    if OLD in text:
        path.write_text(text.replace(OLD, NEW))

finalize = Path('scripts/finalize-openapi-release.cjs')
text = finalize.read_text()
text = text.replace("const priorVersion = '2026-08-22.2'", "const priorVersion = '2026-08-22.1'")
property_anchor = 'application.dependentRequired = {'
if property_anchor not in text:
    raise SystemExit('CustomerApplicationRequest property anchor not found')
text = text.replace(
    property_anchor,
    "application.properties = application.properties ?? {}\napplication.properties.settlement = { $ref: '#/components/schemas/WebsiteQuoteSettlement' }\n" + property_anchor,
    1,
)
finalize.write_text(text)

registry = Path('lib/api/publicRouteRegistry.ts')
text = registry.read_text()
anchor = "  { method: 'GET', path: '/api/v1/openapi/2026-08-22.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-22.1.', rateLimitClass: 'read' },\n"
if anchor not in text:
    raise SystemExit('2026-08-22.1 route registry anchor not found')
addition = anchor + "  { method: 'GET', path: '/api/v1/openapi/2026-08-22.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-22.2.', rateLimitClass: 'read' },\n  { method: 'GET', path: '/api/v1/openapi/2026-08-22.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-22.2.', rateLimitClass: 'read' },\n"
registry.write_text(text.replace(anchor, addition, 1))

manifest = Path('lib/integrations/openApiReleaseManifest.ts')
text = manifest.read_text()
text, count = re.subn(
    r"export const OPENAPI_RELEASED_AT = '[^']+' as const",
    "export const OPENAPI_RELEASED_AT = '2026-08-22T18:52:00.000Z' as const",
    text,
    count=1,
)
if count != 1:
    raise SystemExit('OPENAPI_RELEASED_AT anchor not found')
manifest.write_text(text)

schemas = Path('lib/website/customerApplicationSchemas.ts')
text = schemas.read_text()
insert_anchor = 'export const ApplicationSchema = z.object({\n'
if insert_anchor not in text:
    raise SystemExit('ApplicationSchema anchor not found')
settlement_schema = """export const WebsiteQuoteSettlementSchema = z.object({
  model: z.enum(['fixed_price', 'market_monthly', 'market_hourly', 'market_quarter_hour', 'portfolio', 'mixed']),
  customer_accepts: z.enum(['fixed_energy_price', 'pricing_model', 'portfolio_pricing_model', 'mixed_pricing_model']),
  energy_price_locked_at_signup: z.boolean(),
  uses_actual_metered_consumption: z.literal(true),
  market_data_role: z.enum(['not_applicable', 'indicative_preview_only']),
  settlement_resolution: z.enum(['fixed', 'month', 'hour', 'quarter_hour', 'portfolio_period', 'mixed_components']),
}).strict();

"""
text = text.replace(insert_anchor, settlement_schema + insert_anchor, 1)
field_anchor = '  quoteReference: OPTIONAL_TEXT,\n'
if field_anchor not in text:
    raise SystemExit('quoteReference anchor not found')
text = text.replace(field_anchor, field_anchor + '  settlement: WebsiteQuoteSettlementSchema,\n', 1)
schemas.write_text(text)

process = Path('lib/website/customerApplicationProcess.ts')
text = process.read_text()
import_anchor = 'import { validateWebsiteQuote, WebsiteQuoteValidationError, type WebsiteQuoteRecord } from "@/lib/pricing/websiteQuotes";\n'
if import_anchor not in text:
    raise SystemExit('websiteQuotes import anchor not found')
text = text.replace(import_anchor, import_anchor + 'import { websiteSettlementForContract, type WebsiteSettlement } from "@/lib/pricing/websiteSettlement";\n', 1)
schema_import = 'ApplicationSchema, applicationBusinessKeyHash'
if schema_import not in text:
    raise SystemExit('schema import anchor not found')
text = text.replace(schema_import, 'ApplicationSchema, WebsiteQuoteSettlementSchema, applicationBusinessKeyHash', 1)
fn_anchor = 'export async function processWebsiteCustomerApplication(input: {\n'
helper = """function canonicalQuoteSettlement(
  quote: WebsiteQuoteRecord,
  offer: PublicContractOffer,
): WebsiteSettlement {
  const parsed = WebsiteQuoteSettlementSchema.safeParse(quote.quote_snapshot?.settlement)
  if (parsed.success) return parsed.data
  const pricingInterval = typeof quote.quote_snapshot?.pricing_interval === 'string'
    ? quote.quote_snapshot.pricing_interval
    : null
  return websiteSettlementForContract({
    contractType: offer.contract_type,
    pricingInterval,
  })
}

function sameSettlement(left: WebsiteSettlement, right: WebsiteSettlement): boolean {
  return left.model === right.model
    && left.customer_accepts === right.customer_accepts
    && left.energy_price_locked_at_signup === right.energy_price_locked_at_signup
    && left.uses_actual_metered_consumption === right.uses_actual_metered_consumption
    && left.market_data_role === right.market_data_role
    && left.settlement_resolution === right.settlement_resolution
}

"""
if fn_anchor not in text:
    raise SystemExit('process function anchor not found')
text = text.replace(fn_anchor, helper + fn_anchor, 1)
quote_anchor = """        websiteQuote = await validateWebsiteQuote({
          client: input.client,
          quoteReference: selectedQuoteReference,
          offerReference: selectedOfferReference,
          publicOffer: publicOffer as PublicContractOffer,
          customerType: body.customer.customer_type,
          priceArea: readiness.priceArea,
          resolutionId: energyResolution.resolution.resolutionId ?? null,
          gridAreaCode: readiness.gridAreaCode,
          postalCode: clean(body.site?.postal_code),
          annualConsumptionKwh: requestedAnnualConsumption(body),
          startDate: readiness.requestedStartDate,
          priceOptionReference: body.price_option_reference,
          invoiceDeliveryMethod: body.invoice_delivery_method,
          selectedComponentReferences: body.selected_component_references,
          siteCount: body.site_count,
          applicationId: applicationRowId,
        });
"""
if quote_anchor not in text:
    raise SystemExit('validateWebsiteQuote block anchor not found')
validation = quote_anchor + """        const expectedSettlement = canonicalQuoteSettlement(
          websiteQuote,
          publicOffer as PublicContractOffer,
        );
        if (!sameSettlement(body.settlement, expectedSettlement)) {
          throw new WebsiteApplicationError({
            message: 'settlement motsäger den accepterade canonical quoten.',
            status: 409,
            code: 'quote_settlement_mismatch',
            field: 'settlement',
            stage: 'quote_validation',
            hint: 'Skicka settlement exakt som den returnerades av samma quote_reference.',
            details: {
              expected_settlement: expectedSettlement,
              received_settlement: body.settlement,
              quote_reference: selectedQuoteReference,
            },
          });
        }
"""
process.write_text(text.replace(quote_anchor, validation, 1))

Path('__tests__/website-application-settlement-contract.test.ts').write_text("""import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

describe('website customer application settlement contract', () => {
  it('publishes a satisfiable settlement property and validates it at runtime', () => {
    const openApi = JSON.parse(read('docs/openapi/website-integration-v1.json'))
    const application = openApi.components.schemas.CustomerApplicationRequest
    expect(openApi.info.version).toBe('2026-08-22.2')
    expect(application.required).toContain('settlement')
    expect(application.properties.settlement).toEqual({
      $ref: '#/components/schemas/WebsiteQuoteSettlement',
    })
    expect(application.additionalProperties).toBe(false)

    const schemas = read('lib/website/customerApplicationSchemas.ts')
    expect(schemas).toContain('WebsiteQuoteSettlementSchema')
    expect(schemas).toContain('settlement: WebsiteQuoteSettlementSchema')

    const process = read('lib/website/customerApplicationProcess.ts')
    expect(process).toContain('canonicalQuoteSettlement')
    expect(process).toContain("code: 'quote_settlement_mismatch'")
    expect(process).toContain('sameSettlement(body.settlement, expectedSettlement)')
  })
})
""")
