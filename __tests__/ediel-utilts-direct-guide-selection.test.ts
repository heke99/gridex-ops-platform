import {expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'

it.each(['2026-10-01','2026-10-14'])('direct runtime follows complete shared guide grace on %s',date=>{
  const message=energyHandoffMessage('2026-09-30')
  message.message_received_at=`${date}T10:00:00Z`
  message.raw_payload=message.raw_payload!.replace('735999260731000007::9','735999260731000008::9')
  expect(runUtiltsRuntimeForMessage(message).validation.issues.some(issue=>issue.code==='UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(false)
  const explicit=resolveCanonicalEdielPolicy({family:'UTILTS',messageCode:'E66',direction:'inbound',referenceDate:date,applicationReference:message.application_reference,mode:'parse'})
  expect(runUtiltsRuntimeForMessage(message,{canonicalPolicy:explicit}).validation.issues.some(issue=>issue.code==='UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(true)
})
it('direct runtime uses admission after grace rather than backdated document time',()=>{
  const message=energyHandoffMessage('2026-09-30')
  message.message_received_at='2026-10-15T10:00:00Z'
  message.raw_payload=message.raw_payload!.replace('735999260731000007::9','735999260731000008::9')
  expect(runUtiltsRuntimeForMessage(message).validation.issues.some(issue=>issue.code==='UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID')).toBe(true)
})
