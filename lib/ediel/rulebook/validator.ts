// lib/ediel/rulebook/validator.ts

import type { ProdatEngineInput, ProdatEngineProductionContext } from '@/lib/ediel/prodat/types'
import {
  expectedApplicationReferenceForProcess,
  getBusinessProcessForMessage,
  getRulebookMessageRule,
  isPermissionProdatCode,
  isSupplierSwitchProdatCode,
  type RulebookIssue,
} from '@/lib/ediel/rulebook/rulebook'
import {
  isAllowedMeteringAccessTransactionType,
  isAllowedProdatBgmCode,
  isAllowedSupplierSwitchTransactionType,
  mapProdatSubtypeToTransactionType,
} from '@/lib/ediel/rulebook/codeRules'
import { parseRulebookMessage, type CanonicalRulebookParsedMessage } from '@/lib/ediel/rulebook/messageParser'

export type RulebookValidationResult = {
  status: 'ok' | 'warning' | 'failed'
  issues: RulebookIssue[]
}

function issue(
  severity: RulebookIssue['severity'],
  code: string,
  title: string,
  description: string
): RulebookIssue {
  return { severity, code, title, description }
}

function statusFromIssues(issues: RulebookIssue[]): RulebookValidationResult['status'] {
  if (issues.some((item) => item.severity === 'error')) return 'failed'
  if (issues.some((item) => item.severity === 'warning')) return 'warning'
  return 'ok'
}

function normalize(value?: string | null): string {
  return String(value ?? '').trim().toUpperCase()
}

export function validateProdatRulebookInput(input: ProdatEngineInput): RulebookValidationResult {
  const issues: RulebookIssue[] = []
  const code = normalize(input.code)
  const process = getBusinessProcessForMessage({ family: 'PRODAT', code })
  const expectedApplicationReference = expectedApplicationReferenceForProcess(process)
  const applicationReference = normalize(input.route.applicationReference)
  const requestType = normalize(input.route.routeDecisionReason).replace(/\s+/g, '_')
  const reason = normalize(input.context.reasonForTransaction ?? input.variant)
  const mappedReason = mapProdatSubtypeToTransactionType(reason) ?? reason

  if (!isAllowedProdatBgmCode(code)) {
    issues.push(issue('error', 'rulebook_invalid_prodat_code', 'Fel PRODAT-kod', `BGM ska vara en känd PRODAT-funktion. Värde: ${code || '—'}.`))
  }

  if (code.length > 3 || /^(Z\d{2})(L|LK|C|V|VH|N)$/i.test(code)) {
    issues.push(issue('error', 'rulebook_subtype_in_bgm', 'Undertyp ligger i BGM', 'PRODAT ska inte byggas som Z03L/Z13V i BGM. BGM ska vara Z03/Z13 och undertyp ska ligga som transaktionstyp i SG14/CCI-CAV.'))
  }

  if (expectedApplicationReference && applicationReference && applicationReference !== expectedApplicationReference) {
    issues.push(issue('error', 'rulebook_wrong_application_reference', 'Fel Application Reference', `${code} tillhör ${process} och ska använda ${expectedApplicationReference}, inte ${applicationReference}.`))
  }

  if (isPermissionProdatCode(code)) {
    if (applicationReference && applicationReference !== '23-DGI-PRODAT') {
      issues.push(issue('error', 'rulebook_metering_access_wrong_appref', 'Mätvärdesåtkomst använder fel referens', 'Z13/Z14/Z15/Z18 ska använda 23-DGI-PRODAT. De får inte skickas som vanliga leverantörsbytesmeddelanden.'))
    }
    if (requestType.includes('SUPPLIER_SWITCH')) {
      issues.push(issue('error', 'rulebook_metering_access_as_supplier_switch', 'Mätvärdesåtkomst ligger i leverantörsbyte', 'Z13/Z14/Z15/Z18 måste ligga i metering_access, inte supplier_switch.'))
    }
    if (mappedReason && !isAllowedMeteringAccessTransactionType(mappedReason)) {
      issues.push(issue('error', 'rulebook_invalid_metering_access_transaction_type', 'Fel transaktionstyp för mätvärdesåtkomst', `${mappedReason} är inte giltig för Z13/Z14/Z15/Z18.`))
    }
  }

  if (isSupplierSwitchProdatCode(code)) {
    if (applicationReference && applicationReference !== '23-DDQ-PRODAT') {
      issues.push(issue('error', 'rulebook_supplier_switch_wrong_appref', 'Leverantörsflöde använder fel referens', 'Z03/Z04/Z05/Z06/Z08/Z09/Z10 ska använda 23-DDQ-PRODAT.'))
    }
    if (requestType.includes('METERING_ACCESS')) {
      issues.push(issue('error', 'rulebook_supplier_switch_as_metering_access', 'Leverantörsflöde ligger i mätvärdesåtkomst', 'Leverantörsbyte och mätvärdesåtkomst får inte blandas i samma process.'))
    }
    if (mappedReason && !isAllowedSupplierSwitchTransactionType(mappedReason)) {
      issues.push(issue('warning', 'rulebook_unusual_supplier_transaction_type', 'Ovanlig transaktionstyp', `${mappedReason} är inte en vanlig supplier_switch-transaktionstyp.`))
    }
  }

  if (!getRulebookMessageRule({ family: 'PRODAT', code })) {
    issues.push(issue('warning', 'rulebook_message_rule_missing', 'Regel saknas', `Ingen aktiv rulebook-regel hittades för PRODAT/${code}.`))
  }

  return { status: statusFromIssues(issues), issues }
}

export function validateProdatContextForRulebook(params: {
  context: ProdatEngineProductionContext
  applicationReference?: string | null
  requestType?: string | null
}): RulebookValidationResult {
  return validateProdatRulebookInput({
    code: params.context.code,
    mode: 'production',
    actor: {
      senderEdielId: params.context.senderEdielId,
      receiverEdielId: params.context.receiverEdielId,
    },
    route: {
      applicationReference: params.applicationReference ?? expectedApplicationReferenceForProcess(getBusinessProcessForMessage({ family: 'PRODAT', code: params.context.code })),
      routeDecisionReason: params.requestType ?? null,
    },
    version: {
      selectedVersion: '26A',
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A',
      acceptedVersions: ['26A', 'E2SE6A'],
    },
    context: params.context,
  })
}

export function validateRawPayloadWithRulebook(rawPayload: string): RulebookValidationResult & {
  parsed: CanonicalRulebookParsedMessage
} {
  const parsed = parseRulebookMessage(rawPayload)
  const issues: RulebookIssue[] = []
  const rule = getRulebookMessageRule({ family: parsed.family, code: parsed.messageCode })
  const expectedApplicationReference = expectedApplicationReferenceForProcess(parsed.businessProcess as never)

  if (!rule) {
    issues.push(issue('warning', 'rulebook_raw_message_rule_missing', 'Regel saknas', `Ingen regel hittades för ${parsed.family}/${parsed.messageCode ?? '—'}.`))
  }

  if (parsed.family === 'PRODAT' && parsed.messageCode && !isAllowedProdatBgmCode(parsed.messageCode)) {
    issues.push(issue('error', 'rulebook_raw_invalid_prodat_code', 'Fel PRODAT-kod', `BGM innehåller ${parsed.messageCode}, vilket inte är en godkänd PRODAT-funktion.`))
  }

  if (expectedApplicationReference && parsed.applicationReference && normalize(parsed.applicationReference) !== expectedApplicationReference) {
    issues.push(issue('error', 'rulebook_raw_wrong_application_reference', 'Fel Application Reference', `${parsed.messageCode ?? parsed.family} ska använda ${expectedApplicationReference}, inte ${parsed.applicationReference}.`))
  }

  if (parsed.family === 'PRODAT' && isPermissionProdatCode(parsed.messageCode) && parsed.businessProcess !== 'metering_access') {
    issues.push(issue('error', 'rulebook_raw_permission_wrong_process', 'Fel processgrupp', 'Z13/Z14/Z15/Z18 ska klassas som metering_access.'))
  }

  return {
    parsed,
    status: statusFromIssues(issues),
    issues,
  }
}
