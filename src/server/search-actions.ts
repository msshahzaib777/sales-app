"use server";

import { requireTenantContext } from "./auth/session";
import { globalSearch, type SearchHit } from "./services/search";

/** Results for the search-from-anywhere box (it calls this while you type). */
export async function globalSearchAction(q: string): Promise<SearchHit[]> {
  const ctx = await requireTenantContext("operations.manage");
  return globalSearch(ctx, typeof q === "string" ? q : "");
}
