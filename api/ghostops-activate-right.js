// /api/ghostops-activate-right.js
// Objectif : convertir une Stripe Checkout Session (cs_id) en droit Supabase (table "droits").
// - Auth obligatoire via Supabase access token (Bearer)
// - Vérifie Stripe (paid + bon Price ID selon niveau)
// - Upsert dans "droits" : user_id + niveau_produit + statut="actif" + revoked_at=NULL

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function getBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof h !== "string") return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? cleanStr(m[1]) : "";
}

function json(res, status, payload) {
  return res.status(status).json(payload);
}

function priceIdForLevel(level) {
  const lvl = String(level || "").trim();

  const diagnostic =
    cleanStr(process.env.GHOSTOPS_DIAGNOSTIC_STRIPE_PRICE_ID) ||
    cleanStr(process.env.STRIPE_PRICE_ID_DIAGNOSTIC);

  const studio =
    cleanStr(process.env.GHOSTOPS_STUDIO_STRIPE_PRICE_ID) ||
    cleanStr(process.env.STRIPE_PRICE_ID_STUDIO_SCENARIOS);

  const prebrief =
    cleanStr(process.env.GHOSTOPS_BOARD_STRIPE_PRICE_ID) ||
    cleanStr(process.env.STRIPE_PRICE_ID_PRE_BRIEF_BOARD);

  if (lvl === "diagnostic") return diagnostic;
  if (lvl === "studio") return studio;
  if (lvl === "pre-brief") return prebrief;
  return "";
}

async function verifyStripePaidAndProduct({ stripe, csId, expectedPriceId }) {
  const id = cleanStr(csId);
  if (!id) return { ok: false, reason: "missing_cs_id" };

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items.data.price"] });
  } catch (e) {
    return { ok: false, reason: "stripe_retrieve_failed", message: e?.message || String(e) };
  }

  const paid = session?.payment_status === "paid";
  if (!paid) {
    return {
      ok: false,
      reason: "not_paid",
      status: session?.status,
      payment_status: session?.payment_status,
    };
  }

  const expPriceId = cleanStr(expectedPriceId);
  if (expPriceId) {
    const items = session?.line_items?.data || [];
    const found = items.some((li) => cleanStr(li?.price?.id) === expPriceId);
    if (!found) {
      return {
        ok: false,
        reason: "wrong_product",
        message: "Checkout Session payée, mais ne correspond pas au produit attendu (Price ID).",
      };
    }
  }

  return {
    ok: true,
    session: {
      id: session.id,
      created: session.created,
      payment_status: session.payment_status,
      status: session.status,
      customer_email: session.customer_details?.email || null,
      metadata: session.metadata || {},
    },
  };
}

module.exports = async function handler(req, res) {
  // no-cache
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return json(res, 405, { ok: false, error: "Méthode non autorisée. Utilisez POST." });
  }

  const supabaseUrl = cleanStr(process.env.SUPABASE_URL);
  const serviceRoleKey = cleanStr(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const stripeKey = cleanStr(process.env.STRIPE_SECRET_KEY);

  if (!supabaseUrl || !serviceRoleKey) {
    return json(res, 500, {
      ok: false,
      error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY non configurés.",
    });
  }
  if (!stripeKey) {
    return json(res, 500, { ok: false, error: "STRIPE_SECRET_KEY non configurée." });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return json(res, 401, { ok: false, error: "Non autorisé : token Supabase manquant (Authorization: Bearer ...)." });
  }

  const cs_id = cleanStr(req.body?.cs_id || req.body?.csId);
  const niveau_produit = cleanStr(req.body?.niveau_produit || req.body?.niveauProduit);

  if (!cs_id || !niveau_produit) {
    return json(res, 400, { ok: false, error: 'Champs requis : "cs_id" et "niveau_produit".' });
  }

  if (!["diagnostic", "studio", "pre-brief"].includes(niveau_produit)) {
    return json(res, 400, { ok: false, error: "niveau_produit invalide. Attendu: diagnostic | studio | pre-brief." });
  }

  // 1) Identifier l’utilisateur connecté (via access token)
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
  const user = userData?.user || null;

  if (userErr || !user?.id) {
    return json(res, 401, { ok: false, error: "Session Supabase invalide/expirée.", debug: userErr?.message || "" });
  }

  // 2) Vérifier Stripe
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  const expectedPriceId = priceIdForLevel(niveau_produit);

  if (!expectedPriceId) {
    return json(res, 500, {
      ok: false,
      error: `Price ID manquant pour "${niveau_produit}". Configurez les variables d’environnement correspondantes.`,
    });
  }

  const check = await verifyStripePaidAndProduct({ stripe, csId: cs_id, expectedPriceId });
  if (!check.ok) {
    return json(res, 401, {
      ok: false,
      error: "Paiement non vérifié. Utilisez le lien de fin de paiement (cs_id).",
      debug: check,
    });
  }

  // 3) Upsert droit
  // Table droits attendue : user_id (uuid), niveau_produit (text), statut (text), created_at, revoked_at (timestamp null)
  // On réactive si existant (revoked_at -> null, statut -> actif)
  const payload = {
    user_id: user.id,
    niveau_produit,
    statut: "actif",
    revoked_at: null,
    // optionnel : trace du paiement (si vous avez une colonne)
    // stripe_cs_id: check.session.id
  };

  // IMPORTANT :
  // Pour que upsert fonctionne, il faut un UNIQUE CONSTRAINT sur (user_id, niveau_produit).
  // Sinon, remplacez par : select -> insert ou update.
  const { data: upData, error: upErr } = await supabaseAdmin
    .from("droits")
    .upsert(payload, { onConflict: "user_id,niveau_produit" })
    .select("id, user_id, niveau_produit, statut, created_at, revoked_at")
    .single();

  if (upErr) {
    // Cas fréquent : pas de contrainte unique => upsert échoue
    return json(res, 500, {
      ok: false,
      error: "Impossible d’écrire le droit dans la table droits.",
      debug: upErr?.message || String(upErr),
      hint: "Ajoutez une contrainte UNIQUE (user_id, niveau_produit) ou demandez-moi la version sans upsert.",
    });
  }

  return json(res, 200, {
    ok: true,
    activated: true,
    droit: upData,
    stripe: { cs_id: check.session.id, paid: true },
    user: { id: user.id, email: user.email || null },
  });
};
