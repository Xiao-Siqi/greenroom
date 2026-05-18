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

### Goal
Improving data accuracy and trustworthiness

**1. VS Deal Type Support**
The settlement engine now handles "vs" deals — the most common structure for larger artists — where the payout is whichever is greater: a flat guarantee or a percentage of net after expenses. The worksheet shows both legs of the calculation and labels which one applied, so Mariana and the tour manager can verify the math without a spreadsheet. *(A "walkout pot" bonus — where the artist takes all gross above a breakeven threshold — is also supported as a third leg in this comparison, so it is never double-counted on top of the result.)*

**2. LLM-Powered Bonus Reconciliation**
When Mariana opens a settlement, the system reads the deal's free-text notes and uses AI to extract any bonus terms mentioned. If the extracted bonuses don't match what's recorded in the structured fields, a confirmation screen blocks the worksheet and shows a side-by-side comparison — Mariana picks the correct version before the calculation runs. Confirming a choice saves reliably to the database, so the reconciled terms are used by the settlement engine immediately.

**3. Deal Notes Always Visible on Settlement Page**
The deal's free-text notes — the terms Mariana actually trusts — are now shown on the settlement page for every deal type. Previously they were hidden for flat and percentage-of-gross deals, forcing Mariana to navigate back to the show detail page to cross-reference the human-readable terms against the worksheet.

**4. All Financial Figures Display Full Cents**
Every dollar amount across the app now shows to the cent (e.g., $1,500.00 rather than $1.5K). This removes rounding ambiguity when reviewing settlements and recoups where small differences matter.

**5. Detailed Bill-Style Settlement Worksheet**
The settlement worksheet now reads like an itemized bill, with separate rows for ticketing fees, a clear net box office subtotal, and — for vs deals — both the guarantee leg and the percentage leg shown so the reader can see which one won. A summary deduction row at the bottom of the worksheet connects to the recoups card below, making the full calculation traceable in one view.

**6. Cap-Based Expense Absorption Display**
On the show detail page, expense absorption is now computed from the actual deal cap values rather than a manually-set flag that was often incorrect. When a cap is hit, the expenses card shows three footer rows — total spend, amount absorbed by the venue, and the amount actually passed through — so it's clear at a glance what the artist is being charged.

**7. Net After Expenses Subtotal Row**
The settlement worksheet now includes a "Net after expenses" row between the expenses line and the deal calculation steps. This makes the starting point for the guarantee-vs-percentage comparison explicit, so every number on the worksheet can be traced without doing any arithmetic manually.

**8. Expandable Expense Detail on Settlement Worksheet**
The "Total expenses (passed through)" row on the settlement worksheet can be expanded to reveal each individual expense line item with its category and amount. If an expense cap reduced the total, a note explains how much was absorbed — so the passed-through figure is never a black box.

**9. Expense and Hospitality Cap Enforcement**
When a settlement is run, the engine now checks whether hospitality or total expenses have exceeded their deal caps. Any overage is surfaced as a suggested recoup line item on the worksheet for Mariana to review, rather than silently disappearing from the accounting.


---

## Insights

**1. The Coastal Spell $720 dispute was caused by a worksheet arithmetic error, not a genuine interpretation gap.**
The March 2025 Coastal Spell dispute (documented in `data/dispute-thread.md`) appeared to be about whether the $900 marketing recoup was a pre-cap deduction off gross or included inside the $2,500 expense cap. In practice, both interpretations produce the same payout. Actual venue expenses for the show were $1,600 — well under the $2,500 cap. Under Mariana's interpretation: $19,840 − $1,984 (fees) − $900 (marketing off gross) − $1,600 (expenses) = $15,356 net → 80% = **$12,285**. Under WME's interpretation: $1,600 + $900 = $2,500 (cap hit exactly) → $17,856 − $2,500 = $15,356 net → 80% = **$12,285**. Mariana's settlement email used $2,500 (the cap ceiling) as the expense deduction instead of the actual $1,600, producing $11,565 — $720 short. The concession Marcus paid was unnecessary; the DB value of $12,285 is correct under either reading. The structural problem (schema cannot represent whether a recoup is inside or additive to an expense cap) is real and persists, but the financial outcome in the DB is right.

This might not be the most painful pain point for us to solve, as our main focus shoudl be make the software sholesome, people can use the software as long as they've settled on an agreement. How they communicate should not be the focus as they are comnunicating through email, which is outside the software itself.

