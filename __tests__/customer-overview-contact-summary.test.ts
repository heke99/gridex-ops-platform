import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const source = readFileSync("app/admin/customers/[id]/page.part-4.tsx", "utf8")

describe("customer overview contact summary", () => {
  it("renders the resolved customer identity, contact details and address on overview", () => {
    expect(source).toContain('data-testid="customer-overview-contact-summary"')
    expect(source).toContain('{customerName}')
    expect(source).toContain('{displayEmail ?? "Saknas"}')
    expect(source).toContain('{displayPhone ?? "Saknas"}')
    expect(source).toContain('{customer.customer_number ?? "Saknas"}')
    expect(source).toContain('{activeAddressDisplay.street}')
    expect(source).toContain('{primaryIdentityValue}')
  })
})
