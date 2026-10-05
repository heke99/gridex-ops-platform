"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type WorkspaceGroup = {
  id: string;
  label: string;
  tabs: Array<{ id: string; label: string; href: string }>;
};

export default function CustomerWorkspaceNav({ groups, activeTab }: { groups: WorkspaceGroup[]; activeTab: string }) {
  const router = useRouter();
  const activeGroup = groups.find((group) => group.tabs.some((tab) => tab.id === activeTab));
  const selectClass = "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700";
  function navigate(tabId: string) {
    const tab = groups.flatMap((group) => group.tabs).find((item) => item.id === tabId);
    if (tab) router.push(tab.href);
  }

  return (
    <nav aria-label="Kundkortets delar" className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <label className="grid gap-1.5 md:hidden">
        <span className="text-xs font-semibold text-slate-600">Gå till</span>
        <select aria-label="Gå till" value={activeTab} onChange={(event) => navigate(event.target.value)} className={selectClass}>
          {groups.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="hidden md:block">
        <div className="flex flex-wrap gap-1">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={group.tabs[0].href}
              aria-current={activeGroup?.id === group.id ? "page" : undefined}
              className={`rounded-xl px-3 py-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${activeGroup?.id === group.id ? "bg-emerald-700 text-white" : "text-slate-700 hover:bg-slate-50"}`}
            >
              {group.label}
            </Link>
          ))}
        </div>
        {activeGroup && activeGroup.tabs.length > 1 ? (
          <div className="mt-2 border-t border-slate-100 pt-2" aria-label={`${activeGroup.label}: delar`}>
            {activeGroup.tabs.length > 3 ? (
              <label className="flex max-w-md items-center gap-3">
                <span className="shrink-0 text-xs font-semibold text-slate-600">Visa</span>
                <select aria-label="Visa" value={activeTab} onChange={(event) => navigate(event.target.value)} className={selectClass}>
                  {activeGroup.tabs.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                </select>
              </label>
            ) : (
              <div className="flex flex-wrap gap-1">
                {activeGroup.tabs.map((tab) => (
                  <Link key={tab.id} href={tab.href} aria-current={activeTab === tab.id ? "page" : undefined} className={`rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${activeTab === tab.id ? "bg-slate-100 text-slate-950" : "text-slate-600 hover:bg-slate-50"}`}>
                    {tab.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
