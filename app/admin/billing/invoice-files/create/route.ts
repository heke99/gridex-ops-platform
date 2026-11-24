import { submitInvoiceFile } from '../submit'

const formBytesLimit = 512 * 1024 + 4096
const privateHeaders = { 'Cache-Control': 'no-store' }

async function readExportForm(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return new FormData()
  const decoder = new TextDecoder()
  let bytes = 0
  let raw = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > formBytesLimit) {
      await reader.cancel()
      return null
    }
    raw += decoder.decode(value, { stream: true })
  }
  raw += decoder.decode()
  const form = new FormData()
  for (const [key, value] of new URLSearchParams(raw)) form.append(key, value)
  return form
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const target = new URL(request.url)
  // A standalone Next server can substitute localhost in request.url.
  const host = request.headers.get('host') ?? target.host
  if (origin !== `${target.protocol}//${host.toLowerCase()}`) {
    return new Response(null, { status: 403, headers: privateHeaders })
  }
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
    'application/x-www-form-urlencoded') {
    return new Response(null, { status: 415, headers: privateHeaders })
  }
  const form = await readExportForm(request)
  if (!form) return new Response(null, { status: 413, headers: privateHeaders })
  const location = await submitInvoiceFile(form)
  return new Response(null, { status: 303, headers: { ...privateHeaders, Location: location } })
}
