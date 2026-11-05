import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { asUser } from "@/lib/db";
import { getContract } from "@/lib/queries";
import { loadSite } from "@/lib/site";
import { pickDate, prettyDate, todaySG } from "@/lib/dates";
import { DatePicker, TopBar, withDate } from "@/components/ui";
import { SiteView } from "@/components/SiteView";

export default async function AuthorityContractPage({ params, searchParams }: {
  params: Promise<{ code: string }>; searchParams: Promise<{ date?: string }>;
}) {
  const session = await requireRole("authority");
  const code = (await params).code.toUpperCase();
  const date = pickDate((await searchParams).date);

  const result = await asUser(session.uid, async (c) => {
    const contract = await getContract(c, { code });
    if (!contract) return null;
    const data = await loadSite(c, contract.id, date);
    // PDPA: record that the authority viewed named health data for this site.
    await c.query(
      "insert into audit_log (user_id, action, contract_id) values ($1, $2, $3)",
      [session.uid, `view_site_names:${date}`, contract.id],
    );
    return { contract, data };
  });
  if (!result) notFound();
  const { contract, data } = result;

  return (
    <>
      <TopBar session={session} />
      <main className="page">
        <div className="head">
          <div className="grow">
            <div className="crumbs">
              <Link href={withDate("/authority", date)}>All groups</Link> ›{" "}
              <Link href={withDate(`/authority/g/${contract.group_code}`, date)}>{contract.group_code}</Link> › {contract.code}
            </div>
            <h1>{contract.code} — {contract.name}</h1>
            <div className="muted small">{contract.main_contractor} · {contract.site_address} · {prettyDate(date)}</div>
          </div>
          <DatePicker date={date} />
        </div>
        <SiteView data={data} isToday={date === todaySG()} />
        <p className="small muted" style={{ marginTop: 16 }}>Your access to worker names on this page is logged.</p>
      </main>
    </>
  );
}
