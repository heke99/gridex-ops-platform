import nodemailer from 'nodemailer'

export type TransactionalEmailInput = {
  to: string
  subject: string
  html: string
  text?: string
}

function requiredEnv(name: string): string {
  const value = process.env[name] ?? ''
  if (!value.trim()) {
    throw new Error(
      `Miljövariabel saknas för auth-mail: ${name}. Lägg in AUTH_SMTP_HOST, AUTH_SMTP_PORT, AUTH_SMTP_USER, AUTH_SMTP_PASS och AUTH_SMTP_FROM i Vercel.`
    )
  }
  return value.trim()
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function getTransactionalEmailFromAddress() {
  return (process.env.AUTH_SMTP_FROM ?? process.env.AUTH_EMAIL_FROM ?? 'no-reply@gridex.se').trim()
}

export async function sendTransactionalEmail(input: TransactionalEmailInput) {
  const host = requiredEnv('AUTH_SMTP_HOST')
  const port = numberEnv('AUTH_SMTP_PORT', 465)
  const user = requiredEnv('AUTH_SMTP_USER')
  const pass = requiredEnv('AUTH_SMTP_PASS')
  const from = getTransactionalEmailFromAddress()

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })

  return transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  })
}
