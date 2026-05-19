'use client'

export default function WorkbenchSummary({
 recommendedRouteText,
 sendableCount,
 inboundUtiltsCount,
 ackableCount,
}: {
 recommendedRouteText: string
 sendableCount: number
 inboundUtiltsCount: number
 ackableCount: number
}) {
 return (
 <div className="rounded-2xl border border-slate-200 bg-white p-5">
 <h2 className="text-lg font-semibold text-slate-950">Operativ EDIEL-workbench</h2>
 <p className="mt-1 text-sm text-slate-700">
 Rekommendationerna kommer nu från en separat EDIEL-modul, så samma logik
 kan återanvändas i andra vyer senare.
 </p>

 <div className="mt-4 grid gap-4 md:grid-cols-4">
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-xs font-medium uppercase tracking-wide text-slate-700">
 Rekommenderad route
 </div>
 <div className="mt-2 text-sm text-slate-700">{recommendedRouteText}</div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-xs font-medium uppercase tracking-wide text-slate-700">
 Skickbara meddelanden
 </div>
 <div className="mt-2 text-sm text-slate-700">
 {sendableCount} rekommenderade val
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-xs font-medium uppercase tracking-wide text-slate-700">
 Inbound UTILTS
 </div>
 <div className="mt-2 text-sm text-slate-700">
 {inboundUtiltsCount} rekommenderade val
 </div>
 </div>
 <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
 <div className="text-xs font-medium uppercase tracking-wide text-slate-700">
 ACK-källor
 </div>
 <div className="mt-2 text-sm text-slate-700">
 {ackableCount} rekommenderade val
 </div>
 </div>
 </div>
 </div>
 )
}