# Product Memo: Settlement Depth
**Author:** Siqi Xiao · May 2026

---

## Mission

Pri's Q4 memo names the company's core problem in one sentence: *"We are winning on completeness and losing on craft."* The mission is to become the operational backbone of independent venues with the strongest artist relationships — and settlement is where that relationship is most at risk.  Marcus — The Crescent's GM — lost ~$80K in annual gross revenue when one agency stopped routing their roster after a bad settlement experience. The relationship is the real cost that matters. This sprint goes deep on one thing: making settlement accurate enough and complete enough that bookers stop opening a spreadsheet, and it helps the venues to build good relationships with artists.

---

## The Slice

**VS deal support, plus an AI accuracy layer for bonuses.**

Only 18% of Greenroom customers use the in-app settlement tool. The other 82% default to spreadsheets. That shows the product is absent from the most trust-critical moment in its customers' businesses.

Mariana — The Crescent's lead booker and the clearest representative of Greenroom's core user — left the tool in 2023 because it couldn't handle vs deals, which make up roughly 70% of her book. She told us: *"If you handle vs deals and I trust the math, I'd switch back."* That is a retained customer waiting to be recaptured. Retaining an existing customer costs a fraction of acquiring a new one, and there are hundreds of bookers like Mariana making the same rational exit every Friday night.

Adding vs deal support moves the engine from covering 37% of shows to 73% — nearly increased by 100% by just adding one deal type supported. The LLM bonus reconciliation layer closes the accuracy gap that would undermine that trust: roughly half of deals with bonus structures have those terms only in free-text prose. Without reconciliation, the engine silently ignores them. Now it catches the mismatch before the math runs.

Marcus and Mariana together spend roughly 25 hours a month on settlement and post-settlement cleanup. If that became five hours, the saved time goes the work that actually grows revenue. Multiplied across hundreds of independent venues, that is an enormous amount of senior labor currently spent on a problem software should solve.

---

## What Was Built

Nine features, organized around two themes:

**Cover the deal types:**
- VS deal support — the worksheet calculates both legs (guarantee vs. percentage of net) and labels which one wins
- Walkout pot bonus handled as a natural third leg so it is never double-counted on top of the result
- Cap enforcement — hospitality and expense overruns that previously vanished from accounting are now surfaced as suggested recoup line items before the calculation runs

**Win trust through transparency.** All four stakeholders in user research defined a good settlement the same way: time-saving, traceable math, all in one place. Every feature below serves that standard:
- Full-cent display — removes rounding ambiguity
- Bill-style worksheet — every number has a labeled row for tracing
- Net-after-expenses subtotal — makes the basis of the percentage calculation explicit
- Expandable expense list — either side can drill into individual line items with category, description, and amount
- Deal notes always visible — both sides can scan the prose in seconds to confirm the math matches what was agreed
- Cap absorption computed logic fixed

**NLP + HITL** The Anthropic Claude API does one thing: read free-text deal notes and extract bonus terms. It does not make a decision. When it finds a mismatch with structured data, a blocking gate shows user a side-by-side comparison — she picks the correct version, it saves to the database, and the calculation runs on the right terms. That is the right scope for AI in a financial context.

---

## What Was Cut

**The Coastal Spell dispute** The dispute was not caused by the software, and thus it is out of scope. Both interpretations of the $900 marketing recoup produce the same payout ($12,285) when actual expenses of $1,600 are used. The $720 Marcus paid as a concession was an arithmetic error in Mariana's email — she used the cap ceiling rather than the actual total. Fixing how people negotiate deals is outside the software's scope. Greenroom serves users after they've agreed on a deal.

**Pre-show anomaly flagging, agent portals, and shareable statements** These are real future bets, but with lower priority than making the session usable. Each requires high engineering effort but brings less benefit than getting Vs deal type supported. They are next, not now. None of them work if the user  doesn't trust the base calculation.

**Tradeoffs made:**
- **LLM gate vs. soft warning** — a hard block was chosen because a missed bonus is worse than two extra seconds of friction; the "low confidence" badge is the release valve when extraction is uncertain
- **Full cents vs. rounded display** — trades readability for precision; in a room where small differences escalate into disputes, rounding is a liability, not a convenience
- **VS deals only, not door or percentage-of-net** — This is the deal type that brings back the most users. By focusing on this type, greenroom can rollout the feature for test and bring higher revenue by the least cost, time and effort.

---

## How We Validate

**Metrics (30-60 day):**
- Settlement tool adoption rate — baseline 18%, target 36%+
- In-app completion rate — % of sessions reaching "signed" without navigating away
- VS deal coverage — % of vs-deal shows settled in-app vs. spreadsheet
- Average settlement session time — proxy for friction reduction at the table
- Bonus extraction accuracy — validated against a curated edge-case test set

**VOC Signal (10-15 day):** Follow up with Mariana. If she is still in the Google Sheet for vs deals 15 days post-ship, we have not shipped what we think we shipped. Book the follow-up session immediately after soft-launch.

---

## What Ships Next

1. **Closed-case labeling.** Settled shows should be visually marked on the list so Mariana doesn't click back in. Small surface change, high daily-use impact.
2. **Shareable settlement statement.** A link or clean export the tour manager and agent can access without a Greenroom account — closing the gap between the in-room settlement and the morning email Sarah reads.
3. **Pre-show deal term anomaly flagging.** Mariana told us that some flavor of pushback happens on roughly 40% of settlements. The data to detect these — cap risk, bonus-only-in-prose, ambiguous recoup categorizations — already exists in Greenroom. This is the feature that surfaces them upfront.
