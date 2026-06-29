function SkeletonCard() {
  return <div className="h-28 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><div className="h-4 w-28 rounded-full bg-slate-200" /><div className="mt-4 h-8 w-20 rounded-full bg-slate-200" /><div className="mt-3 h-3 w-40 rounded-full bg-slate-100" /></div>
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="mb-8 space-y-3">
        <div className="h-8 w-64 rounded-full bg-slate-200" />
        <div className="h-4 w-full max-w-xl rounded-full bg-slate-100" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-5 w-48 rounded-full bg-slate-200" />
        <div className="mt-5 space-y-3">
          <div className="h-14 rounded-2xl bg-slate-100" />
          <div className="h-14 rounded-2xl bg-slate-100" />
        </div>
      </div>
    </div>
  )
}
