import { getEmailProvider } from '@/lib/email/providers'
import type { SendEmailInput, SendEmailResult } from '@/lib/email/providers/types'

export async function sendApplicationEmail(input: SendEmailInput): Promise<SendEmailResult> {
  return getEmailProvider().sendEmail(input)
}
