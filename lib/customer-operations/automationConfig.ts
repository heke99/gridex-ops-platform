import { supabaseService } from '@/lib/supabase/service'
import { normalizeUuidOrNull } from '@/lib/validation/uuid'
import {
  makeCustomerOperationBlocker,
  type CustomerOperationBlocker,
} from '@/lib/customer-operations/blockers'

/**
 * Configuration resolver for the automatic customer-operation actor.
 *
 * GRIDEX_AUTOMATION_USER_ID must be the UUID of an existing `auth.users` row
 * (a dedicated service/automation account). It is used as `created_by` /
 * `actorUserId` for automatic EDIEL and supplier-switch operations when no
 * interactive session exists. Note: `public.profiles` does NOT exist in this
 * schema — the FK on customer_operation_jobs.created_by points to auth.users(id).
 *
 * A missing or malformed value is a CONFIGURATION error, not a technical
 * error: it must fail fast (no retries) with a clear admin-action blocker.
 */

export const AUTOMATION_USER_ENV_KEY = 'GRIDEX_AUTOMATION_USER_ID'

export const MISSING_AUTOMATION_USER_BLOCKER_CODE = 'missing_automation_user' as const

export const AUTOMATION_USER_REQUIRED_ADMIN_ACTION = 'configure_GRIDEX_AUTOMATION_USER_ID'

export const AUTOMATION_USER_NEXT_REQUIRED_ACTION =
  'Configure GRIDEX_AUTOMATION_USER_ID for automatic EDIEL/supplier switch operations'

export class AutomationConfigurationError extends Error {
  readonly blockerCode = MISSING_AUTOMATION_USER_BLOCKER_CODE
  readonly reasonCode = MISSING_AUTOMATION_USER_BLOCKER_CODE
  readonly errorClass = 'configuration_error' as const
  readonly retryable = false as const
  readonly requiredAdminAction = AUTOMATION_USER_REQUIRED_ADMIN_ACTION
  readonly nextRequiredAction = AUTOMATION_USER_NEXT_REQUIRED_ACTION

  constructor(message?: string) {
    super(message ?? 'GRIDEX_AUTOMATION_USER_ID saknas för automatisk Ediel-åtgärd.')
    this.name = 'AutomationConfigurationError'
  }
}

export function isAutomationConfigurationError(
  error: unknown,
): error is AutomationConfigurationError {
  return (
    error instanceof AutomationConfigurationError ||
    (error instanceof Error && error.name === 'AutomationConfigurationError')
  )
}

export function makeMissingAutomationUserBlocker(): CustomerOperationBlocker {
  return makeCustomerOperationBlocker(MISSING_AUTOMATION_USER_BLOCKER_CODE)
}

/**
 * Full result payload for a job blocked by missing automation user config.
 * Shape follows the customer-operation blocker contract plus the explicit
 * non-retryable configuration fields required by ops/superadmin tooling.
 */
export function missingAutomationUserJobResult(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const blocker = makeMissingAutomationUserBlocker()
  return {
    ...extra,
    ...blocker,
    reason: blocker.reason_code,
    retryable: false,
    required_admin_action: AUTOMATION_USER_REQUIRED_ADMIN_ACTION,
  }
}

/**
 * Resolves the acting user for an automatic customer operation.
 * Order: explicit value (e.g. customer_operation_jobs.created_by) first,
 * then the GRIDEX_AUTOMATION_USER_ID environment variable.
 *
 * Throws AutomationConfigurationError (typed, non-retryable) when neither is
 * available or the env value is not a valid UUID.
 */
export function resolveAutomationActorId(explicit?: unknown, envValue?: unknown): string {
  const explicitActor = normalizeUuidOrNull(explicit, 'created_by')
  if (explicitActor) return explicitActor

  const raw = envValue !== undefined ? envValue : process.env[AUTOMATION_USER_ENV_KEY]
  const trimmed = typeof raw === 'string' ? raw.trim() : null
  if (!trimmed) {
    throw new AutomationConfigurationError()
  }

  let envActor: string | null = null
  try {
    envActor = normalizeUuidOrNull(trimmed, AUTOMATION_USER_ENV_KEY)
  } catch {
    throw new AutomationConfigurationError(
      'GRIDEX_AUTOMATION_USER_ID är satt men är inte ett giltigt UUID. Ange auth.users-id för automationskontot.',
    )
  }
  if (!envActor) throw new AutomationConfigurationError()
  return envActor
}

export type AutomationUserConfigStatus = {
  ok: boolean
  userId: string | null
  issue:
    | null
    | 'missing'
    | 'invalid_uuid'
    | 'user_not_found'
    | 'verification_unavailable'
  message: string | null
}

/**
 * Runtime/startup validation for GRIDEX_AUTOMATION_USER_ID.
 * Never throws — used by the customer-operations cron entrypoint so a broken
 * config is loudly visible without stopping unrelated job processing (jobs
 * that need the actor fail fast with the typed configuration blocker).
 */
export async function validateAutomationUserConfig(): Promise<AutomationUserConfigStatus> {
  const raw = typeof process.env[AUTOMATION_USER_ENV_KEY] === 'string'
    ? process.env[AUTOMATION_USER_ENV_KEY]!.trim()
    : ''
  if (!raw) {
    return {
      ok: false,
      userId: null,
      issue: 'missing',
      message: `${AUTOMATION_USER_ENV_KEY} saknas. ${AUTOMATION_USER_NEXT_REQUIRED_ACTION}.`,
    }
  }

  let userId: string | null = null
  try {
    userId = normalizeUuidOrNull(raw, AUTOMATION_USER_ENV_KEY)
  } catch {
    return {
      ok: false,
      userId: null,
      issue: 'invalid_uuid',
      message: `${AUTOMATION_USER_ENV_KEY} är inte ett giltigt UUID.`,
    }
  }
  if (!userId) {
    return {
      ok: false,
      userId: null,
      issue: 'missing',
      message: `${AUTOMATION_USER_ENV_KEY} saknas. ${AUTOMATION_USER_NEXT_REQUIRED_ACTION}.`,
    }
  }

  // Best-effort existence check against auth.users. Verification failures
  // (network, permissions) must not be reported as a broken config.
  try {
    const { data, error } = await supabaseService.auth.admin.getUserById(userId)
    if (error) {
      const notFound = /not.*found|does not exist/i.test(error.message ?? '') || (error as { status?: number }).status === 404
      if (notFound) {
        return {
          ok: false,
          userId,
          issue: 'user_not_found',
          message: `${AUTOMATION_USER_ENV_KEY} pekar på en användare som inte finns i auth.users.`,
        }
      }
      return { ok: true, userId, issue: 'verification_unavailable', message: error.message ?? null }
    }
    if (!data?.user?.id) {
      return {
        ok: false,
        userId,
        issue: 'user_not_found',
        message: `${AUTOMATION_USER_ENV_KEY} pekar på en användare som inte finns i auth.users.`,
      }
    }
  } catch (error) {
    return {
      ok: true,
      userId,
      issue: 'verification_unavailable',
      message: error instanceof Error ? error.message : null,
    }
  }

  return { ok: true, userId, issue: null, message: null }
}
