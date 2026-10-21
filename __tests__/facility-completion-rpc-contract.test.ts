// Executes the actual static validators, not the application or an E2E journey.
// Only their fixed source-file reads and existing child-test launch boundary are
// modeled. The shared parser/verifier is real; no provider or child process runs.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const workflowPath = 'lib/facility/facilityLookupWorkflow.ts'
const workflow = readFileSync(resolve(root, workflowPath), 'utf8')
const validators = [
  'scripts/gridex-customer-intake-completion-hardening-regression.cjs',
  'scripts/gridex-facility-lookup-manual-workflow-regression.cjs',
] as const
const sourceFiles = new Set([
  workflowPath,
  'lib/customer-operations/facilityResponseOrchestrator.ts',
  'supabase/migrations/20260825112000_ops_precision_resolution_authority.sql',
  'lib/customer-operations/customerProcessNextStepEngine.ts',
  'lib/ediel/inbound/inboundFacilityRecognition.ts',
  'app/admin/facility-requests/actions.ts',
  'app/admin/facility-requests/page.tsx',
  'app/admin/work-queue/page.tsx',
  'vercel.json',
  'app/api/cron/billing/monthly/route.ts',
  'supabase/migrations/20260624183000_gridex_customer_intake_completion_hardening.sql',
  'package.json',
].map(path => resolve(root, path)))

class ValidatorExit extends Error {}

function runValidator(path: typeof validators[number], candidate = workflow) {
  const filename = resolve(root, path)
  const realRequire = createRequire(filename)
  const errors: string[] = []
  const state = {
    exitCode: 0,
    execPath: process.execPath,
    cwd: () => root,
    exit(code = 0) { state.exitCode = code; throw new ValidatorExit() },
  }
  const filePort = {
    readFileSync(file: string, encoding: string) {
      const absolute = resolve(root, file)
      if (!sourceFiles.has(absolute) || encoding !== 'utf8') throw new Error('Unexpected source read')
      return absolute === resolve(root, workflowPath) ? candidate : readFileSync(absolute, 'utf8')
    },
  }
  const childPort = {
    execFileSync(executable: string, args: string[], options: { cwd: string; stdio: string }) {
      // This external port is deliberately inert. It cannot certify the two
      // genuine behavioral suites, which are run separately by the caller.
      expect(executable).toBe(process.execPath)
      expect(args).toEqual([
        'node_modules/vitest/vitest.mjs', 'run',
        '__tests__/ediel-facility-recognition-source-owner.test.ts',
        '__tests__/ediel-at-z02l-z02lk-supplier-profile.test.ts',
      ])
      expect(options).toEqual({ cwd: root, stdio: 'inherit' })
    },
  }
  try {
    new Script(readFileSync(filename, 'utf8'), { filename }).runInNewContext({
      require(name: string) {
        if (name === 'fs' || name === 'node:fs') return filePort
        if (name === 'node:child_process') return childPort
        if (name === './lib/facility-completion-rpc-contract.cjs') return realRequire(name)
        throw new Error('Unexpected validator dependency')
      },
      process: state,
      console: { log() {}, error(...values: unknown[]) { errors.push(values.map(String).join(' ')) } },
    }, { timeout: 2_000 })
  } catch (error) {
    if (!(error instanceof ValidatorExit)) throw error
  }
  return { exitCode: state.exitCode, errors }
}

function replaceOnce(source: string, before: string, after: string) {
  expect(source.split(before)).toHaveLength(2)
  return source.replace(before, () => after)
}

function changeBranch(branch: 'automatic' | 'manual', change: (source: string) => string) {
  const automaticStart = workflow.indexOf(' automatic ? {\n')
  const manualStart = workflow.indexOf('  } : {\n    p_company_id: input.companyId,', automaticStart)
  const end = workflow.indexOf('\n  })', manualStart)
  expect(automaticStart).toBeGreaterThan(0)
  expect(manualStart).toBeGreaterThan(automaticStart)
  expect(end).toBeGreaterThan(manualStart)
  const start = branch === 'automatic' ? automaticStart : manualStart
  const finish = branch === 'automatic' ? manualStart : end
  return workflow.slice(0, start) + change(workflow.slice(start, finish)) + workflow.slice(finish)
}

const wrongManual = replaceOnce(workflow, ": 'gridex_complete_facility_response',", ": 'wrong_manual_rpc',")
const negatives: [string, string][] = [
  ['wrong manual command', wrongManual],
  ['wrong automatic command', replaceOnce(workflow, "? 'gridex_apply_manual_facility_reply_v1'", "? 'wrong_automatic_rpc'")],
  ['manual command only in a comment', wrongManual + "\n// rpc('gridex_complete_facility_response'\n"],
  ['manual command only in an unrelated function', wrongManual + "\nfunction decoy() { return rpc('gridex_complete_facility_response', {}) }\n"],
  ['wrong automatic source binding', replaceOnce(workflow, 'const automatic = input.automaticInbound', 'const automatic = input.source')],
  ['wrong database client binding', replaceOnce(workflow, 'const rpcClient = supabaseService as unknown as', 'const rpcClient = otherService as unknown as')],
  ['different argument branch condition', replaceOnce(workflow, ', automatic ? {', ', input.source ? {')],
  ['renamed result binding', replaceOnce(workflow, 'const { data, error } = await rpcClient.rpc(', 'const { data: otherData, error } = await rpcClient.rpc(')],
  ['additional RPC call', replaceOnce(workflow, '  const { data, error } = await rpcClient.rpc(', "  await rpcClient.rpc('decoy', {})\n  const { data, error } = await rpcClient.rpc(")],
  ['extra manual argument', changeBranch('manual', source => replaceOnce(source, '    p_source: input.source,', '    p_source: input.source, extra_authority: true,'))],
  ['duplicate manual argument', changeBranch('manual', source => replaceOnce(source, '    p_source: input.source,', '    p_source: input.source, p_source: input.source,'))],
  ['spread manual arguments', changeBranch('manual', source => replaceOnce(source, '    p_source: input.source,', '    ...input, p_source: input.source,'))],
  ['computed manual argument', changeBranch('manual', source => replaceOnce(source, '    p_source: input.source,', "    ['p_source']: input.source,"))],
  ['manual tenant taken from another input', changeBranch('manual', source => replaceOnce(source, 'p_company_id: input.companyId', 'p_company_id: input.requestId'))],
  ['manual actor loses null fallback', changeBranch('manual', source => replaceOnce(source, 'input.actorUserId ?? null', 'input.actorUserId'))],
  ['manual evidence loses normalization', changeBranch('manual', source => replaceOnce(source, 'text(input.edielMessageId)', 'input.edielMessageId'))],
  ['automatic tenant taken from another input', changeBranch('automatic', source => replaceOnce(source, 'p_company_id: input.companyId', 'p_company_id: input.requestId'))],
  ['automatic source hash from wrong identity', changeBranch('automatic', source => replaceOnce(source, 'sourceHash: automatic.sourceHash', 'sourceHash: input.source'))],
  ['automatic raw evidence loses fallback', changeBranch('automatic', source => replaceOnce(source, 'raw_payload: input.rawPayload ?? {}', 'raw_payload: input.rawPayload'))],
  ['automatic extracted evidence loses normalization', changeBranch('automatic', source => replaceOnce(source, 'asRecord(input.rawPayload?.extracted)', 'input.rawPayload?.extracted'))],
  ['automatic payload gains an extra field', changeBranch('automatic', source => replaceOnce(source, 'facts: automatic.facts ?? {}', 'facts: automatic.facts ?? {}, extra_authority: true'))],
  ['syntax error', workflow + '\nconst broken = (\n'],
]
for (const field of [
  'p_company_id', 'p_request_id', 'p_actor_user_id', 'p_source', 'p_ediel_message_id', 'p_facility_id',
  'p_metering_point_external_id', 'p_grid_area_code', 'p_price_area_code', 'p_source_party_grid_owner_id', 'p_raw_payload', 'p_note',
]) negatives.push(['missing manual ' + field, changeBranch('manual', source => replaceOnce(source, field + ':', 'wrong_' + field + ':'))])
for (const field of ['p_company_id', 'p_request_id', 'p_inbound_id', 'p_payload']) {
  negatives.push(['missing automatic ' + field, changeBranch('automatic', source => replaceOnce(source, field + ':', 'wrong_' + field + ':'))])
}
for (const field of ['sourceHash', 'facility_id', 'metering_point_id', 'grid_area_code', 'price_area_code', 'raw_payload', 'extracted', 'facts']) {
  negatives.push(['missing automatic payload ' + field, changeBranch('automatic', source => replaceOnce(source, field + ':', 'wrong_' + field + ':'))])
}

describe.each(validators)('%s actual executable RPC contract', path => {
  it('accepts the actual canonical manual and automatic branches', () => {
    expect(runValidator(path)).toEqual({ exitCode: 0, errors: [] })
  })

  it('accepts harmless quotes, comments, parentheses and reordered argument properties', () => {
    let candidate = replaceOnce(workflow, "? 'gridex_apply_manual_facility_reply_v1' : 'gridex_complete_facility_response'", '? "gridex_apply_manual_facility_reply_v1" : "gridex_complete_facility_response"')
    candidate = replaceOnce(candidate, 'const automatic = input.automaticInbound', 'const automatic = (input.automaticInbound) /* source identity */')
    candidate = replaceOnce(candidate, '    p_actor_user_id: input.actorUserId ?? null,\n    p_source: input.source,', "    'p_source': input.source,\n    p_actor_user_id: (input.actorUserId ?? null),")
    expect(runValidator(path, candidate)).toEqual({ exitCode: 0, errors: [] })
  })

  it.each(negatives)('rejects %s even though other static assertions retain their original source', (_label, candidate) => {
    const result = runValidator(path, candidate)
    expect(result.exitCode).toBe(1)
    expect(result.errors).toContain(path === validators[0]
      ? 'FAIL: facility completion delegates the transactional write to the canonical RPC'
      : 'FAIL: complete workflow delegates all canonical writes to gridex_complete_facility_response')
  })
})
