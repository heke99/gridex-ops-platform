import type { EmailProvider } from './types'
import { ResendEmailProvider } from './resendProvider'

export function getEmailProvider(): EmailProvider {
  const provider = (process.env.EMAIL_PROVIDER ?? 'resend').trim().toLowerCase()

  if (provider === 'resend') {
    return new ResendEmailProvider()
  }

  throw new Error(`Okänd e-postleverantör: ${provider}. Stöd finns för resend.`)
}
