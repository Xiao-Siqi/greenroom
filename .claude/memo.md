# Product Memo: Settlement Depth — Greenroom Q1 2026

**Author:** Siqi  
**Date:** May 2026  
**Status:** Shipped

---

## Mission

Give both sides of a live music deal — the venue and the touring team — a trustworthy, accurate, and all-in-one settlement experience, so that trust built on show night survives into the next relationship.

---

## Why This Slice

Pri's all-hands memo named three problem areas: settlement, advance documents, and sponsor reporting. We cut two. The choice to go deep on settlement — and only settlement — was deliberate.

**The signal is existential.** Only 18% of Greenroom customers use the in-app settlement tool. The other 82% do the math somewhere else. That is not a feature gap. That is the product being absent from the most trust-critical moment in its customers' businesses.

**The VOC is specific.** Mariana, The Crescent's lead booker and the user who decides whether Greenroom is worth opening, told us directly: "Probably 70% of my deals are vs deals. Your tool can't do those. So now I just do it in the sheet." She is not unhappy with Greenroom in general — she is making a rational decision every Friday night. The exit point is known and fixable.

**The scope is contained.** Advance documents and sponsor reporting both require upstream workflow changes or external integrations. Settlement is self-contained: the data already lives in Greenroom. The gap is the engine and the display, not the data model.

---

## The Problem We Are Not Solving (and Why)

The Coastal Spell dispute — the $720 WME situation documented in the dispute thread — looks like a canonical example of why settlement fails. On closer analysis, it is not the most painful pain point.

The math shows that both interpretations of the marketing recoup (pre-cap deduction vs. inside the $2,500 expense cap) produce exactly the same payout: $15,356 net → 80% = **$12,285** either way, when actual expenses of $1,600 are used. Mariana's settlement email used the cap ceiling ($2,500) as the expense figure instead of the actual total. The $720 Marcus paid as a concession was not owed. The dispute was an arithmetic error in an email, not a structural ambiguity in the software.

More importantly: how Mariana and the agent communicate during negotiation is outside the software's scope. Greenroom's job is to serve both sides after they've agreed on a deal — not to negotiate on their behalf. The communication layer lives in email, and that is the right place for it. Our focus should be making the software wholesome for users who walk in with a deal already signed.

**We cut:** Pre-show dispute flagging, agent-facing portals, and deal-term ambiguity detection. These are real future bets, but each requires either a new notification surface or external adoption. They are next.

---

## Features Shipped and the Reasoning

### 1. VS Deal Type Support *(with Walkout Pot as third leg)*

The single highest-leverage change in this release. Adding one deal type — the vs deal — moves the support ceiling from roughly 18% of shows to over 70%, because vs deals dominate the larger-artist segment Mariana cares most about. The worksheet shows both legs of the calculation (guarantee vs. net percentage) and labels which one won, so the tour manager can verify without a separate spreadsheet. A walkout pot bonus — where the artist takes all gross above a breakeven threshold — is handled as a natural third leg in the same comparison, preventing any risk of double-counting it on top of the result.

**Trade-off:** We chose to implement the guarantee-vs-percentage comparison only, not percentage_of_net or door deals, which remain unsupported. This keeps the engine correct rather than complete. Partial support for door deals, with its pro-rata complexities, would have introduced edge cases we couldn't validate in this sprint.

### 2. LLM-Powered Bonus Reconciliation

Roughly half of deals with bonus structures have those bonuses only in the free-text notes — not in the structured `bonusesJson` field. The settlement engine reads only structured data. Before this feature, it silently ignored prose bonuses with no warning. Now, when Mariana opens a settlement, the system uses AI to extract bonus terms from the deal notes and compares them against the structured fields. If they diverge, a blocking gate shows a side-by-side comparison. Mariana picks the correct version; the confirmed choice is written to the database immediately so it informs the calculation.

**AI's role:** The model does the reading; Mariana does the judging. This is the right scope for AI in a high-stakes financial context — pattern recognition in unstructured text, with a human in the loop before any data changes. A "low confidence" badge is shown when the extraction is uncertain, giving Mariana the signal she needs to scrutinize rather than rubber-stamp.

**Trade-off:** The gate adds friction. Every settlement open that triggers reconciliation requires an explicit choice before proceeding. This is intentional — a missed bonus is worse than two extra seconds. False positives are the risk to monitor.

### 3. Deal Notes Always Visible on Settlement Page

Mariana trusts the free-text deal notes over the structured fields. They were hidden on the settlement page for supported deal types — flat and percentage-of-gross — forcing her to navigate back to the show detail page mid-settlement to read the human-readable terms. Now the deal notes are shown on every settlement regardless of deal type. This is a small change with high signal: if we hide the thing she trusts, she will not trust the thing we show her.

### 4. All Financial Figures Display Full Cents

Every dollar amount in the app now shows to the cent ($1,500.00 rather than $1.5K). This removes rounding ambiguity in a context where small differences matter. A $720 dispute starts with a number that looks close enough but isn't. Full cents make discrepancies visible before they become disputes.

### 5. Detailed Bill-Style Settlement Worksheet

The worksheet now reads like an itemized receipt: gross box office, ticketing fees, net box office subtotal, expenses passed through, net after expenses, guarantee vs. percentage comparison, and — for vs deals — a clear label on which leg won. Diego said the settlement is "half about the money, half about the proof." The worksheet is now the proof. Sarah Kim described what a trustworthy settlement looks like: itemization, provenance, and the feeling that the venue is showing its work rather than presenting a fait accompli. This is built to that standard.

### 6. Cap-Based Expense Absorption Display

The show detail page previously computed expense absorption from an `absorbedByVenue` flag that was frequently set incorrectly. Absorption is now computed from the actual cap values at render time. When a cap is hit, the expenses card shows three rows: total spend, amount absorbed by the venue, and amount passed through. This corrects a logic error and makes the venue's concession explicit — which is important for building goodwill in the settlement conversation.

### 7. Net After Expenses Subtotal Row

The settlement worksheet now includes a "Net after expenses" row between the expenses line and the deal calculation. This makes the starting point for the guarantee-vs-percentage comparison explicit. Without it, the tour manager has to do mental arithmetic to verify the basis of the percentage. Mariana said: "The math is the easy part. The hard part is the back-and-forth." We can reduce the back-and-forth by eliminating the arithmetic they're doing in their heads.

### 8. Expandable Expense Detail on Settlement Worksheet

The "Total expenses (passed through)" row on the worksheet is now expandable. Each individual expense line item — category, description, and amount — is revealed on click, along with a note explaining any cap absorption. The passed-through total is no longer a black box. Implemented using native HTML disclosure elements — no client-side JavaScript required on a server-rendered page.

### 9. Expense and Hospitality Cap Enforcement

A logic bug: when hospitality or total expenses exceeded their deal caps, the overage silently vanished from accounting. No recoup was generated; the settlement total was simply wrong. The engine now detects cap overruns and surfaces them as suggested recoup line items for Mariana to review before the calculation runs. This is an accuracy fix, not a trust feature — it corrects numbers that were wrong.

---

## How We Validate

**Primary metrics (60-day post-ship):**

- **Settlement tool adoption rate:** from 18% baseline toward 40%+ of active customers using in-app settlement
- **Settlement completion rate:** % of settlements started in-app that reach "signed" status without a user navigating to an external tool
- **Dispute recurrence rate:** % of settlements that re-open after "signed" status, as a proxy for post-settlement email disputes
- **VS deal coverage:** % of vs-deal shows where the in-app settlement is used rather than defaulted to spreadsheet

**Leading indicator (30-day):**  
Mariana's behavior. Book a follow-up session 30 days post-ship. If she is still in the Google Sheet for vs deals, we have not shipped what we think we shipped.

**VOC signals to track:**

- Diego: Does he ask "where did this number come from" during the settlement conversation? If the worksheet is readable, he shouldn't need to.
- Sarah: Can she read the morning settlement statement in under 3 minutes without a follow-up email?
- Marcus: Is his 2am review faster? Does the 40% predicted-vs-actual margin variance improve?

---

## What We Ship Next

**1. Pre-show anomaly flagging.**  
Marcus said: "I wish she could see, before a show even happens, whether the deal we agreed to is going to be a clean one or a messy one." The data to detect many of these anomalies — hospitality running over cap, bonus terms only in prose, ambiguous recoup categorization — already exists. The next bet is surfacing these on Wednesday, not at 2am. This requires a notification surface but no new data model.

**2. Shareable settlement statement.**  
Mariana currently exports her Google Sheet to PDF and emails it to the agent the next morning. Greenroom has no role in that handoff. A structured, shareable settlement link — something Sarah can open without a Greenroom account — closes this seam and puts Greenroom in the agent relationship for the first time.

**3. Structured deal term capture at booking time.**  
The upstream cause of most settlement friction is ambiguous deal prose written at 11pm by an overworked agent. The next deep bet is making deal terms machine-readable at the point of negotiation — structured fields with explicit rules for expense inclusion, recoup ordering, and bonus conditions — so that both sides agree on a version the engine can use before the show is advanced. This is a workflow change and will require agent-side adoption. It is the right next problem.

---

## Summary

We chose settlement because it is where 82% of customers are already leaving the product. Within settlement, we chose vs deal support because it is the single exit trigger Mariana named by name. Everything else in this release is designed to make the math readable enough that Diego trusts it, Sarah can audit it in three minutes, and Marcus can sign off on it without blind faith at 1am.

The AI feature — bonus reconciliation — is one thing: extracting structured data from unstructured text so that Mariana doesn't have to do it manually. It does not make decisions. It surfaces discrepancies. Humans close them. That is the right scope for AI in a settlement tool where a missed line item costs a relationship.

What we did not build — agent portals, dispute prevention, pre-show alerts, deal negotiation tooling — are real problems. They are next. The reason they are next and not now is that none of them work if Mariana doesn't trust the base calculation. We fix that first.
