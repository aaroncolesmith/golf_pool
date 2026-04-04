import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * DELETE /api/tournaments/[id]
 *
 * Deletes a tournament. The requesting user must be the admin of at least one
 * pool associated with this tournament.
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
    return NextResponse.json({ ok: false, error: "Tournament ID is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  // Verify authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  }

  // Verify the user is admin of a pool associated with this tournament
  const { data: adminPool, error: poolError } = await supabase
    .from("pools")
    .select("id")
    .eq("tournament_id", id)
    .eq("admin_user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (poolError) {
    console.error("[delete-tournament] Pool query error:", poolError);
    return NextResponse.json({ ok: false, error: "Failed to verify authorization." }, { status: 500 });
  }

  if (!adminPool) {
    return NextResponse.json({ ok: false, error: "Not authorized to delete this tournament." }, { status: 403 });
  }

  // Delete the tournament
  const { error: deleteError } = await supabase
    .from("tournaments")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("[delete-tournament] Delete error:", deleteError);
    return NextResponse.json(
      { ok: false, error: `Failed to delete tournament: ${deleteError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
