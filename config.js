// /config.js — GhostOps (navigateur / site statique)
// Doit être chargé APRÈS supabase-js v2

(function () {
  // ✅ 1) Paramètres Supabase (Settings > API Keys)
  window.SUPABASE_URL = "https://isrxjzaphaciwdaxbylt.supabase.co";

  // ✅ Clé publique (nouveau format Supabase) — OK côté navigateur
  window.SUPABASE_ANON_KEY = "sb_publishable_tF5NE6f0LBgwIY9wkf7Mbg_608SvdPY";

  // ✅ 2) Garde-fous
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("[GhostOps] config.js: SUPABASE_URL / SUPABASE_ANON_KEY manquants.");
    return;
  }

  if (typeof window.SUPABASE_URL !== "string" || !window.SUPABASE_URL.startsWith("https://")) {
    console.error("[GhostOps] config.js: SUPABASE_URL invalide:", window.SUPABASE_URL);
    return;
  }

  if (!window.supabase?.createClient) {
    console.error("[GhostOps] config.js: supabase-js non chargé avant config.js.");
    return;
  }

  // ✅ 3) Client unique global
  window.ghostopsSupabase = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  );

  // ✅ 4) Trace légère (utile en debug)
  console.log("[GhostOps] Supabase client OK", {
    url: window.SUPABASE_URL,
    keyPrefix: String(window.SUPABASE_ANON_KEY).slice(0, 14) + "…",
  });
})();
