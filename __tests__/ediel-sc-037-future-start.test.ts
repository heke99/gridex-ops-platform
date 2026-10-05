// masterplan: SC-037
// A correct Z04 with a future start is not activated early; it activates on
// the Stockholm start date only while still accepted with its Z04, and
// transport or technical acknowledgement never moves the start earlier.
import {expect,it} from 'vitest'
import {getSupplierSwitchActivationReadiness as readiness} from '@/lib/operations/supplierSwitchActivation'
import type {SupplierSwitchRequestStatus} from '@/lib/operations/types'

const z04='11111111-1111-4111-8111-111111111111'
const confirmed={status:'accepted' as SupplierSwitchRequestStatus,inbound_z04_message_id:z04,confirmed_start_date:'2026-10-20',requested_start_date:'2026-10-20'}

it('is not ready before the Stockholm start date and ready from it',()=>{
 expect(readiness(confirmed,new Date('2026-10-19T21:59:00Z'))).toMatchObject({ready:false,code:'awaiting_effective_start_date'})
 expect(readiness(confirmed,new Date('2026-10-19T22:00:00Z'))).toMatchObject({ready:true,code:'ready',effectiveStartDate:'2026-10-20'})
})
it('SMTP acceptance or a technical ACK without the business Z04 never activates or advances the start',()=>{
 // Transport/ACK stages (queued, submitted) are not the business Z04 acceptance.
 for(const status of ['queued','submitted','cancellation_sent'] as SupplierSwitchRequestStatus[])
  expect(readiness({...confirmed,status},new Date('2026-10-25T10:00:00Z')).ready).toBe(false)
 expect(readiness({...confirmed,inbound_z04_message_id:null},new Date('2026-10-25T10:00:00Z'))).toMatchObject({ready:false,code:'missing_z04_confirmation'})
})
it('a cancelled or no longer accepted switch is not activated at the start date',()=>{
 for(const status of ['cancelled_before_start','cancellation_requested','rejected'] as SupplierSwitchRequestStatus[])
  expect(readiness({...confirmed,status},new Date('2026-10-20T10:00:00Z'))).toMatchObject({ready:false,code:'not_accepted'})
})
