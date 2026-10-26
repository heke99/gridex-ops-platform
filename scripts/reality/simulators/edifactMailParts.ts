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
