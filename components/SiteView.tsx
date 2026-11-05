import type { AlertCounts, PersonRow, SubconRow, Totals, TrendPoint } from "@/lib/queries";
import { Bar, Kpi, pct } from "./ui";
import { TrendChart } from "./TrendChart";

export type SiteData = {
  totals: Totals;
  subcons: SubconRow[];
  unwell: PersonRow[];
  notExited: PersonRow[];
  trend: TrendPoint[];
};

export function AlertBadge({ a }: { a: AlertCounts }) {
  if (a.alerts_failed) return <span className="pill bad" title="Delivery failed — see alert log">Failed {a.alerts_failed}</span>;
  if (a.alerts_pending) return <span className="pill">Sending…</span>;
  if (a.alerts_sent) return <span className="pill good" title="Delivered to recipients">✓ Sent {a.alerts_sent}</span>;
  if (a.alerts_logged) return <span className="pill" title="Demo mode: message recorded, not sent">Demo {a.alerts_logged}</span>;
  return <span className="pill warn" title="No active alert recipients">None</span>;
}

/** One site's day: shared by the contractor page and the authority drill-down. */
export function SiteView({ data, isToday, followUp }: {
  data: SiteData;
  isToday: boolean;
  /** Server action to toggle follow-up. Only the site's own contractor gets this. */
  followUp?: (formData: FormData) => Promise<void>;
}) {
  const { totals, subcons, unwell, notExited, trend } = data;
  const roster = subcons.reduce((n, s) => n + s.roster, 0);
  const max = Math.max(1, ...subcons.map((s) => s.total));
  const open = unwell.filter((u) => !u.followed_up).length;

  return (
    <>
      <div className="kpis">
        <Kpi label="Checked in" value={totals.total} sub={`${totals.start} start · ${totals.mid} mid · ${pct(totals.total, roster)} of roster`} />
        <Kpi label={isToday ? "Still on site" : "Not checked out"} value={totals.still_on_site}
             tone={!isToday && totals.still_on_site > 0 ? "warn" : undefined}
             sub={`${totals.total - totals.still_on_site} checked out`} />
        <Kpi label="Unwell" value={totals.unwell} tone={totals.unwell > 0 ? "bad" : undefined}
             sub={`${pct(totals.unwell, totals.total)} of workers${open ? ` · ${open} open` : ""}`} />
        <Kpi label="Subcontractors" value={subcons.filter((s) => s.total > 0).length} sub={`of ${subcons.length} on roster`} />
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h2>Manpower by subcontractor</h2>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Subcontractor</th><th className="barcell"></th>
                  <th className="num">In</th><th className="num">Start</th><th className="num">Mid</th>
                  <th className="num">On site</th><th className="num">Unwell</th>
                </tr>
              </thead>
              <tbody>
                {subcons.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}<div className="small muted">{s.trade} · roster {s.roster}</div></td>
                    <td className="barcell"><Bar value={s.total} max={max} /></td>
                    <td className="num"><b>{s.total}</b></td>
                    <td className="num">{s.start}</td>
                    <td className="num">{s.mid}</td>
                    <td className="num">{s.still_on_site}</td>
                    <td className="num">{s.unwell > 0 ? <span className="pill bad">{s.unwell}</span> : 0}</td>
                  </tr>
                ))}
                <tr>
                  <td><b>Total</b></td><td></td>
                  <td className="num"><b>{totals.total}</b></td><td className="num">{totals.start}</td>
                  <td className="num">{totals.mid}</td><td className="num">{totals.still_on_site}</td>
                  <td className="num"><b>{totals.unwell}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <h2>Last 14 days</h2>
          <TrendChart points={trend} />
        </section>

        <section className="card">
          <h2>Unwell workers <span className="pill bad">{unwell.length}</span></h2>
          {unwell.length === 0 ? <p className="empty">Nobody reported unwell.</p> : (
            <div className="tablewrap list">
              <table>
                <thead><tr><th>Worker</th><th>Subcontractor</th><th>In</th><th>Remarks</th><th>Alert</th><th>Follow-up</th></tr></thead>
                <tbody>
                  {unwell.map((u) => (
                    <tr key={u.attendance_id}>
                      <td>{u.name}<div className="small muted">…{u.id_last4} · {u.trade}</div></td>
                      <td>{u.subcontractor}</td>
                      <td className="tnum">{u.checked_in}</td>
                      <td>{u.remarks ?? <span className="muted">–</span>}</td>
                      <td><AlertBadge a={u} /></td>
                      <td>
                        {followUp ? (
                          <form action={followUp}>
                            <input type="hidden" name="id" value={u.health_id ?? ""} />
                            <button className={`btn small ${u.followed_up ? "ghost" : ""}`} type="submit">
                              {u.followed_up ? "✓ Done" : "Mark done"}
                            </button>
                          </form>
                        ) : u.followed_up ? <span className="pill good">Done</span> : <span className="pill warn">Open</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <h2>
            {isToday ? "Not yet exited" : "Never checked out"}{" "}
            <span className={`pill ${notExited.length && !isToday ? "warn" : ""}`}>{notExited.length}</span>
          </h2>
          {notExited.length === 0 ? <p className="empty">Everyone has checked out.</p> : (
            <div className="tablewrap list">
              <table>
                <thead><tr><th>Worker</th><th>Subcontractor</th><th>Type</th><th>In</th></tr></thead>
                <tbody>
                  {notExited.map((p) => (
                    <tr key={p.attendance_id}>
                      <td>{p.name}<div className="small muted">…{p.id_last4}</div></td>
                      <td>{p.subcontractor}</td>
                      <td>{p.checkin_type === "mid" ? <span className="pill">Mid</span> : "Start"}</td>
                      <td className="tnum">{p.checked_in}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
