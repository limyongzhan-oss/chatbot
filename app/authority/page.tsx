import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { groupOverview, trend } from "@/lib/queries";
import { pickDate, prettyDate } from "@/lib/dates";
import { Bar, DatePicker, Kpi, TopBar, pct, withDate } from "@/components/ui";
import { TrendChart } from "@/components/TrendChart";

export default async function AuthorityOverview({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireRole("authority");
  const date = pickDate((await searchParams).date);
  const { groups, points } = await asUser(session.uid, async (c) => ({
    groups: await groupOverview(c, date),
    points: await trend(c, date),
  }));

  const sum = (k: "total" | "still_on_site" | "unwell" | "contracts" | "reporting") =>
    groups.reduce((n, g) => n + g[k], 0);
  const max = Math.max(1, ...groups.map((g) => g.total));
  const silent = sum("contracts") - sum("reporting");

  return (
    <>
      <TopBar session={session} />
      <main className="page">
        <div className="head">
          <div className="grow">
            <div className="crumbs">All groups</div>
            <h1>Manpower overview</h1>
            <div className="muted small">{prettyDate(date)}</div>
          </div>
          <DatePicker date={date} />
        </div>

        <div className="kpis">
          <Kpi label="Workers checked in" value={sum("total")} sub={`across ${sum("contracts")} sites`} />
          <Kpi label="Still on site" value={sum("still_on_site")} />
          <Kpi label="Unwell" value={sum("unwell")} tone={sum("unwell") ? "bad" : undefined}
               sub={`${pct(sum("unwell"), sum("total"))} of workers`} />
          <Kpi label="Sites reporting" value={`${sum("reporting")}/${sum("contracts")}`}
               tone={silent ? "warn" : undefined} sub={silent ? `${silent} with no check-ins` : "all sites reporting"} />
        </div>

        <div className="grid cols-2">
          <section className="card">
            <h2>By group</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Group</th><th className="barcell"></th><th className="num">Workers</th>
                    <th className="num">On site</th><th className="num">Unwell</th><th className="num">Sites</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.code}>
                      <td><Link href={withDate(`/authority/g/${g.code}`, date)}><b>{g.code}</b></Link>
                        <div className="small muted">{g.name}</div></td>
                      <td className="barcell"><Bar value={g.total} max={max} /></td>
                      <td className="num"><b>{g.total}</b></td>
                      <td className="num">{g.still_on_site}</td>
                      <td className="num">{g.unwell ? <span className="pill bad">{g.unwell}</span> : 0}</td>
                      <td className="num">{g.reporting}/{g.contracts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>Last 14 days — all sites</h2>
            <TrendChart points={points} />
          </section>
        </div>
      </main>
    </>
  );
}
