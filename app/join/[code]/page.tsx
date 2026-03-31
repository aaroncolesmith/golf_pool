import { JoinPoolPage } from "@/components/join-pool-page";

export default async function JoinCodePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <JoinPoolPage code={code} />;
}
