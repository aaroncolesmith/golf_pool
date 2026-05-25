import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/pools/preview?code=XXXXXX
 *
 * Returns public preview info for a pool by join code.
 * Uses service role to bypass RLS so unauthenticated users can see pool
 * name and description before signing in to join.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code")?.trim().toUpperCase();

  if (!code) {
    return NextResponse.json({ ok: false, error: "code is required" }, { status: 400 });
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: pool, error } = await adminClient
    .from("pools")
    .select("id,name,description,is_public")
    .eq("join_code", code)
    .maybeSingle();

  if (error || !pool) {
    return NextResponse.json({ ok: false, error: "Pool not found" }, { status: 404 });
  }

  const { count } = await adminClient
    .from("pool_members")
    .select("*", { count: "exact", head: true })
    .eq("pool_id", pool.id);

  return NextResponse.json({
    ok: true,
    pool: {
      id: pool.id,
      name: pool.name,
      description: pool.description ?? null,
      isPublic: pool.is_public,
      memberCount: count ?? 0,
    },
  });
}
