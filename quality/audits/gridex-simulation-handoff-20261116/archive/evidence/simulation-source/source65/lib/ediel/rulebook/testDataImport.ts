export type StructuredTestDataImport = {
  headers: string[]
  rows: Array<Record<string, string>>
  customers: Array<Record<string, string>>
  facilities: Array<Record<string, string>>
  meteringPoints: Array<Record<string, string>>
  expectedValues: Array<Record<string, string>>
  expectedAcks: Array<Record<string, string>>
  fieldValues: Array<Record<string, string>>
  warnings: string[]
}

function detectDelimiter(line: string): string {
  if (line.includes(';')) return ';'
  if (line.includes('\t')) return '\t'
  return ','
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

function splitLine(line: string, delimiter: string): string[] {
  // Simple, robust enough for pasted AGT/TGT tables. Quoted CSV can be handled later if needed.
  return line.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, ''))
}

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]
    if (value && value.trim().length > 0) return value.trim()
  }
  return null
}

export function parseStructuredTestData(text: string): StructuredTestDataImport {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) {
    return { headers: [], rows: [], customers: [], facilities: [], meteringPoints: [], expectedValues: [], expectedAcks: [], fieldValues: [], warnings: ['Ingen testdata hittades.'] }
  }

  const delimiter = detectDelimiter(lines[0])
  const headers = splitLine(lines[0], delimiter).map(normalizeHeader)
  const rows = lines.slice(1).map((line) => {
    const values = splitLine(line, delimiter)
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  })

  const warnings: string[] = []
  if (delimiter !== ';') warnings.push('Testdata importerades, men filen är inte semikolonseparerad. Kontrollera formatet om källan är AI/BI eller Ediel-bilaga.')

  const customers = rows
    .filter((row) => pick(row, ['customer_id', 'kund_id', 'personnummer', 'organisationsnummer', 'customer_identifier', 'kundnummer']))
    .map((row) => ({
      test_case_code: pick(row, ['test_case', 'testfall', 'test_case_code', 'id']) ?? '',
      customer_identifier: pick(row, ['customer_id', 'kund_id', 'personnummer', 'organisationsnummer', 'customer_identifier', 'kundnummer']) ?? '',
      customer_name: pick(row, ['customer_name', 'kundnamn', 'namn', 'name']) ?? '',
      raw: JSON.stringify(row),
    }))

  const facilities = rows
    .filter((row) => pick(row, ['facility_id', 'anlaggnings_id', 'anlaggningsid', 'gsrn', 'metering_point_id']))
    .map((row) => ({
      test_case_code: pick(row, ['test_case', 'testfall', 'test_case_code', 'id']) ?? '',
      facility_id: pick(row, ['facility_id', 'anlaggnings_id', 'anlaggningsid', 'gsrn']) ?? pick(row, ['metering_point_id']) ?? '',
      grid_area_id: pick(row, ['grid_area_id', 'natomrade', 'natomrades_id', 'area_id']) ?? '',
      raw: JSON.stringify(row),
    }))

  const meteringPoints = rows
    .filter((row) => pick(row, ['metering_point_id', 'meter_point_id', 'ediel_reference', 'anlaggnings_id', 'facility_id']))
    .map((row) => ({
      test_case_code: pick(row, ['test_case', 'testfall', 'test_case_code', 'id']) ?? '',
      metering_point_id: pick(row, ['metering_point_id', 'meter_point_id', 'ediel_reference', 'anlaggnings_id', 'facility_id']) ?? '',
      metering_method: pick(row, ['metering_method', 'matmetod']) ?? '',
      reporting_frequency: pick(row, ['reporting_frequency', 'rapportering', 'upplosning']) ?? '',
      raw: JSON.stringify(row),
    }))

  const expectedAcks = rows
    .filter((row) => pick(row, ['expected_contrl', 'forvantad_contrl', 'expected_aperak', 'forvantad_aperak', 'expected_utilts_err']))
    .map((row) => ({
      test_case_code: pick(row, ['test_case', 'testfall', 'test_case_code', 'id']) ?? '',
      expected_contrl: pick(row, ['expected_contrl', 'forvantad_contrl']) ?? '',
      expected_aperak: pick(row, ['expected_aperak', 'forvantad_aperak']) ?? '',
      expected_utilts_err: pick(row, ['expected_utilts_err', 'forvantad_utilts_err']) ?? '',
      raw: JSON.stringify(row),
    }))

  const expectedValues = rows.map((row) => ({
    test_case_code: pick(row, ['test_case', 'testfall', 'test_case_code', 'id']) ?? '',
    message_family: pick(row, ['message_family', 'familj']) ?? '',
    message_code: pick(row, ['message_code', 'kod', 'bgm']) ?? '',
    expected_status: pick(row, ['expected_status', 'status']) ?? '',
    raw: JSON.stringify(row),
  }))

  const fieldValues = rows.flatMap((row) => headers.map((header) => ({
    test_case_code: pick(row, ['test_case', 'testfall', 'test_case_code', 'id']) ?? '',
    field_key: header,
    field_value: row[header] ?? '',
    raw: JSON.stringify(row),
  })))

  return { headers, rows, customers, facilities, meteringPoints, expectedValues, expectedAcks, fieldValues, warnings }
}
