#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = process.cwd()
const originalResolve = Module._resolveFilename

process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://rule-regression-placeholder.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'rule-regression-placeholder-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'rule-regression-placeholder-service-role-key'

function existingFile(candidates) {
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

Module._resolveFilename = function resolveTsAlias(request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    const mapped = path.join(root, request.slice(2))
    const candidate = existingFile([`${mapped}.ts`, `${mapped}.tsx`, path.join(mapped, 'index.ts'), mapped])
    if (candidate) return candidate
  }

  if (request.startsWith('.')) {
    const base = path.resolve(path.dirname(parent?.filename ?? root), request)
    const candidate = existingFile([`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base])
    if (candidate) return candidate
  }

  return originalResolve.call(this, request, parent, isMain, options)
}

require.extensions['.ts'] = function loadTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText
  module._compile(output, filename)
}

const { validateFieldMatrixPayload } = require('../lib/ediel/rulebook/fieldMatrix.ts')
const { validateRulebookMessage } = require('../lib/ediel/rulebook/validator.ts')
const { resolveCanonicalRuntimeDecision } = require('../lib/ediel/core/runtimeDecision.ts')

const registryRules = [
  {
    family: 'PRODAT',
    code: 'Z03',
    fieldKey: 'line_reference',
    label: 'Line reference',
    segmentPath: 'RFF+LI',
    requirement: 'required',
    errorCodeIfMissing: 'RFF_LI_MISSING',
    source: 'registry',
  },
  {
    family: 'PRODAT',
    code: 'Z03',
    fieldKey: 'forbidden_partner',
    label: 'Forbidden partner',
    segmentPath: 'NAD+ZZ',
    requirement: 'forbidden',
    errorCodeIfInvalid: 'NAD_ZZ_FORBIDDEN',
    source: 'registry',
  },
  {
    family: 'PRODAT',
    code: 'Z03',
    fieldKey: 'dependent_date',
    label: 'Dependent date',
    segmentPath: 'DTM+203',
    requirement: 'dependent',
    dependency: { anySegmentPresent: ['CCI++Z99'] },
    errorCodeIfMissing: 'DTM_203_DEPENDENCY_MISSING',
    source: 'registry',
  },
  {
    family: 'PRODAT',
    code: 'Z03',
    fieldKey: 'message_code',
    label: 'Message function',
    segmentPath: 'BGM/C002/1001',
    requirement: 'required',
    allowedValues: ['Z04'],
    errorCodeIfInvalid: 'BGM_CODE_NOT_IN_LIST',
    source: 'registry',
  },
]

const importedMatrixIssues = validateFieldMatrixPayload(
  {
    family: 'PRODAT',
    code: 'Z03',
    mode: 'send',
    rawSegments: ['BGM+Z03', 'NAD+ZZ+123', 'CCI++Z99', 'CAV+X'],
  },
  registryRules
)

for (const code of ['RFF_LI_MISSING', 'NAD_ZZ_FORBIDDEN', 'DTM_203_DEPENDENCY_MISSING', 'BGM_CODE_NOT_IN_LIST']) {
  assert(importedMatrixIssues.some((issue) => issue.code === code), `missing ${code}`)
}

const unresolvedDependentIssues = validateFieldMatrixPayload(
  { family: 'PRODAT', code: 'Z03', mode: 'send', rawSegments: ['BGM+Z03'] },
  [{ family: 'PRODAT', code: 'Z03', fieldKey: 'dependent_without_runtime_rule', label: 'Dependent without rule', segmentPath: 'DTM+999', requirement: 'dependent', errorCodeIfMissing: 'UNRESOLVED_D_SHOULD_NOT_BLOCK', source: 'registry' }]
)
assert(
  !unresolvedDependentIssues.some((issue) => issue.code === 'UNRESOLVED_D_SHOULD_NOT_BLOCK'),
  'imported D rules without dependency payload must not block'
)

const rawProdatMissingR =
  "UNA:+.? 'UNB+UNOC:3+SENDER:14+RECEIVER:14+260530:1832+1++++23-DDQ-PRODAT'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z03+DOC1+9'DTM+137:202605301832:203'DTM+ZZZ:202605301832:203'NAD+FR+SENDER::9'NAD+DO+RECEIVER::9'LIN+1++735999999999999999:Z07'UNT+8+1'UNZ+1+1'"

const validation = validateRulebookMessage({
  family: 'PRODAT',
  code: 'Z03',
  rawPayload: rawProdatMissingR,
  applicationReference: '23-DDQ-PRODAT',
  mode: 'parse',
})
assert(validation.issues.some((issue) => issue.code === 'RFF_LI_MISSING'), 'static PRODAT RFF_LI_MISSING regression')

const now = new Date().toISOString()
const message = {
  id: '00000000-0000-4000-8000-000000000001',
  direction: 'inbound',
  message_standard: 'edifact',
  message_family: 'PRODAT',
  message_code: 'Z03',
  message_version: '26A',
  process_type: 'supplier_switch',
  environment: 'test',
  test_flag: 1,
  status: 'received',
  transport_type: 'manual_upload',
  mailbox: null,
  mailbox_message_id: null,
  sender_ediel_id: 'SENDER',
  sender_name: null,
  sender_sub_address: null,
  receiver_ediel_id: 'RECEIVER',
  receiver_name: null,
  receiver_sub_address: null,
  sender_email: null,
  receiver_email: null,
  subject: null,
  file_name: null,
  mime_type: null,
  interchange_reference: '1',
  external_reference: null,
  correlation_reference: null,
  transaction_reference: null,
  application_reference: '23-DDQ-PRODAT',
  original_message_id: null,
  original_transaction_id: null,
  original_message_code: null,
  related_message_id: null,
  communication_route_id: null,
  outbound_request_id: null,
  route_scope: null,
  switch_request_id: null,
  grid_owner_data_request_id: null,
  partner_export_id: null,
  customer_id: null,
  site_id: null,
  metering_point_id: null,
  grid_owner_id: null,
  raw_payload: rawProdatMissingR,
  parsed_payload: {},
  validation_report: {},
  requires_contrl: true,
  requires_aperak: true,
  contrl_status: null,
  aperak_status: null,
  utilts_err_status: null,
  ack_outcome: null,
  syntax_check_status: null,
  functional_check_status: null,
  failure_reason: null,
  message_created_at: null,
  message_received_at: null,
  message_sent_at: null,
  parsed_at: null,
  validated_at: null,
  acknowledged_at: null,
  failed_at: null,
  ack_due_at: null,
  created_at: now,
  updated_at: now,
  created_by: null,
  updated_by: null,
}

const decision = resolveCanonicalRuntimeDecision(message)
assert(
  decision.responsePlan.some((item) => item.family === 'APERAK' && item.outcome === 'negative'),
  'missing R must plan negative APERAK'
)

assert(
  validateFieldMatrixPayload({ family: 'APERAK', code: 'APERAK', rawSegments: ['ERC+100'], mode: 'parse' })
    .some((issue) => issue.code === 'APERAK_POSITIVE_OK_MISSING'),
  'APERAK OK text regression'
)
assert(
  validateFieldMatrixPayload({ family: 'CONTRL', code: 'CONTRL', rawSegments: ['UCI+1', 'BGM+BAD'], mode: 'parse' })
    .some((issue) => issue.code === 'CONTRL_MUST_NOT_HAVE_BGM'),
  'CONTRL BGM regression'
)
assert(
  validateFieldMatrixPayload({ family: 'UTILTS_ERR', code: 'UTILTS_ERR', rawSegments: ['BGM+E66', 'STS+E01', 'RFF+ACE:1'], mode: 'parse' })
    .some((issue) => issue.code === 'UTILTS_ERR_BGM_NOT_ERR'),
  'UTILTS_ERR BGM regression'
)
assert(
  validateFieldMatrixPayload({ family: 'UTILTS', code: 'E66', rawSegments: ['BGM+E66'], mode: 'parse' })
    .some((issue) => issue.code === 'DTM_324_MISSING'),
  'UTILTS E66 required delivery period regression'
)

console.log(JSON.stringify({
  ok: true,
  importedRuleIssues: importedMatrixIssues.map((issue) => issue.code),
  negativeAperakPlanned: true,
  ackProfilesChecked: ['APERAK', 'CONTRL', 'UTILTS_ERR'],
  utiltsE66Checked: true,
}, null, 2))
