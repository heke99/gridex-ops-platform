"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A disclosure containing ordinary links/buttons, with their native keyboard behavior. */
export default function AdminActionsMenu({
  label = "Mer",
  ariaLabel,
  children,
  disabled = false,
  placement = "auto",
}: {
  label?: string;
  ariaLabel?: string;
  children: ReactNode;
  disabled?: boolean;
  placement?: "auto" | "top";
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !panel.current) return;
      const bounds = trigger.current.getBoundingClientRect();
      const panelWidth = panel.current.getBoundingClientRect().width;
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const upward = placement === "top" || (below < panel.current.scrollHeight && above > below);
      const left = Math.max(16, Math.min(bounds.right - panelWidth, window.innerWidth - panelWidth - 16));
      panel.current.style.left = `${left - bounds.left}px`;
      panel.current.style.right = "auto";
      panel.current.style.top = upward ? "auto" : "calc(100% + 0.5rem)";
      panel.current.style.bottom = upward ? "calc(100% + 0.5rem)" : "auto";
      panel.current.style.maxHeight = `${Math.max(100, upward ? above : below)}px`;
    }
    position();
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, placement]);

  return (
    <div
      ref={root}
      className="relative inline-block shrink-0 text-left"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() => {
            root.current?.querySelector<HTMLElement>("[data-action-panel] a, [data-action-panel] button:not(:disabled)")?.focus();
          });
        }}
        className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60"
      >
        {label}
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          data-action-panel
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
          className="absolute right-0 top-full z-40 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-2 text-sm text-slate-800 shadow-lg [&_a]:block [&_a]:rounded-lg [&_a]:px-3 [&_a]:py-2.5 [&_a]:hover:bg-slate-50 [&_a]:focus-visible:outline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-emerald-700 [&_button]:w-full [&_button]:rounded-lg [&_button]:px-3 [&_button]:py-2.5 [&_button]:text-left [&_button]:hover:bg-slate-50 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-emerald-700"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
