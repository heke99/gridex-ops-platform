import type { CompanyEmailTemplate } from './emailTemplates'
import {
  EMAIL_TEMPLATE_VARIABLES,
  emailEventAvailableVariables,
  emailEventRequiredVariables,
  getEmailEventVariableContract,
} from './eventVariableContracts'

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
  eventKey?: string | null,
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

  const contractKey = eventKey ?? template.template_key
  const contract = getEmailEventVariableContract(contractKey)
  if (contract) {
    const available = emailEventAvailableVariables(contractKey)
    const unavailable = [...referenced].filter(
      (key) => !available.has(key as never),
    )
    if (unavailable.length > 0) {
      throw new Error(
        `email_template_variables_unavailable_for_event:${contract.eventKey}:${unavailable.join(',')}`,
      )
    }
  }

  return [...referenced]
}

function renderValue(
  value: string,
  variables: EmailTemplateVariables,
  html: boolean,
  templateKey: string,
  eventKey?: string | null,
) {
  const contractKey = eventKey ?? templateKey
  const contract = getEmailEventVariableContract(contractKey)
  const required = contract ? emailEventRequiredVariables(contractKey) : null

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
        if (required?.has(key as never) || !contract) {
          throw new Error(`email_template_required_variable_missing:${templateKey}:${key}`)
        }
        return ''
      }

      const text = String(raw)
      return html ? escapeHtml(text) : text
    },
  )
}

export function renderEmailTemplate(
  template: CompanyEmailTemplate,
  variables: EmailTemplateVariables,
  options: { eventKey?: string | null } = {},
) {
  validateEmailTemplateVariableContract(template, options.eventKey)
  const subject = renderValue(
    template.subject,
    variables,
    false,
    template.template_key,
    options.eventKey,
  )
  const html = renderValue(
    template.body_html,
    variables,
    true,
    template.template_key,
    options.eventKey,
  )
  const text = template.body_text
    ? renderValue(
        template.body_text,
        variables,
        false,
        template.template_key,
        options.eventKey,
      )
    : stripHtml(html)

  return { subject, html, text }
}
