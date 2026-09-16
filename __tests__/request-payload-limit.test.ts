import type { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { ApiInputError, readJsonObject } from '@/lib/api/strictRequest'
import { readTextBodyWithLimit } from '@/lib/http/boundedRequestBody'
import { readJsonWithLimit } from '@/lib/http/payloadLimit'

const encoder = new TextEncoder()

type StreamRequest = {
  request: Request
  pulls: () => number
  cancels: () => number
}

function streamRequest(input: {
  chunks: Uint8Array[]
  contentLength?: string
  readError?: Error
}): StreamRequest {
  let index = 0
  let pullCount = 0
  let cancelCount = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pullCount += 1
      if (index < input.chunks.length) {
        controller.enqueue(input.chunks[index])
        index += 1
        return
      }
      if (input.readError) {
        controller.error(input.readError)
        return
      }
      controller.close()
    },
    cancel() {
      cancelCount += 1
    },
  }, { highWaterMark: 0 })

  const headers = input.contentLength === undefined
    ? undefined
    : { 'content-length': input.contentLength }
  const request = new Request('https://example.invalid', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })

  return {
    request,
    pulls: () => pullCount,
    cancels: () => cancelCount,
  }
}

function textRequest(text: string, contentLength?: string): StreamRequest {
  return streamRequest({
    chunks: [encoder.encode(text)],
    contentLength,
  })
}

function asNextRequest(request: Request): NextRequest {
  return request as unknown as NextRequest
}

function expectApiInputError(error: unknown, code: string, status: number) {
  expect(error).toBeInstanceOf(ApiInputError)
  expect(error).toMatchObject({ code, status })
}

describe('bounded request body reader', () => {
  it('decodes UTF-8 characters split across chunks and accepts the exact byte cap', async () => {
    const raw = '{"name":"Å🙂"}'
    const bytes = encoder.encode(raw)
    const streamed = streamRequest({
      chunks: Array.from(bytes, (byte) => Uint8Array.of(byte)),
    })

    await expect(readTextBodyWithLimit(streamed.request, bytes.byteLength)).resolves.toEqual({
      ok: true,
      text: raw,
    })
    expect(streamed.cancels()).toBe(0)
  })

  it.each([
    ['an unknown length', undefined],
    ['a lying smaller content length', '2'],
  ])('stops and cancels an oversized stream with %s', async (_label, contentLength) => {
    const streamed = streamRequest({
      chunks: Array.from({ length: 100 }, () => new Uint8Array(1024)),
      contentLength,
    })

    await expect(readTextBodyWithLimit(streamed.request, 2048)).resolves.toEqual({
      ok: false,
      code: 'payload_too_large',
    })
    expect(streamed.pulls()).toBe(3)
    expect(streamed.cancels()).toBe(1)
  })

  it('rejects declared oversize before reading and cancels the body', async () => {
    const streamed = textRequest('{}', '2049')

    await expect(readTextBodyWithLimit(streamed.request, 2048)).resolves.toEqual({
      ok: false,
      code: 'payload_too_large',
    })
    expect(streamed.pulls()).toBe(0)
    expect(streamed.cancels()).toBe(1)
  })

  it('preserves stream read failures', async () => {
    const readError = new Error('stream failed')
    const streamed = streamRequest({ chunks: [encoder.encode('{')], readError })

    await expect(readTextBodyWithLimit(streamed.request, 100)).rejects.toBe(readError)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the invalid byte limit %s',
    async (limit) => {
      const streamed = textRequest('{}')
      await expect(readTextBodyWithLimit(streamed.request, limit)).rejects.toBeInstanceOf(RangeError)
      expect(streamed.pulls()).toBe(0)
    },
  )
})

describe('readJsonWithLimit', () => {
  it('maps a streamed overflow to payload_too_large without draining the body', async () => {
    const streamed = streamRequest({
      chunks: Array.from({ length: 100 }, () => new Uint8Array(1024)),
    })

    await expect(readJsonWithLimit(asNextRequest(streamed.request), 2048)).resolves.toEqual({
      ok: false,
      code: 'payload_too_large',
      limitBytes: 2048,
    })
    expect(streamed.pulls()).toBe(3)
    expect(streamed.cancels()).toBe(1)
  })

  it('keeps empty and whitespace-only bodies as empty objects', async () => {
    await expect(readJsonWithLimit(asNextRequest(textRequest('').request), 20)).resolves.toEqual({
      ok: true,
      body: {},
    })
    await expect(readJsonWithLimit(asNextRequest(textRequest(' \n\t').request), 20)).resolves.toEqual({
      ok: true,
      body: {},
    })
  })

  it('keeps invalid JSON and read failures on the invalid_json result contract', async () => {
    await expect(readJsonWithLimit(asNextRequest(textRequest('{').request), 20)).resolves.toEqual({
      ok: false,
      code: 'invalid_json',
      limitBytes: 20,
    })

    const failed = streamRequest({ chunks: [], readError: new Error('stream failed') })
    await expect(readJsonWithLimit(asNextRequest(failed.request), 20)).resolves.toEqual({
      ok: false,
      code: 'invalid_json',
      limitBytes: 20,
    })
  })

  it('keeps accepting any valid JSON value', async () => {
    await expect(readJsonWithLimit(asNextRequest(textRequest('[1,2]').request), 20)).resolves.toEqual({
      ok: true,
      body: [1, 2],
    })
  })

  it('rejects an invalid configured limit instead of treating it as unlimited', async () => {
    await expect(
      readJsonWithLimit(asNextRequest(textRequest('{}').request), Number.POSITIVE_INFINITY),
    ).rejects.toBeInstanceOf(RangeError)
  })
})

describe('readJsonObject', () => {
  it('maps a streamed overflow to the established 413 error without draining the body', async () => {
    const streamed = streamRequest({
      chunks: Array.from({ length: 100 }, () => new Uint8Array(1024)),
    })

    await readJsonObject(asNextRequest(streamed.request), 2048).then(
      () => expect.unreachable('expected payload cap error'),
      (error) => expectApiInputError(error, 'payload_too_large', 413),
    )
    expect(streamed.pulls()).toBe(3)
    expect(streamed.cancels()).toBe(1)
  })

  it('keeps missing, invalid, and non-object JSON errors distinct', async () => {
    await readJsonObject(asNextRequest(textRequest(' \n').request), 20).then(
      () => expect.unreachable('expected missing-body error'),
      (error) => expectApiInputError(error, 'json_body_missing', 400),
    )
    await readJsonObject(asNextRequest(textRequest('{').request), 20).then(
      () => expect.unreachable('expected invalid-JSON error'),
      (error) => expectApiInputError(error, 'invalid_json', 400),
    )

    for (const raw of ['null', '[]', 'true', '1', '"text"']) {
      await readJsonObject(asNextRequest(textRequest(raw).request), 20).then(
        () => expect.unreachable('expected object constraint error'),
        (error) => expectApiInputError(error, 'invalid_json_object', 400),
      )
    }
  })

  it('preserves the original stream read error', async () => {
    const readError = new Error('stream failed')
    const failed = streamRequest({ chunks: [], readError })

    await expect(readJsonObject(asNextRequest(failed.request), 20)).rejects.toBe(readError)
  })

  it('rejects an invalid configured limit instead of treating it as unlimited', async () => {
    await expect(
      readJsonObject(asNextRequest(textRequest('{}').request), Number.NaN),
    ).rejects.toBeInstanceOf(RangeError)
  })

  it('keeps the 256000-byte default distinct from the 256 KiB default', async () => {
    const raw = '{"value":"' + 'a'.repeat(256_001 - 12) + '"}'
    expect(encoder.encode(raw)).toHaveLength(256_001)

    await readJsonObject(asNextRequest(textRequest(raw).request)).then(
      () => expect.unreachable('expected strict payload cap error'),
      (error) => expectApiInputError(error, 'payload_too_large', 413),
    )
    await expect(readJsonWithLimit(asNextRequest(textRequest(raw).request))).resolves.toMatchObject({
      ok: true,
    })
  })
})
