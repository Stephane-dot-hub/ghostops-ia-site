/* GhostOps — Auth Guard centralisé (corrigé + robustifié)
   Objectifs :
   - Ne PAS “tourner en rond” : decision claire (OK / KO) + signal à la page via event "ghostops:auth"
   - Tolérer le cas où Supabase n'est pas encore prêt (config.js chargé mais client non initialisé)
   - Gérer proprement le cas “ouverture du magic link dans un autre navigateur” (session absente)
*/

(async function ghostopsAuthGuard() {
  const niveauProduit = window.GHOSTOPS_NIVEAU_PRODUIT; // "diagnostic" | "studio" | "pre-brief"

  function emit(ok, reason, extra) {
    try {
      window.dispatchEvent(
        new CustomEvent("ghostops:auth", { detail: { ok: !!ok, reason: reason || "", ...(extra || {}) } })
      );
    } catch (_) {}
  }

  function goConnexion(reason) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    const r = reason ? `&reason=${encodeURIComponent(reason)}` : "";
    window.location.href = `/connexion.html?next=${next}${r}`;
  }

  function goProduit(reason) {
    const params = new URLSearchParams();
    if (reason) params.set("reason", reason);

    const map = {
      diagnostic: "/diagnostic-ia.html",
      studio: "/studio-scenarios.html",
      "pre-brief": "/pre-brief-board.html",
    };
    const target = map[niveauProduit] || "/index.html";
    const q = params.toString();
    window.location.href = q ? `${target}?${q}` : target;
  }

  if (!niveauProduit) {
    console.error("GhostOps Auth Guard — niveau_produit non défini (window.GHOSTOPS_NIVEAU_PRODUIT)");
    emit(false, "missing_niveau_produit");
    // On ne redirige pas automatiquement ici pour éviter un loop si une page est mal configurée
    return;
  }

  // 1) Récupérer le client Supabase centralisé (créé dans config.js)
  //    On laisse une petite fenêtre pour que config.js ait le temps d'initialiser.
  let supabase = window.ghostopsSupabase;
  if (!supabase || !supabase.auth) {
    // attendre jusqu'à ~1.5s max
    const t0 = Date.now();
    while ((!supabase || !supabase.auth) && Date.now() - t0 < 1500) {
      await new Promise((r) => setTimeout(r, 50));
      supabase = window.ghostopsSupabase;
    }
  }

  if (!supabase || !supabase.auth) {
    console.error("GhostOps Auth Guard — window.ghostopsSupabase introuvable (config.js non chargé ?)");
    emit(false, "supabase_missing");
    // Dans ce cas, mieux vaut renvoyer vers connexion (ou page produit) plutôt que de laisser un écran bloqué
    goConnexion("supabase_missing");
    return;
  }

  // 2) Session obligatoire
  let session = null;
  try {
    const { data: sessData, error: sessErr } = await supabase.auth.getSession();
    session = sessData?.session || null;

    if (sessErr) {
      console.warn("GhostOps Auth Guard — erreur getSession:", sessErr);
    }
  } catch (e) {
    console.error("GhostOps Auth Guard — exception getSession:", e);
  }

  if (!session?.user?.id) {
    // Cas typique : magic link ouvert dans un AUTRE navigateur => pas de session ici
    emit(false, "no_session");
    goConnexion("no_session");
    return;
  }

  const userId = session.user.id;

  // 3) Vérification droits (table : droits)
  // Colonnes attendues : user_id, niveau_produit, statut, revoked_at
  let droit = null;
  try {
    const { data, error } = await supabase
      .from("droits")
      .select("id, statut, niveau_produit, revoked_at")
      .eq("user_id", userId)
      .eq("niveau_produit", niveauProduit)
      .eq("statut", "actif")
      .is("revoked_at", null)
      .maybeSingle();

    if (error) {
      console.warn("GhostOps Auth Guard — erreur check droits:", error);
      emit(false, "right_check_error", { error: String(error.message || error) });
      // Si erreur technique, on préfère renvoyer vers la page produit plutôt que bloquer
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
    // Pas de droit actif
    emit(false, "no_right");
    goProduit("no_right");
    return;
  }

  // 4) OK
  console.log("GhostOps Auth Guard — accès autorisé :", niveauProduit);
  emit(true, "authorized", { userId, niveauProduit });
})();
