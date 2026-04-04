import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

/**
 * DELETE /api/pools/[id]
 *
 * Deletes a single pool. The requesting user must be the pool admin.
 * Only the pool is deleted — the tournament and golfers are untouched.
 *
 * Response:
 *   { ok: true }
 *   { ok: false, error: string }
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ ok: false, error: "Pool ID is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  // Verify the user is the pool admin
  const { data: pool, error: poolError } = await supabase
    .from("pools")
    .select("id, admin_user_id")
    .eq("id", id)
    .maybeSingle();

  if (poolError) {
    return NextResponse.json({ ok: false, error: "Failed to load pool." }, { status: 500 });
  }

  if (!pool) {
    return NextResponse.json({ ok: false, error: "Pool not found." }, { status: 404 });
  }

  if (pool.admin_user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Only the pool admin can delete this pool." }, { status: 403 });
  }

  // Use service-role client to bypass RLS for the delete
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { error: deleteError } = await adminClient
    .from("pools")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json(
      { ok: false, error: `Failed to delete pool: ${deleteError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
