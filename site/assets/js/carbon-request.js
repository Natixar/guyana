/**
 * Demander à Natixar de signer le contenu carbone d'une barre.
 *
 * ─── LE CHAÎNON QUI MANQUAIT ─────────────────────────────────────────────
 *
 * Jusqu'au 2 août 2026, rien dans l'interface ne demandait cette signature.
 * Le magasin savait servir, le signataire savait signer, la page de
 * vérification savait recalculer — et le vérificateur n'avait jamais de carbone
 * à vérifier, parce qu'aucun geste ne reliait les trois. C'est ce geste.
 *
 * ─── CINQ ÉTAPES, ET CHACUNE EST UNE FRONTIÈRE ───────────────────────────
 *
 * 1. Le PLAN se dérive de la barre : deux mois, les lots vus, les barres du lot.
 *    Personne ne saisit rien.
 * 2. Le MAGASIN sert les cellules qui recouvrent la fenêtre, taillées à celle-ci
 *    et SIGNÉES. C'est cette signature qui rend le recalcul du signataire
 *    probant : sans elle, il recalculerait à partir d'entrées fournies par celui
 *    dont on ne veut justement pas croire la conclusion.
 * 3. Les DISPOSITIONS se calculent depuis le plan, une par cellule servie, motif
 *    compris. Le client rend compte de tout ce qu'on lui a donné.
 * 4. Le navigateur CALCULE la valeur, avec le même moteur et la même règle que
 *    le signataire. Il ne la lui impose pas : il l'annonce, et le signataire
 *    refuse si son propre calcul diverge.
 * 5. Le SIGNATAIRE rend `{credential, disclosures, totalSalt}`. L'attestation
 *    part au portefeuille et au magasin ; LES DIVULGATIONS RESTENT ICI. C'est ce
 *    qui permet au porteur d'en retirer avant de présenter, sans toucher à un
 *    octet de ce qui a été signé.
 *
 * ─── CE QUE CE MODULE NE FAIT PAS ────────────────────────────────────────
 *
 * Il ne touche pas à la clé de la mine. L'attestation carbone est signée par
 * Natixar, sous la clé de Natixar, dans un processus qui n'a pas la base : la
 * mine la reçoit et peut la lire, elle ne la fabrique pas. C'est exactement ce
 * que la démonstration doit rendre visible.
 *
 * @see site/assets/js/lot-selection.js — la sélection, automatique
 * @see services/signer/attest.mjs — les quatre contrôles, côté Natixar
 */
import { aggregate, allocateToBar } from "./engine.js";
import { planForBar, disposeCells, tally } from "./lot-selection.js";
import { canonicalBytes } from "./canonical.js";
import { multibase58 } from "./multibase.js";

function fault(code, detail) {
  const e = new Error(detail ? `${code} — ${detail}` : code);
  e.code = code;
  return e;
}

/**
 * Lit une réponse en exigeant du JSON.
 *
 * Le site répond 200 avec sa page d'accueil pour tout chemin inconnu : une
 * erreur de routage arrive donc sous la forme d'un succès contenant du HTML, et
 * `JSON.parse` répond « Unexpected token '<' » — un message qui ne nomme ni le
 * routage ni le service absent. On le nomme.
 */
async function asJson(res, what) {
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw fault("NOT_JSON", `${what} : réponse ${res.status} non JSON (${type || "type absent"}) — routage ?`);
  }
  return res.json();
}

/**
 * La référence à l'attestation d'origine : son sujet et son empreinte.
 *
 * L'EMPREINTE PORTE SUR LE DOCUMENT SIGNÉ, PREUVE COMPRISE. C'est ce qui la
 * rend utile : elle désigne CETTE attestation-là, celle que la mine a émise, et
 * pas une variante rebâtie avec les mêmes revendications. Canonicalisée, parce
 * qu'un même document réordonné donnerait une autre empreinte et que le porteur
 * n'a aucun moyen de garantir l'ordre des clés à travers un aller-retour JSON.
 */
export async function originRef(doc) {
  if (!doc?.credentialSubject?.id) throw fault("ORIGIN_REQUIRED", "sans sujet");
  const digest = await crypto.subtle.digest("SHA-256", canonicalBytes(doc));
  return { id: doc.credentialSubject.id, digestMultibase: multibase58(new Uint8Array(digest)) };
}

/** La taxonomie servie — celle contre laquelle le signataire traduira aussi. */
export async function fetchTaxonomy(fetchImpl = fetch) {
  const r = await fetchImpl("/engine/taxonomy.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw fault("TAXONOMY_UNAVAILABLE", `HTTP ${r.status}`);
  return asJson(r, "taxonomy.json");
}

/**
 * Le calcul, à l'identique de celui que le signataire refera.
 *
 * DEUX AGRÉGATS ET NON UN. Ce qui appartient au lot de la barre et ce qui
 * n'appartient à aucun lot ne subissent pas la même division ; les mêler avant
 * de diviser diluerait le lot dans son voisin. Les écartées ne sont dans aucun
 * des deux — leur part est nulle — mais elles restent dans la matrice.
 *
 * Exporté pour être exercé seul : c'est l'endroit où un désaccord avec le
 * signataire se manifesterait, et un désaccord se cherche sans réseau.
 *
 * @returns {{value: number, alloc: object, counts: object}}
 */
export function computeForBar({ cells, dispositions, plan, bar, taxonomy }) {
  const by = new Map(dispositions.map((d) => [d.id, d.use]));
  const pick = (use) => cells.filter((c) => by.get(c.id) === use);

  const allocated = aggregate(pick("USED"), taxonomy);
  const shared = aggregate(pick("SHARED"), taxonomy);
  const sum = (lines) => Object.values(lines).reduce((a, b) => a + b, 0);

  const alloc = allocateToBar({
    allocated: sum(allocated.lines),
    shared: sum(shared.lines),
    lotsInWindow: plan.lotsInWindow.length,
    barsInLot: plan.barsInLot,
  });

  // Le dénominateur est l'or FIN, en kilogrammes : une unité SI, la seule que le
  // signataire accepte. L'once est une affaire de rendu.
  const denominator = bar.fineGoldKg;
  if (!(typeof denominator === "number") || !(denominator > 0)) {
    throw fault("FINE_GOLD_MISSING", String(denominator));
  }

  return { value: alloc.perBar / denominator, denominator, alloc,
           counts: tally(dispositions) };
}

/**
 * Demande l'extraction, la classe, et fait signer.
 *
 * @param {object} opts
 * @param {object} opts.bar        la barre du registre
 * @param {object} opts.fixture    le jeu d'essai ERP
 * @param {object} opts.origin     l'attestation d'origine signée par la mine
 * @param {object} [opts.taxonomy] évite un aller-retour si on l'a déjà
 * @returns {Promise<{credential: object, disclosures: Array, totalSalt: string,
 *                    plan: object, counts: object, value: number, alloc: object}>}
 * @throws {Error} codes stables : `ORIGIN_REQUIRED`, `EXTRACTION_REFUSED`,
 *   `SIGNATURE_REFUSED`, plus ceux de `planForBar` et du moteur
 */
export async function requestCarbonCredential({ bar, fixture, origin, taxonomy },
                                              fetchImpl = fetch) {
  // L'ATTESTATION D'ORIGINE EST UN PRÉALABLE, pas une commodité. `derivedFrom`
  // la désigne par son empreinte, et c'est ce lien qui empêche quiconque
  // d'émettre un chiffre carbone pour le même sujet : sans origine, l'intensité
  // flotte sur un identifiant que personne n'a revendiqué.
  if (!origin?.digestMultibase) throw fault("ORIGIN_REQUIRED");

  const plan = planForBar(bar, fixture);
  const tax = taxonomy ?? await fetchTaxonomy(fetchImpl);

  // 2 — l'extraction, signée par le magasin. UN SEUL INTERVALLE : la fenêtre est
  // continue, et deux intervalles adjacents seraient deux fois la même demande.
  const res = await fetchImpl("/api/v1/ranges", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ periods: [plan.window] }),
  });
  if (!res.ok) {
    const why = await res.text().catch(() => "");
    throw fault("EXTRACTION_REFUSED", `HTTP ${res.status} ${why.slice(0, 200)}`);
  }
  const extraction = await asJson(res, "ranges");
  if (!Array.isArray(extraction.cells) || extraction.cells.length === 0) {
    throw fault("EXTRACTION_EMPTY", `${plan.window.start} → ${plan.window.end}`);
  }

  // 3 et 4 — on classe, puis on calcule ce que le signataire recalculera.
  const dispositions = disposeCells(extraction.cells, plan);
  const { value, denominator, alloc, counts } =
    computeForBar({ cells: extraction.cells, dispositions, plan, bar, taxonomy: tax });

  // 5 — la signature de Natixar.
  const signRes = await fetchImpl("/api/v1/sign", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      claim: "carbonIntensity",
      subjectKind: "dore-bar",
      subjectId: bar.subjectId,
      derivedFrom: origin,
      conditions: { export: "GHGP", control: "Operational" },
      extraction: extraction,
      dispositions,
      allocation: "lot",
      // Les deux diviseurs. Déclarés ici, RECALCULÉS là-bas, et écrits dans
      // l'attestation : la règle n'est pas seulement nommée, elle est refaisable.
      allocationInputs: {
        lotsInWindow: plan.lotsInWindow.length,
        barsInLot: plan.barsInLot,
      },
      eventModel: fixture?.eventModel,
      value,
      denominator,
      denominatorUnit: "kg",
    }),
  });
  if (!signRes.ok) {
    const body = await signRes.json().catch(() => ({}));
    throw fault(body.error ?? "SIGNATURE_REFUSED", body.detail ?? `HTTP ${signRes.status}`);
  }
  const signed = await asJson(signRes, "sign");

  return { ...signed, plan, counts, value, alloc, servedAt: extraction.servedAt,
           cellsServed: extraction.cells.length };
}
