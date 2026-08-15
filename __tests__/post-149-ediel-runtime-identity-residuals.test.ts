import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  getSupplierAgtUtiltsSetupPackage,
  resolveEdielSystemTestPackageForCase,
} from '@/lib/ediel/systemTestPackages'

const actions = readFileSync('app/admin/ediel/actions.ts', 'utf8')
const db = readFileSync('lib/ediel/db.ts', 'utf8')
const agtActions = readFileSync('app/admin/ediel/agt/actions.ts', 'utf8')
const agtEngine = readFileSync('lib/ediel/testing/agtEngine.ts', 'utf8')
const tgtAutopilot = readFileSync('lib/ediel/testing/tgtAutopilot.ts', 'utf8')
const packages = readFileSync('lib/ediel/systemTestPackages.ts', 'utf8')
const settings = readFileSync('lib/ediel/systemTestSettings.ts', 'utf8')
const bindMigration = readFileSync(
  'supabase/migrations/20260815220000_ediel_test_run_setup_package_exact_bind.sql',
  'utf8',
)

describe('post-#149 Ediel runtime identity residuals', () => {
  it('resolves supplier AGT UTILTS packages by message code without collapsing to the family token', () => {
    expect(getSupplierAgtUtiltsSetupPackage('S02')).toBe('agt_ddq_utilts_s02')
    expect(getSupplierAgtUtiltsSetupPackage('E66')).toBe('agt_ddq_utilts_e66')
    expect(
      resolveEdielSystemTestPackageForCase({
        runtimeSuite: 'AGT',
        actorRole: 'supplier',
        messageFamily: 'UTILTS',
        messageCode: 'S03',
      })?.value,
    ).toBe('agt_ddq_utilts_s03')
    expect(
      resolveEdielSystemTestPackageForCase({
        runtimeSuite: 'AGT',
        actorRole: 'supplier',
        messageFamily: 'PRODAT',
      })?.value,
    ).toBe('agt_ddq_prodat_l')
    expect(
      resolveEdielSystemTestPackageForCase({
        runtimeSuite: 'AGT',
        actorRole: 'supplier',
        messageFamily: 'UTILTS',
      }),
    ).toBeNull()
  })

  it('keeps TGT/AGT start and AGT engines on explicit package identity', () => {
    expect(packages).toContain('export function resolveEdielSystemTestPackageForCase')
    expect(actions).toContain('resolveEdielSystemTestPackageForCase(')
    expect(actions).toContain('setupPackage: runtimePackage.value')
    expect(actions).toContain('messageFamily: runtimePackage.messageFamily')
    expect(agtActions).toContain('resolveEdielSystemTestPackageForCase(')
    expect(agtEngine).toContain('resolveEdielSystemTestPackageForCase(')
    expect(agtEngine).toContain('setupPackage:')
  })

  it('does not invent setup_package from the message-family test_suite token', () => {
    expect(db).not.toContain('setup_package: input.setupPackage ?? input.testSuite')
    expect(db).toContain('setup_package: input.setupPackage ?? null')
  })

  it('threads bound setup_package from the test run into autopilot runtime lookups', () => {
    expect(tgtAutopilot).toContain('setupPackage: params.evaluation.testRun.setup_package')
    expect(tgtAutopilot).toContain('setupPackage: evaluation.testRun.setup_package')
  })

  it('requires exact setup_package binding for role-scoped active configurations', () => {
    expect(bindMigration).toContain('active_role_scoped_test_configuration_setup_package_required')
    expect(bindMigration).not.toContain('upper(new.setup_package)=upper(new.test_suite)')
    expect(bindMigration).toContain('c.setup_package=v_setup_package')
    expect(settings).toContain('messageFamily: params.messageFamily')
    expect(settings).toContain('setupPackage: params.setupPackage')
  })
})
