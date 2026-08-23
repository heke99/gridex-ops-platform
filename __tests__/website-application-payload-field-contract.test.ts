import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { validateNestedPayloadFields } from "@/lib/website/customerApplicationSchemas"

const read = (path: string) => readFileSync(path, "utf8")

const settlement = {
  model: "market_hourly",
  customer_accepts: "pricing_model",
  energy_price_locked_at_signup: false,
  uses_actual_metered_consumption: true,
  market_data_role: "indicative_preview_only",
  settlement_resolution: "hour",
}

describe("website customer application raw payload contract", () => {
  it("accepts canonical top-level fields directly from the runtime schema", () => {
    expect(validateNestedPayloadFields({
      settlement,
      resolution_id: "resolution_123",
      offer_reference: "offer_123",
      quote_reference: "quote_123",
    })).toBeNull()
  })

  it("continues to fail closed for truly unknown business fields", () => {
    const error = validateNestedPayloadFields({
      settlement,
      resolution_id: "resolution_123",
      unexpected_business_field: "must-not-be-ignored",
    })

    expect(error).toMatchObject({
      status: 422,
      code: "unknown_field",
      field: "unexpected_business_field",
      stage: "validation",
    })
  })

  it("derives canonical top-level field coverage from ApplicationSchema", () => {
    const schemas = read("lib/website/customerApplicationSchemas.ts")
    expect(schemas).toContain("...Object.keys(ApplicationSchema.shape),")
    expect(schemas).toContain("(key) => !TOP_LEVEL_PAYLOAD_FIELDS.has(key)")
  })

  it("keeps settlement and resolution binding in the published customer application contract", () => {
    const openApi = JSON.parse(read("docs/openapi/website-integration-v1.json"))
    const application = openApi.components.schemas.CustomerApplicationRequest

    expect(application.additionalProperties).toBe(false)
    expect(application.properties).toHaveProperty("settlement")
    expect(application.properties).toHaveProperty("resolution_id")
    expect(application.required).toEqual(expect.arrayContaining(["settlement", "resolution_id"]))
  })
})