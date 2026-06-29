#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const page = read('app/admin/platform/legal-templates/page.tsx')
const actions = read('app/admin/platform/legal-templates/actions.ts')
const lib = read('lib/legal/platformLegalTemplates.ts')
const defaults = read('lib/tenant/legalDefaults.ts')
const migration = read('supabase/migrations/20260629193000_platform_legal_template_editor_and_rendering.sql')

assert(page.includes('Master legal templates'), 'template editor page should render master legal templates title')
assert(page.includes('copyPublishedTemplatesToTenantsAction'), 'page should expose bulk tenant generation action')
assert(page.includes('TemplatePreview'), 'page should include rendered placeholder preview')
assert(actions.includes('updateDraftPlatformLegalTemplateAction'), 'actions should support draft-only edits')
assert(actions.includes('publishPlatformTemplate'), 'actions should publish one active template per legal type')
assert(actions.includes('copyPublishedTemplatesToCompanies'), 'actions should support bulk copy to tenants')
assert(lib.includes('renderTenantLegalTemplate'), 'library should render tenant placeholders')
assert(lib.includes('ensurePublishedLegalBundleForCompany'), 'library should ensure legal bundle items')
assert(lib.includes('company_name') && lib.includes('org_number') && lib.includes('support_email'), 'renderer should support required placeholders')
assert(defaults.includes("source: 'gridex_default_rendered'"), 'company default seeding should use rendered platform templates')
assert(migration.includes('platform_default_legal_templates_type_status_updated_idx'), 'migration should add template index')
assert(migration.includes('gridex-standard-2026-07'), 'migration should seed placeholder-aware default templates')

console.log('Platform legal templates regression passed')
