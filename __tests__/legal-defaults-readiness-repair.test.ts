import { describe, expect, it } from 'vitest'
import { CANONICAL_LEGAL_MODULES } from '@/lib/legal/canonicalModules'
import {
  CANONICAL_EMAIL_EVENT_LABELS,
  DEFAULT_EMAIL_EVENT_RULES,
  isEmailEventRuleActive,
} from '@/lib/email/emailEvents'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/email/emailTemplates'
import { summarizeTenantEffectiveLegalSources } from '@/lib/tenant/legalDefaults'

function platformRows(): Array<Record<string, unknown>> {
  return CANONICAL_LEGAL_MODULES.map((moduleKey, index) => ({
    company_id: 'company-1',
    module_key: moduleKey,
    platform_template_version_id: `platform-${index}`,
    platform_version: 'ops-standard-2026-07-v2',
    tenant_override_id: null,
    tenant_override_version: null,
    tenant_override_mode: null,
    effective_source: 'platform_template',
    effective_available: true,
  }))
}

describe('canonical legal source readiness', () => {
  it('treats the 28 OPS master modules as effective without tenant copies', () => {
    const status = summarizeTenantEffectiveLegalSources('company-1', platformRows())

    expect(status.hasAllRequiredLegalTexts).toBe(true)
    expect(status.platformPublishedCount).toBe(28)
    expect(status.tenantOverrideCount).toBe(0)
    expect(status.effectiveModuleCount).toBe(28)
    expect(status.missingTypes).toEqual([])
  })

  it('lets a tenant replacement override exactly one OPS module', () => {
    const rows = platformRows()
    rows[0] = {
      ...rows[0],
      tenant_override_id: 'override-1',
      tenant_override_version: 'tenant-v2',
      tenant_override_mode: 'replacement',
      effective_source: 'tenant_replacement',
    }

    const status = summarizeTenantEffectiveLegalSources('company-1', rows)

    expect(status.hasAllRequiredLegalTexts).toBe(true)
    expect(status.platformPublishedCount).toBe(28)
    expect(status.tenantOverrideCount).toBe(1)
    expect(status.effectiveSources[0]).toMatchObject({
      type: CANONICAL_LEGAL_MODULES[0],
      effectiveSource: 'tenant_replacement',
      tenantOverrideMode: 'replacement',
    })
  })

  it('reports only the actually missing effective module', () => {
    const rows = platformRows()
    rows[4] = {
      ...rows[4],
      platform_template_version_id: null,
      platform_version: null,
      effective_source: 'missing',
      effective_available: false,
    }

    const status = summarizeTenantEffectiveLegalSources('company-1', rows)

    expect(status.hasAllRequiredLegalTexts).toBe(false)
    expect(status.effectiveModuleCount).toBe(27)
    expect(status.missingTypes).toEqual([CANONICAL_LEGAL_MODULES[4]])
  })
})

describe('canonical tenant mail registry', () => {
  it('honors disabled and inactive event rules at dispatch time', () => {
    expect(isEmailEventRuleActive({ enabled: true, is_active: true })).toBe(true)
    expect(isEmailEventRuleActive({ enabled: false, is_active: true })).toBe(false)
    expect(isEmailEventRuleActive({ enabled: true, is_active: false })).toBe(false)
  })

  it('keeps labels, rules and templates aligned for all 13 events', () => {
    const ruleKeys = DEFAULT_EMAIL_EVENT_RULES.map((rule) => rule.event_key).sort()
    const templateKeys = DEFAULT_EMAIL_TEMPLATES.map((template) => template.template_key).sort()
    const labelKeys = Object.keys(CANONICAL_EMAIL_EVENT_LABELS).sort()

    expect(ruleKeys).toHaveLength(13)
    expect(new Set(ruleKeys).size).toBe(13)
    expect(templateKeys).toEqual(ruleKeys)
    expect(labelKeys).toEqual(ruleKeys)
  })
})
