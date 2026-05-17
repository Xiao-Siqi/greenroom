"use server";

import { db } from "@/db";
import { deals } from "@/db/schema";
import type { Bonus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

function cookieName(dealId: string) {
  return `bonus_confirmed_${dealId}`;
}

const COOKIE_OPTS = { maxAge: 60 * 60 * 24 * 30, path: "/" } as const;

export async function confirmBonusTerms(dealId: string, bonuses: Bonus[]) {
  // Serialize on the server side to avoid Next.js Server Action deserializing
  // a JSON string back to an array before Drizzle can write it as text.
  const bonusesJson = JSON.stringify(bonuses);
  await db.update(deals).set({ bonusesJson }).where(eq(deals.id, dealId));
  const store = await cookies();
  store.set(cookieName(dealId), "1", COOKIE_OPTS);
}

export async function keepExistingTerms(dealId: string) {
  const store = await cookies();
  store.set(cookieName(dealId), "1", COOKIE_OPTS);
}
