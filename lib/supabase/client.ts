"use client";

import "@/lib/local-storage-shim";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

let browserClient: SupabaseClient | null = null;
let browserClientPromise: Promise<SupabaseClient> | null = null;

export async function getSupabaseBrowserClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are missing.");
  }

  const url = supabaseUrl;
  const anonKey = supabaseAnonKey;

  if (!browserClient) {
    browserClientPromise ??= import("@supabase/ssr").then(({ createBrowserClient }) => {
      browserClient = createBrowserClient(url, anonKey);
      return browserClient;
    });
    browserClient = await browserClientPromise;
  }

  return browserClient;
}
