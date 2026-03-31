import { PoolPage } from "@/components/pool-page";

export default async function PoolDetailsPage({
  params,
}: {
  params: Promise<{ poolId: string }>;
}) {
  const { poolId } = await params;
  return <PoolPage poolId={poolId} />;
}
