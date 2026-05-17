"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { BonusReconcileResult } from "@/lib/bonusReconcile";
import type { Bonus } from "@/db/schema";
import {
  confirmBonusTerms,
  keepExistingTerms,
} from "@/app/shows/[id]/settle/actions";

function bonusLabel(b: Bonus): string {
  switch (b.type) {
    case "gross_threshold":
      return `${b.label} — $${b.amount.toLocaleString()} at $${b.threshold.toLocaleString()} gross`;
    case "sellout":
      return `${b.label} — $${b.amount.toLocaleString()} sellout bonus`;
    case "attendance_threshold":
      return `${b.label} — $${b.amount.toLocaleString()} at ${b.threshold.toLocaleString()} tickets`;
    case "tier_ratchet":
      return `${b.label} — tiered ratchet (${b.tiers.length} tier${b.tiers.length === 1 ? "" : "s"})`;
    case "walkout_pot":
      return `${b.label} — 100% of gross above $${b.threshold.toLocaleString()} breakeven`;
  }
}

export function BonusReconcileGate({
  dealId,
  reconcileResult,
  children,
}: {
  dealId: string;
  reconcileResult: BonusReconcileResult | null;
  children: React.ReactNode;
}) {
  const [showGate, setShowGate] = useState(!!reconcileResult);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  if (!showGate || !reconcileResult) return <>{children}</>;

  const handleUseExtracted = () => {
    startTransition(async () => {
      await confirmBonusTerms(dealId, reconcileResult.extracted);
      setShowGate(false);
      router.refresh();
    });
  };

  const handleKeepExisting = () => {
    startTransition(async () => {
      await keepExistingTerms(dealId);
      setShowGate(false);
    });
  };

  return (
    <>
      {/* Fixed overlay — blocks the settlement worksheet */}
      <div className="fixed inset-0 z-50 bg-white/85 backdrop-blur-sm flex items-center justify-center p-8">
        <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <Card accent="amber">
            <CardHeader>
              <div>
                <CardTitle>Bonus terms may be out of sync</CardTitle>
                <CardDescription>
                  {reconcileResult.isNewData
                    ? "The deal notes mention bonuses but none are recorded in the structured fields. Confirm the extracted terms to include them in the settlement calculation."
                    : "The deal notes don't match the structured bonus data. Choose which version to use before settling."}
                </CardDescription>
              </div>
              {reconcileResult.confidence === "low" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 shrink-0">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Low confidence
                </span>
              )}
            </CardHeader>
            <CardContent className="space-y-6 py-5">
              {/* Side-by-side diff */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-2">
                    From deal notes
                  </div>
                  {reconcileResult.extracted.length === 0 ? (
                    <p className="text-[12.5px] text-ink-400 italic">
                      No bonuses found
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {reconcileResult.extracted.map((b, i) => (
                        <li
                          key={i}
                          className="text-[12.5px] text-ink-800 bg-amber-50 rounded-md px-3 py-2 ring-1 ring-amber-200/70"
                        >
                          {bonusLabel(b)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-2">
                    Structured data
                  </div>
                  {reconcileResult.existing.length === 0 ? (
                    <p className="text-[12.5px] text-ink-400 italic">
                      None on record
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {reconcileResult.existing.map((b, i) => (
                        <li
                          key={i}
                          className="text-[12.5px] text-ink-800 bg-canvas-soft rounded-md px-3 py-2 ring-1 ring-ink-200/70"
                        >
                          {bonusLabel(b)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Verbatim excerpt from the prose */}
              {reconcileResult.rawMentions.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-2">
                    Extracted from
                  </div>
                  <div className="text-[12px] text-ink-600 bg-canvas-soft rounded-lg p-3 ring-1 ring-ink-200/60 leading-relaxed">
                    &ldquo;{reconcileResult.rawMentions.join("  ·  ")}&rdquo;
                  </div>
                </div>
              )}

              {/* Confirm / dismiss buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleUseExtracted}
                  disabled={isPending}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-[13px] font-medium text-white hover:bg-brand-800 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle className="h-4 w-4" />
                  Use extracted terms
                </button>
                <button
                  onClick={handleKeepExisting}
                  disabled={isPending}
                  className="flex-1 inline-flex items-center justify-center rounded-lg border border-ink-200 px-4 py-2.5 text-[13px] font-medium text-ink-700 hover:bg-canvas-soft disabled:opacity-50 transition-colors"
                >
                  Keep existing data
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Settlement content — dimmed beneath the overlay */}
      <div className="pointer-events-none select-none opacity-30">
        {children}
      </div>
    </>
  );
}
