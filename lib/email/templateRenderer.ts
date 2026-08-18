import {
  EMAIL_TEMPLATE_VARIABLES,
  type CompanyEmailTemplate,
} from './emailTemplates'

const SUPPORTED_VARIABLES = new Set<string>(EMAIL_TEMPLATE_VARIABLES)
const BALANCED_PLACEHOLDER = /\{\{([^{}]*)\}\}/g

export type EmailTemplateVariables = Record<
  string,
  string | number | null | undefined
>

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

export function extractEmailTemplateVariables(value: string): string[] {
  const variables = new Set<string>()
  for (const match of value.matchAll(BALANCED_PLACEHOLDER)) {
    variables.add(match[1].trim())
  }
  return [...variables]
}

export function validateEmailTemplateVariableContract(
  template: Pick<CompanyEmailTemplate, 'template_key' | 'subject' | 'body_html' | 'body_text'>,
) {
  const referenced = new Set([
    ...extractEmailTemplateVariables(template.subject),
    ...extractEmailTemplateVariables(template.body_html),
    ...extractEmailTemplateVariables(template.body_text ?? ''),
  ])
  const unknown = [...referenced].filter((key) => !SUPPORTED_VARIABLES.has(key))
  if (unknown.length > 0) {
    const labels = unknown.map((key) => key || '<empty>')
    throw new Error(
      `email_template_unknown_variables:${template.template_key}:${labels.join(',')}`,
    )
  }
  return [...referenced]
}

function renderValue(
  value: string,
  variables: EmailTemplateVariables,
  html: boolean,
  templateKey: string,
) {
  return value.replace(
    BALANCED_PLACEHOLDER,
    (_match, rawKey: string) => {
      const key = rawKey.trim()
      if (!SUPPORTED_VARIABLES.has(key)) {
        throw new Error(
          `email_template_unknown_variable:${templateKey}:${key || '<empty>'}`,
        )
      }
      const raw = variables[key]
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        throw new Error(`email_template_required_variable_missing:${templateKey}:${key}`)
      }
      const text = String(raw)
      return html ? escapeHtml(text) : text
    },
  )
}

export function renderEmailTemplate(
  template: CompanyEmailTemplate,
  variables: EmailTemplateVariables,
) {
  validateEmailTemplateVariableContract(template)
  const subject = renderValue(
    template.subject,
    variables,
    false,
    template.template_key,
  )
  const html = renderValue(
    template.body_html,
    variables,
    true,
    template.template_key,
  )
  const text = template.body_text
    ? renderValue(
        template.body_text,
        variables,
        false,
        template.template_key,
      )
    : stripHtml(html)

  return { subject, html, text }
}
