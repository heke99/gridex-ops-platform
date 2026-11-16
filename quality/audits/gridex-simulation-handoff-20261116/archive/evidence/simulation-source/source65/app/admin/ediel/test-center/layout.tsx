import Link from 'next/link'

export default function EdielTestCenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <nav className="border-b border-slate-200 bg-white px-8 py-3" aria-label="Test Center-flikar">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/ediel/test-center"
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-black text-slate-800 hover:border-emerald-300 hover:bg-emerald-50"
          >
            Ediel-tester
          </Link>
          <Link
            href="/admin/ediel/test-center/invoice-test"
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-900 hover:bg-emerald-100"
          >
            Fakturatest
          </Link>
        </div>
      </nav>
      {children}
    </div>
  )
}
