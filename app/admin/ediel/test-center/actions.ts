'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { prepareEdielTestRunTransportMetadata } from '@/lib/ediel/testing/testRunTransportMetadata'
import { resolveEdielTestCenterIsolation } from '@/lib/ediel/testing/testCenterSafety'
import { runTestCenterMeteringToInvoiceChain } from '@/lib/ediel/testing/testCenterRuntimeChain'
import { importRawEdifactAndRunTestCenterChain } from '@/lib/ediel/testing/testCenterRawEdifactImport'
import { materializeTestCenterScenario, type TestCenterScenario } from '@/lib/ediel/testing/testCenterScenarios'
import { supabaseService } from '@/lib/supabase/service'
import { formatErrorMessage } from '@/lib/errors'

type RawImportResult = Awaited<ReturnType<typeof importRawEdifactAndRunTestCenterChain>>

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function scenarioValue(formData: FormData): TestCenterScenario {
  const value = stringValue(formData, 'testScenario') ?? 'baseline'
  if (!['baseline', 'duplicate', 'missing_values', 'correction', 'rebilling'].includes(value)) {
    throw new Error('Ogiltigt Testcenter-scenario.')
  }
  return value as TestCenterScenario
}

function closeNumber(left: number, right: number, tolerance = 0.001) {
  return Math.abs(left - right) <= tolerance
}

function requireScenarioResultCount(scenario: TestCenterScenario, results: RawImportResult[], expected: number) {
  if (results.length !== expected) {
    throw new Error(`Scenario ${scenario} gav ${results.length} verifierade körningar; ${expected} krävdes.`)
  }
}

function assertScenarioRunEvidence(scenario: TestCenterScenario, results: RawImportResult[]) {
  if (scenario === 'missing_values') {
    if (results.length !== 0) {
      throw new Error('Missing-values-scenariot får inte lämna ett lyckat faktureringsresultat.')
    }
    return
  }

  if (scenario === 'baseline') {
    requireScenarioResultCount(scenario, results, 1)
    return
  }

  if (scenario === 'duplicate') {
    requireScenarioResultCount(scenario, results, 2)
    const [original, duplicate] = results
    if (!duplicate.reusedInboundEnvelope) {
      throw new Error('Duplicate-scenariot återanvände inte samma inbound-envelope idempotent.')
    }
    if (
      duplicate.inboundEmailMessageId !== original.inboundEmailMessageId ||
      duplicate.edielMessageId !== original.edielMessageId ||
      duplicate.materializedMeteringPointId !== original.materializedMeteringPointId
    ) {
      throw new Error('Duplicate-scenariot skapade en ny envelope-, Ediel- eller mätpunktsidentitet.')
    }
    if (
      duplicate.runtime.billingUnderlayId !== original.runtime.billingUnderlayId ||
      duplicate.runtime.customerInvoiceId !== original.runtime.customerInvoiceId ||
      duplicate.runtime.pricingRunId !== original.runtime.pricingRunId ||
      !closeNumber(duplicate.runtime.totalKwh, original.runtime.totalKwh)
    ) {
      throw new Error('Duplicate-scenariot var inte idempotent genom billing-/fakturagrafen.')
    }
    return
  }

  if (scenario === 'correction') {
    requireScenarioResultCount(scenario, results, 2)
    const [original, correction] = results
    if (correction.edielMessageId === original.edielMessageId || correction.inboundEmailMessageId === original.inboundEmailMessageId) {
      throw new Error('Correction-scenariot skapade inte en separat korrigerings-envelope/Ediel-post.')
    }
    if (correction.materializedMeteringPointId !== original.materializedMeteringPointId) {
      throw new Error('Correction-scenariot bytte mätpunkt i stället för att skapa en revision på samma objekt.')
    }
    if (!closeNumber(correction.runtime.totalKwh, original.runtime.totalKwh + 1)) {
      throw new Error('Correction-scenariot gav inte den deterministiska +1 kWh-revisionen i fakturaunderlaget.')
    }
    return
  }

  requireScenarioResultCount(scenario, results, 3)
  const [original, correction, rebilling] = results
  if (correction.materializedMeteringPointId !== original.materializedMeteringPointId || rebilling.materializedMeteringPointId !== original.materializedMeteringPointId) {
    throw new Error('Rebilling-scenariot lämnade den ursprungliga mätpunkten.')
  }
  if (correction.edielMessageId === original.edielMessageId || correction.inboundEmailMessageId === original.inboundEmailMessageId) {
    throw new Error('Rebilling-scenariot saknar separat korrigeringsmeddelande.')
  }
  if (!rebilling.reusedInboundEnvelope || rebilling.inboundEmailMessageId !== correction.inboundEmailMessageId || rebilling.edielMessageId !== correction.edielMessageId) {
    throw new Error('Rebilling-verifieringen återanvände inte den korrigerade inbound-/Ediel-identiteten idempotent.')
  }
  if (!closeNumber(correction.runtime.totalKwh, original.runtime.totalKwh + 1) || !closeNumber(rebilling.runtime.totalKwh, correction.runtime.totalKwh)) {
    throw new Error('Rebilling-scenariot bevarade inte den korrigerade +1 kWh-revisionen.')
  }
  if (
    rebilling.runtime.billingUnderlayId !== correction.runtime.billingUnderlayId ||
    rebilling.runtime.customerInvoiceId !== correction.runtime.customerInvoiceId ||
    rebilling.runtime.pricingRunId !== correction.runtime.pricingRunId
  ) {
    throw new Error('Rebilling-verifieringen skapade dubbla aktiva billing-/fakturaobjekt i stället för idempotent återanvändning.')
  }
}

async function rawEdifactFromForm(formData: FormData): Promise<{ raw: string; filename: string | null }> {
  const pasted = stringValue(formData, 'rawEdifact')
  const file = formData.get('edifactFile')
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) throw new Error('EDIFACT-filen får vara högst 2 MB.')
    const raw = (await file.text()).trim()
    if (!raw) throw new Error('Den uppladdade EDIFACT-filen är tom.')
    return { raw, filename: file.name || null }
  }
  if (!pasted) throw new Error('Ladda upp en EDIFACT-fil eller klistra in EDIFACT-innehåll.')
  return { raw: pasted, filename: null }
}

function traceHref(input: { edielMessageId: string; billingMonth: string; billingUnderlayId?: string | null }) {
  const query = new URLSearchParams({ billingMonth: input.billingMonth })
  if (input.billingUnderlayId) query.set('underlayId', input.billingUnderlayId)
  return `/admin/ediel/test-center/metering-to-invoice/trace/${encodeURIComponent(input.edielMessageId)}?${query.toString()}`
}

export async function prepareEdielTestCenterRunAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'Test-run förbereddes i isolerad testmiljö. Du kan fortsätta i AGT/Systemtester.'
  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'companyId')
    const testSuite = stringValue(formData, 'testSuite') ?? 'PRODAT'
    const roleCode = stringValue(formData, 'roleCode')
    const testCaseCode = stringValue(formData, 'testCaseCode')
    const isolation = resolveEdielTestCenterIsolation({
      environmentType: stringValue(formData, 'environmentType') ?? 'agt_test',
      productionLike: formData.get('productionLike') === 'true',
    })
    const encryptionMode = stringValue(formData, 'encryptionMode') ?? 'none'

    if (!companyId) throw new Error('Välj bolag/tenant.')
    if (!roleCode || !['supplier', 'esco'].includes(roleCode)) throw new Error('Välj en giltig aktörsroll explicit.')
    if (!testCaseCode) throw new Error('Välj testfall.')

    await prepareEdielTestRunTransportMetadata({
      actorUserId: context.userId,
      companyId,
      testSuite,
      roleCode,
      testCaseCode,
      environment: isolation.environment,
      environmentType: isolation.environmentType,
      productionLike: isolation.productionLike,
      encryptionMode,
    })

    revalidatePath('/admin/ediel/test-center')
    revalidatePath('/admin/ediel/system-tests')
    revalidatePath('/admin/ediel/agt')
  } catch (error) {
    status = 'error'
    message = formatErrorMessage(error, 'Test-run kunde inte förberedas.')
  }
  redirect(`/admin/ediel/test-center?runStatus=${status}&runMessage=${encodeURIComponent(message)}`)
}

export async function importRawEdifactAndRunTestCenterAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'EDIFACT importerades och testkedjan kördes.'
  let target: string | null = null

  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'runtimeCompanyId')
    const customerId = stringValue(formData, 'runtimeCustomerId')
    const billingMonth = stringValue(formData, 'runtimeBillingMonth')
    if (!companyId || !customerId || !billingMonth) {
      throw new Error('Bolag, testkund och fakturamånad krävs.')
    }
    const source = await rawEdifactFromForm(formData)
    const scenario = scenarioValue(formData)
    const plan = materializeTestCenterScenario(source.raw, scenario)
    const results: RawImportResult[] = []
    let lastResult: RawImportResult | null = null
    let expectedBlock: string | null = null

    for (const run of plan.runs) {
      try {
        const result = await importRawEdifactAndRunTestCenterChain({
          actorUserId: context.userId,
          companyId,
          customerId,
          billingMonth,
          rawEdifact: run.rawEdifact,
          filename: source.filename ? `${run.label}-${source.filename}` : `fixture-${scenario}-${run.label}.edi`,
        })
        results.push(result)
        lastResult = result
      } catch (error) {
        if (run.expectation === 'blocked_missing_values') {
          const detail = formatErrorMessage(error, 'Missing-values-scenariot blockerades.')
          if (!detail.includes('Fakturatest kräver positiv fakturerbar periodenergi i QTY+136')) {
            throw error
          }
          expectedBlock = detail
          break
        }
        throw error
      }
    }

    if (expectedBlock) {
      assertScenarioRunEvidence(scenario, results)
    } else {
      assertScenarioRunEvidence(scenario, results)
    }

    if (expectedBlock && !lastResult) {
      message = `Scenario ${scenario} verifierat: kedjan blockerade den deterministiskt ofullständiga UTILTS-filen av rätt orsak. ${expectedBlock}`
    } else if (lastResult) {
      message = lastResult.runtime.billingUnderlayId
        ? `Scenario ${scenario} kördes och verifierades semantiskt. ${lastResult.runtime.meteringValueIds.length} mätvärdesrader skapades, billing-underlag ${lastResult.runtime.billingUnderlayId} och fakturautkast förbereddes i testmiljö.`
        : `Scenario ${scenario} kördes och verifierades semantiskt. ${lastResult.runtime.meteringValueIds.length} mätvärdesrader skapades utan billing-underlag.`
      target = traceHref({
        edielMessageId: lastResult.edielMessageId,
        billingMonth,
        billingUnderlayId: lastResult.runtime.billingUnderlayId,
      })
    } else {
      throw new Error('Testcenter-scenariot gav inget verifierbart resultat.')
    }

    revalidatePath('/admin/ediel/test-center')
    revalidatePath('/admin/ediel/test-center/metering-to-invoice')
    revalidatePath('/admin/metering')
    revalidatePath('/admin/billing')
  } catch (error) {
    status = 'error'
    message = formatErrorMessage(error, 'EDIFACT-importen eller testkedjan misslyckades.')
  }

  redirect(target ?? `/admin/ediel/test-center/metering-to-invoice?runStatus=${status}&runMessage=${encodeURIComponent(message)}`)
}

export async function runTestCenterMeteringToInvoiceAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'Testkedjan kördes i isolerad testmiljö.'
  let target: string | null = null

  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'runtimeCompanyId')
    const customerId = stringValue(formData, 'runtimeCustomerId')
    const edielMessageId = stringValue(formData, 'runtimeEdielMessageId')
    const billingMonth = stringValue(formData, 'runtimeBillingMonth')

    if (!companyId || !customerId || !edielMessageId || !billingMonth) {
      throw new Error('Bolag, testkund, Ediel-meddelande och fakturamånad krävs.')
    }

    const result = await runTestCenterMeteringToInvoiceChain({
      actorUserId: context.userId,
      companyId,
      customerId,
      edielMessageId,
      billingMonth,
    })

    message = result.billingUnderlayId
      ? `Testkedjan kördes: ${result.meteringValueIds.length} mätvärdesrader, billing-underlag ${result.billingUnderlayId} och fakturautkast förbereddes i testmiljö.`
      : `UTILTS behandlades i testmiljö och ${result.meteringValueIds.length} mätvärdesrader skapades. Inget faktureringsunderlag skapades för detta meddelande.`
    target = traceHref({ edielMessageId, billingMonth, billingUnderlayId: result.billingUnderlayId })

    revalidatePath('/admin/ediel/test-center')
    revalidatePath('/admin/metering')
    revalidatePath('/admin/billing')
  } catch (error) {
    status = 'error'
    message = formatErrorMessage(error, 'Testkedjan kunde inte köras.')
  }

  redirect(target ?? `/admin/ediel/test-center?runStatus=${status}&runMessage=${encodeURIComponent(message)}`)
}

export async function releaseEdielTestRunLockAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const lockId = stringValue(formData, 'lockId')
  if (!lockId) throw new Error('Testlås saknas.')

  const { error } = await supabaseService
    .from('ediel_test_run_locks')
    .update({
      released_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        releasedBy: context.userId,
        releaseReason: stringValue(formData, 'releaseReason') ?? 'Manual release from Test Center.',
      },
    })
    .eq('id', lockId)

  if (error) throw error
  revalidatePath('/admin/ediel/test-center')
  revalidatePath('/admin/ediel/readiness')
}
