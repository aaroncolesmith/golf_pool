export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabaseEnabled = process.env.NEXT_PUBLIC_ENABLE_SUPABASE === "true";
export const magicLinkPreviewEnabled = process.env.NEXT_PUBLIC_ENABLE_MAGIC_LINK_PREVIEW === "true";

export function isSupabaseConfigured() {
  return Boolean(supabaseEnabled && supabaseUrl && supabaseAnonKey);
}
