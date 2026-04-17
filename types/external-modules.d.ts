/**
 * Shims so `tsc` can resolve optional deps when `node_modules` is incomplete locally.
 * Prefer a real `npm install` — see package.json.
 */
declare module "@solana/spl-token";
declare module "@supabase/supabase-js";
