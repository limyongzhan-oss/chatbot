import Link from "next/link";
import { logout } from "@/app/actions";
import type { Session } from "@/lib/session";

export function TopBar({ session }: { session: Session }) {
  return (
    <header className="topbar">
      <Link href="/" className="logo">d<span>TBM</span></Link>
      <span className="small" style={{ opacity: 0.8 }}>
        {session.role === "authority" ? "Authority" : "Contractor"}
      </span>
      <div className="who">
        <span>{session.email}</span>
        <form action={logout}><button type="submit">Log out</button></form>
      </div>
    </header>
  );
}

export function Kpi({ label, value, sub, tone }: {
  label: string; value: number | string; sub?: string; tone?: "bad" | "warn";
}) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value tnum">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function DatePicker({ date }: { date: string }) {
  return (
    <form className="inline noprint" method="get">
      <input type="date" name="date" defaultValue={date} aria-label="Date" />
      <button className="btn ghost" type="submit">View</button>
    </form>
  );
}

export function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return <div className="bar"><div style={{ width: `${w}%` }} /></div>;
}

export function pct(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "–";
}

export function withDate(href: string, date: string) {
  return `${href}?date=${date}`;
}
