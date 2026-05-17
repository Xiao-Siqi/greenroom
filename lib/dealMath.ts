/**
 * Deal calculation logic for the in-app settlement tool.
 *
 * IMPORTANT — DELIBERATELY INCOMPLETE.
 *
 * This is the existing Greenroom settlement engine. It was built early in
 * the company's life, when most deals were flat guarantees. It currently
 * handles three deal types end-to-end:
 *
 *   1. flat                 — $X guaranteed, optional sellout bonus
 *   2. percentage_of_gross  — X% of gross, no expense deductions, optional sellout bonus
 *   3. vs                   — MAX(guarantee, percentage × net after expenses)
 *
 * For all three, it reads `bonusesJson` and applies bonuses where it can — but
 * only the structured ones. Bonuses that exist only in `dealNotesFreetext`
 * are invisible to this engine.
 *
 * It does NOT handle:
 *
 *   - percentage_of_net deals (with expense deductions, no guarantee floor)
 *   - door deals
 *   - recoups (those flow separately through the settlement record)
 *   - comps that count toward gross
 */

import type { Deal, Expense, TicketSale, Bonus } from "@/db/schema";

export type SuggestedRecoup = {
  category: "hospitality_overage" | "production_overage";
  label: string;
  amount: number;
};

export type SettlementCalculation =
  | {
      supported: true;
      grossBoxOffice: number;
      netBoxOffice: number;
      totalExpenses: number;
      cappedExpenses: number;
      totalToArtist: number;
      steps: { label: string; value: number; note?: string }[];
      finalFormula: string;
      bonusesApplied: { label: string; amount: number; reason: string }[];
      bonusesNotTriggered: { label: string; amount: number; reason: string }[];
      suggestedRecoups: SuggestedRecoup[];
    }
  | {
      supported: false;
      reason: string;
      dealType: Deal["dealType"];
    };

interface CalcInput {
  deal: Deal;
  ticketSales: TicketSale[];
  expenses: Expense[];
  venueCapacity?: number;
  ticketsSold?: number;
}

export function parseBonuses(deal: Deal): Bonus[] {
  if (!deal.bonusesJson) return [];
  try {
    const parsed = JSON.parse(deal.bonusesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Apply hospitality and total expense caps. Returns capped total and any suggested recoups. */
function applyExpenseCaps(
  expenses: Expense[],
  deal: Deal,
): {
  totalExpenses: number;
  cappedExpenses: number;
  suggestedRecoups: SuggestedRecoup[];
} {
  const passedThrough = expenses.filter((e) => !e.absorbedByVenue);
  const totalExpenses = passedThrough.reduce((s, e) => s + e.amount, 0);

  const hospActual = passedThrough
    .filter((e) => e.category === "hospitality")
    .reduce((s, e) => s + e.amount, 0);

  const suggestedRecoups: SuggestedRecoup[] = [];

  let hospEffective = hospActual;
  if (deal.hospitalityCap != null && hospActual > deal.hospitalityCap) {
    const overage = hospActual - deal.hospitalityCap;
    hospEffective = deal.hospitalityCap;
    suggestedRecoups.push({
      category: "hospitality_overage",
      label: `Hospitality overage (cap $${deal.hospitalityCap.toLocaleString()})`,
      amount: overage,
    });
  }

  const nonHosp = passedThrough
    .filter((e) => e.category !== "hospitality")
    .reduce((s, e) => s + e.amount, 0);

  let cappedExpenses = nonHosp + hospEffective;

  if (deal.expenseCap != null && cappedExpenses > deal.expenseCap) {
    const overage = cappedExpenses - deal.expenseCap;
    suggestedRecoups.push({
      category: "production_overage",
      label: `Total expense cap overage (cap $${deal.expenseCap.toLocaleString()})`,
      amount: overage,
    });
    cappedExpenses = deal.expenseCap;
  }

  return { totalExpenses, cappedExpenses, suggestedRecoups };
}

/** Resolve the effective percentage for a vs deal, checking for a tier_ratchet first. */
function resolveVsPercentage(
  allBonuses: Bonus[],
  fallback: number,
  tickets: number,
  capacity: number | undefined,
): {
  effectivePercentage: number;
  ratchetNote: string | null;
  ratchetBonus: Extract<Bonus, { type: "tier_ratchet" }> | null;
} {
  const ratchet = allBonuses.find(
    (b): b is Extract<Bonus, { type: "tier_ratchet" }> =>
      b.type === "tier_ratchet",
  );

  if (!ratchet || capacity == null) {
    return {
      effectivePercentage: fallback,
      ratchetNote: null,
      ratchetBonus: ratchet ?? null,
    };
  }

  const sellThrough = tickets / capacity;
  const tier = ratchet.tiers.find(
    (t) =>
      sellThrough >= t.from && (t.to == null || sellThrough < t.to),
  );

  if (!tier) {
    return {
      effectivePercentage: fallback,
      ratchetNote: `${(sellThrough * 100).toFixed(1)}% sell-through — no matching tier, using base ${(fallback * 100).toFixed(1)}%`,
      ratchetBonus: ratchet,
    };
  }

  const fromPct = (tier.from * 100).toFixed(0);
  const toPct = tier.to != null ? `${(tier.to * 100).toFixed(0)}%` : "∞";
  const note = `${(sellThrough * 100).toFixed(1)}% sell-through → tier ${fromPct}%–${toPct} → ${(tier.percentage * 100).toFixed(1)}% applies`;

  return {
    effectivePercentage: tier.percentage,
    ratchetNote: note,
    ratchetBonus: ratchet,
  };
}

export function calculateSettlement(input: CalcInput): SettlementCalculation {
  const { deal, ticketSales, expenses, venueCapacity, ticketsSold } = input;

  const grossBoxOffice = ticketSales.reduce((sum, t) => sum + t.gross, 0);
  const totalFees = ticketSales.reduce((sum, t) => sum + t.fees, 0);
  const netBoxOffice = grossBoxOffice - totalFees;

  const tickets =
    ticketsSold ?? ticketSales.reduce((sum, t) => sum + (t.qty ?? 0), 0);

  const capResult = applyExpenseCaps(expenses, deal);
  const { totalExpenses, cappedExpenses, suggestedRecoups } = capResult;

  // ---------- flat guarantee ----------
  if (deal.dealType === "flat") {
    if (deal.guaranteeAmount == null) {
      return {
        supported: false,
        reason: "Flat deal is missing a guarantee amount.",
        dealType: deal.dealType,
      };
    }
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: deal.guaranteeAmount + bonusResult.totalApplied,
      steps: [
        {
          label: "Flat guarantee",
          value: deal.guaranteeAmount,
          note: "No expense deductions. The guarantee is the floor.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `flat ${deal.guaranteeAmount} + bonuses ${bonusResult.totalApplied} = ${(deal.guaranteeAmount + bonusResult.totalApplied).toFixed(2)}`
        : `flat guarantee = ${deal.guaranteeAmount}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      suggestedRecoups,
    };
  }

  // ---------- percentage of gross ----------
  if (deal.dealType === "percentage_of_gross") {
    if (deal.percentage == null) {
      return {
        supported: false,
        reason: "Percentage-of-gross deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }
    const payout = grossBoxOffice * deal.percentage;
    const bonusResult = applyBonuses(parseBonuses(deal), {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: payout + bonusResult.totalApplied,
      steps: [
        { label: "Gross box office", value: grossBoxOffice },
        {
          label: `× ${(deal.percentage * 100).toFixed(0)}%`,
          value: payout,
          note: "Percentage of gross — no expense deductions.",
        },
        ...bonusResult.applied.map((b) => ({
          label: b.label,
          value: b.amount,
          note: b.reason,
        })),
      ],
      finalFormula: bonusResult.applied.length
        ? `gross × ${deal.percentage} + bonuses = ${(payout + bonusResult.totalApplied).toFixed(2)}`
        : `gross × ${deal.percentage} = ${payout.toFixed(2)}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      suggestedRecoups,
    };
  }

  // ---------- vs deal (guarantee vs. percentage of net) ----------
  if (deal.dealType === "vs") {
    if (deal.guaranteeAmount == null || deal.percentage == null) {
      return {
        supported: false,
        reason:
          deal.guaranteeAmount == null
            ? "Vs deal is missing a guarantee amount."
            : "Vs deal is missing a percentage.",
        dealType: deal.dealType,
      };
    }

    const allBonuses = parseBonuses(deal);
    const { effectivePercentage, ratchetNote, ratchetBonus } =
      resolveVsPercentage(allBonuses, deal.percentage, tickets, venueCapacity);

    const netAfterExpenses = netBoxOffice - cappedExpenses;
    const percentagePayout = netAfterExpenses * effectivePercentage;

    // Walkout pot: 100% of gross above a breakeven threshold — third MAX leg,
    // not additive. Computed dynamically from actual gross at settlement time.
    const walkoutPot = allBonuses.find(
      (b): b is Extract<Bonus, { type: "walkout_pot" }> =>
        b.type === "walkout_pot",
    );
    const walkoutAmount = walkoutPot
      ? Math.max(0, grossBoxOffice - walkoutPot.threshold)
      : 0;

    const baseToArtist = Math.max(
      deal.guaranteeAmount,
      percentagePayout,
      walkoutAmount,
    );
    const guaranteeWins =
      deal.guaranteeAmount >= percentagePayout &&
      deal.guaranteeAmount >= walkoutAmount;
    const walkoutWins =
      !guaranteeWins && walkoutAmount >= percentagePayout;

    // Only pass non-ratchet, non-walkout bonuses to additive applyBonuses
    const additiveBonuses = allBonuses.filter(
      (b) => b.type !== "tier_ratchet" && b.type !== "walkout_pot",
    );
    const bonusResult = applyBonuses(additiveBonuses, {
      gross: grossBoxOffice,
      tickets,
      capacity: venueCapacity,
    });

    // Include ratchet in notTriggered if it wasn't used (capacity unknown)
    if (ratchetBonus && ratchetNote?.includes("no matching tier")) {
      bonusResult.notTriggered.push({
        label: ratchetBonus.label,
        amount: 0,
        reason: ratchetNote,
      });
    }

    const pctLabel = `${(effectivePercentage * 100).toFixed(1)}% of net`;

    const steps: { label: string; value: number; note?: string }[] = [
      {
        label: "Guarantee floor",
        value: deal.guaranteeAmount,
        note: "The minimum the artist receives regardless of ticket sales.",
      },
      {
        label: `Percentage leg (${pctLabel})`,
        value: percentagePayout,
        note: ratchetNote
          ? ratchetNote
          : `Net after expenses × ${(effectivePercentage * 100).toFixed(1)}%`,
      },
      ...(walkoutPot
        ? [
            {
              label: `Walkout pot (above $${walkoutPot.threshold.toLocaleString()})`,
              value: walkoutAmount,
              note: `$${grossBoxOffice.toLocaleString()} gross − $${walkoutPot.threshold.toLocaleString()} breakeven — artist takes 100% of the excess`,
            },
          ]
        : []),
      {
        label: guaranteeWins
          ? "→ Guarantee applies"
          : walkoutWins
            ? "→ Walkout pot applies"
            : "→ Percentage leg applies",
        value: baseToArtist,
        note: guaranteeWins
          ? "Guarantee is greater — artist receives the floor."
          : walkoutWins
            ? "Walkout pot is greater — artist receives 100% of gross above breakeven."
            : "Percentage leg is greater — artist receives the upside.",
      },
      ...bonusResult.applied.map((b) => ({
        label: b.label,
        value: b.amount,
        note: b.reason,
      })),
    ];

    const winnerDesc = guaranteeWins
      ? `guarantee $${deal.guaranteeAmount.toLocaleString()}`
      : walkoutWins
        ? `walkout $${walkoutAmount.toLocaleString()}`
        : `${(effectivePercentage * 100).toFixed(1)}% × net $${baseToArtist.toLocaleString()}`;

    return {
      supported: true,
      grossBoxOffice,
      netBoxOffice,
      totalExpenses,
      cappedExpenses,
      totalToArtist: baseToArtist + bonusResult.totalApplied,
      steps,
      finalFormula: `MAX(guarantee, pct × net${walkoutPot ? ", walkout" : ""}) → ${winnerDesc}${bonusResult.totalApplied ? ` + bonuses $${bonusResult.totalApplied.toLocaleString()}` : ""}`,
      bonusesApplied: bonusResult.applied,
      bonusesNotTriggered: bonusResult.notTriggered,
      suggestedRecoups,
    };
  }

  // ---------- everything else: not supported ----------
  const friendlyName: Record<Deal["dealType"], string> = {
    flat: "Flat guarantee",
    percentage_of_gross: "Percentage of gross",
    percentage_of_net: "Percentage of net",
    vs: "Vs deal (guarantee vs %)",
    door: "Door deal",
  };

  return {
    supported: false,
    dealType: deal.dealType,
    reason:
      `${friendlyName[deal.dealType]} deals aren't supported in the in-app tool yet. ` +
      `Power users at venues like The Crescent default to spreadsheets for these.`,
  };
}

/** Evaluate a list of bonuses against the show's actual numbers. */
function applyBonuses(
  bonuses: Bonus[],
  ctx: { gross: number; tickets: number; capacity?: number },
) {
  const applied: { label: string; amount: number; reason: string }[] = [];
  const notTriggered: { label: string; amount: number; reason: string }[] = [];

  for (const b of bonuses) {
    if (b.type === "gross_threshold") {
      if (ctx.gross >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} ≥ ${b.threshold.toLocaleString()}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `Gross ${ctx.gross.toLocaleString()} < ${b.threshold.toLocaleString()}`,
        });
      }
    } else if (b.type === "sellout") {
      if (ctx.capacity != null && ctx.tickets >= ctx.capacity * 0.95) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} of ${ctx.capacity} sold`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason:
            ctx.capacity != null
              ? `${ctx.tickets} of ${ctx.capacity} sold (sellout = ≥95%)`
              : `Capacity unknown — can't evaluate`,
        });
      }
    } else if (b.type === "attendance_threshold") {
      if (ctx.tickets >= b.threshold) {
        applied.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} ≥ ${b.threshold}`,
        });
      } else {
        notTriggered.push({
          label: b.label,
          amount: b.amount,
          reason: `${ctx.tickets} < ${b.threshold}`,
        });
      }
    } else if (b.type === "tier_ratchet") {
      // Tier ratchets change the effective percentage on vs deals and are
      // resolved before applyBonuses() is called. If one appears here it
      // means this isn't a vs deal — mark as not applicable.
      notTriggered.push({
        label: b.label,
        amount: 0,
        reason: "Tier ratchets apply only to vs deals — not used here",
      });
    } else if (b.type === "walkout_pot") {
      // Walkout pot is a third MAX leg in vs deals, not an additive bonus.
      // If it appears here the deal type doesn't support it.
      notTriggered.push({
        label: b.label,
        amount: Math.max(0, ctx.gross - b.threshold),
        reason: "Walkout pot applies only to vs deals — not used here",
      });
    }
  }

  return {
    applied,
    notTriggered,
    totalApplied: applied.reduce((s, b) => s + b.amount, 0),
  };
}
