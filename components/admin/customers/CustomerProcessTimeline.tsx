import type { CustomerWorkflowStep, WorkflowStepStatus } from '@/lib/customer-operations/customerCardWorkflow'

function stepIcon(status: WorkflowStepStatus) {
  if (status === 'done') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
        </svg>
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700">
        <span className="h-2.5 w-2.5 rounded-full bg-blue-600" />
      </span>
    )
  }
  if (status === 'waiting') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 4.75a.75.75 0 0 1 1.5 0v3.5l2.25 1.3a.75.75 0 0 1-.75 1.3l-2.625-1.52A.75.75 0 0 1 7.25 9V4.75Z" clipRule="evenodd" />
        </svg>
      </span>
    )
  }
  if (status === 'blocked') {
    return (
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM5.47 5.47a.75.75 0 0 1 1.06 0L8 6.94l1.47-1.47a.75.75 0 1 1 1.06 1.06L9.06 8l1.47 1.47a.75.75 0 1 1-1.06 1.06L8 9.06l-1.47 1.47a.75.75 0 0 1-1.06-1.06L6.94 8 5.47 6.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </span>
    )
  }
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white">
      <span className="h-2 w-2 rounded-full bg-slate-300" />
    </span>
  )
}

function stepConnector(status: WorkflowStepStatus) {
  const color =
    status === 'done'
      ? 'bg-emerald-200'
      : status === 'current' || status === 'waiting'
        ? 'bg-blue-100'
        : status === 'blocked'
          ? 'bg-red-100'
          : 'bg-slate-100'
  return <div className={`ml-4 mt-1 h-6 w-0.5 ${color}`} aria-hidden="true" />
}

export default function CustomerProcessTimeline({
  steps,
  showTechnical = false,
}: {
  steps: CustomerWorkflowStep[]
  showTechnical?: boolean
}) {
  if (!steps.length) return null

  return (
    <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
        Processöversikt
      </h2>
      <ol className="space-y-0">
        {steps.map((step, index) => (
          <li key={step.id}>
            <div className="flex items-start gap-3">
              {stepIcon(step.status)}
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`text-sm font-semibold ${
                      step.status === 'done'
                        ? 'text-emerald-800'
                        : step.status === 'blocked'
                          ? 'text-red-800'
                          : step.status === 'current'
                            ? 'text-blue-900'
                            : step.status === 'waiting'
                              ? 'text-amber-800'
                              : 'text-slate-400'
                    }`}
                  >
                    {step.label}
                  </span>
                  {step.timestamp ? (
                    <span className="text-xs text-slate-400">
                      {new Date(step.timestamp).toLocaleString('sv-SE')}
                    </span>
                  ) : null}
                </div>
                <p
                  className={`mt-0.5 text-xs leading-5 ${
                    step.status === 'not_started' ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {step.explanation}
                </p>
                {step.blockerReason && step.status === 'blocked' ? (
                  <p className="mt-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-800">
                    {step.blockerReason}
                  </p>
                ) : null}
                {showTechnical && step.messageId ? (
                  <p className="mt-1 font-mono text-[10px] text-slate-400">{step.messageId}</p>
                ) : null}
              </div>
            </div>
            {index < steps.length - 1 ? stepConnector(step.status) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}
