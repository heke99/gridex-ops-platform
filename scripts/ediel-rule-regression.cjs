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


const { decideProdatAperak, ensureExpectedAckSent, parsePortalValidationFeedback } = require('../lib/ediel/decisionEngine.ts')

function makeMessage(overrides) {
  return {
    ...message,
    id: overrides.id ?? `00000000-0000-4000-8000-${Math.random().toString().slice(2, 14).padEnd(12, '0')}`,
    message_family: overrides.message_family ?? 'PRODAT',
    message_code: overrides.message_code ?? 'Z14',
    process_type: overrides.process_type ?? 'metering_access',
    application_reference: overrides.application_reference ?? '23-DGI-PRODAT',
    raw_payload: overrides.raw_payload,
    validation_report: overrides.validation_report ?? {},
    test_flag: overrides.test_flag ?? 1,
    related_message_id: overrides.related_message_id ?? null,
    business_match_status: overrides.business_match_status ?? null,
    customer_id: overrides.customer_id ?? null,
    site_id: overrides.site_id ?? null,
    metering_point_id: overrides.metering_point_id ?? null,
  }
}

const rawZ14N = "UNA:+.? 'UNB+UNOC:3+91100:ZZ:PRODAT+21660:ZZ+260605:1200+Z14NREF++23-DGI-PRODAT++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z14+Z14NREF+9+AB'DTM+137:202606051200:203'DTM+ZZZ:1:805'NAD+FR+91100:160:SVK'NAD+DO+21660:160:SVK'LIN+1++735999888000000109:::9'RFF+LI:CASE-Z14N'CCI++Z23'CAV+Z96'UNT+11+1'UNZ+1+Z14NREF'"
const z14nDecision = decideProdatAperak({ message: makeMessage({ raw_payload: rawZ14N }), testKind: 'TGT' })
assert.strictEqual(z14nDecision.kind, 'ack', 'Z14N should produce ACK decision')
assert.strictEqual(z14nDecision.outcome, 'positive', 'correct Z14N must produce positive APERAK')

const e6Decision = decideProdatAperak({
  message: makeMessage({ raw_payload: rawZ14N }),
  testKind: 'AGT',
  testCaseCode: 'E6',
  expectedOutcome: 'negative',
})
assert.strictEqual(e6Decision.kind, 'ack', 'E6 should produce ACK decision')
assert.strictEqual(e6Decision.outcome, 'negative', 'E6 unlinked Z14N must follow backend negative APERAK decision')
assert(
  e6Decision.applicationErrors.some((error) => error.ercCode === '40' && error.fieldCode === '105' && error.lineItemReference === 'CASE-Z14N'),
  'E6 negative APERAK must use facility_not_identified ERC 40 / FTX 105 and preserve RFF+LI'
)

const rawZ14MissingStatus = "UNA:+.? 'UNB+UNOC:3+91100:ZZ:PRODAT+21660:ZZ+260605:1201+Z14BAD++23-DGI-PRODAT++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z14+Z14BAD+9+AB'DTM+137:202606051201:203'DTM+ZZZ:1:805'NAD+FR+91100:160:SVK'NAD+DO+21660:160:SVK'LIN+1++735999888000000109:::9'RFF+LI:CASE-Z14BAD'UNT+9+1'UNZ+1+Z14BAD'"
const z14BadDecision = decideProdatAperak({ message: makeMessage({ raw_payload: rawZ14MissingStatus }), testKind: 'TGT' })
assert.strictEqual(z14BadDecision.outcome, 'negative', 'invalid Z14 without permission status must produce negative APERAK')
assert(z14BadDecision.applicationErrors.some((error) => error.ercCode === '41' && error.fieldCode === '322'), 'invalid Z14 should carry permission status error')

const rawZ18MissingReason = "UNA:+.? 'UNB+UNOC:3+21660:ZZ+91100:ZZ:PRODAT+260605:1202+Z18BAD++23-DGI-PRODAT++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z18+Z18BAD+9+AB'DTM+137:202606051202:203'DTM+ZZZ:1:805'NAD+FR+21660:160:SVK'NAD+DO+91100:160:SVK'LIN+1++735999888000000109:::9'RFF+LI:CASE-Z18BAD'UNT+9+1'UNZ+1+Z18BAD'"
const z18BadDecision = decideProdatAperak({ message: makeMessage({ raw_payload: rawZ18MissingReason, message_code: 'Z18' }), testKind: 'TGT' })
assert.strictEqual(z18BadDecision.outcome, 'negative', 'Z18 missing end reason must produce negative APERAK')
assert(z18BadDecision.applicationErrors.some((error) => error.ercCode === '41' && error.fieldCode === '324'), 'Z18 missing reason should use FTX 324')

const prodUnlinkedZ14 = decideProdatAperak({ message: makeMessage({ raw_payload: rawZ14N, test_flag: 0 }), testKind: 'production' })
assert.strictEqual(prodUnlinkedZ14.kind, 'manual_review', 'production Z14 without process link must require manual review')

const portalFeedback = parsePortalValidationFeedback({ expectedA902: ['40', '41', '42'], actualA902: '100' })
assert(portalFeedback && portalFeedback.mismatch, 'portal A902 expected negative vs actual 100 mismatch should be detected')
const portalDecision = decideProdatAperak({
  message: makeMessage({ raw_payload: rawZ14N, validation_report: { expectedA902: ['40', '41', '42'], actualA902: '100' } }),
  testKind: 'TGT',
})
assert.strictEqual(portalDecision.outcome, 'negative', 'portal negative feedback should force negative APERAK decision')

const lifecycleAlreadySent = ensureExpectedAckSent({
  desiredFamily: 'APERAK',
  desiredOutcome: 'positive',
  existingAcks: [{ id: 'ack-1', message_family: 'APERAK', status: 'sent', ack_outcome: 'positive', created_at: now, updated_at: now }],
})
assert.strictEqual(lifecycleAlreadySent.status, 'already_sent_success', 'correct final ACK must be treated as already_sent_success')

const lifecycleConflict = ensureExpectedAckSent({
  desiredFamily: 'APERAK',
  desiredOutcome: 'negative',
  existingAcks: [{ id: 'ack-2', message_family: 'APERAK', status: 'sent', ack_outcome: 'positive', created_at: now, updated_at: now }],
})
assert.strictEqual(lifecycleConflict.status, 'blocked_final_ack_exists', 'conflicting final ACK must block replacement')

console.log(JSON.stringify({
  ok: true,
  importedRuleIssues: importedMatrixIssues.map((issue) => issue.code),
  negativeAperakPlanned: true,
  ackProfilesChecked: ['APERAK', 'CONTRL', 'UTILTS_ERR'],
  utiltsE66Checked: true,
  prodatDecisionEngineChecked: true,
  ackLifecycleChecked: true,
}, null, 2))
