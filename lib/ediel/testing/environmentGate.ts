import { supabaseService } from '@/lib/supabase/service'
import { getCompanyProductionReadiness } from '@/lib/ediel/productionReadiness'

export type EdielEnvironmentType = 'tgt_test' | 'agt_test' | 'bilateral_test' | 'production'

export type EdielEnvironmentGateResult = {
  ok: boolean
  environmentType: EdielEnvironmentType
  blockingIssues: string[]
  warnings: string[]
}

function normalizeEnvironmentType(value?: string | null): EdielEnvironmentType {
  if (value === 'production' || value === 'bilateral_test' || value === 'tgt_test') return value
  return 'agt_test'
}

function isSchemaCompatibilityError(error: unknown): boolean {
  const maybe = error as { code?: string; message?: string } | null
  return (
    maybe?.code === '42P01' ||
    maybe?.code === '42703' ||
    maybe?.code === 'PGRST204' ||
    maybe?.code === 'PGRST205' ||
    /does not exist|schema cache|column/i.test(maybe?.message ?? '')
  )
}

export async function evaluateEdielEnvironmentGate(input: {
  companyId: string
  actorRole: string
  messageFamily: string
  environmentType?: string | null
}): Promise<EdielEnvironmentGateResult> {
  const environmentType = normalizeEnvironmentType(input.environmentType)
  const blockingIssues: string[] = []
  const warnings: string[] = []

  if (environmentType === 'agt_test') {
    const { data: readiness, error: readinessError } = await supabaseService
      .from('ediel_agt_readiness')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('actor_role', input.actorRole)
      .eq('message_family', input.messageFamily)
      .maybeSingle()

    if (readinessError && !isSchemaCompatibilityError(readinessError)) throw readinessError

    if (!readiness) {
      blockingIssues.push('AGT-readiness saknas för valt bolag, roll och message family.')
    } else {
      if (readiness.needs_retest === true) blockingIssues.push(`AGT kräver omtest: ${readiness.retest_reason ?? 'route/certifikat/aktörsdata har ändrats.'}`)
      if (readiness.test_resource_confirmed !== true) blockingIssues.push('Testresurs är inte bekräftad.')
      if (readiness.ediel_portal_login_confirmed !== true) blockingIssues.push('Edielportalen-login är inte bekräftad.')
      if (readiness.application_system_selected !== true) blockingIssues.push('Application system är inte valt.')
      if (readiness.edi_system_selected !== true) blockingIssues.push('EDI system är inte valt.')
      if (['blocked', 'not_ready'].includes(String(readiness.readiness_status ?? 'not_ready'))) {
        blockingIssues.push(`AGT-readiness är ${readiness.readiness_status ?? 'not_ready'}.`)
      }
    }

    const { data: tgtRuns, error: tgtError } = await supabaseService
      .from('ediel_test_runs')
      .select('id,status')
      .eq('company_id', input.companyId)
      .eq('environment_type', 'tgt_test')
      .eq('role_code', input.actorRole)
      .eq('message_family', input.messageFamily)
      .in('status', ['approved', 'passed', 'completed', 'success'])
      .limit(1)

    if (tgtError && !isSchemaCompatibilityError(tgtError)) throw tgtError
    if ((tgtRuns ?? []).length === 0) {
      blockingIssues.push('TGT/systemkombination måste vara godkänd innan AGT kan starta.')
    }
  }

  if (environmentType === 'production') {
    const readiness = await getCompanyProductionReadiness(input.companyId)
    if (readiness.blockingIssues.length > 0) {
      blockingIssues.push(...readiness.blockingIssues.map((issue) => issue.message))
    }
    if (readiness.warningIssues.length > 0) {
      warnings.push(...readiness.warningIssues.map((issue) => issue.message))
    }
  }

  return {
    ok: blockingIssues.length === 0,
    environmentType,
    blockingIssues,
    warnings,
  }
}

export async function assertEdielEnvironmentGate(input: {
  companyId: string
  actorRole: string
  messageFamily: string
  environmentType?: string | null
}): Promise<EdielEnvironmentGateResult> {
  const result = await evaluateEdielEnvironmentGate(input)
  if (!result.ok) {
    throw new Error(result.blockingIssues.join(' '))
  }
  return result
}
