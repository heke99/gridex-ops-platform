import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSwedishProdatCustomerIdentity } from '@/lib/ediel/prodat/customerIdentity'
import { validateProdatProfile } from '@/lib/ediel/prodat/profiles'
import {
  normalizeProdatEndUserIdQualifier,
  prodatCustomerNadSegment,
} from '@/lib/ediel/prodat/render/segments'

describe('PRODAT Swedish end-user identity compliance', () => {
  it('maps an explicit organisation number to SE1 and never lets a personal number override it', () => {
    expect(resolveSwedishProdatCustomerIdentity({
      org_number: '556677-8899',
      personal_number: '199001011234',
      company_name: 'Grid AB',
    })).toEqual({
      id: '556677-8899',
      qualifier: 'SE1',
      name: 'Grid AB',
    })
  })

  it('maps an explicit personal identity number to SE2', () => {
    expect(resolveSwedishProdatCustomerIdentity({
      personal_number: '19900101-1234',
      full_name: 'Anna Andersson',
    })).toEqual({
      id: '19900101-1234',
      qualifier: 'SE2',
      name: 'Anna Andersson',
    })
  })

  it('does not promote an internal customer number to a legal EDIEL identity', () => {
    expect(resolveSwedishProdatCustomerIdentity({
      customer_number: 'K-1234567890',
      full_name: 'Kund Utan Legal ID',
    })).toEqual({
      id: null,
      qualifier: null,
      name: 'Kund Utan Legal ID',
    })
  })

  it('accepts only explicit PRODAT end-user qualifiers and never infers them from identifier length', () => {
    expect(normalizeProdatEndUserIdQualifier('SE1')).toBe('SE1')
    expect(normalizeProdatEndUserIdQualifier('se2')).toBe('SE2')
    expect(normalizeProdatEndUserIdQualifier('1')).toBe('1')
    expect(normalizeProdatEndUserIdQualifier(undefined)).toBeNull()
    expect(normalizeProdatEndUserIdQualifier('260')).toBeNull()
  })

  it('renders Swedish organisation and personal identities with Ediel Nordic Forum as code-list responsible', () => {
    const organisation = prodatCustomerNadSegment({
      customerId: '5566778899',
      customerIdCodeListQualifier: 'SE1',
      customerName: 'Grid AB',
      country: 'SE',
    })
    const person = prodatCustomerNadSegment({
      customerId: '199001011234',
      customerIdCodeListQualifier: 'SE2',
      customerName: 'Anna Andersson',
      country: 'SE',
    })

    expect(organisation).toContain('NAD+UD+5566778899:SE1:ZZZ')
    expect(person).toContain('NAD+UD+199001011234:SE2:ZZZ')
    expect(organisation).not.toContain(':260')
    expect(person).not.toContain(':260')
  })

  it('omits the legal party id instead of guessing a qualifier when it is missing', () => {
    const segment = prodatCustomerNadSegment({
      customerId: '199001011234',
      customerName: 'Anna Andersson',
      country: 'SE',
    })

    expect(segment).not.toContain('199001011234')
    expect(segment).not.toContain(':SE1:')
    expect(segment).not.toContain(':SE2:')
  })

  it('blocks identity-required PRODAT profiles when an explicit qualifier is missing', () => {
    const invalid = validateProdatProfile({
      code: 'Z03',
      subtype: 'L',
      version: '26A',
      context: {
        code: 'Z03',
        customerId: '199001011234',
        customerName: 'Anna Andersson',
        meterPointId: '735999999999999999',
        startDate: '20260825',
        reasonForTransaction: 'Z22',
      } as never,
    })
    const valid = validateProdatProfile({
      code: 'Z03',
      subtype: 'L',
      version: '26A',
      context: {
        code: 'Z03',
        customerId: '199001011234',
        customerIdCodeListQualifier: 'SE2',
        customerName: 'Anna Andersson',
        meterPointId: '735999999999999999',
        startDate: '20260825',
        reasonForTransaction: 'Z22',
      } as never,
    })

    expect(invalid.issues.map((issue) => issue.code)).toContain('prodat_customer_identity_qualifier_missing')
    expect(valid.issues.map((issue) => issue.code)).not.toContain('prodat_customer_identity_qualifier_missing')
  })
})

describe('PRODAT Z02 LI correlation compliance', () => {
  const migration = readFileSync(
    join(process.cwd(), 'supabase/migrations/20260821165300_prodat_identity_and_z02_li_compliance.sql'),
    'utf8',
  )

  it('requires one LI in both originating Z01 and inbound Z02', () => {
    expect(migration).toContain("v_source_li := public.gridex_edifact_rff_value(v_source.raw_payload, 'LI')")
    expect(migration).toContain("v_inbound_li := public.gridex_edifact_rff_value(v_inbound.raw_payload, 'LI')")
    expect(migration).toContain("v_reason_code := 'z02_origin_line_item_reference_ambiguous'")
    expect(migration).toContain("v_reason_code := 'z02_line_item_reference_missing'")
    expect(migration).toContain("v_reason_code := 'z02_line_item_reference_ambiguous'")
  })

  it('requires exact returned LI equality before automatic apply', () => {
    expect(migration).toContain('elsif v_inbound_li <> v_source_li then')
    expect(migration).toContain("v_reason_code := 'z02_line_item_reference_mismatch'")
    expect(migration).toContain("'exact_li_match', v_source_li is not null and v_inbound_li = v_source_li")
  })

  it('checks the originating typed LI registry and keeps TN/ACW supplemental only', () => {
    expect(migration).toContain("and br.reference_type = 'RFF_LI'")
    expect(migration).toContain("v_reason_code := 'z02_origin_line_item_registry_missing'")
    expect(migration).toContain("v_reason_code := 'z02_origin_line_item_registry_conflict'")
    expect(migration).toContain('TN and ACW are diagnostic/supplemental evidence only')
    expect(migration).toContain("br.reference_type = 'RFF_TN'")
    expect(migration).toContain("br.reference_type = 'RFF_ACW'")
  })

  it('retains the service-role-only SECURITY DEFINER contract', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })
})
