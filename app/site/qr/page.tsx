import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireRole } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getContract } from "@/lib/queries";
import { TopBar } from "@/components/ui";

export default async function QrPage() {
  const session = await requireRole("contractor");
  const contract = await asUser(session.uid, (c) => getContract(c, { id: session.cid! }));
  if (!contract) throw new Error("Contract not visible to this user");

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const url = `${proto}://${h.get("host")}/checkin/${contract.checkin_token}`;
  const img = await QRCode.toDataURL(url, { width: 600, margin: 1 });

  return (
    <>
      <TopBar session={session} />
      <main className="narrow">
        <div className="card qr">
          <div className="logo" style={{ color: "var(--brand)", fontSize: 26 }}>d<span>TBM</span></div>
          <h1 style={{ margin: "8px 0 4px" }}>{contract.code} check-in</h1>
          <p className="muted" style={{ marginTop: 0 }}>{contract.name}</p>
          <img src={img} alt={`QR code for ${url}`} />
          <p><b>Scan to check in or check out.</b><br />
            <span className="muted small">Have your NRIC/FIN last 4 and PIN ready.</span></p>
          <p className="small muted" style={{ wordBreak: "break-all" }}>{url}</p>
        </div>
        <div className="noprint" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Link className="btn ghost" href="/site">← Dashboard</Link>
          <Link className="btn ghost" href={`/checkin/${contract.checkin_token}`}>Open check-in page</Link>
        </div>
      </main>
    </>
  );
}
