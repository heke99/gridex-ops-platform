'use client'

import { useFormStatus } from 'react-dom'
import type { ReactNode } from 'react'

export default function SubmitActionButton({ children, className }: { children: ReactNode; className: string }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} className={className}>{pending ? 'Sparar…' : children}</button>
}
