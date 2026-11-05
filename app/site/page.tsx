import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getContract } from "@/lib/queries";
import { loadSite } from "@/lib/site";
import { pickDate, prettyDate, todaySG } from "@/lib/dates";
import { DatePicker, TopBar } from "@/components/ui";
import { SiteView } from "@/components/SiteView";

async function toggleFollowUp(formData: FormData) {
  "use server";
  const s = await requireRole("contractor");
  const id = Number(formData.get("id"));
  if (!id) return;
  // RLS policy health_followup only lets a contractor update its own site's rows.
  await asUser(s.uid, (c) =>
    c.query("update health_reports set followed_up = not followed_up where id = $1", [id]),
  );
  revalidatePath("/site");
}

export default async function SitePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const session = await requireRole("contractor");
  const date = pickDate((await searchParams).date);

  const { contract, data } = await asUser(session.uid, async (c) => {
    const contract = await getContract(c, { id: session.cid! });
    if (!contract) throw new Error("Contract not visible to this user");
    return { contract, data: await loadSite(c, contract.id, date) };
  });

  return (
    <>
      <TopBar session={session} />
      <main className="page">
        <div className="head">
          <div className="grow">
            <div className="crumbs">{contract.group_name} · {contract.main_contractor}</div>
            <h1>{contract.code} — {contract.name}</h1>
            <div className="muted small">{prettyDate(date)} · {contract.site_address}</div>
          </div>
          <Link className="btn ghost noprint" href="/site/qr">Site check-in QR</Link>
          <DatePicker date={date} />
        </div>
        <SiteView data={data} isToday={date === todaySG()} followUp={toggleFollowUp} />
      </main>
    </>
  );
}
