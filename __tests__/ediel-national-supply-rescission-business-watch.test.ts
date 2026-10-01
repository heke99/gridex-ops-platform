import {expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{}}))
import {prepareEdielBusinessExpectationPlan} from '@/lib/ediel/businessExpectations'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type {EdielMessageRow} from '@/lib/ediel/types'
const row=(reason='Z25')=>({direction:'outbound',message_family:'PRODAT',message_code:'Z08',raw_payload:`UNB+UNOC:3+12345:14+54321:14+261001:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z08+H-OWN+9'LIN+1++735123456789012345:::9'CCI++Z13'CAV+${reason}'RFF+LI:H-OWN'UNT+7+M'UNZ+1+I'`} as EdielMessageRow)
const policy=(subtype='H')=>resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z08',subtypeOrReasonCode:subtype,direction:'outbound',referenceDate:'2026-10-01',mode:'catalog_evidence'})
it('national Z08H watches the canonical Z05L without inventing a numeric deadline or remote receipt',()=>{const plan=prepareEdielBusinessExpectationPlan(row(),policy());expect(plan).toMatchObject({sourceCode:'Z08',expectedCode:'Z05',expectedSubtypes:['L'],offset:null,unit:null,timerRuleId:null,timerKind:'untimed_business_response',remoteReceiptKnown:false,anchor:'actual_accepted_smtp_observed_at'});expect(Object.isFrozen(plan)).toBe(true)})
it('preserves bilateral Z08LK without inventing its own national response watch',()=>{expect(prepareEdielBusinessExpectationPlan(row('Z23'),policy('LK'))).toBeNull()})
it('rejects a contradictory H policy and a multiple-message source before provider entry',()=>{expect(()=>prepareEdielBusinessExpectationPlan(row(),policy('LK'))).toThrow('policy_source_mismatch');const m=row();m.raw_payload=m.raw_payload!.replace("UNZ+1+I'","UNH+SECOND+PRODAT:D:97A:UN:E2SE6A'BGM+Z08+OTHER+9'LIN+1++SECOND:::9'CCI++Z13'CAV+Z25'UNT+6+SECOND'UNZ+2+I'");expect(()=>prepareEdielBusinessExpectationPlan(m,policy())).toThrow('multiple_message_scope_not_supported')})
