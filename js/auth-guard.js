/* GhostOps — Auth Guard centralisé (v6 : hardening pages système + next safe + anti-loop + whitelists)
   Objectifs :
   - Décision claire (OK/KO) + event "ghostops:auth"
   - Tolérer Supabase pas prêt (config.js chargé après)
   - Gérer “magic link ouvert dans un autre navigateur” (session absente)
   - Éviter les boucles (connexion <-> index / produit / session)
   - Raisons stables (reason codes)
   - ✅ FIX : ne JAMAIS pré-encoder "next" (URLSearchParams encode)
   - ✅ HARDEN : ne jamais rediriger depuis/vers pages système (connexion/callback)
*/

(async function ghostopsAuthGuard() {
  const RAW_NIVEAU = String(window.GHOSTOPS_NIVEAU_PRODUIT || "").trim();

  const DEBUG =
    String(new URLSearchParams(window.location.search).get("debug") || "") === "1" ||
    String(localStorage.getItem("ghostops_debug_auth") || "") === "1";

  const NOW = Date.now();
  const PATH = window.location.pathname || "";
  const SEARCH = window.location.search || "";

  // Pages “système”
  const IS_CONNEXION = /\/connexion\.html$/i.test(PATH);
  const IS_AUTH_CALLBACK = /\/auth-callback\.html$/i.test(PATH);

  // IMPORTANT : si ce guard est inclus par erreur sur une page système, on ne fait rien.
  if (IS_CONNEXION || IS_AUTH_CALLBACK) {
    try {
      window.dispatchEvent(
        new CustomEvent("ghostops:auth", {
          detail: { ok: true, reason: "system_page_bypass", ts: Date.now(), path: PATH },
        })
      );
    } catch (_) {}
    return;
  }

  // ---- Logs ----
  function log(...args) {
    if (DEBUG) console.log("[GhostOps AuthGuard]", ...args);
  }
  function warn(...args) {
    console.warn("[GhostOps AuthGuard]", ...args);
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

  // -----------------------------
  // Normalisation niveau produit
  // -----------------------------
  function normalizeNiveau(v) {
    const s = String(v || "").trim().toLowerCase();
    if (s === "prebrief" || s === "pre_brief" || s === "pre-brief-board") return "pre-brief";
    if (s === "studio_scenarios" || s === "studio-scenarios" || s === "studio scenarios") return "studio-scenarios";
    if (s === "studio") return "studio-scenarios";
    if (s === "diagnostic" || s === "diagnostic-ia") return "diagnostic";
    if (s === "pre-brief") return "pre-brief";
    return "";
  }

  const niveauProduit = normalizeNiveau(RAW_NIVEAU);

  // -----------------------------
  // Anti-loop : bloque si redirections vers la même cible trop vite
  // -----------------------------
  const LOOP_KEY = "ghostops_auth_loop_v3";

  function bumpRedirectCounter(target) {
    try {
      const raw = localStorage.getItem(LOOP_KEY);
      const obj = raw ? JSON.parse(raw) : { c: 0, t: 0, last: "", lastFrom: "" };

      const elapsed = NOW - (obj.t || 0);
      const sameTarget = String(obj.last || "") === String(target || "");
      const sameWindow = elapsed < 15000;

      const next = {
        c: sameWindow ? (sameTarget ? Number(obj.c || 0) + 1 : 1) : 1,
        t: NOW,
        last: String(target || ""),
        lastFrom: PATH,
      };

      localStorage.setItem(LOOP_KEY, JSON.stringify(next));
      return next.c;
    } catch (_) {
      return 0;
    }
  }

  function allowRedirect(target) {
    const count = bumpRedirectCounter(target);
    if (count >= 3) {
      emit(false, "redirect_loop_guard", { target, count });
      warn("Loop guard activé :", { target, count });
      return false;
    }
    return true;
  }

  // ✅ FIX : ne PAS encoder ici.
  // URLSearchParams encodera automatiquement.
  function buildNext() {
    return (PATH || "/") + (SEARCH || "");
  }

  // Hardening : refuser d’utiliser une page système comme "next"
  function safeNext(next) {
    const v = String(next || "").trim();
    if (!v) return "/index.html";
    // Bloquer next vers pages système
    if (/\/connexion\.html/i.test(v) || /\/auth-callback\.html/i.test(v)) return "/index.html";
    return v;
  }

  // -----------------------------
  // Cibles
  // -----------------------------
  function productPageFor(np) {
    const map = {
      diagnostic: "/diagnostic-ia.html",
      "studio-scenarios": "/studio-scenarios.html",
      "pre-brief": "/pre-brief-board.html",
    };
    return map[np] || "/index.html";
  }

  function goConnexion(reason, extra) {
    // Sécurité : ne jamais être ici si page système (double garde)
    if (IS_CONNEXION || IS_AUTH_CALLBACK) {
      emit(false, reason || "system_page_no_redirect", { ...(extra || {}), already: true });
      log("Page système — pas de redirection.");
      return;
    }

    const next = safeNext(buildNext());

    const params = new URLSearchParams();
    params.set("next", next); // encodage géré par URLSearchParams
    if (reason) params.set("reason", reason);
    if (DEBUG) params.set("debug", "1");
    if (extra && typeof extra === "object") {
      if (extra.niveauProduit) params.set("np", String(extra.niveauProduit));
    }

    const url = `/connexion.html?${params.toString()}`;
    if (!allowRedirect(url)) return;
    window.location.assign(url);
  }

  function goProduit(reason) {
    const target = productPageFor(niveauProduit);
    if (PATH === target) {
      emit(false, reason || "already_on_product", { niveauProduit, target, already: true });
      log("Déjà sur la page produit — pas de redirection supplémentaire.");
      return;
    }

    const params = new URLSearchParams();
    if (reason) params.set("reason", reason);
    if (DEBUG) params.set("debug", "1");

    const url = params.toString() ? `${target}?${params.toString()}` : target;
    if (!allowRedirect(url)) return;
    window.location.assign(url);
  }

  // -----------------------------
  // 0) Pré-check niveau
  // -----------------------------
  if (!niveauProduit) {
    console.error(
      "GhostOps Auth Guard — niveau_produit non défini ou invalide (window.GHOSTOPS_NIVEAU_PRODUIT). Valeur reçue :",
      RAW_NIVEAU
    );
    emit(false, "missing_niveau_produit", { raw: RAW_NIVEAU });
    return; // pas de redirection auto : évite boucles si page mal configurée
  }

  // -----------------------------
  // 1) Récupérer Supabase (créé dans config.js)
  // -----------------------------
  let supabase = window.ghostopsSupabase;

  // Attente courte : config.js peut arriver après
  if (!supabase || !supabase.auth) {
    const t0 = Date.now();
    while ((!supabase || !supabase.auth) && Date.now() - t0 < 2000) {
      await new Promise((r) => setTimeout(r, 50));
      supabase = window.ghostopsSupabase;
    }
  }

  if (!supabase || !supabase.auth) {
    console.error("GhostOps Auth Guard — window.ghostopsSupabase introuvable (config.js non chargé ?)");
    emit(false, "supabase_missing", { niveauProduit });
    goConnexion("supabase_missing", { niveauProduit });
    return;
  }

  // -----------------------------
  // 2) Session obligatoire
  // -----------------------------
  let session = null;

  try {
    const { data: sessData, error: sessErr } = await supabase.auth.getSession();
    session = sessData?.session || null;
    if (sessErr) log("getSession error:", sessErr);

    // fallback getUser
    if (!session?.user?.id && typeof supabase.auth.getUser === "function") {
      try {
        const { data: uData, error: uErr } = await supabase.auth.getUser();
        if (uErr) log("getUser error:", uErr);
        if (uData?.user?.id) session = session || { user: uData.user };
      } catch (e) {
        log("getUser exception:", e);
      }
    }

    // refresh silencieux si dispo
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
    console.error("GhostOps Auth Guard — exception getSession/getUser/refreshSession:", e);
  }

  if (!session?.user?.id) {
    emit(false, "no_session", { niveauProduit });
    goConnexion("no_session", { niveauProduit });
    return;
  }

  const userId = session.user.id;

  // -----------------------------
  // 3) Vérification droits (table : droits)
  // Colonnes attendues : user_id, niveau_produit, statut, revoked_at
  // -----------------------------
  let droit = null;

  // Mapping tolérant (au cas où des anciennes valeurs existent)
  const niveauCandidates =
    niveauProduit === "studio-scenarios"
      ? ["studio-scenarios", "studio"]
      : niveauProduit === "pre-brief"
        ? ["pre-brief", "prebrief", "pre_brief"]
        : [niveauProduit];

  try {
    let lastError = null;

    for (const np of niveauCandidates) {
      const q = supabase
        .from("droits")
        .select("id, statut, niveau_produit, revoked_at, created_at")
        .eq("user_id", userId)
        .eq("niveau_produit", np)
        .eq("statut", "actif")
        .is("revoked_at", null);

      const { data, error } = await q.maybeSingle();

      if (error) {
        lastError = error;
        warn("Erreur check droits (np=" + np + "):", error);
        break;
      }

      if (data) {
        droit = data;
        break;
      }
    }

    if (!droit && lastError) {
      emit(false, "right_check_error", { error: String(lastError.message || lastError), niveauProduit });
      // On renvoie sur la page produit (explication possible) : évite d’ouvrir connexion inutilement
      goProduit("right_check_error");
      return;
    }
  } catch (e) {
    console.error("GhostOps Auth Guard — exception check droits:", e);
    emit(false, "right_check_exception", { error: String(e?.message || e), niveauProduit });
    goProduit("right_check_error");
    return;
  }

  if (!droit) {
    emit(false, "no_right", { userId, niveauProduit });
    goProduit("no_right");
    return;
  }

  // -----------------------------
  // 4) OK
  // -----------------------------
  log("Accès autorisé:", { niveauProduit, userId, droitId: droit.id, droitNp: droit.niveau_produit });
  emit(true, "authorized", { userId, niveauProduit, droitId: droit.id, droitNp: droit.niveau_produit });
})();
