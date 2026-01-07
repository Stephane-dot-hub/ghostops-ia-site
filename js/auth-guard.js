<script>
/* GhostOps — Auth Guard centralisé */

(async function ghostopsAuthGuard() {
  // --- CONFIG ---
  const SUPABASE_URL = window.SUPABASE_URL;
  const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

  // À définir dans chaque page AVANT ce script :
  // window.GHOSTOPS_NIVEAU_PRODUIT = "diagnostic" | "studio" | "pre-brief"
  const niveauProduit = window.GHOSTOPS_NIVEAU_PRODUIT;

  if (!niveauProduit) {
    console.error("GhostOps Auth Guard — niveau_produit non défini");
    return;
  }

  const supabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
  );

  // --- 1. Vérification session ---
  const { data: { session }, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !session) {
    const next = encodeURIComponent(window.location.pathname);
    window.location.href = `/connexion.html?next=${next}`;
    return;
  }

  const userId = session.user.id;

  // --- 2. Vérification droits ---
  const { data: droit, error: droitError } = await supabase
    .from("droits")
    .select("id")
    .eq("user_id", userId)
    .eq("niveau_produit", niveauProduit)
    .eq("statut", "actif")
    .is("revoked_at", null)
    .maybeSingle();

  if (droitError || !droit) {
    const params = new URLSearchParams({
      reason: "right_check_error"
    });
    window.location.href = `/diagnostic-ia.html?${params.toString()}`;
    return;
  }

  // --- 3. Accès autorisé ---
  console.log("GhostOps Auth Guard — accès autorisé :", niveauProduit);
})();
</script>
