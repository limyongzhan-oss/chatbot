import { login } from "../actions";

const DEMO = [
  ["authority@dtbm.demo", "Authority — all groups & sites"],
  ["jl111@dtbm.demo", "Contractor — JL111 only"],
  ["cr112@dtbm.demo", "Contractor — CR112 only"],
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <main className="narrow">
      <div style={{ textAlign: "center", margin: "24px 0" }}>
        <div className="logo" style={{ color: "var(--brand)", fontSize: 32 }}>d<span>TBM</span></div>
        <p className="muted">Site manpower &amp; worker wellness</p>
      </div>
      <form action={login} className="card">
        {e && <div className="err">Wrong email or password.</div>}
        <label className="field">Email<input name="email" type="email" required autoComplete="username" /></label>
        <label className="field">Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn big" type="submit">Log in</button>
      </form>
      <div className="card small" style={{ marginTop: 16 }}>
        <b>Demo accounts</b> (password <code>demo1234</code>)
        <ul style={{ paddingLeft: 18, margin: "8px 0 0" }}>
          {DEMO.map(([email, label]) => <li key={email}><code>{email}</code> — {label}</li>)}
        </ul>
        <p className="muted" style={{ marginBottom: 0 }}>Any contract works: jl111–jl113, cr111–cr113.</p>
      </div>
    </main>
  );
}
