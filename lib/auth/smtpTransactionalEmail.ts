import nodemailer from 'nodemailer'

export type TransactionalEmailInput = {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
}

type AuthSmtpConfig = {
  host: string
  port: number
  user: string
  pass: string
  from: string
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

export function getAuthSmtpConfig(): AuthSmtpConfig {
  return {
    host: requiredEnv('AUTH_SMTP_HOST'),
    port: numberEnv('AUTH_SMTP_PORT', 465),
    user: requiredEnv('AUTH_SMTP_USER'),
    pass: requiredEnv('AUTH_SMTP_PASS'),
    from: getTransactionalEmailFromAddress(),
  }
}

function createAuthSmtpTransporter() {
  const config = getAuthSmtpConfig()
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  })
}

export async function assertTransactionalEmailReady() {
  const transporter = createAuthSmtpTransporter()

  try {
    await transporter.verify()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Auth-mail kunde inte ansluta till SMTP. Kontrollera AUTH_SMTP_HOST, AUTH_SMTP_PORT, AUTH_SMTP_USER, AUTH_SMTP_PASS och AUTH_SMTP_FROM i Vercel. SMTP-fel: ${message}`
    )
  }
}

export async function sendTransactionalEmail(input: TransactionalEmailInput) {
  const config = getAuthSmtpConfig()
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.port === 465,
    auth: { user: config.user, pass: config.pass },
  })

  return transporter.sendMail({
    from: input.from || config.from,
    replyTo: input.replyTo,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
  })
}
