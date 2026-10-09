import type { InvoiceFileRow } from '@/lib/billing/invoiceFileExport'

/**
 * Nordfin invoice import (XML). Follows Nordfin's "Testfile_Specification_v1" layout
 * (<Invoices><Inv><Customer/><Invoice/><InvoiceSpecification/></Inv></Invoices>) and adds the
 * electricity facts Nordfin asked us to extend it with: an <Electricity> block per invoice and
 * quantity/unit/unit price per specification row. Rendering is pure: the same stored file rows
 * always give byte-identical XML.
 */
export const NORDFIN_VAT_PERCENT = 25

function xml(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 forbids most control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function el(name: string, value: unknown, indent: string) {
  const text = xml(value)
  return text === '' ? `${indent}<${name} />` : `${indent}<${name}>${text}</${name}>`
}

function amount(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2)
}

function kwh(value: number | null | undefined) {
  return value === null || value === undefined ? null : (Math.round(value * 1000) / 1000).toFixed(3)
}

function digits(value: string | null) {
  return value ? value.replace(/\D/g, '') : null
}

function period(start: string | null, end: string | null) {
  return start && end ? `${start}-${end}` : null
}

export function renderNordfinInvoiceXml(rows: InvoiceFileRow[]) {
  const out: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Invoices xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
  ]
  for (const row of rows) {
    const e = row.electricity
    out.push('  <Inv>')
    out.push('    <Customer>')
    out.push(el('Customername', row.customer_name, '      '))
    out.push(el('CustomerNumber', row.customer_number, '      '))
    out.push(el('Customeradress', row.street, '      '))
    out.push(el('ZipCode', row.postal_code, '      '))
    out.push(el('City', row.city, '      '))
    out.push(el('OrganizationNumber', digits(row.identity_number), '      '))
    out.push(el('CustomerEmail', row.email, '      '))
    out.push(el('CustomerType', row.customer_type === 'business' ? 'FTG' : 'PRV', '      '))
    out.push(el('CoName', row.recipient && row.recipient !== row.customer_name ? row.recipient : null, '      '))
    out.push(el('ClientId', row.nordfin_client_id, '      '))
    out.push('    </Customer>')
    out.push('    <Invoice>')
    out.push(el('InvoiceAmount', amount(row.amount_inc_vat), '      '))
    out.push(el('RemainingAmount', amount(row.amount_inc_vat), '      '))
    out.push(el('AmountExclVat', amount(row.amount_ex_vat), '      '))
    out.push(el('InvoiceVATAmount', amount(row.vat_amount), '      '))
    out.push(el('BillDate', row.invoice_date, '      '))
    out.push(el('DueDate', row.due_date, '      '))
    out.push(el('Delivery', row.email ? 'EMAIL' : 'PRINT', '      '))
    out.push(el('InvoiceNumber', row.invoice_number, '      '))
    // OCR/payment reference is pending a decision on how it is issued.
    out.push(el('PaymentReference', null, '      '))
    out.push('    </Invoice>')
    out.push('    <Electricity>')
    out.push(el('FacilityId', e?.facility_id, '      '))
    out.push(el('MeteringPointId', e?.metering_point_id, '      '))
    out.push(el('FacilityAddress', e?.site_street, '      '))
    out.push(el('FacilityZipCode', e?.site_postal_code, '      '))
    out.push(el('FacilityCity', e?.site_city, '      '))
    out.push(el('PriceArea', row.price_area, '      '))
    out.push(el('GridArea', e?.grid_area, '      '))
    out.push(el('GridOwner', e?.grid_owner, '      '))
    out.push(el('Period', period(row.period_start, row.period_end), '      '))
    out.push(el('ConsumptionKwh', kwh(row.kwh), '      '))
    out.push(el('EstimatedAnnualConsumptionKwh', kwh(e?.estimated_annual_kwh), '      '))
    out.push(el('ContractName', e?.contract_name, '      '))
    out.push('    </Electricity>')
    out.push('    <InvoiceSpecification>')
    for (const line of row.lines) {
      const total = line.amount_ex_vat * (1 + NORDFIN_VAT_PERCENT / 100)
      out.push('      <InvoiceRowsSpecification>')
      out.push(el('Period', period(row.period_start, row.period_end), '        '))
      out.push(el('Description', line.description, '        '))
      out.push(el('Quantity', line.quantity === null ? null : String(line.quantity), '        '))
      out.push(el('Unit', line.unit, '        '))
      out.push(el('UnitPrice', line.unit_price_ex_vat === null ? null : String(line.unit_price_ex_vat), '        '))
      out.push(el('Amount', amount(line.amount_ex_vat), '        '))
      out.push(el('Vat', NORDFIN_VAT_PERCENT.toFixed(6), '        '))
      out.push(el('Total', amount(total), '        '))
      out.push('      </InvoiceRowsSpecification>')
    }
    out.push('    </InvoiceSpecification>')
    out.push('  </Inv>')
  }
  out.push('</Invoices>')
  return `${out.join('\r\n')}\r\n`
}
