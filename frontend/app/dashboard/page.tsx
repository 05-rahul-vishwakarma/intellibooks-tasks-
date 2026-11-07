import DashboardClient from "@/components/DashboardClient";

export default function DashboardPage({
  searchParams,
}: {
  searchParams?: { doc?: string | string[] };
}) {
  const raw = searchParams?.doc;
  const initialDocId = Array.isArray(raw) ? raw[0] ?? null : raw ?? null;

  return <DashboardClient initialDocId={initialDocId} />;
}
