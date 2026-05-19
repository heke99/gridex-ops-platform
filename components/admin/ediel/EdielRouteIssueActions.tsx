'use client'

import {
 quickFixEdielProfileBasicsAction,
 quickFixEdielRouteActivationAction,
 quickFixEdielTargetEmailAction,
 quickFixGridOwnerEdielIdAction,
} from '@/app/admin/ediel/routes/actions'
import type {
 EdielRouteIssue,
 EdielRecommendationRouteRow,
} from '@/lib/ediel/recommendations'

type Props = {
 route: EdielRecommendationRouteRow | null
 issues: EdielRouteIssue[]
 customerId?: string | null
}

function hasIssue(
 issues: EdielRouteIssue[],
 key: EdielRouteIssue['key']
) {
 return issues.some((issue) => issue.key === key)
}

export default function EdielRouteIssueActions({
 route,
 issues,
 customerId,
}: Props) {
 if (!route || issues.length === 0) {
 return null
 }

 const needsTargetEmail = hasIssue(issues, 'target_email_missing')
 const needsSender = hasIssue(issues, 'sender_ediel_missing')
 const needsReceiver = hasIssue(issues, 'receiver_ediel_missing')
 const needsMailbox = hasIssue(issues, 'mailbox_missing')
 const needsActivation = hasIssue(issues, 'route_inactive')
 const needsEnable = hasIssue(issues, 'profile_disabled')

 return (
 <div className="space-y-3">
 <div className="text-xs font-medium uppercase tracking-wide text-slate-700 ">
 Operativa fixar för vald route
 </div>

 {(needsActivation || needsEnable) && (
 <form
 action={quickFixEdielRouteActivationAction}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="routeId" value={route.id} />
 <input type="hidden" name="customerId" value={customerId ?? ''} />
 <input type="hidden" name="activateRoute" value="true" />
 <input type="hidden" name="enableEdiel" value="true" />

 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 {needsActivation && needsEnable
 ? 'Aktivera route + Ediel-profil'
 : needsActivation
 ? 'Aktivera route'
 : 'Aktivera Ediel-profil'}
 </div>
 <p className="mt-1 text-sm text-slate-700 ">
 Detta sparas direkt på routen/profilen och används automatiskt nästa gång.
 </p>
 </div>

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Spara fix
 </button>
 </div>
 </form>
 )}

 {needsTargetEmail && (
 <form
 action={quickFixEdielTargetEmailAction}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="routeId" value={route.id} />
 <input type="hidden" name="customerId" value={customerId ?? ''} />

 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 Lägg till target email
 </div>
 <p className="mt-1 text-sm text-slate-700 ">
 Behövs för mailbaserad dispatch om routen går via SMTP.
 </p>
 </div>

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Spara fix
 </button>
 </div>
 </form>
 )}

 {(needsSender || needsMailbox) && (
 <form
 action={quickFixEdielProfileBasicsAction}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="routeId" value={route.id} />
 <input type="hidden" name="customerId" value={customerId ?? ''} />
 <input type="hidden" name="fillSenderEdielId" value={needsSender ? 'true' : 'false'} />
 <input type="hidden" name="fillMailbox" value={needsMailbox ? 'true' : 'false'} />

 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 Fyll profilens grundfält
 </div>
 <p className="mt-1 text-sm text-slate-700 ">
 Används för sender Ediel-id och mailbox på vald routeprofil.
 </p>
 </div>

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Spara fix
 </button>
 </div>
 </form>
 )}

 {needsReceiver && route.grid_owner_id && (
 <form
 action={quickFixGridOwnerEdielIdAction}
 className="rounded-2xl border border-slate-200 bg-slate-50 p-4 "
 >
 <input type="hidden" name="gridOwnerId" value={route.grid_owner_id} />
 <input type="hidden" name="customerId" value={customerId ?? ''} />

 <div className="flex flex-wrap items-start justify-between gap-3">
 <div>
 <div className="text-sm font-semibold text-slate-900 ">
 Fyll mottagarens Ediel-id
 </div>
 <p className="mt-1 text-sm text-slate-700 ">
 Hämtas normalt från route profile eller nätägarens masterdata.
 </p>
 </div>

 <button className="rounded-2xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ">
 Spara fix
 </button>
 </div>
 </form>
 )}
 </div>
 )
}