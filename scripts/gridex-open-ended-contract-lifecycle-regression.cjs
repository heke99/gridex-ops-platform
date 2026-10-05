const fs = require('node:fs')
const assert = require('node:assert/strict')
const source = fs.readFileSync('lib/customer-contracts/lifecycle.ts', 'utf8')

assert(source.includes("input.bindingMonths > 0"), 'binding must only create a contractual end when strictly positive')
assert(source.includes("const boundUntil = startsAt && bindingMonths"), 'open-ended contracts must not derive end from start date')
assert(!source.includes("addMonths(startsAt, input.bindingMonths ?? 0)"), 'zero/null binding must not collapse ends_at to starts_at')
console.log('gridex-open-ended-contract-lifecycle-regression: PASS')
