type AdminHeaderProps = {
 title: string
 subtitle?: string
 userEmail?: string | null
 workspaceName?: string | null
 workspaceMode?: 'platform' | 'tenant'
}

function workspaceInitial(name: string | null | undefined) {
 const trimmed = name?.trim()
 return trimmed ? trimmed.charAt(0).toUpperCase() : 'G'
}

export default function AdminHeader({
 title,
 subtitle,
 userEmail,
 workspaceName,
 workspaceMode = 'tenant',
}: AdminHeaderProps) {
 const label = workspaceMode === 'platform' ? 'Platform Control' : 'Bolagsyta'
 const displayName = workspaceName?.trim() || (workspaceMode === 'platform' ? 'Gridex Platform' : 'Ditt bolag')

 return (
 <header className="sticky top-0 z-20 border-b border-emerald-100/80 bg-white/88 backdrop-blur-xl">
 <div className="absolute inset-x-0 top-0 -z-10 h-full bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_34%),radial-gradient(circle_at_top_right,rgba(15,23,42,0.05),transparent_30%)]" />
 <div className="flex min-h-[88px] items-center justify-between gap-6 px-6 py-3 sm:px-8">
 <div className="min-w-0">
 <div className="flex flex-wrap items-center gap-2">
 <div className="inline-flex rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-800">
 {label}
 </div>
 <div className="inline-flex max-w-[320px] items-center gap-2 rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm shadow-slate-950/5">
 <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[10px] font-black text-white">
 {workspaceInitial(displayName)}
 </span>
 <span className="truncate">{displayName}</span>
 </div>
 </div>
 <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
 {title}
 </h1>
 {subtitle ? (
 <p className="mt-1 max-w-5xl text-sm leading-6 text-slate-700">{subtitle}</p>
 ) : null}
 </div>

 <div className="hidden shrink-0 items-center gap-3 md:flex">
 <div className="rounded-3xl border border-emerald-100 bg-white/90 px-4 py-3 text-right shadow-sm shadow-emerald-950/5">
 <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
 Inloggad
 </p>
 <p className="mt-1 max-w-[260px] truncate text-sm font-semibold text-slate-800">
 {userEmail ?? 'Användare'}
 </p>
 </div>
 </div>
 </div>
 </header>
 )
}
