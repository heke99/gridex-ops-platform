'use client'

import { useActionState, useCallback, useState } from 'react'
import { useUnsavedChanges } from '@/components/admin/AdminUnsavedChanges'
import { recordInvoiceRedeliveryDecisionFormAction } from '../redelivery-actions'

type Props = {
  companyId: string; customerId: string; invoiceId: string; expectedRevision: number; expectedOverrideRevision: number
  idempotencyKey: string; accountIds: string[]; accountLabels?: Record<string, string>; canRecord: boolean
}
export default function RedeliveryDecisionForm(props: Props) {
  const [state, action, pending] = useActionState(recordInvoiceRedeliveryDecisionFormAction, null)
  const [accountId, setAccountId] = useState('')
  const [reason, setReason] = useState('')
  const completed = state?.status === 'success'
  const disabled = pending || completed || !props.canRecord
  const dirty = !completed && (accountId !== '' || reason !== '')
  const discard = useCallback(() => { setAccountId(''); setReason('') }, [])
  useUnsavedChanges(dirty, discard)
  return (
    <form action={action} data-dirty-form={dirty ? 'true' : undefined} className="space-y-4">
      {['companyId', 'customerId', 'invoiceId', 'expectedRevision', 'expectedOverrideRevision', 'idempotencyKey'].map(key => (
        <input key={key} type="hidden" name={key} value={String(props[key as keyof Props])} />
      ))}
      <fieldset disabled={disabled} className="space-y-4">
        <label className="block text-sm font-medium text-slate-800">
          Kundens aktiva ägarrelation
          <select name="accountId" required value={accountId} onChange={event => setAccountId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2">
            <option value="">Välj den ägarrelation vars bekräftade adress ska användas</option>
            {props.accountIds.map((id, index) => <option key={id} value={id}>{props.accountLabels?.[id] ?? `Ägarrelation ${index + 1}`}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-800">
          Anledning till omleverans
          <textarea name="reason" required maxLength={200} rows={3} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
        </label>
        <button type="submit" disabled={disabled} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? 'Registrerar beslut…' : completed ? 'Leveransbeslut skapat' : 'Skapa leveransbeslut'}
        </button>
      </fieldset>
      {state ? <p role={state.status === 'error' ? 'alert' : 'status'} className={state.status === 'error' ? 'rounded-lg bg-amber-50 p-3 text-sm text-amber-950' : 'rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950'}>{state.message}</p> : null}
      {!props.canRecord ? <p className="text-sm text-slate-600">Beslut kan inte registreras med den aktuella behörigheten eller mottagarrelationen.</p> : null}
    </form>
  )
}
