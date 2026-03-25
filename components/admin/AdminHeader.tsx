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
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="flex min-h-[84px] items-center justify-between gap-6 px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-right sm:block">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
              Inloggad som
            </p>
            <p className="mt-1 text-sm font-medium text-slate-800">
              {userEmail ?? 'Okänd användare'}
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}