// FINDINGS T7: the platform's shared production Ediel mailbox, configured as Gridex staff do it in
// /admin/inbound-mail ("Spara shared mailbox"). The platform stores every inbound file in the lane of the mailbox
// it arrived in; without a polled production mailbox the grid owner's answers to a production Z03 land in the
// test lane and never meet their original. Production's seeded row (ediel@gridex.se) has no IMAP host; the world
// points the same row at its own GreenMail on a synthetic address. The password is an env reference only
// (scripts/reality/up.sh); nothing is written to the database outside the product's own action.
import type { BrowserContext } from '@playwright/test'
import { LIVE, literal, sql } from '../live-chain-fixture'
import { submitServerAction } from './operatorConsole'

export const PRODUCTION_MAILBOX = process.env.GRIDEX_SHARED_EDIEL_PRODUCTION_EMAIL ?? 'gridex-ediel@example.invalid'
const MAILBOX_NAME = 'Gridex shared Ediel mailbox (production)'

export async function configureProductionMailboxAsOperator(context: BrowserContext) {
  const page = await context.newPage()
  try {
    await page.goto('/admin/inbound-mail', { waitUntil: 'load' })
    const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Spara shared mailbox' }) })
    await form.locator('select[name="environment"]').selectOption('production')
    const fill = async (name: string, value: string) => form.locator(`input[name="${name}"]`).fill(value)
    await fill('mailbox_name', MAILBOX_NAME)
    await fill('email_address', PRODUCTION_MAILBOX)
    await fill('imap_host', LIVE.mailHost)
    await fill('imap_port', String(LIVE.imapsPort))
    await fill('imap_folder', 'INBOX')
    await form.locator('input[name="imap_secure"]').check()
    await fill('username', PRODUCTION_MAILBOX)
    await fill('secret_reference', 'env:GRIDEX_SHARED_EDIEL_PRODUCTION_IMAP_PASS')
    await fill('smtp_host', LIVE.mailHost)
    await fill('smtp_port', String(LIVE.smtpsPort))
    await form.locator('input[name="smtp_secure"]').check()
    await fill('smtp_from', PRODUCTION_MAILBOX)
    await fill('smtp_username', PRODUCTION_MAILBOX)
    await fill('smtp_secret_reference', 'env:EDIEL_SMTP_PASS')
    const actionStatus = await submitServerAction(page, () => form.getByRole('button', { name: 'Spara shared mailbox' }).click(), 120_000)
    const rows = sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email_address,'imap',imap_host,'port',imap_port,
        'active',is_active,'secret',secret_reference,'error',last_error)),'[]') FROM public.ediel_mailboxes
      WHERE company_id IS NULL AND environment='production'`)
    const configured = rows.filter(row => row.email === PRODUCTION_MAILBOX && row.imap === LIVE.mailHost && Number(row.port) === LIVE.imapsPort && row.active === true)
    if (actionStatus !== 200 || configured.length !== 1)
      throw Error(`production_mailbox_not_configured:${actionStatus}:${JSON.stringify(rows)}`)
    // A second production row for the same lane would make the poller read two inboxes for one address.
    const shared = sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment='production'
      AND is_active AND coalesce(metadata->>'scope','')='platform_shared' AND email_address<>${literal(PRODUCTION_MAILBOX)}`)
    return { actionStatus, mailbox: configured[0], otherActiveSharedProductionMailboxes: shared }
  } finally {
    await page.close()
  }
}
