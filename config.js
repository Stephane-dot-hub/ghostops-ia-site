// /config.js — GhostOps (navigateur / site statique)
// Doit être chargé APRÈS supabase-js v2

(function () {
  // ✅ 1) Renseignez vos valeurs réelles (Supabase > Project Settings > API)
  // Exemple: https://xxxx.supabase.co
  window.SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";

  // Exemple: eyJhbGciOi...
  window.SUPABASE_ANON_KEY = "VOTRE_ANON_PUBLIC_KEY";

  // ✅ 2) Garde-fou
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("[GhostOps] config.js: SUPABASE_URL / SUPABASE_ANON_KEY manquants.");
    return;
  }

  if (!window.supabase?.createClient) {
    console.error("[GhostOps] supabase-js non chargé avant config.js.");
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

  console.log("[GhostOps] Supabase client OK");
})();
