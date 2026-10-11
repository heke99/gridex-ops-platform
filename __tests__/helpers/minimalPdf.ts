import { deflateSync } from 'node:zlib'

/** Builds a small structurally valid one-page PDF with a correct xref table. */
export function minimalPdf(text = 'Synthetic fullmakt'): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let out = '%PDF-1.7\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'))
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** PDF 1.5 variant: catalog and page live in a compressed object stream. */
export function objectStreamPdf(): Buffer {
  const inner = '1 0 3 50 '.padEnd(20, ' ') + '<< /Type /Catalog /Pages 2 0 R >>' + ' '.repeat(16) + '<< /Type /Page /Parent 2 0 R >>'
  const compressed = deflateSync(Buffer.from(inner, 'latin1'))
  let out = Buffer.from('%PDF-1.7\n', 'latin1')
  const objStm = Buffer.concat([
    Buffer.from(`5 0 obj\n<< /Type /ObjStm /N 2 /First 20 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`, 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
  out = Buffer.concat([out, objStm, Buffer.from('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1')])
  const xrefOffset = out.length
  out = Buffer.concat([out, Buffer.from(`6 0 obj\n<< /Type /XRef /Size 7 /Root 1 0 R >>\nstream\n\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`, 'latin1')])
  return out
}
