"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** An expandable server-rendered panel that also honors existing section links. */
export default function AdminDisclosurePanel({ id, title, defaultOpen = false, className, children }: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function revealLinkedPanel() {
      if (window.location.hash === `#${id}` && panel.current) panel.current.open = true;
    }
    function revealClickedPanel(event: MouseEvent) {
      const link = (event.target as HTMLElement).closest("a");
      if (link?.getAttribute("href") === `#${id}` && panel.current) panel.current.open = true;
    }
    revealLinkedPanel();
    window.addEventListener("hashchange", revealLinkedPanel);
    document.addEventListener("click", revealClickedPanel);
    return () => {
      window.removeEventListener("hashchange", revealLinkedPanel);
      document.removeEventListener("click", revealClickedPanel);
    };
  }, [id]);
  return (
    <details ref={panel} id={id} open={defaultOpen} className={`scroll-mt-48 lg:scroll-mt-32 ${className ?? ''}`} onInvalidCapture={(event) => {
      let ancestor = (event.target as HTMLElement).closest("details");
      while (ancestor) {
        ancestor.open = true;
        ancestor = ancestor.parentElement?.closest("details") ?? null;
      }
    }}>
      <summary className="cursor-pointer text-base font-semibold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">{title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
