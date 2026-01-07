/* GhostOps — Auth Guard centralisé */
(async function ghostopsAuthGuard() {
  // 0) Niveau produit obligatoire, défini dans chaque page avant ce script
  // window.GHOSTOPS_NIVEAU_PRODUIT = "diagnostic" | "studio" | "pre-brief"
  const niveauProduit = window.GHOSTOPS_NIVEAU_PRODUIT;

  if (!niveauProduit) {
    console.error("GhostOps Auth Guard — niveau_produit non défini (window.GHOSTOPS_NIVEAU_PRODUIT)");
    return;
  }

  // 1) Utiliser le client Supabase centralisé (créé dans config.js)
  const supabase = window.ghostopsSupabase;
  if (!supabase || !supabase.auth) {
    console.error("GhostOps Auth Guard — window.ghostopsSupabase introuvable (config.js non chargé ?)");
    return;
  }

  // 2) Session obligatoire
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  const session = sessData?.session;

  if (sessErr || !session?.user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/connexion.html?next=${next}`;
    return;
  }

  const userId = session.user.id;

  // 3) Vérification droits (selon votre table réelle)
  // D’après vos infos : user_id, niveau_produit, statut, revoked_at
  const { data: droit, error: droitErr } = await supabase
    .from("droits")
    .select("id")
    .eq("user_id", userId)
    .eq("niveau_produit", niveauProduit)
    .eq("statut", "actif")
    .is("revoked_at", null)
    .maybeSingle();

  if (droitErr || !droit) {
    const params = new URLSearchParams({ reason: "right_check_error" });

    // Redirection vers la page produit correspondante
    const map = {
      diagnostic: "/diagnostic-ia.html",
      studio: "/studio-scenarios.html",
      "pre-brief": "/pre-brief-board.html",
    };
    const target = map[niveauProduit] || "/index.html";

    window.location.href = `${target}?${params.toString()}`;
    return;
  }

  console.log("GhostOps Auth Guard — accès autorisé :", niveauProduit);
})();
