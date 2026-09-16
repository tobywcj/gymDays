// Server-side Supabase client. Reads/writes the session cookie via Next's cookies() API.
// Use in Server Components, Route Handlers, and Server Actions.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll throws inside Server Components — safe to ignore;
            // middleware refreshes the session cookies in that case.
          }
        },
      },
    },
  );
}
