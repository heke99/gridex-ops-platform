#!/usr/bin/env node
const fs = require('fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertIncludes(path, needle, label) {
  const text = read(path)
  if (!text.includes(needle)) {
    throw new Error(`${label || path} saknar ${needle}`)
  }
}

function assertAll() {
  assertIncludes('lib/ediel/rulebook/fieldMatrixImport.ts', 'parseFieldMatrixImport', 'Field Matrix parser')
  assertIncludes('lib/ediel/rulebook/fieldMatrixImport.ts', 'prodat_z15_permission_ended', 'PRODAT Z15 profile mapping')
  assertIncludes('app/admin/ediel/rule-profiles/page.tsx', 'importEdielFieldMatrixAction', 'rule profile import UI')
  assertIncludes('app/admin/ediel/rule-profiles/page.tsx', 'activateEdielRuleProfileVersionAction', 'rule profile activation UI')
  assertIncludes('app/admin/ediel/rule-profiles/actions.ts', 'ediel_field_matrix_rules', 'field matrix rule storage')
  assertIncludes('app/admin/ediel/rule-profiles/actions.ts', 'ediel_rule_profile_versions', 'rule profile version storage')
  assertIncludes('supabase/migrations/20260605183000_batch4_canonical_edifact_rulebook.sql', 'ediel_field_matrix_imports', 'field matrix import table')
  assertIncludes('app/admin/ediel/page.tsx', '/admin/ediel/rule-profiles', 'Ediel Center rule profile link')
}

assertAll()
console.log('ediel field-matrix regression: ok')
