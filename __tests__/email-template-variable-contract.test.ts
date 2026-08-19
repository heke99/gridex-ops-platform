import { describe, expect, it } from 'vitest'
import {
  renderEmailTemplate,
  validateEmailTemplateVariableContract,
} from '@/lib/email/templateRenderer'
import type { CompanyEmailTemplate } from '@/lib/email/emailTemplates'

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

describe('email template variable contract', () => {
  it('renders customer completion variables instead of silently erasing them', () => {
    const rendered = renderEmailTemplate(
      template(
        'contract.customer_information_required',
        '{{required_information}} · {{portal_url}}',
      ),
      {
        customer_name: 'Testkund',
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
        power_of_attorney_url: 'https://example.invalid/poa/token',
      },
    )

    expect(rendered.text).toContain('https://example.invalid/poa/token')
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
        { customer_name: 'Testkund' },
      ),
    ).toThrow(/email_template_required_variable_missing/)
  })
})
