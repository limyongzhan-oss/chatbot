import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { contractsInGroup, groupName, trend } from "@/lib/queries";
import { pickDate, prettyDate } from "@/lib/dates";
import { Bar, DatePicker, Kpi, TopBar, pct, withDate } from "@/components/ui";
import { TrendChart } from "@/components/TrendChart";

export default async function GroupPage({ params, searchParams }: {
  params: Promise<{ code: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireRole("authority");
  const code = (await params).code.toUpperCase();
  const date = pickDate((await searchParams).date);

  const data = await asUser(session.uid, async (c) => {
    const name = await groupName(c, code);
    if (!name) return null;
    return { name, contracts: await contractsInGroup(c, code, date), points: await trend(c, date, { groupCode: code }) };
  });
  if (!data) notFound();

  const { name, contracts, points } = data;
  const total = contracts.reduce((n, r) => n + r.total, 0);
  const unwell = contracts.reduce((n, r) => n + r.unwell, 0);
  const onSite = contracts.reduce((n, r) => n + r.still_on_site, 0);
  const max = Math.max(1, ...contracts.map((r) => r.total));

  return (
    <>
      <TopBar session={session} />
      <main className="page">
        <div className="head">
          <div className="grow">
            <div className="crumbs"><Link href={withDate("/authority", date)}>All groups</Link> › {code}</div>
            <h1>{code} — {name}</h1>
            <div className="muted small">{prettyDate(date)}</div>
          </div>
          <DatePicker date={date} />
        </div>

        <div className="kpis">
          <Kpi label="Workers checked in" value={total} sub={`${contracts.length} contracts`} />
          <Kpi label="Still on site" value={onSite} />
          <Kpi label="Unwell" value={unwell} tone={unwell ? "bad" : undefined} sub={`${pct(unwell, total)} of workers`} />
        </div>

        <div className="grid cols-2">
          <section className="card">
            <h2>By contract</h2>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>Contract</th><th className="barcell"></th><th className="num">In</th>
                    <th className="num">Start</th><th className="num">Mid</th>
                    <th className="num">On site</th><th className="num">Unwell</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((r) => (
                    <tr key={r.code}>
                      <td><Link href={withDate(`/authority/c/${r.code}`, date)}><b>{r.code}</b></Link>
                        <div className="small muted">{r.main_contractor} · {r.subcons} subcons</div></td>
                      <td className="barcell"><Bar value={r.total} max={max} /></td>
                      <td className="num"><b>{r.total}</b></td>
                      <td className="num">{r.start}</td>
                      <td className="num">{r.mid}</td>
                      <td className="num">{r.still_on_site}</td>
                      <td className="num">{r.unwell ? <span className="pill bad">{r.unwell}</span> : 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card">
            <h2>Last 14 days — {code}</h2>
            <TrendChart points={points} />
          </section>
        </div>
      </main>
    </>
  );
}
