'use client'

import { useFormStatus } from 'react-dom'

/** Disabled while the signature is being submitted so a double click cannot sign twice. */
export default function SignSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full rounded-2xl bg-white px-5 py-4 text-base font-semibold text-slate-950 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? 'Signerar…' : 'Signera avtal'}
    </button>
  )
}
