import type { CompanyEmailTemplate } from './emailTemplates'

const SUPPORTED_VARIABLES = new Set([
  'customer_name',
  'customer_number',
  'company_name',
  'contract_name',
  'start_date',
  'facility_id',
  'metering_point_id',
  'support_email',
  'cancellation_deadline',
  'portal_url',
])

export type EmailTemplateVariables = Record<string, string | number | null | undefined>

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderValue(value: string, variables: EmailTemplateVariables, html: boolean) {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    if (!SUPPORTED_VARIABLES.has(key)) return ''
    const raw = variables[key]
    const text = raw === null || raw === undefined ? '' : String(raw)
    return html ? escapeHtml(text) : text
  })
}

export function renderEmailTemplate(template: CompanyEmailTemplate, variables: EmailTemplateVariables) {
  const subject = renderValue(template.subject, variables, false)
  const html = renderValue(template.body_html, variables, true)
  const text = template.body_text
    ? renderValue(template.body_text, variables, false)
    : stripHtml(html)

  return { subject, html, text }
}
