# Greenroom — Walkthrough Script
**Runtime: ~7–8 minutes**

---

## [Open at /shows]

"Hi, welcome to the demo for greenroom. First of all, let's have a recap of what Greenroom is — this is a tool for independent music venues, and specifically, we want to do it better in terms of the settlement part this year. Now as we're looking at the slice of settlement, imagine: every show night it's been 2am in the midnight, the booker mariana and tour manager have sit down at the table, spending huge amount of time opening several different screens for checking the expenses, money terms line by line and calculate what the artist is owed. We all know that settlement might be the most trust-critical moment in the venue-artist relationship, however, since previously greenroom didn't support in-app calcualtion for a lot of the deals, teh process has been filled up by a lot of the back and forth and frustration.

Now, in this version, to make the tool my all-in-one, user friendly, and easier for venues to build trust with their customer, I add several features using the AI Power which is the NLP, and refine some of the math logic and product details to make the product not only win on the completeness, but also win the customer by the craft. 

So here we start. This is the home view for a booker. Whenever she wants to locate a show, she can search live. [type 'pale' in search to demonstrate live filtering, then clear it]

Let me go into a show."

---

## [Click into show_0221 — Pale Lake, April 30]

"This is all the detailed information of the show, and here we have all the information we might need later on for building up the settlement sheet. We have the artist name, date, gross, etc. We can also see the bonus information from the bonus database as well as the deal notes, which is the raw prose both party has been agreed on. Also, here you can see the expenses broken down by category — sound, lights, hospitality, production. For this page, what I change is that I make the precision higher to cent. For every number, the usernow  no longer see the vague number for example 17.7k, instead they see the exact number for the math they need to do later.

[Point to deal card] This is a VS deal — $8,575 guarantee versus 85% of net after expenses, whichever's greater. The most common structure for mid-to-large artists. The old Greenroom couldn't calculate this at all. Let me go to the settlement."

---

## [Click Settle on show_0221]

"This is the hero number — total to artist, full cents, no rounding again, as rounding may later escalate into disputes.

[Scroll to worksheet card] The worksheet reads like an itemized bill. Gross box office at the top. Net box office after ticketing fees. [Click expand on expenses] Expenses — expanded here to show each individual line item. [Click to collapse] Net after expenses. And then — this is the new part — both legs of the VS deal. The guarantee leg. The percentage-of-net leg. And a label showing which one win the game.

[Point to deal notes] There's also a deal notes here. I add a card here showing the raw prose as well, so if either side want to go back to the deal and reference it, they can always do by a glance instead of opening a new window, go to the email, spend 5 minutes scrolling down for the notes, and lay it on the table.

---

## [Navigate to show_0081 — Low Country — in Incognito, after DB setup]

"Now a big feature added - the AI.

About half of deals with bonus structures have those terms only in the free-text notes, not in the structured database, this could cause a lot of trouble later on if the bonus is overlooked or calculated in a wrong way. I build the bridge by add an AI feature to extract that from the free text and match it with whatever in the database. When detect a mismatch, alert the user, so that the user can look into it and confirm.

[Gate appears] When user opens this settlement, the system reads the deal notes using a LLM — and extracts any bonus terms mentioned. It found a sellout bonus of $500 in the prose that isn't in the structured data.

[Point to side-by-side] This is a side-by-side. From deal notes on the left. Structured data on the right. The user picks the correct version. This is the blocking gate — she can't settle until she's confirmed. I chose a hard block over a soft warning because a missed bonus is worse than two seconds of friction.

[Click 'Use extracted terms'] In this specific case, the user might want to click use extracted terms — it writes to the database, and the worksheet loads with the correct terms included.

This is an NLP plus human-in-the-loop pattern. The AI does the extraction. And the user makes the call. For a financial calculation, that's the perfect scope — the AI never decides, it just surfaces the discrepancy."

---

## [Navigate to show_0099 — Wet Cement, May 9]

"One more thing I want to show — the expense cap math.

A lot of deals have an expense cap — the venue agrees to absorb anything over a certain amount so the artist isn't dinged for cost overruns. The old code was using a manually-set flag per line item that was often wrong, so the cap wasn't being enforced correctly.

[Point to expenses card] Now, let's see the new feature through Wet Cement's case, expense cap of $600. Let's look at what actually happened: sound, lights, backline, production, hospitality, marketing — total spend came in at $2000.

So $1,600 should be and was absorbed by the venue — you can see that called out right here with the breakdown: total spend, absorbed by venue, passed through to the artist. Before this fix, that absorbed amount was invisible, and often wrong. The worksheet would have used $2000 in the expense deduction, understating the net, and shorting the artist on their percentage. Now as you can see, every step is traceble.

---

## [Closing]

"So that's all the update. To summarize all: 1. the settlement engine now covers over 70% of the deals, growed from 37%, which is almost doubling the rate, by just adding VS deal supported. 2.An AI accuracy layer for bonuses leveraging LLM power, and a bill-style worksheet helps both sides trace the math in a minute, and confirm without asking questions. Last but not the least, the math logic for spending cap is redesigned, the bug has been fixed. 

That's a much better verison Greenroom. It's bringing the user back. Thank you for your listening."
