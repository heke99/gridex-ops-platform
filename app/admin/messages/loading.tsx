export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mb-8 space-y-3">
        <div className="h-8 w-56 rounded-full bg-slate-200" />
        <div className="h-4 w-full max-w-xl rounded-full bg-slate-100" />
      </div>
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-5 w-48 rounded-full bg-slate-200" />
        <div className="mt-5 space-y-3">
          <div className="h-14 rounded-2xl bg-slate-100" />
          <div className="h-14 rounded-2xl bg-slate-100" />
          <div className="h-14 rounded-2xl bg-slate-100" />
          <div className="h-14 rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  )
}
