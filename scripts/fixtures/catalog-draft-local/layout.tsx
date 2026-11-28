import type { ReactNode } from 'react'
export default function LocalRoot({ children }: { children:ReactNode }) {
  return <html lang="sv"><body>{children}</body></html>
}
