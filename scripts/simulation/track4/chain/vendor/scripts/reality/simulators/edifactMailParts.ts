/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/reality/simulators/edifactMailParts.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
/**
 * The EDIFACT interchanges in a readable MIME text, as a counterparty reads them: every part that holds a UNA/UNB.
 * A base64 part is decoded as ISO 8859-1, the UNOC character set the platform encodes Ediel files in
 * (lib/ediel/core/edifactEncoding.ts). Decoding it as UTF-8 turned å/ä/ö into U+FFFD, so an answer that echoed the
 * file (a Z02 with the Z01's address) could not be encoded again (FINDINGS A-B4b).
 */
export function edifactInterchangesInMail(text: string): string[] {
  const files: string[] = []
  for (const part of text.split(/\r?\n--[^\r\n]+\r?\n/)) {
    const [head, ...rest] = part.split(/\r?\n\r?\n/)
    let content = rest.join('\n\n')
    if (/content-transfer-encoding:\s*base64/i.test(head)) content = Buffer.from(content.replace(/\s+/g, ''), 'base64').toString('latin1')
    if (!/UN[AB][+:]/.test(content)) continue
    files.push(content.slice(content.search(/UN[AB]/)).trim())
  }
  return files
}

/**
 * A mail attachment carrying an EDIFACT interchange as ISO 8859-1 bytes (UNOC), as a market actor sends it. A string
 * attachment is encoded as UTF-8 by nodemailer, so 'Anläggningen' arrived as 'AnlÃ¤ggningen': the grid owner's APERAK
 * text no longer matched the guide text and the platform refused it (ACK_PRODAT_APPLICATION_TEXT_INVALID, FINDINGS I-B6).
 */
export function edifactAttachment(filename: string, edifact: string) {
  const outside = [...edifact].find(char => char.codePointAt(0)! > 0xff)
  if (outside) throw Error(`edifact_attachment_not_iso8859_1:U+${outside.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`)
  return { filename, content: Buffer.from(edifact, 'latin1'), contentType: 'application/edifact' }
}
