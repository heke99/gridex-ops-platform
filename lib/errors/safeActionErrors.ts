import { randomUUID } from 'node:crypto'
import { contractDatabaseErrorMessage } from '@/lib/contracts/lifecycleErrors'
import { redactLogText, safeLogError, sanitizeLogMetadata } from '@/lib/logging/redaction'
import { supabaseService } from '@/lib/supabase/service'

type DatabaseLikeError = {
  code?: unknown
  message?: unknown
  details?: unknown
  hint?: unknown
}

type ErrorContext = {
  action: string
  companyId?: string | null
  userId?: string | null
  metadata?: Record<string, unknown>
}

const SCHEMA_DRIFT_CODES = new Set(['42P01', '42703', '42883', 'PGRST200', 'PGRST201', 'PGRST204', 'PGRST205'])

function errorRecord(error: unknown): DatabaseLikeError {
  return error && typeof error === 'object' ? error as DatabaseLikeError : {}
}

function errorCode(error: unknown): string {
  const code = errorRecord(error).code
  return typeof code === 'string' ? code.trim() : ''
}

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  const message = errorRecord(error).message
  return typeof message === 'string' ? message.trim() : ''
}

function safeOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? redactLogText(value.trim())
    : null
}

export function isDeploymentMigrationDrift(error: unknown): boolean {
  const code = errorCode(error)
  const message = rawMessage(error)
  return SCHEMA_DRIFT_CODES.has(code) || /schema cache|relation .* does not exist|column .* does not exist|function .* does not exist|could not find the (function|table|column|relationship)/i.test(message)
}

function correlationReference(): string {
  return randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
}

function logTechnicalError(error: unknown, context: ErrorContext, reference: string) {
  const record = errorRecord(error)
  const safeError = safeLogError(error)
  console.error('[safe-action-error]', {
    reference,
    action: context.action,
    companyId: context.companyId ?? null,
    userId: context.userId ?? null,
    code: safeError.code,
    message: safeError.message,
    details: safeOptionalText(record.details),
    hint: safeOptionalText(record.hint),
    metadata: sanitizeLogMetadata(context.metadata ?? {}),
  })
}

function withReference(message: string, reference: string): string {
  return `${message} Referens: ${reference}.`
}

export function toSafeCompanyProfileError(error: unknown, context: ErrorContext): string {
  const reference = correlationReference()
  logTechnicalError(error, context, reference)
  const message = rawMessage(error)

  if (isDeploymentMigrationDrift(error)) {
    return withReference('Bolagsuppgifterna kunde inte sparas eftersom databasen inte är synkroniserad med den här versionen.', reference)
  }
  if (/invalid_swedish_organization_number|Organisationsnummer måste/i.test(message)) {
    return withReference('Organisationsnumret är ogiltigt. Kontrollera samtliga tio siffror.', reference)
  }
  if (/invalid_swedish_postal_code|invalid_postal_code|postnummer.*(måste|ogiltigt)/i.test(message)) {
    return withReference('Postnumret är ogiltigt. Svenska postnummer ska anges med fem siffror.', reference)
  }
  if (/invalid_country_code/i.test(message)) {
    return withReference('Landkoden är ogiltig. Ange två bokstäver, exempelvis SE.', reference)
  }
  if (/tenant_legal_profile_incomplete/i.test(message)) {
    return withReference('Juridikprofilen kan inte godkännas förrän bolagsuppgifterna är kompletta.', reference)
  }
  if (/company_not_found/i.test(message)) {
    return withReference('Bolaget hittades inte.', reference)
  }
  if (/Kundnummerprefix|Bolagsnamn krävs|Ogiltig bolagsstatus|måste vara en giltig/i.test(message)) {
    return withReference(message, reference)
  }
  return withReference('Bolagsuppgifterna kunde inte behandlas på grund av ett internt fel.', reference)
}

function safeContractErrorWithReference(
  error: unknown,
  context: ErrorContext,
  reference: string,
): string {
  const message = rawMessage(error)

  if (isDeploymentMigrationDrift(error)) {
    return withReference('Avtalet kunde inte behandlas eftersom databasen inte är synkroniserad med den här versionen.', reference)
  }
  const lifecycleMessage = contractDatabaseErrorMessage(error)
  if (lifecycleMessage) return withReference(lifecycleMessage, reference)
  if (/contract_permission_denied|Du saknar behörigheten|\bForbidden\b|\bUnauthorized\b/i.test(message)) {
    return withReference('Du saknar behörighet att genomföra den här avtalsåtgärden.', reference)
  }
  if (/publication_not_ready:/i.test(message)) {
    return withReference('Avtalet är inte publiceringsklart. Komplettera juridik, pris eller bolagsuppgifter enligt readiness-statusen.', reference)
  }
  if (/tenant_legal_profile_(missing|incomplete)/i.test(message)) {
    return withReference('Bolagets juridiska uppgifter behöver kompletteras innan avtalet kan publiceras.', reference)
  }
  if (/tenant_legal_profile_review_required/i.test(message)) {
    return withReference('Bolagets juridikprofil har ändrats och behöver godkännas innan avtalet kan publiceras.', reference)
  }
  if (/price_plan|price version|price_plan_version|price_book/i.test(message)) {
    return withReference('Avtalet saknar en komplett och låst prisversion.', reference)
  }
  if (/legal_bundle|legal module|unresolved_placeholder/i.test(message)) {
    return withReference('Avtalets juridikpaket är ofullständigt eller innehåller olösta variabler.', reference)
  }
  if (/måste vara|krävs|ogiltig|hittades inte|finns redan/i.test(message) && !/digest|schema|column|function/i.test(message)) {
    return withReference(message, reference)
  }
  return withReference('Avtalet kunde inte behandlas på grund av ett internt fel.', reference)
}

export function toSafeContractError(error: unknown, context: ErrorContext): string {
  const reference = correlationReference()
  logTechnicalError(error, context, reference)
  return safeContractErrorWithReference(error, context, reference)
}

export async function toSafeContractErrorPersisted(
  error: unknown,
  context: ErrorContext,
): Promise<string> {
  const reference = correlationReference()
  logTechnicalError(error, context, reference)
  const record = errorRecord(error)
  const metadata = sanitizeLogMetadata(context.metadata ?? {})
  const originalMetadata = context.metadata ?? {}
  const offerId =
    typeof originalMetadata.offerId === 'string' ? originalMetadata.offerId : null
  const contractProductId =
    typeof originalMetadata.contractProductId === 'string'
      ? originalMetadata.contractProductId
      : null
  const safeError = safeLogError(error)

  try {
    const { error: persistError } = await supabaseService
      .from('contract_lifecycle_operation_errors')
      .insert({
        reference,
        company_id: context.companyId ?? null,
        actor_user_id: context.userId ?? null,
        action: context.action,
        offer_id: offerId,
        contract_product_id: contractProductId,
        sqlstate: safeError.code,
        error_message: safeError.message,
        error_detail: safeOptionalText(record.details),
        error_hint: safeOptionalText(record.hint),
        metadata,
      })
    if (persistError) {
      const safePersistError = safeLogError(persistError)
      console.error('[safe-action-error-persistence-failed]', {
        reference,
        code: safePersistError.code,
        message: safePersistError.message,
      })
    }
  } catch (persistError) {
    const safePersistError = safeLogError(persistError)
    console.error('[safe-action-error-persistence-failed]', {
      reference,
      code: safePersistError.code,
      message: safePersistError.message,
    })
  }

  return safeContractErrorWithReference(error, context, reference)
}
