const fs = require('fs')
const path = require('path')

const root = process.cwd()
const mustContain = [
  ['lib/ediel/rulebook/canonicalRules.ts', 'ACK_NO_APERAK_ON_APERAK'],
  ['lib/ediel/rulebook/canonicalRules.ts', 'UNSUPPORTED_NBS_XML'],
  ['lib/ediel/rulebook/canonicalRules.ts', 'UNSUPPORTED_GAS'],
  ['lib/ediel/rulebook/canonicalRules.ts', 'ROUTE_PRODAT_PORTAL_RECEIVER_SUBADDRESS'],
  ['lib/ediel/rulebook/prodatRulebook.ts', 'prodat_z15_permission_ended'],
  ['lib/ediel/rulebook/prodatRulebook.ts', 'DTM+164'],
  ['lib/ediel/rulebook/prodatRulebook.ts', 'RFF+Z09'],
  ['lib/ediel/rulebook/utiltsRulebook.ts', 'functionalErrorResult'],
  ['lib/ediel/rulebook/mapEdielError.ts', 'OBJECT_NOT_IDENTIFIED'],
  ['lib/ediel/rulebook/mapEdielError.ts', 'INCORRECT_PERMISSION_END_REASON'],
  ['supabase/migrations/20260605183000_batch4_canonical_edifact_rulebook.sql', 'ediel_canonical_error_mappings'],
  ['supabase/migrations/20260605183000_batch4_canonical_edifact_rulebook.sql', 'NBS_XML_ESETT'],
]

const failures = []
for (const [relative, needle] of mustContain) {
  const file = path.join(root, relative)
  if (!fs.existsSync(file)) {
    failures.push(`Missing file: ${relative}`)
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes(needle)) failures.push(`${relative} does not contain ${needle}`)
}

if (failures.length > 0) {
  console.error('Canonical rulebook regression failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Canonical rulebook regression ok')
