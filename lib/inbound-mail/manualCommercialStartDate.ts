// Share this inventory with the repeated-statement conflict check. A bare
// "kan börja" also describes cancellation/administration, not supply start.
export const MANUAL_SUPPLIER_START_LABEL = /(?:^|[.!?;]\s*)(?:tidigaste\s+(?:leveransstart|start(?:datum)?(?:\s+hos\s+ny\s+leverantör)?)|earliest[\s_-]*start|leverantörsbyte(?:t)?\s+(?:(?:är\s+)?möjligt(?:\s+tidigast)?(?:\s+från)?|från)|kunden\s+(?:kan|får)\s+(?:tidigast\s+)?(?:starta|börja|byta(?:\s+(?:el)?leverantör)?|påbörja\s+(?:sin\s+)?(?:el|leverans))(?:\s+hos\s+(?:(?:en\s+)?ny\s+leverantör|er))?(?:\s+tidigast)?)/i

/** Pure calendar calculation. The caller must independently establish that
 * receivedDate is the original trusted Stockholm receipt day. */
export function relativeManualCommercialStartDate(input: {
  raw: string; sourceLine: string; receivedDate: string
}): string | null {
  const fold = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim()
    .toLocaleLowerCase('sv-SE').replace(/[.;]+$/, '').trim()
  const raw = fold(input.raw), line = fold(input.sourceLine)
  if (/\b(?:inom|senast|cirka|ungefär|mellan|arbetsdagar|bankdagar)\b|upp\s+till/.test(line)) return null
  const relative = line.match(/\bom\s+(\d{1,3})\s+((?:kalender)?dag(?:ar)?)(?:\s+från\s+(?:idag|i\s+dag|dagens\s+datum|mejlets\s+datum))?$/)
  if (!relative || relative.index === undefined) return null
  const before = line.slice(0, relative.index).replace(/\s*[:\-]?\s*$/, '')
  const label = before.match(MANUAL_SUPPLIER_START_LABEL)
  if (!label || label.index === undefined || label.index + label[0].length !== before.length) return null
  // A shorter AI quote must still describe this exact source offset, not an
  // unrelated notice duration elsewhere on the same line.
  if (![relative[0], `${relative[1]} ${relative[2]}`, line].includes(raw)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate)) return null
  const date = new Date(`${input.receivedDate}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.receivedDate) return null
  // Calendar arithmetic, independent of DST, worker time and retries. The
  // caller must qualify receipt provenance before using this calculation.
  date.setUTCDate(date.getUTCDate() + Number(relative[1]))
  if (date.getUTCFullYear() > 2199) return null
  return date.toISOString().slice(0, 10)
}
