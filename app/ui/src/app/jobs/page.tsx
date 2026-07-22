"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import TopBar from "@/components/TopBar";
import StatusBadge from "@/components/StatusBadge";
import { useLocale } from "@/components/LocaleProvider";

export default function JobsList() {
  const { t } = useLocale();
  const [jobs, setJobs] = useState<any[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/jobs").then((r) => r.json()).then((d) => setJobs(d.jobs || []));
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <TopBar title="Jobs">
        <Link href="/jobs/new" className="btn btn-primary">+ New</Link>
      </TopBar>
      <div className="p-5">
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-neutral-500 text-xs">
              <tr className="border-b border-edge">
                <th className="text-left px-4 py-2 font-medium">{t("jobs.colName")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("jobs.colStatus")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("jobs.colProgress")}</th>
                <th className="text-left px-4 py-2 font-medium">{t("jobs.colInfo")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-edge hover:bg-panel2">
                  <td className="px-4 py-2.5">
                    <Link href={`/jobs/${j.id}`} className="text-blue-300 hover:underline">{j.name}</Link>
                  </td>
                  <td className="px-4 py-2.5"><StatusBadge status={j.status} /></td>
                  <td className="px-4 py-2.5 text-neutral-400">
                    {j.total_steps > 0 ? `${j.step}/${j.total_steps}` : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-neutral-500 truncate max-w-md">{j.info}</td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-neutral-500">{t("jobs.empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
