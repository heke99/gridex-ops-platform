import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AUTOMATION_USER_ENV_KEY,
  AUTOMATION_USER_NEXT_REQUIRED_ACTION,
  AUTOMATION_USER_REQUIRED_ADMIN_ACTION,
  AutomationConfigurationError,
  isAutomationConfigurationError,
  makeMissingAutomationUserBlocker,
  missingAutomationUserJobResult,
  resolveAutomationActorId,
} from '@/lib/customer-operations/automationConfig'
import { makeCustomerOperationBlocker } from '@/lib/customer-operations/blockers'

const VALID_UUID = '0076220e-3b76-4c30-a2a2-310b64a9d264'
const ENV_UUID = 'bc2babae-356d-44be-bc96-30da527aa2de'

describe('resolveAutomationActorId', () => {
  const originalEnv = process.env[AUTOMATION_USER_ENV_KEY]

  beforeEach(() => {
    delete process.env[AUTOMATION_USER_ENV_KEY]
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[AUTOMATION_USER_ENV_KEY]
    else process.env[AUTOMATION_USER_ENV_KEY] = originalEnv
  })

  it('prefers the explicit created_by value over the env var', () => {
    process.env[AUTOMATION_USER_ENV_KEY] = ENV_UUID
    expect(resolveAutomationActorId(VALID_UUID)).toBe(VALID_UUID)
  })

  it('falls back to GRIDEX_AUTOMATION_USER_ID when created_by is missing', () => {
    process.env[AUTOMATION_USER_ENV_KEY] = ENV_UUID
    expect(resolveAutomationActorId(null)).toBe(ENV_UUID)
    expect(resolveAutomationActorId(undefined)).toBe(ENV_UUID)
    expect(resolveAutomationActorId('')).toBe(ENV_UUID)
  })

  it('normalizes env values with whitespace and uppercase', () => {
    process.env[AUTOMATION_USER_ENV_KEY] = `  ${ENV_UUID.toUpperCase()}  `
    expect(resolveAutomationActorId(null)).toBe(ENV_UUID)
  })

  it('throws the typed configuration error when env is missing', () => {
    expect(() => resolveAutomationActorId(null)).toThrowError(AutomationConfigurationError)
  })

  it('throws the typed configuration error when env is not a UUID', () => {
    process.env[AUTOMATION_USER_ENV_KEY] = 'not-a-uuid'
    expect(() => resolveAutomationActorId(null)).toThrowError(AutomationConfigurationError)
  })

  it('marks the error as a non-retryable configuration blocker with the exact admin action', () => {
    let caught: unknown = null
    try {
      resolveAutomationActorId(null)
    } catch (error) {
      caught = error
    }
    expect(isAutomationConfigurationError(caught)).toBe(true)
    const typed = caught as AutomationConfigurationError
    expect(typed.blockerCode).toBe('missing_automation_user')
    expect(typed.reasonCode).toBe('missing_automation_user')
    expect(typed.errorClass).toBe('configuration_error')
    expect(typed.retryable).toBe(false)
    expect(typed.requiredAdminAction).toBe('configure_GRIDEX_AUTOMATION_USER_ID')
    expect(typed.nextRequiredAction).toBe(AUTOMATION_USER_NEXT_REQUIRED_ACTION)
  })

  it('does not classify generic errors as configuration errors', () => {
    expect(isAutomationConfigurationError(new Error('GRIDEX_AUTOMATION_USER_ID saknas'))).toBe(false)
    expect(isAutomationConfigurationError(null)).toBe(false)
  })
})

describe('missing_automation_user blocker contract', () => {
  it('exposes the required blocker fields via the canonical blocker registry', () => {
    const blocker = makeCustomerOperationBlocker('missing_automation_user')
    expect(blocker.blocker_code).toBe('missing_automation_user')
    expect(blocker.reason_code).toBe('missing_automation_user')
    expect(blocker.error_class).toBe('configuration_error')
    expect(blocker.blocker_reason).toContain('GRIDEX_AUTOMATION_USER_ID')
    expect(blocker.next_required_action).toBe(
      'Configure GRIDEX_AUTOMATION_USER_ID for automatic EDIEL/supplier switch operations',
    )
  })

  it('makeMissingAutomationUserBlocker matches the registry entry', () => {
    expect(makeMissingAutomationUserBlocker()).toEqual(
      makeCustomerOperationBlocker('missing_automation_user'),
    )
  })

  it('missingAutomationUserJobResult carries retryable=false and the admin action', () => {
    const result = missingAutomationUserJobResult({ job_id: 'job-1' })
    expect(result.blocker_code).toBe('missing_automation_user')
    expect(result.reason_code).toBe('missing_automation_user')
    expect(result.reason).toBe('missing_automation_user')
    expect(result.error_class).toBe('configuration_error')
    expect(result.retryable).toBe(false)
    expect(result.required_admin_action).toBe(AUTOMATION_USER_REQUIRED_ADMIN_ACTION)
    expect(result.job_id).toBe('job-1')
  })
})
