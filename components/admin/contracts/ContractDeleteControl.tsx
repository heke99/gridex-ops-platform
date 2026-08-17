"use client";

import { useActionState, useMemo, useState } from "react";

import {
  archiveContractAction,
  deleteContractPermanentlyAction,
  previewContractDeleteAction,
  type ContractDeletePreviewActionState,
} from "@/lib/contracts/adminActions";
import type { ContractAdminView } from "@/lib/contracts/adminDto";

const INITIAL_CONTRACT_DELETE_PREVIEW_STATE: ContractDeletePreviewActionState = {
  status: "idle",
  requestId: null,
  companyId: null,
  offerId: null,
  surface: "contracts",
  view: "active",
  page: 1,
  preview: null,
  error: null,
};

function dependencyCount(value: Record<string, number> | undefined): number {
  return Object.values(value ?? {}).reduce(
    (total, count) => total + (Number.isFinite(Number(count)) ? Number(count) : 0),
    0,
  );
}

export default function ContractDeleteControl({
  companyId,
  offerId,
  productId,
  productName,
  companyName,
  surface,
  view,
  page,
  compact = false,
}: {
  companyId: string;
  offerId: string;
  productId?: string | null;
  productName: string;
  companyName?: string | null;
  surface: "contracts" | "company";
  view: ContractAdminView;
  page: number;
  compact?: boolean;
}) {
  const [state, previewAction, pending] = useActionState(
    previewContractDeleteAction,
    INITIAL_CONTRACT_DELETE_PREVIEW_STATE,
  );
  const [dismissedRequestId, setDismissedRequestId] = useState<string | null>(
    null,
  );
  const open = Boolean(
    state.requestId && state.requestId !== dismissedRequestId,
  );

  const preview = state.preview;
  const canDelete = Boolean(
    (preview?.can_delete ?? preview?.deletable) && preview?.preview_token,
  );
  const lifecycleCanArchive = [
    "draft",
    "ready",
    "paused",
    "expired",
    "closed",
    "superseded",
  ].includes(preview?.lifecycle_status ?? "");
  const canArchive =
    lifecycleCanArchive &&
    !["repair", "review", "none"].includes(preview?.recommended_action ?? "");
  const blockers = preview?.blockers ?? [];
  const removableCount = useMemo(
    () => dependencyCount(preview?.removable_system_dependencies),
    [preview?.removable_system_dependencies],
  );

  const hiddenFields = (
    <>
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="offer_id" value={offerId} />
      <input type="hidden" name="return_surface" value={surface} />
      <input type="hidden" name="contract_view" value={view} />
      <input type="hidden" name="contract_page" value={String(page)} />
    </>
  );

  return (
    <>
      <form action={previewAction} className="mt-2">
        {hiddenFields}
        <button
          type="submit"
          disabled={pending}
          className={`${compact ? "" : "w-full "}rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-800 disabled:cursor-wait disabled:opacity-60`}
        >
          {pending ? "Kontrollerar beroenden…" : "Radera permanent"}
        </button>
      </form>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`delete-contract-${offerId}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-red-700">
                  Permanent radering
                </p>
                <h3
                  id={`delete-contract-${offerId}`}
                  className="mt-2 text-xl font-black text-slate-950"
                >
                  {preview?.product_name ?? productName}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">
                  Tenant: {preview?.company_name ?? companyName ?? companyId}
                  <br />Produkt-ID: {preview?.contract_product_id ?? productId ?? "saknas"}
                  <br />Offer-ID: {offerId}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDismissedRequestId(state.requestId)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-black text-slate-700"
              >
                Stäng
              </button>
            </div>

            {state.status === "error" ? (
              <p className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900">
                {state.error}
              </p>
            ) : null}

            {state.status === "ready" ? (
              <>
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                  <strong>{removableCount}</strong> interna draftberoenden kommer att
                  raderas i samma transaktion. Kundavtal, offerter, fakturor,
                  juridikbevis och regulatorisk historik raderas aldrig.
                </div>

                {blockers.length > 0 ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                    <p className="font-black">Kan inte raderas permanent:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {blockers.map((blocker, index) => (
                        <li key={`${blocker.reason ?? "blocker"}-${index}`}>
                          {typeof blocker.count === "number"
                            ? `${blocker.count} × `
                            : ""}
                          {blocker.message ?? blocker.reason ?? blocker.resource_type ?? "Blockerande historik"}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 font-black">
                      Rekommenderad åtgärd:{" "}
                      {canArchive
                        ? "Arkivera och dölj"
                        : preview?.recommended_action === "unpublish"
                          ? "Pausa eller stäng avtalet före arkivering"
                          : "Åtgärda blockerande relationer"}
                    </p>
                  </div>
                ) : null}

                <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
                  Permanent radering kan inte ångras eller återställas genom en
                  vanlig applikationsrollback.
                </p>

                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setDismissedRequestId(state.requestId)}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-700"
                  >
                    Avbryt
                  </button>
                  {!canDelete && canArchive ? (
                    <form action={archiveContractAction}>
                      {hiddenFields}
                      <button className="rounded-xl border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-black text-white">
                        Arkivera och dölj
                      </button>
                    </form>
                  ) : canDelete ? (
                    <form action={deleteContractPermanentlyAction}>
                      {hiddenFields}
                      <input
                        type="hidden"
                        name="expected_preview_token"
                        value={preview?.preview_token ?? ""}
                      />
                      <button className="rounded-xl border border-red-700 bg-red-700 px-4 py-2 text-sm font-black text-white">
                        Bekräfta permanent radering
                      </button>
                    </form>
                  ) : (
                    <span className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-900">
                      Åtgärda blockerarna och kör preview igen
                    </span>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
