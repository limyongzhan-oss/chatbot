import { notFound } from "next/navigation";
import { asService } from "@/lib/db";
import { checkIn, checkOut, finish, identify, readClaim, rememberedLast4 } from "./actions";

const ERRORS: Record<string, string> = {
  format: "Enter the last 4 characters of your NRIC/FIN (e.g. 567A) and your 4-digit PIN.",
  nomatch: "We couldn't find you on this site. Check your NRIC/FIN last 4 and PIN, or see your supervisor.",
  expired: "Your session timed out. Please enter your details again.",
  missing: "Please choose Start or Mid, and whether you are feeling well.",
  consent: "Please tick the consent box to continue.",
};

type State = {
  name: string; subcontractor: string; consent_at: Date | null;
  checkin_type: string | null; checked_in: string | null; checked_out: string | null; status: string | null;
};

export default async function CheckinPage({ params, searchParams }: {
  params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }>;
}) {
  const { token } = await params;
  const { e } = await searchParams;

  const contract = await asService(async (c) =>
    (await c.query<{ id: number; code: string; name: string }>(
      "select id, code, name from contracts where checkin_token = $1", [token],
    )).rows[0],
  );
  if (!contract) notFound();

  const claim = await readClaim(token, contract.id);
  const state = claim && await asService(async (c) =>
    (await c.query<State>(
      `select w.name, s.name as subcontractor, w.consent_at, a.checkin_type, h.status,
              to_char(a.checked_in_at at time zone 'Asia/Singapore', 'HH24:MI') as checked_in,
              to_char(a.checked_out_at at time zone 'Asia/Singapore', 'HH24:MI') as checked_out
       from workers w
       join subcontractors s on s.id = w.subcontractor_id
       left join attendance a on a.worker_id = w.id and a.work_date = (now() at time zone 'Asia/Singapore')::date
       left join health_reports h on h.attendance_id = a.id
       where w.id = $1 and w.contract_id = $2`,
      [claim.wid, contract.id],
    )).rows[0],
  );

  return (
    <main className="narrow">
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <div className="logo" style={{ color: "var(--brand)", fontSize: 24 }}>d<span>TBM</span></div>
        <h1 style={{ marginTop: 6 }}>{contract.code}</h1>
        <div className="muted">{contract.name}</div>
      </div>

      <div className="card">
        {e && ERRORS[e] && <div className="err">{ERRORS[e]}</div>}
        {!state ? <Identify token={token} last4={await rememberedLast4()} /> : (
          <>
            <p style={{ marginTop: 0 }}>
              <b style={{ fontSize: 18 }}>{state.name}</b><br />
              <span className="muted small">{state.subcontractor}</span>
            </p>
            {!state.checked_in && <CheckInForm token={token} needConsent={!state.consent_at} />}
            {state.checked_in && !state.checked_out && (
              <>
                <div className="big-status">
                  <div className="icon">🦺</div>
                  <h2>Checked in at {state.checked_in}</h2>
                  <p className="muted">{state.checkin_type === "mid" ? "Mid-day" : "Start of day"} check-in
                    {state.status === "unwell" && " · reported unwell — please tell your supervisor"}</p>
                </div>
                <form action={checkOut}>
                  <input type="hidden" name="token" value={token} />
                  <button className="btn big danger" type="submit">Check out — leaving site</button>
                </form>
              </>
            )}
            {state.checked_out && (
              <div className="big-status">
                <div className="icon">✅</div>
                <h2>Checked out at {state.checked_out}</h2>
                <p className="muted">In at {state.checked_in}. Have a safe trip home.</p>
              </div>
            )}
            <form action={finish} style={{ marginTop: 12 }}>
              <input type="hidden" name="token" value={token} />
              <button className="btn ghost" style={{ width: "100%" }} type="submit">Done · Not me</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

function Identify({ token, last4 }: { token: string; last4: string }) {
  return (
    <form action={identify}>
      <input type="hidden" name="token" value={token} />
      <label className="field">NRIC/FIN — last 4 characters
        <input name="last4" defaultValue={last4} placeholder="e.g. 567A" maxLength={4} required
               autoCapitalize="characters" autoComplete="off" style={{ fontSize: 20, letterSpacing: 4 }} />
      </label>
      <label className="field">PIN
        <input name="pin" type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required
               placeholder="••••" style={{ fontSize: 20, letterSpacing: 6 }} />
      </label>
      <button className="btn big" type="submit">Continue</button>
      <p className="small muted" style={{ marginBottom: 0 }}>Forgot your PIN? See your supervisor.</p>
    </form>
  );
}

function CheckInForm({ token, needConsent }: { token: string; needConsent: boolean }) {
  return (
    <form action={checkIn}>
      <input type="hidden" name="token" value={token} />
      <div className="small" style={{ fontWeight: 600 }}>Check-in type</div>
      <div className="choice">
        <input type="radio" id="t-start" name="type" value="start" defaultChecked />
        <label htmlFor="t-start">Start of day</label>
        <input type="radio" id="t-mid" name="type" value="mid" />
        <label htmlFor="t-mid">Mid-day</label>
      </div>

      <div className="small" style={{ fontWeight: 600 }}>Are you feeling well today?</div>
      <div className="choice">
        <input type="radio" id="h-well" className="well" name="health" value="well" required />
        <label htmlFor="h-well">👍 Yes, well</label>
        <input type="radio" id="h-unwell" className="unwell" name="health" value="unwell" />
        <label htmlFor="h-unwell">🤒 Not well</label>
      </div>
      <label className="field">If not well, what&apos;s wrong? <span className="muted">(optional)</span>
        <textarea name="remarks" maxLength={300} placeholder="e.g. fever, headache" />
      </label>

      {needConsent && (
        <label className="consent">
          <input type="checkbox" name="consent" required />
          <span>I agree that my name, NRIC/FIN last 4 and daily health status are collected to manage site
            safety, and shared with my main contractor and the site authority.</span>
        </label>
      )}
      <button className="btn big good" type="submit">Check in</button>
    </form>
  );
}
