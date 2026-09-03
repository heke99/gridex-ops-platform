import { describe, expect, it } from 'vitest'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'

const validZ02 = [
  "UNB+UNOC:3+27700:14+21660:14+260903:0830+Z02REF+++++PRODAT'",
  "UNH+1+PRODAT:D:96A:UN:EDIEL2'",
  "BGM+Z02+Z02MSG+9+AB'",
  "DTM+137:202609030830:203'",
  "LIN+1++735999147062804224:Z01'",
  "CCI++Z04'",
  "CAV+Z01'",
  "CCI++Z13'",
  "CAV+Z22'",
  "RFF+Z05:MBY'",
  "RFF+LI:AUTO-Z01-CASE'",
  "NAD+UD+199905242328:SE2:260++Mariam Said El Hessi+Stjärngatan 14+Mjölby++59533+SE'",
  "NAD+IT+735999147062804224::9+++Stjärngatan 14+Mjölby++59533+SE'",
  "UNT+12+1'",
  "UNZ+1+Z02REF'",
].join('')

describe('PRODAT Z02 inbound parsing hardening', () => {
  it('parses canonical end-user and installation NAD evidence', () => {
    const line = parseProdatMessage(validZ02).lineItems[0]
    expect(line?.meteringPointId).toBe('735999147062804224')
    expect(line?.lineItemReference).toBe('AUTO-Z01-CASE')
    expect(line?.gridAreaId).toBe('MBY')
    expect(line?.measuringMethod).toBe('Z01')
    expect(line?.reasonForTransaction).toBe('Z22')
    expect(line?.endUserId).toBe('199905242328')
    expect(line?.endUserIdQualifier).toBe('SE2')
    expect(line?.endUserName).toBe('Mariam Said El Hessi')
    expect(line?.endUserAddress).toBe('Stjärngatan 14')
    expect(line?.endUserPostcode).toBe('59533')
    expect(line?.endUserCity).toBe('Mjölby')
    expect(line?.endUserCountry).toBe('SE')
    expect(line?.installationId).toBe('735999147062804224')
    expect(line?.installationAddress).toBe('Stjärngatan 14')
    expect(line?.installationPostcode).toBe('59533')
    expect(line?.installationCity).toBe('Mjölby')
    expect(line?.installationCountry).toBe('SE')
  })
})
