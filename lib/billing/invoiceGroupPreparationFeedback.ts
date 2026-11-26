export const invoiceGroupPreparationMessages = {
  price_timeline_invoice_review_required: 'Avtalets prisversioner har ändrats. Läs om prisunderlaget före attest.',
  invoice_group_prepare_failed: 'Samlingsfakturan kunde inte beredas. Kontrollera valda underlag.',
  invoice_group_company_scope_mismatch: 'Valt fakturerande bolag eller fakturamiljö stämmer inte med underlagen.',
  invoice_group_issuer_series_missing: 'En godkänd nummerserie för samlingsfakturor saknas för bolaget och fakturamiljön.',
  invoice_group_issuer_terms_missing: 'Bekräftade betalvillkor saknas för samlingsfakturan.',
  invoice_group_terms_conflict: 'Samlingsfakturan kan inte skapas eftersom betalvillkoren skiljer sig.',
  invoice_group_selection_changed: 'De valda faktureringsunderlagen eller faktureringscykeln har ändrats. Läs om urvalet.',
  invoice_group_source_not_ready: 'Alla valda anläggningar behöver färdiga faktureringsunderlag.',
  invoice_group_customer_choice_changed: 'Kundens val eller fakturauppgifter har ändrats. Kontrollera de berörda avtalen.',
  invoice_group_site_mismatch: 'Kund, anläggning och mätpunkt stämmer inte för alla underlag.',
  invoice_group_price_not_locked: 'Låst prissättning saknas för en vald anläggning.',
  invoice_group_calculation_changed: 'Det låsta fakturaunderlaget har ändrats. Läs om och granska samlingsfakturan igen.',
  invoice_group_delivery_missing: 'Bekräftad fakturamottagare eller leveransväg saknas på en vald anläggning.',
  invoice_group_recipient_conflict: 'Samlingsfakturan kan inte skapas eftersom fakturamottagarna skiljer sig.',
  invoice_group_locked_currency_mismatch: 'Underlagets valuta kan inte bekräftas av den låsta prissättningen.',
  invoice_group_currency_conflict: 'Samlingsfakturan kan inte skapas eftersom valutorna skiljer sig.',
  invoice_group_channel_conflict: 'Samlingsfakturan kan inte skapas eftersom leveranskanalerna eller fakturaadresserna skiljer sig.',
  invoice_group_source_already_reserved: 'Ett valt underlag har redan beretts på en annan faktura.',
  invoice_group_distinct_sites_required: 'Samlingsfakturan behöver underlag för minst två anläggningar.',
  invoice_group_changed_replay: 'En samlingsfaktura finns redan för ett annat urval under faktureringscykeln.',
  invoice_group_source_busy: 'Ett valt underlag bereds redan. Läs om urvalet och försök igen.',
} as const

export type InvoiceGroupPreparationCode = keyof typeof invoiceGroupPreparationMessages

export function readInvoiceGroupPreparationCode(value: string): InvoiceGroupPreparationCode | null {
  return Object.hasOwn(invoiceGroupPreparationMessages, value) ? value as InvoiceGroupPreparationCode : null
}
