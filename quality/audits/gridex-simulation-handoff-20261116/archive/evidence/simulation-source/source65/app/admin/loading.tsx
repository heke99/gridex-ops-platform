// Keep the persistent admin layout visible. Route-level sections provide their
// own small skeletons; a full-screen replacement made navigation feel slower
// and hid already rendered navigation on every transition.
export default function AdminLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-7 w-52 animate-pulse rounded-full bg-slate-200" />
      <div className="h-4 w-full max-w-lg animate-pulse rounded-full bg-slate-100" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-3xl border border-slate-200 bg-white" />
        <div className="h-24 animate-pulse rounded-3xl border border-slate-200 bg-white" />
        <div className="h-24 animate-pulse rounded-3xl border border-slate-200 bg-white" />
      </div>
    </div>
  )
}
