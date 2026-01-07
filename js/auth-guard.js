/* GhostOps — Auth Guard centralisé (v2 : durci + anti-loop + diagnostics)
   Objectifs :
   - Décision claire (OK/KO) + signal à la page via event "ghostops:auth"
   - Tolérer le cas où Supabase n'est pas encore prêt
   - Gérer proprement “magic link ouvert dans un autre navigateur”
   - Éviter les boucles (connexion -> index -> connexion, etc.)
   - Donner des raisons stables (reason codes) pour vos redirections/logs

   Dépendances :
   - window.GHOSTOPS_NIVEAU_PRODUIT = "diagnostic" | "studio" | "pre-brief"
   - window.ghostopsSupabase créé par /config.js
*/

(async function ghostopsAuthGuard() {
  const niveauProduit = window.GHOSTOPS_NIVEAU_PRODUIT; // "diagnostic" | "studio" | "pre-brief"
  const DEBUG =
    String(new URLSearchParams(window.location.search).get("debug") || "") === "1" ||
    String(localStorage.getItem("ghostops_debug_auth") || "") === "1";

  const NOW = Date.now();
  const PATH = window.location.pathname || "";

  function log(...args) {
    if (DEBUG) console.log("[GhostOps AuthGuard]", ...args);
  }

  function emit(ok, reason, extra) {
    try {
      window.dispatchEvent(
        new CustomEvent("ghostops:auth", {
          detail: { ok: !!ok, reason: reason || "", ts: Date.now(), path: PATH, ...(extra || {}) },
        })
      );
    } catch (_) {}
  }

  // Anti-loop simple : si on redirige trop souvent en peu de temps, on stoppe.
  // (évite les cas "connexion -> index -> connexion" quand une page est mal câblée)
  function bumpRedirectCounter(target) {
    try {
      const key = "ghostops_auth_redirects";
      const raw = localStorage.getItem(key);
      const obj = raw ? JSON.parse(raw) : { c: 0, t: 0, last: "" };
      const elapsed = NOW - (obj.t || 0);

      const next = {
        c: elapsed < 15000 ? (Number(obj.c || 0) + 1) : 1, // reset si >15s
        t: NOW,
        last: String(target || ""),
      };

      localStorage.setItem(key, JSON.stringify(next));
      return next.c;
    } catch (_) {
      return 0;
    }
  }

  function allowRedirect(target) {
    const count = bumpRedirectCounter(target);
    if (count >= 4) {
      // stop : trop de redirections
      emit(false, "redirect_loop_guard", { target, count });
      log("Loop guard activé :", { target, count });
      return false;
    }
    return true;
  }

  function buildNext() {
    return encodeURIComponent(window.location.pathname + window.location.search);
  }

  function goConnexion(reason, extra) {
    const next = buildNext();
    const params = new URLSearchParams();
    params.set("next", next);
    if (reason) params.set("reason", reason);
    if (DEBUG) params.set("debug", "1");
    if (extra && typeof extra === "object") {
      // petit diagnostic (sans données sensibles)
      if (extra.niveauProduit) params.set("np", String(extra.niveauProduit));
    }

    const url = `/connexion.html?${params.toString()}`;
    if (!allowRedirect(url)) return;
    window.location.assign(url);
  }

  function goProduit(reason) {
    const map = {
      diagnostic: "/diagnostic-ia.html",
      studio: "/studio-scenarios.html",
      "pre-brief": "/pre-brief-board.html",
    };

    const target = map[niveauProduit] || "/index.html";
    const params = new URLSearchParams();
    if (reason) params.set("reason", reason);
    if (DEBUG) params.set("debug", "1");

    const url = params.toString() ? `${target}?${params.toString()}` : target;
    if (!allowRedirect(url)) return;
    window.location.assign(url);
  }

  // 0) Pré-check niveau
  if (!niveauProduit) {
    console.error("GhostOps Auth Guard — niveau_produit non défini (window.GHOSTOPS_NIVEAU_PRODUIT)");
    emit(false, "missing_niveau_produit");
    // Pas de redirection automatique : évite boucles si page mal configurée
    return;
  }

  // 1) Récupérer le client Supabase centralisé (créé dans config.js)
  let supabase = window.ghostopsSupabase;

  // Attente courte : config.js peut arriver après
  if (!supabase || !supabase.auth) {
    const t0 = Date.now();
    while ((!supabase || !supabase.auth) && Date.now() - t0 < 1500) {
      await new Promise((r) => setTimeout(r, 50));
      supabase = window.ghostopsSupabase;
    }
  }

  if (!supabase || !supabase.auth) {
    console.error("GhostOps Auth Guard — window.ghostopsSupabase introuvable (config.js non chargé ?)");
    emit(false, "supabase_missing");
    goConnexion("supabase_missing", { niveauProduit });
    return;
  }

  // 2) Session obligatoire (on essaie aussi refreshSession si dispo)
  let session = null;

  try {
    // getSession suffit dans la plupart des cas
    const { data: sessData, error: sessErr } = await supabase.auth.getSession();
    session = sessData?.session || null;
    if (sessErr) log("getSession error:", sessErr);

    // Si pas de session, on tente un refresh silencieux (utile si tokens présents)
    if (!session?.user?.id && typeof supabase.auth.refreshSession === "function") {
      try {
        const { data: refData, error: refErr } = await supabase.auth.refreshSession();
        if (refErr) log("refreshSession error:", refErr);
        session = refData?.session || session;
      } catch (e) {
        log("refreshSession exception:", e);
      }
    }
  } catch (e) {
    console.error("GhostOps Auth Guard — exception getSession/refreshSession:", e);
  }

  if (!session?.user?.id) {
    // Magic link ouvert dans un autre navigateur / session absente / expirée
    emit(false, "no_session");
    goConnexion("no_session", { niveauProduit });
    return;
  }

  const userId = session.user.id;

  // 3) Vérification droits (table : droits)
  // Colonnes attendues : user_id, niveau_produit, statut, revoked_at
  // NB : on sélectionne aussi "created_at" utile en debug
  let droit = null;

  try {
    const q = supabase
      .from("droits")
      .select("id, statut, niveau_produit, revoked_at, created_at")
      .eq("user_id", userId)
      .eq("niveau_produit", niveauProduit)
      .eq("statut", "actif")
      .is("revoked_at", null);

    const { data, error } = await q.maybeSingle();

    if (error) {
      console.warn("GhostOps Auth Guard — erreur check droits:", error);
      emit(false, "right_check_error", { error: String(error.message || error) });
      // Erreur technique : on renvoie vers produit (plus logique que bloquer)
      goProduit("right_check_error");
      return;
    }

    droit = data || null;
  } catch (e) {
    console.error("GhostOps Auth Guard — exception check droits:", e);
    emit(false, "right_check_exception", { error: String(e?.message || e) });
    goProduit("right_check_error");
    return;
  }

  if (!droit) {
    emit(false, "no_right", { userId, niveauProduit });
    goProduit("no_right");
    return;
  }

  // 4) OK
  log("Accès autorisé:", { niveauProduit, userId, droitId: droit.id });
  emit(true, "authorized", { userId, niveauProduit, droitId: droit.id });
})();
