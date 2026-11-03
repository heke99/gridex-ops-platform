import { XMLParser } from 'fast-xml-parser'
import { CFB, read } from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildXlsxWorkbook, type XlsxRow } from '@/lib/billing/xlsx'

function workbookParts(headers: string[], rows: XlsxRow[]) {
  const bytes = buildXlsxWorkbook(headers, rows)
  const zip = CFB.read(bytes, { type: 'array' })
  const entries: Array<{ name: string; content: Uint8Array }> = zip.FileIndex
  const parts = entries
    .filter((entry) => entry.name.endsWith('.xml') || entry.name.endsWith('.rels'))
    .map((entry) => ({ name: entry.name, xml: new TextDecoder().decode(entry.content) }))
  return { bytes, parts, worksheet: parts.find((part) => part.name === 'sheet1.xml')!.xml }
}

function worksheetStrings(xml: string): string[] {
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: false }).parse(xml)
  const rows = [parsed.worksheet.sheetData.row].flat()
  return rows.flatMap((row) => [row.c].flat().map((cell) =>
    // ST_Xstring escapes are decoded once, after XML entity decoding.
    String(cell.is.t).replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
  ))
}

describe('billing XLSX string serialization', () => {
  it.each([
    ['NUL', '\u0000'],
    ['C0', '\u0001\u0008\u000b\u000c\u000e\u001f'],
    ['noncharacters', '\ufffe\uffff'],
    ['carriage return', '\r'],
    ['unpaired high surrogate', '\ud800'],
    ['unpaired low surrogate', '\udfff'],
  ])('exports %s in headers and values as valid XML without losing the input', (_, characters) => {
    const header = `Kund${characters}namn`
    const value = `Åsa${characters} AB`
    const stored = JSON.parse(JSON.stringify({ [header]: value }))
    const { parts, worksheet } = workbookParts([header], [stored])

    expect(parts).toHaveLength(6)
    for (const part of parts) {
      expect(part.xml, part.name).not.toMatch(/[\u0000-\u0008\u000b-\u001f\ufffe\uffff\ud800-\udfff]/u)
    }
    expect(worksheetStrings(worksheet)).toEqual([header, value])
  })

  it.each([
    '_x0001_ _xFFFF_ _x0041_',
    '_x005F_ _x005f_ _X000A_',
    '_x0001_x0041_ _x0000__x0000_',
    'literal _x000D_ followed by an actual\rreturn',
  ])('preserves literal OOXML escape sequences: %s', (literal) => {
    const { worksheet } = workbookParts([literal], [{ [literal]: literal }])
    expect(worksheetStrings(worksheet)).toEqual([literal, literal])
  })

  it('preserves Unicode, XML entities and permitted whitespace as text cells', () => {
    const header = 'Kund & <referens>'
    const value = 'Åsa 🧪 𐀀 & <AB> "citat" \'apostrof\'\tflik\nrad'
    const { bytes, worksheet } = workbookParts([header], [{ [header]: value }])
    expect(worksheetStrings(worksheet)).toEqual([header, value])
    const workbook = read(bytes, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    expect(sheet.A1.v).toBe(header)
    expect(sheet.A2.v).toBe(value)
    expect(sheet.A2.t).toBe('s')
  })

  it('keeps formula-looking strings literal and retains numeric and boolean cell types', () => {
    const formula = '=HYPERLINK("https://example.invalid","A")'
    const bytes = buildXlsxWorkbook(['text', 'amount', 'enabled'], [{ text: formula, amount: 12.5, enabled: true }])
    const workbook = read(bytes, { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    expect(sheet.A2).toMatchObject({ t: 's', v: formula })
    expect(sheet.A2.f).toBeUndefined()
    expect(sheet.B2).toMatchObject({ t: 'n', v: 12.5 })
    expect(sheet.C2).toMatchObject({ t: 'b', v: true })
  })
})
