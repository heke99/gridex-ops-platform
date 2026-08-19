import { describe, expect, it } from 'vitest'
import {
  renderEmailTemplate,
  validateEmailTemplateVariableContract,
} from '@/lib/email/templateRenderer'
import type { CompanyEmailTemplate } from '@/lib/email/emailTemplates'
import { DEFAULT_EMAIL_TEMPLATES } from '@/lib/email/emailTemplates'
import {
  EMAIL_EVENT_VARIABLE_CONTRACTS,
  sampleEmailVariablesForEvent,
} from '@/lib/email/eventVariableContracts'

function template(
  templateKey: string,
  body: string,
): CompanyEmailTemplate {
  return {
    id: 'test-template',
    company_id: '00000000-0000-0000-0000-000000000001',
    template_key: templateKey,
    name: 'Test',
    subject: 'Hej {{customer_name}}',
    body_html: `<p>${body}</p>`,
    body_text: body,
    language: 'sv',
    is_active: true,
    created_at: '2026-08-18T00:00:00.000Z',
    updated_at: '2026-08-18T00:00:00.000Z',
  }
}

function defaultTemplate(templateKey: string): CompanyEmailTemplate {
  const row = DEFAULT_EMAIL_TEMPLATES.find((item) => item.template_key === templateKey)
  if (!row) throw new Error(`missing_default_template:${templateKey}`)
  return {
    id: `default:${templateKey}`,
    company_id: '00000000-0000-0000-0000-000000000001',
    template_key: row.template_key,
    name: row.name,
    subject: row.subject,
    body_html: row.body_html,
    body_text: row.body_text,
    language: 'sv',
    is_active: true,
    created_at: '2026-08-19T00:00:00.000Z',
    updated_at: '2026-08-19T00:00:00.000Z',
  }
}

describe('email template variable contract', () => {
  it('renders customer completion variables instead of silently erasing them', () => {
    const rendered = renderEmailTemplate(
      template(
        'contract.customer_information_required',
        '{{required_information}} · {{portal_url}}',
      ),
      {
        customer_name: 'Testkund',
        company_name: 'Testbolag',
        required_information: 'Anläggnings-ID',
        portal_url: 'https://example.invalid/complete',
      },
    )

    expect(rendered.text).toContain('Anläggnings-ID')
    expect(rendered.text).toContain('https://example.invalid/complete')
  })

  it('renders the power-of-attorney URL', () => {
    const rendered = renderEmailTemplate(
      template(
        'contract.power_of_attorney_required',
        '{{power_of_attorney_url}}',
      ),
      {
        customer_name: 'Testkund',
        company_name: 'Testbolag',
        contract_name: 'Elavtal',
        power_of_attorney_url: 'https://example.invalid/poa/token',
        support_email: 'support@example.invalid',
      },
    )

    expect(rendered.text).toContain('https://example.invalid/poa/token')
  })

  it('allows an optional event variable to be blank', () => {
    const rendered = renderEmailTemplate(
      template('contract.application_received', '{{customer_phone}}'),
      {
        customer_name: 'Testkund',
        customer_email: 'test@example.invalid',
        customer_number: 'DX-1',
        company_name: 'Testbolag',
        support_email: 'support@example.invalid',
        customer_phone: '',
      },
      { eventKey: 'contract.application_received' },
    )
    expect(rendered.text).toBe('')
  })

  it('supports the lifecycle action message that Gridex uses', () => {
    const rendered = renderEmailTemplate(
      template('switch.action_required', '{{case_message}} · {{portal_url}}'),
      sampleEmailVariablesForEvent('switch.action_required'),
      { eventKey: 'switch.action_required' },
    )
    expect(rendered.text).toContain('leverantörsbytet')
    expect(rendered.text).toContain('https://portal.example.invalid/')
  })

  it('fails closed when a template references a globally valid variable that the event cannot provide', () => {
    expect(() =>
      validateEmailTemplateVariableContract(
        template('switch.started', '{{review_reason}}'),
        'switch.started',
      ),
    ).toThrow(/email_template_variables_unavailable_for_event/)
  })

  it('renders every canonical default template with its explicit event contract sample', () => {
    for (const contract of Object.values(EMAIL_EVENT_VARIABLE_CONTRACTS)) {
      expect(() => renderEmailTemplate(
        defaultTemplate(contract.templateKey),
        sampleEmailVariablesForEvent(contract.eventKey),
        { eventKey: contract.eventKey },
      )).not.toThrow()
    }
  })

  it('fails closed for unknown placeholders', () => {
    expect(() =>
      validateEmailTemplateVariableContract(
        template('contract.test', '{{not_a_real_variable}}'),
      ),
    ).toThrow(/email_template_unknown_variables/)
  })

  it.each([
    '{{customer-name}}',
    '{{customer.name}}',
    '{{ }}',
  ])('fails closed for unsupported placeholder syntax: %s', (placeholder) => {
    expect(() =>
      validateEmailTemplateVariableContract(
        template('contract.test', placeholder),
      ),
    ).toThrow(/email_template_unknown_variables/)
  })

  it('fails closed when a referenced required variable is missing', () => {
    expect(() =>
      renderEmailTemplate(
        template('contract.customer_information_required', '{{required_information}}'),
        { customer_name: 'Testkund', company_name: 'Testbolag', portal_url: 'https://example.invalid' },
      ),
    ).toThrow(/email_template_required_variable_missing/)
  })
})
