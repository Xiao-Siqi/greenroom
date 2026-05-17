# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # Production build
npm run lint         # ESLint
npm run db:push      # Push schema changes to SQLite
npm run db:seed      # Re-seed without dropping
npm run db:reset     # Drop DB, push schema, re-seed (takes ~5s, deterministic)
npm run db:studio    # Open Drizzle Studio browser at local.drizzle.studio
```

There is no test suite.

The database file lives at `data/greenroom.db`. The `DATABASE_URL` env var overrides that path (format: `file:./data/greenroom.db`).

## Architecture

**Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS 4 · Drizzle ORM · libsql (pure-JS SQLite — no native compile needed)

**Data flow:** All pages are React Server Components. Data is fetched server-side in `lib/queries.ts` using Drizzle, then passed as props to UI components. There is no client-side data fetching or API routes — everything runs at request time on the server.

**Time-gate:** `getAllShows()` filters with `lte(shows.date, todayDateString())`, so only shows on or before today are visible. Future shows exist in the DB but are hidden until their date arrives. This is intentional.

### Key files

| File | Purpose |
|---|---|
| `db/schema.ts` | All table definitions + TypeScript types. Source of truth for the data model. |
| `lib/queries.ts` | Server-side fetch helpers (`getAllShows`, `getShowById`, `getAllArtists`, `getReports`). |
| `lib/dealMath.ts` | Settlement calculation engine — **deliberately incomplete** (see below). |
| `lib/settlementStage.ts` | Settlement state machine: stage order, labels, transitions, history. |
| `lib/format.ts` | `formatMoney` and date helpers. |
| `db/index.ts` | Drizzle + libsql client singleton. |
| `db/seed.ts` | 24-month synthetic seed — deterministic, regenerates identical data every run. |

### The settlement engine gap (core design constraint)

`lib/dealMath.ts` only handles two deal types end-to-end: `flat` and `percentage_of_gross`. For everything else — `vs`, `percentage_of_net`, `door` — it returns `{ supported: false }` and the UI shows an unsupported-deal empty state. This affects ~82% of shows. The gap is intentional and central to the case study.

Bonuses in `bonusesJson` are read by the engine. Bonuses that exist only in `dealNotesFreetext` are invisible to it — which is a data quality problem, since Mariana trusts the free-text field over the structured fields.

### Data model key facts

- **`deals.dealNotesFreetext`** is the source of truth Mariana actually uses. The structured fields (`guaranteeAmount`, `percentage`, `bonusesJson`) are filled inconsistently.
- **`bonusesJson`** has five bonus types: `gross_threshold`, `sellout`, `attendance_threshold`, `tier_ratchet`, `walkout_pot`. About half of deals with bonus structures only have them in the prose.
- **`settlements.recoupsJson`** holds an array of `Recoup` objects with statuses `agreed | disputed | withdrawn`. Recoups are venue costs deducted before artist payment, and are the most common source of disputes.
- **Settlement lifecycle:** `draft → submitted → in_review → signed → finalized → paid`, with a `disputed → revised` branch and `voided` as a terminal off-ramp. Helpers live in `lib/settlementStage.ts`.
- **`comps.countsTowardGross`** controls whether comp tickets count toward the gross box office figure used in artist % calculations. Rules vary by deal.

### Component structure

- `components/ui/` — Button, Badge (StatusBadge, DealTypeBadge, PlainBadge), Card (with CardHeader, CardContent, Field), Tooltip
- `components/layout/` — Sidebar (server), NavLinks (client, for pathname-aware active state)
- `components/command-palette/` — ⌘K global search across shows and artists
- `components/brand/logo.tsx` — Logomark / wordmark

### CSS conventions

Tailwind CSS 4. Custom design tokens used throughout: `text-ink-{400,500,600,800,900}`, `bg-canvas`, `bg-canvas-soft`, `text-brand-{700,800}`. Display headings use the `font-display` class (Fraunces variable serif loaded via `next/font/google`). Monospace data uses `font-mono tabular` with `tabular-nums` for financial figures.

### Context files (domain knowledge)

`data/` contains narrative context that the database deliberately doesn't capture:
- `data/ceo-memo.md` — CEO's Q4 priorities
- `data/dispute-thread.md` — The March 2025 Coastal Spell recoup dispute in full
- `data/transcripts/` — Interviews with Mariana (booker), Diego (tour manager), Marcus (GM), Sarah Kim (WME agent)

## Data Flaws

The seed (`db/seed.ts`) deliberately plants realistic inconsistencies that cause incorrect or ambiguous settlements. These are not bugs in the seed — they simulate real venue operational problems. Any work touching settlement logic or data display should be aware of them.

### Structural flaws (exist in every environment)

| Flaw | Where | Effect |
|---|---|---|
| **No bridge between prose and structured fields** | `deals.dealNotesFreetext` vs `deals.bonusesJson` | ~50% of deals have bonuses only in prose. `calculateSettlement()` silently ignores them — no warning, no diff shown. |
| **Free text hidden on settlement page for supported deals** | `app/shows/[id]/settle/page.tsx` | For flat and % of gross deals, `dealNotesFreetext` is fetched but never rendered. A renegotiated bonus in the prose is invisible on the settlement worksheet. |
| **`bonusesJson` partially populated** | `deals` table | About half of deals with bonus structures fill in `bonusesJson`; the other half put the bonus only in prose. The engine can't know which half it's dealing with. |

### Seeded data inconsistencies (concrete examples)

| ID | Flaw | Fields involved | Settlement impact |
|---|---|---|---|
| BC2 | Bonus threshold renegotiated in prose, not in `bonusesJson` | `bonusesJson[0].threshold` vs `dealNotesFreetext` | Engine fires bonus at wrong threshold — over- or under-pays |
| BC6 | Percentage renegotiated in prose, not in `deals.percentage` | `percentage = 0.75` vs prose "85/15 split" | Artist underpaid by ~10 percentage points |
| BC9 | Wrong deal type recorded | `dealType = "percentage_of_net"` vs prose describing a vs-deal with guarantee | Engine returns unsupported, guarantee never applied |
| BC5 | Hospitality cap overrun, no recoup generated | `hospitalityCap = 400`, actual spend `$620`, `absorbedByVenue = false` | $220 overage disappears from accounting entirely |
| BC10 | `countsTowardGross` flag contradicts prose | `countsTowardGross = false` vs notes "agreed these count" | Gross box office understated → artist % payout understated |
| BC8 | Duplicate expense entry | Same sound line item entered twice by different users | Double-counted expense reduces net, underpays artist |
| BC7 | Timestamp reversal | `signedAt < submittedAt` | Breaks any audit or timeline logic |
| BC3 | Settlement marked paid with an unresolved disputed recoup | `status = "paid"`, `recoupsJson` has `"disputed"` entry | Financial obligation open, system treats settlement as closed |
| BC1 | Disputed status contradicts signoff text | `status = "disputed"`, signoffText = "Looks good" | Opposite signals — agent signed off, then an assistant re-opened without formal process |
| BC4 | Recoup categorized incorrectly | `category = "production_overage"` for a Spotify ad spend | Wrong bucket in reporting |
| BC11 | Stale `priorShowCount` | Artist in 4+ shows, `priorShowCount = 0` | Misleading booking context |
| BC12 | Systemic agent dispute pattern | Multiple WME shows with disputed marketing recoups | Signals a communication breakdown, not a one-off |

### Canonical dispute: Coastal Spell (March 2025)
Deal prose said "$900 marketing recoup against gross." Mariana read it as a deduction _before_ the expense cap; the agent's team read it as _inside_ the $2,500 cap. The structured field (`expenseCap: 2500`) cannot represent that distinction. $720 difference in payout; GM resolved as a concession. Full thread in `data/dispute-thread.md`.

---

## Product Feature Changes

### Goal: 
Improving data accuracy and trustworthiness

### Plan

**1. LLM-powered bonus reconciliation on settlement open**
When Mariana opens the settlement page, pass `deal.dealNotesFreetext` to an LLM (claude-haiku-4-5-20251001 with structured output) to extract all bonus terms mentioned in the prose — dollar thresholds, percentages, attendance targets, ratchet triggers. Compare the extracted terms against the structured `bonusesJson` field.

- **If aligned:** Proceed silently — no UI interruption.
- **If misaligned:** Block the settlement worksheet with a modal confirmation screen showing a side-by-side diff: what the prose says vs. what `bonusesJson` contains. Mariana chooses which version is correct, then clicks Confirm.
  - On confirm, write the chosen bonus terms back to `deals.bonusesJson` (via a Server Action or lightweight API route that updates the DB row).
  - The settlement page re-renders with the now-accurate `bonusesJson`, and `calculateSettlement()` runs as normal — no changes needed to the calculation engine.
  - This closes the prose-vs-structured gap at source: once confirmed, the record is the authority.
- **If `bonusesJson` is null but prose mentions bonuses:** No structured data to compare against — this is a legacy deal where bonuses were never recorded in structured form. Show the same modal with the LLM-extracted terms on the left and "none on record" on the right. Mariana confirms the extracted terms, which are written to `bonusesJson` for the first time. This is the primary path for closing the gap on older deals and should be treated the same as "misaligned" in the UI flow — the modal always appears, Mariana always confirms before the calculation runs.

Implementation target: call Claude API server-side at settlement-page load (in `app/shows/[id]/settle/page.tsx`). Use tool use / structured output to return a typed `ExtractedBonusTerms` object. Add prompt caching on the system prompt (same extraction schema every call). Only fire for deals where `dealNotesFreetext` is non-null. Write-back goes to `deals` table column `bonusesJson` via `db.update(deals).set({ bonusesJson: ... }).where(eq(deals.id, deal.id))`.

`ExtractedBonusTerms` shape (mirrors the existing `Bonus` union in `db/schema.ts`):
```ts
type ExtractedBonusTerms = {
  bonuses: Array<
    | { type: "gross_threshold"; label: string; threshold: number; amount: number }
    | { type: "sellout"; label: string; amount: number }
    | { type: "attendance_threshold"; label: string; threshold: number; amount: number }
    | { type: "tier_ratchet"; label: string; tiers: { from: number; to: number | null; percentage: number }[] }
  >;
  confidence: "high" | "low"; // LLM self-reported — surface as a warning if low
  rawMentions: string[];       // verbatim excerpt(s) from prose that triggered each extraction
};
```

**Error handling:** If the Claude API call fails (network error, timeout, non-200), catch the error and proceed silently — show the settlement page as normal with no reconciliation check. Log the failure server-side. Never block Mariana from settling because of an LLM call failure.

**2. Support Vs deal type**
The `vs` deal (guarantee vs. percentage of net, whichever is greater) is the most common deal structure for large artists and the most important gap in the current engine. All required data already exists in the schema — no DB changes needed. The full implementation is confined to `lib/dealMath.ts`.

**Math:** `grossBoxOffice` = sum of `ticketSales.gross`; `fees` = sum of `ticketSales.fees`; `netBoxOffice = grossBoxOffice - fees`; `cappedExpenses = min(totalExpenses, deal.expenseCap)` (if `expenseCap` is null, use full expenses); `netAfterExpenses = netBoxOffice - cappedExpenses`; `percentagePayout = netAfterExpenses × deal.percentage`; `totalToArtist = MAX(deal.guaranteeAmount, percentagePayout)`. If a `tier_ratchet` bonus exists in `bonusesJson`, resolve the effective percentage first: calculate `sellThrough = ticketsSold / venueCapacity`, find the matching tier (where `sellThrough` is between `tier.from` and `tier.to`), and use that tier's `percentage` instead of `deal.percentage`. All other bonus types (`gross_threshold`, `sellout`, `attendance_threshold`) are applied additively on top of the MAX result as they are today.

**Steps:**
1. In `calculateSettlement()` (`lib/dealMath.ts`), add a `vs` case after the `percentage_of_gross` block. Guard: if `guaranteeAmount` or `percentage` is null, return `{ supported: false, reason: "..." }`.
2. Before calling `applyBonuses()`, extract any `tier_ratchet` entry from `parseBonuses(deal)`. Evaluate sell-through against its tiers to get the effective percentage; fall back to `deal.percentage` if no ratchet exists or capacity is unknown.
3. Calculate `netAfterExpenses` using the capped expense logic above, then compute `percentagePayout` with the resolved percentage.
4. Call `applyBonuses()` with the remaining non-ratchet bonuses for the additive pass.
5. Return `{ supported: true, totalToArtist: MAX(guaranteeAmount, percentagePayout) + bonusResult.totalApplied, steps: [...], ... }` with a clear step breakdown showing the guarantee floor, net calculation, percentage leg, and which leg won.
6. No changes needed to `app/shows/[id]/settle/page.tsx` — once `calculateSettlement()` returns `{ supported: true }` for `vs` deals, the existing `SupportedSettlement` component renders automatically.


**3. Cap enforcement at settlement calculation time**
`dealMath.ts` currently ignores `hospitalityCap` entirely. Add a cap-enforcement pass inside `calculateSettlement()` — after totalling expenses, check whether the hospitality subtotal exceeds `deal.hospitalityCap` or total expenses exceed `deal.expenseCap`. If so, inject an overage recoup into the returned `steps` array (do NOT write to the DB at this point — the recoup is surfaced as a suggested line item for Mariana to confirm, which then gets written to `settlements.recoupsJson` via the existing settlement-save flow). Use `status: "agreed"` and `category: "hospitality_overage"` or `"production_overage"` as appropriate. This prevents the BC5-class silent overrun where a $220 hospitality overage disappears from accounting entirely. Note: `recoupsJson` lives on the `settlements` table, not `deals` — cap enforcement generates a suggested recoup in the calculation output, not a direct DB update.

**4. `countsTowardGross` flag audit**
Add a query in `getReports()` (`lib/queries.ts`) that finds shows where any comp row has `countsTowardGross = true` but the settlement's `grossBoxOffice` matches raw ticket gross (meaning the comp face value was never added in). Surface this as a data-quality warning count on the reports page — e.g. "3 shows may have understated gross box office." This catches the BC10-class error where the comp flag contradicts the prose and the artist's % payout is silently understated.

**5. Show deal free text on settlement page for all deal types**
Currently `dealNotesFreetext` is only rendered on the settlement page for unsupported deal types (vs, % of net, door). For supported deals (flat, % of gross) it is fetched but never shown. **Goal:** always render the deal notes prose on the settlement page, regardless of deal type, so Mariana can cross-reference the human deal terms against the calculated worksheet without navigating back to the show detail page.

Implementation: in `app/shows/[id]/settle/page.tsx`, add a deal notes card (or field within the existing `SupportedSettlement` component) that shows `deal.dealNotesFreetext` when it is non-null, using the same prose display pattern already in `UnsupportedDeal`.

**6. All numbers on the UI displayed with precision to cents — ✓ Done**
`formatMoney` updated with `minimumFractionDigits: 2`; `formatMoneyCompact` made an alias. All call sites automatically render full cents (e.g. `$1,500.00` not `$1.5K`).

**8. Expense absorption display — cap-based, not DB-flag-based — ✓ Done**
The `expenses.absorbed_by_venue` DB flag is unreliable (often set on overage rows before anyone evaluated whether the cap was actually hit). The show detail page (`app/shows/[id]/page.tsx`) now ignores this flag entirely for financial display. Absorption is computed from cap fields at render time:

1. Sum hospitality expenses separately → apply `deal.hospitalityCap` → `hospitalityPassedThrough`
2. Add all non-hospitality → apply `deal.expenseCap` → `totalPassedThrough`
3. `totalAbsorbed = allExpensesTotal − totalPassedThrough`

UI behavior in the Expenses card:
- All expense rows are listed with no per-row "absorbed" tag.
- A `"X absorbed"` badge appears in the card header **only** when `totalAbsorbed > 0`.
- When no cap is hit: single footer row "Total (passed through)".
- When a cap is hit: three footer rows — Total → Absorbed by venue (−X) → **Total passed through**.

**9. Walkout pot bonus type — ✓ Done**
`walkout_pot` is a fifth `Bonus` variant in `db/schema.ts`. It represents "artist takes 100% of gross above a breakeven threshold." Key rules:
- Payout is dynamic: `max(0, gross − threshold)`. There is no fixed `amount` field.
- In vs deals, it is a **third leg** in the MAX comparison — `MAX(guarantee, pct × netAfterExpenses, walkoutPot)` — not additive on top. Adding it additively would allow payouts exceeding total gross.
- Only non-ratchet, non-walkout bonuses (`gross_threshold`, `sellout`, `attendance_threshold`) are passed to `applyBonuses()` as additive bonuses.
- The LLM extraction prompt (`lib/bonusReconcile.ts`) explicitly distinguishes `walkout_pot` from `gross_threshold` so it is not misclassified.

**11. Net after expenses row on settlement worksheet — ✓ Done**
Added a "Net after expenses" subtotal row on the settlement page (`app/shows/[id]/settle/page.tsx`) between the "Total expenses (passed through)" row and the deal calculation steps. Value is `calc.netBoxOffice − calc.cappedExpenses` — computed in the UI since `calculateSettlement()` does not return this intermediate value. The row uses a `subtotal` prop on the `Row` component (top border + slightly heavier font) to signal it is the input to the deal math below, not just another line item.

**10. Server Action serialization — ✓ Done**
`confirmBonusTerms` in `app/shows/[id]/settle/actions.ts` accepts `Bonus[]` (not a pre-stringified `string`) and calls `JSON.stringify` server-side before writing to the `bonuses_json` text column. Passing `JSON.stringify(array)` as a `string` parameter to a Server Action can cause the framework to re-parse it back to an array, which then fails when Drizzle binds an array to a SQLite text column.

**7. More detailed settlement worksheet — bill-style row expansion**
Keep the existing card and `Row` component visual style. The goal is not a redesign — it is adding more rows so Mariana and the tour manager can read the worksheet like a detailed bill and verify every number without doing any mental arithmetic.

Specific rows to add or expand within the existing "Settlement worksheet" card in `SupportedSettlement`:

**Box office section** (currently shows two lump rows — expand to three):
```
Gross box office          $8,516.00
  − Ticketing fees          −$852.00    ← new row; note: "service charges from ticketing"
  = Net box office          $7,664.00   ← existing, now clearly a subtotal
```

**Expenses section** (currently one lump total — expand to itemized lines):
```
Expenses:
  Sound                     −$800.00
  Lighting                  −$350.00
  Hospitality               −$620.00    ← actual spend
    [if over hospitalityCap: note "Hospitality cap $400.00 — $220.00 overage not charged"]
    [show capped amount as the deduction: −$400.00]
  Marketing                 −$150.00
  = Total expenses          −$1,300.00  ← subtotal row, visually heavier
```
Each expense row uses the existing `Row` component. If `hospitalityCap` or `expenseCap` is set and exceeded, add an inline note on that row explaining the cap and what was absorbed — this makes the cap visible rather than silent.

**Deal calculation section** — unchanged structure, but now sits below a clear "Net after expenses" subtotal row so the input to the formula is explicit.

**For vs deals** — add both legs as rows so the reader can see which one won:
```
  Guarantee leg             $2,631.00
  Percentage leg (90% net)  $5,727.60
  → Percentage leg applies  $5,727.60   ← note: "greater of the two"
```

**Recoups** — keep the existing `RecoupsSection` card below the worksheet, but add a summary deduction row at the bottom of the worksheet card itself:
```
  = Subtotal before recoups  $6,127.60
  − Recoups (agreed)          −$900.00   ← single summary line linking to the card below
  = Total to artist          $5,227.60   ← existing bold total row
```
This connects the two cards so the final number is fully traceable within the worksheet.

**Implementation:**
- `lib/dealMath.ts`: Expand the `steps[]` return to include the fee deduction row and per-expense rows. Add a `cappedExpenses` field to the return type so the UI knows the effective expense total after caps. Add `suggestedRecoups` (from Item 3 cap enforcement) as an array on the return type.
- `app/shows/[id]/settle/page.tsx`: In `SupportedSettlement`, replace the three current lump rows with the expanded row set described above. Use the existing `Row` component throughout — no new component needed. Pull per-expense rows from the `expenses` prop passed through from the page. Add the recoup summary deduction row using the `recoups` array already available at the page level (pass it into `SupportedSettlement` as a prop).

