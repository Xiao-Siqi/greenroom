import Anthropic from "@anthropic-ai/sdk";
import type { Deal, Bonus } from "@/db/schema";
import { parseBonuses } from "@/lib/dealMath";

const client = new Anthropic();

export type BonusReconcileResult = {
  needsConfirmation: boolean;
  extracted: Bonus[];
  confidence: "high" | "low";
  rawMentions: string[];
  existing: Bonus[];
  isNewData: boolean;
};

const SYSTEM_PROMPT = `You are a music venue settlement assistant. Extract structured bonus terms from deal notes.

Return ONLY valid JSON matching this exact schema — no markdown, no explanation:
{
  "bonuses": [
    // Each bonus is ONE of these shapes:
    { "type": "gross_threshold", "label": string, "threshold": number, "amount": number }
    { "type": "sellout", "label": string, "amount": number }
    { "type": "attendance_threshold", "label": string, "threshold": number, "amount": number }
    { "type": "tier_ratchet", "label": string, "tiers": [{ "from": number, "to": number|null, "percentage": number }] }
    { "type": "walkout_pot", "label": string, "threshold": number }
  ],
  "confidence": "high" | "low",
  "rawMentions": [string]
}

Bonus type guide:
- "gross_threshold": artist receives a FIXED dollar amount when gross exceeds a threshold. Example: "$500 bonus if gross tops $10,000."
- "sellout": fixed dollar bonus for selling out (≥95% capacity).
- "attendance_threshold": fixed dollar bonus when ticket count exceeds a threshold.
- "tier_ratchet": artist percentage escalates in tiers based on sell-through. Example: "70% up to 80% sold, then 80% above."
- "walkout_pot": artist takes 100% of ALL gross above a breakeven threshold — the amount is dynamic, not fixed. Use this (NOT gross_threshold) whenever notes say "100% of gross above $X", "walkout above breakeven", or "walkout pot above $X". Only capture the threshold number; do NOT invent an amount.

Rules:
- Do NOT extract base guarantee amounts or base percentage rates as bonuses
- "rawMentions": verbatim quote(s) from the text that mention bonuses
- "confidence": "high" if text is clear; "low" if there is ambiguity
- If no bonuses are mentioned, return: {"bonuses":[],"confidence":"high","rawMentions":[]}`;

export async function reconcileBonuses(
  deal: Deal,
): Promise<BonusReconcileResult | null> {
  if (!deal.dealNotesFreetext) return null;

  const existing = parseBonuses(deal);

  let extracted: Bonus[] = [];
  let confidence: "high" | "low" = "high";
  let rawMentions: string[] = [];

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract bonus terms from these deal notes:\n\n${deal.dealNotesFreetext}`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type === "text") {
      const clean = content.text
        .trim()
        .replace(/^```(?:json)?\n?/, "")
        .replace(/\n?```$/, "");
      const parsed = JSON.parse(clean);
      extracted = Array.isArray(parsed.bonuses) ? (parsed.bonuses as Bonus[]) : [];
      confidence = parsed.confidence === "low" ? "low" : "high";
      rawMentions = Array.isArray(parsed.rawMentions)
        ? (parsed.rawMentions as string[])
        : [];
    }
  } catch (err) {
    // Silent failure — never block Mariana from settling
    console.error("[reconcileBonuses] Claude API call failed:", err);
    return null;
  }

  const hasProseBonuses = extracted.length > 0;
  const hasStructuredBonuses = existing.length > 0;

  // Nothing to reconcile if neither side has bonuses
  if (!hasProseBonuses && !hasStructuredBonuses) return null;

  // Only show gate when the prose mentions bonuses
  if (!hasProseBonuses) return null;

  const isNewData = !hasStructuredBonuses;

  // Compare by bonus type list — any difference triggers confirmation
  const isMisaligned =
    isNewData ||
    existing.map((b) => b.type).sort().join(",") !==
      extracted.map((b) => b.type).sort().join(",");

  if (!isMisaligned) return null;

  return {
    needsConfirmation: true,
    extracted,
    confidence,
    rawMentions,
    existing,
    isNewData,
  };
}
