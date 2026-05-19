type AdminHeaderProps = {
  title: string
  subtitle?: string
  userEmail?: string | null
}

export default function AdminHeader({
  title,
  subtitle,
  userEmail,
}: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-emerald-100 bg-[#f7fbf8]/92 backdrop-blur-xl">
      <div className="flex min-h-[84px] items-center justify-between gap-6 px-6 py-2 sm:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Gridex Operations
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-500">{subtitle}</p>
          ) : null}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <div className="rounded-2xl border border-emerald-100 bg-white/85 px-4 py-3 text-right shadow-sm shadow-emerald-950/5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Inloggad
            </p>
            <p className="mt-1 max-w-[240px] truncate text-sm font-semibold text-slate-800">
              {userEmail ?? 'Användare'}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
