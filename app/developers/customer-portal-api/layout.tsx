import type { ReactNode } from 'react'

export default function CustomerPortalApiLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <aside className="border-b border-amber-200 bg-amber-50 px-6 py-4 text-amber-950">
        <div className="mx-auto max-w-6xl text-sm leading-6">
          <strong>Production readiness:</strong>{' '}
          En giltig API-nyckel kan vara fail-closed tills tenantens canonical
          go-live är verifierad. <code>api_client_not_launch_ready</code>,{' '}
          <code>integration_receipt_not_verified</code> och{' '}
          <code>integration_capability_not_ready</code> är operatörsåtgärder,
          inte signaler om att klienten ska byta tenant-ID, kringgå scopes eller
          retry:a obegränsat. Gridex provisionerar/revaliderar klienten och
          aktiverar normal trafik först när receipt, capability och launch
          readiness är klara.
        </div>
      </aside>
      {children}
    </>
  )
}
