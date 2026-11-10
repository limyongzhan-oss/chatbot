import "server-only";
import type { Db } from "./db";
import { notExitedList, siteTotals, subconBreakdown, trend, unwellList } from "./queries";
import type { SiteData } from "@/components/SiteView";

export async function loadSite(c: Db, contractId: number, date: string): Promise<SiteData> {
  // One client = one connection; pg runs these sequentially anyway.
  const totals = await siteTotals(c, contractId, date);
  const subcons = await subconBreakdown(c, contractId, date);
  const unwell = await unwellList(c, contractId, date);
  const notExited = await notExitedList(c, contractId, date);
  const points = await trend(c, date, { contractId });
  return { totals, subcons, unwell, notExited, trend: points };
}
