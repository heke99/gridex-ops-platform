'use client'

import { createContext, useContext, type ReactNode } from 'react'

const PortalSupportHrefContext = createContext<string | null>(null)

export function PortalSupportContact({ href, children }: { href: string | null; children: ReactNode }) {
  return <PortalSupportHrefContext.Provider value={href}>{children}</PortalSupportHrefContext.Provider>
}

export function usePortalSupportHref(): string | null {
  return useContext(PortalSupportHrefContext)
}
