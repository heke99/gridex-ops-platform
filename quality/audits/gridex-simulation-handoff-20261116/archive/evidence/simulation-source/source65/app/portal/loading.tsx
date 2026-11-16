export default function Loading() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-8 w-64 rounded-full bg-slate-200" />
        <div className="h-4 w-full max-w-2xl rounded-full bg-slate-100" />
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="h-5 w-44 rounded-full bg-slate-200" />
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
            <div className="h-24 rounded-2xl bg-slate-100" />
          </div>
        </section>
      </div>
    </main>
  )
}
