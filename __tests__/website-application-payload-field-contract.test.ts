import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

describe("website customer application raw payload contract", () => {
  it("derives canonical top-level field coverage from ApplicationSchema", () => {
    const schemas = read("lib/website/customerApplicationSchemas.ts")
    expect(schemas).toContain("...Object.keys(ApplicationSchema.shape),")
    expect(schemas).toContain("(key) => !TOP_LEVEL_PAYLOAD_FIELDS.has(key)")
    expect(schemas).toContain('code: "unknown_field"')
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
