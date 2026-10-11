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

function num(value: number | null | undefined) {
  return value === null || value === undefined ? null : String(value)
}

const CONSUMPTION_BASIS = { measured: 'MEASURED', estimated: 'ESTIMATED', measured_with_estimate: 'MEASURED_WITH_ESTIMATE', reconciliation: 'RECONCILIATION' } as const

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
    out.push(el('InvoiceType', e?.invoice_type === 'credit' ? 'CREDIT' : 'DEBIT', '      '))
    out.push(el('ConsumptionBasis', e ? CONSUMPTION_BASIS[e.consumption_basis] : null, '      '))
    out.push(el('PriceArea', row.price_area, '      '))
    out.push(el('Period', period(row.period_start, row.period_end), '      '))
    out.push(el('ConsumptionKwh', kwh(row.kwh), '      '))
    out.push(el('AveragePriceOrePerKwh', e?.average_price_ore_per_kwh === null || e?.average_price_ore_per_kwh === undefined ? null : e.average_price_ore_per_kwh.toFixed(2), '      '))
    if (e?.reconciliation) {
      const r = e.reconciliation
      out.push('      <Reconciliation>')
      out.push(el('Role', r.role === 'credit_preliminary' ? 'CREDIT_PRELIMINARY' : 'CHARGE_FINAL', '        '))
      out.push(el('ReconciledMonth', r.reconciled_month, '        '))
      out.push(el('PreliminaryKwh', kwh(r.preliminary_kwh), '        '))
      out.push(el('FinalKwh', kwh(r.final_kwh), '        '))
      out.push(el('DifferenceKwh', kwh(r.difference_kwh), '        '))
      out.push('      </Reconciliation>')
    }
    const facilities = e?.facilities ?? []
    out.push(el('FacilityCount', String(facilities.length), '      '))
    out.push('      <Facilities>')
    for (const f of facilities) {
      out.push('        <Facility>')
      out.push(el('FacilityId', f.facility_id, '          '))
      out.push(el('MeteringPointId', f.metering_point_id, '          '))
      out.push(el('FacilityAddress', f.site_street, '          '))
      out.push(el('FacilityZipCode', f.site_postal_code, '          '))
      out.push(el('FacilityCity', f.site_city, '          '))
      out.push(el('PriceArea', f.price_area, '          '))
      out.push(el('GridArea', f.grid_area, '          '))
      out.push(el('GridOwner', f.grid_owner, '          '))
      out.push(el('Period', period(f.period_start, f.period_end), '          '))
      out.push(el('ConsumptionKwh', kwh(f.consumption_kwh), '          '))
      out.push(el('EstimatedAnnualConsumptionKwh', kwh(f.estimated_annual_kwh), '          '))
      out.push('        </Facility>')
    }
    out.push('      </Facilities>')
    const c = e?.contract
    if (c) {
      out.push('      <Contract>')
      out.push(el('ContractName', c.name, '        '))
      out.push(el('ContractNumber', c.number, '        '))
      out.push(el('ContractType', c.type, '        '))
      out.push(el('StartDate', c.start_date, '        '))
      out.push(el('BindingMonths', num(c.binding_months), '        '))
      out.push(el('BindingEndDate', c.binding_end_date, '        '))
      out.push(el('BindingMonthsRemaining', num(c.binding_months_remaining), '        '))
      out.push(el('NoticeMonths', num(c.notice_months), '        '))
      out.push(el('AutoRenew', c.auto_renew === null ? null : c.auto_renew ? 'true' : 'false', '        '))
      out.push(el('FixedPriceOrePerKwh', num(c.fixed_price_ore_per_kwh), '        '))
      out.push(el('SpotMarkupOrePerKwh', num(c.spot_markup_ore_per_kwh), '        '))
      out.push(el('MonthlyFeeSek', c.monthly_fee_sek === null ? null : amount(c.monthly_fee_sek), '        '))
      out.push('      </Contract>')
    }
    out.push('    </Electricity>')
    out.push('    <InvoiceSpecification>')
    for (const line of row.lines) {
      const vatRate = line.vat_rate ?? NORDFIN_VAT_PERCENT / 100
      const vatPercent = vatRate <= 1 ? vatRate * 100 : vatRate
      const total = line.amount_inc_vat ?? line.amount_ex_vat * (1 + vatPercent / 100)
      out.push('      <InvoiceRowsSpecification>')
      out.push(el('Period', period(row.period_start, row.period_end), '        '))
      out.push(el('Description', line.description, '        '))
      out.push(el('LineType', line.line_type ?? null, '        '))
      out.push(el('Quantity', line.quantity === null ? null : String(line.quantity), '        '))
      out.push(el('Unit', line.unit, '        '))
      out.push(el('UnitPrice', line.unit_price_ex_vat === null ? null : String(line.unit_price_ex_vat), '        '))
      out.push(el('Amount', amount(line.amount_ex_vat), '        '))
      out.push(el('Vat', vatPercent.toFixed(6), '        '))
      out.push(el('Total', amount(total), '        '))
      out.push('      </InvoiceRowsSpecification>')
    }
    out.push('    </InvoiceSpecification>')
    out.push('  </Inv>')
  }
  out.push('</Invoices>')
  return `${out.join('\r\n')}\r\n`
}
