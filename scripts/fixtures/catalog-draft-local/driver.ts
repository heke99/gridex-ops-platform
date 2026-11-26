import type { Locator, Page } from 'playwright'

export type DraftTarget = {
  origin: string
  companyId: string
  offerId: string
  offerName: string
}

function isScopedCatalogue(url: URL, target: DraftTarget) {
  return url.origin === target.origin &&
    url.pathname === '/admin/contracts' &&
    url.searchParams.getAll('company_id').length === 1 &&
    url.searchParams.get('company_id') === target.companyId
}

function isDraftView(url: URL, target: DraftTarget) {
  return isScopedCatalogue(url, target) &&
    url.searchParams.getAll('view').length === 1 &&
    url.searchParams.get('view') === 'draft'
}

export async function draftSaveButton(page: Page, target: DraftTarget): Promise<Locator> {
  const current = new URL(page.url())
  if (!isDraftView(current, target)) throw new Error('Förväntade ordinarie Utkast-vy för valt bolag.')
  if (current.searchParams.getAll('edit_offer').length !== 1 ||
      current.searchParams.get('edit_offer') !== target.offerId) {
    throw new Error('Förväntade redigering av det valda utkastet.')
  }

  const button = page.getByRole('button', { name: 'Spara avtalsutkast', exact: true })
  await button.waitFor({ state: 'visible' })
  const fields = await button.evaluate(control => {
    const form = (control as HTMLButtonElement).form
    return form ? Array.from(new FormData(form).entries()) : []
  })
  function fieldValue(name: string) {
    const entries = fields.filter(([key]) => key === name)
    return entries.length === 1 ? entries[0]?.[1] : undefined
  }
  if (fieldValue('id') !== target.offerId ||
      fieldValue('company_id') !== target.companyId ||
      fieldValue('name') !== target.offerName ||
      fieldValue('lifecycle_status') !== 'draft') {
    throw new Error('Utkastformuläret har oväntat bolag, avtal eller livscykel.')
  }
  return button
}

export async function openCatalogueDraft(page: Page, target: DraftTarget): Promise<Locator> {
  if (!isScopedCatalogue(new URL(page.url()), target)) {
    throw new Error('Förväntade ordinarie avtalskatalog för valt bolag.')
  }
  if (!isDraftView(new URL(page.url()), target)) {
    await page.getByRole('link', { name: 'Utkast', exact: true }).click()
    await page.waitForURL(url => isDraftView(url, target))
  }

  const row = page.getByRole('row').filter({
    has: page.getByText(target.offerName, { exact: true }),
  })
  const edit = row.getByRole('link', { name: 'Redigera utkast', exact: true })
  const href = await edit.getAttribute('href')
  const destination = new URL(href ?? '', page.url())
  if (!href || !isDraftView(destination, target) ||
      destination.searchParams.getAll('edit_offer').length !== 1 ||
      destination.searchParams.get('edit_offer') !== target.offerId) {
    throw new Error('Utkastlänken pekar inte på det valda utkastet.')
  }
  await edit.click()
  await page.waitForURL(url => url.href === destination.href)
  return draftSaveButton(page, target)
}
