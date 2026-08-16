import { describe, expect, it } from 'vitest'
import {
  isDisallowedWebhookAddress,
  parsePublicWebhookUrl,
} from '@/lib/integrations/publicWebhookTransport'

describe('public webhook transport SSRF policy', () => {
  it('accepts ordinary public HTTPS endpoints', () => {
    expect(parsePublicWebhookUrl('https://partner.example.com/webhooks/gridex').hostname)
      .toBe('partner.example.com')
    expect(parsePublicWebhookUrl('https://8.8.8.8/webhook').hostname).toBe('8.8.8.8')
    expect(isDisallowedWebhookAddress('2606:4700:4700::1111')).toBe(false)
  })

  it('requires HTTPS and rejects embedded credentials', () => {
    expect(() => parsePublicWebhookUrl('http://partner.example.com/webhook')).toThrow()
    expect(() => parsePublicWebhookUrl('https://user:secret@partner.example.com/webhook')).toThrow()
  })

  it.each([
    'https://localhost/webhook',
    'https://service.local/webhook',
    'https://service.internal/webhook',
    'https://127.0.0.1/webhook',
    'https://2130706433/webhook',
    'https://0x7f000001/webhook',
    'https://10.0.0.1/webhook',
    'https://100.64.0.1/webhook',
    'https://169.254.169.254/latest/meta-data',
    'https://172.16.0.1/webhook',
    'https://192.168.1.1/webhook',
    'https://192.0.2.10/webhook',
    'https://198.51.100.10/webhook',
    'https://203.0.113.10/webhook',
    'https://[::1]/webhook',
    'https://[64:ff9b::7f00:1]/webhook',
    'https://[fc00::1]/webhook',
    'https://[fe80::1]/webhook',
    'https://[ff02::1]/webhook',
    'https://[2001::1]/webhook',
    'https://[2001:1ff::1]/webhook',
    'https://[2001:db8::1]/webhook',
    'https://[2002:7f00:1::]/webhook',
    'https://[3fff::1]/webhook',
  ])('rejects non-public target %s', (url) => {
    expect(() => parsePublicWebhookUrl(url)).toThrow()
  })

  it('classifies private and special addresses as disallowed', () => {
    for (const address of [
      '0.0.0.0',
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '172.31.255.255',
      '192.168.0.1',
      '::1',
      '64:ff9b::7f00:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '2001::1',
      '2001:1ff::1',
      '2001:db8::1',
      '2002:7f00:1::',
      '::ffff:127.0.0.1',
    ]) {
      expect(isDisallowedWebhookAddress(address)).toBe(true)
    }
    expect(isDisallowedWebhookAddress('8.8.8.8')).toBe(false)
    expect(isDisallowedWebhookAddress('1.1.1.1')).toBe(false)
  })
})
