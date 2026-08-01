/**
 * Le moteur de calcul carbone.
 *
 * UN MOTEUR, DEUX HÔTES. Ce fichier est importé par la page dans le navigateur
 * et copié tel quel dans l'image du signataire. C'est la même source ; ce qui
 * prouve que c'est le même comportement, ce sont les vecteurs partagés de
 * `site/static/engine/vectors.json`, exécutés des deux côtés.
 *
 * L'exploration se produit des milliers de fois par session et appartient
 * entièrement au navigateur. La signature se produit une fois par attestation,
 * et le signataire recalcule avant de signer : pour une agrégation linéaire,
 * vérifier coûte ce que calculer coûte, il n'y a pas de raccourci.
 *
 * ─── ON AGRÈGE, PUIS ON TRADUIT ──────────────────────────────────────────
 *
 * L'ordre n'est pas indifférent. Un élément du cube est situé dans la
 * taxonomie pivot ; dans un contexte donné il aboutit à tel sous-poste du
 * référentiel cible. Traduire chaque élément puis sommer donnerait le même
 * chiffre, mais referait la même recherche autant de fois qu'il y a de
 * cellules. On regroupe donc d'abord les cellules dont **le sous-poste pivot
 * ET le contexte** coïncident, et l'on traduit une fois par groupe.
 *
 * Ce qui se somme à l'intérieur d'un groupe, c'est l'**émission** et non la
 * donnée d'activité : deux cellules du même groupe peuvent être en litres et
 * en kilogrammes, et additionner leurs quantités n'aurait aucun sens. Leurs
 * émissions, si — elles sont dans la même unité par construction.
 *
 * @see services/README.md
 * @see site/static/engine/taxonomy.json
 */

/**
 * Origines, de la meilleure à la pire.
 *
 * L'ordre est le sujet : un agrégat vaut au mieux sa pire entrée (#46). Sans
 * cette règle, KPI 1 devient ininterprétable ou accidentellement flatteur.
 */
const ORIGIN_RANK = ["MEASURED", "DERIVED", "ESTIMATED", "NOT_MEASURED"];

/** Une erreur dont le code est stable, pour que l'appelant décide sans lire le texte. */
function fault(code, detail) {
  const e = new Error(detail ? `${code} — ${detail}` : code);
  e.code = code;
  return e;
}

/**
 * TOUT EST EN SI, ET UN FACTEUR EST UN NOMBRE.
 *
 * Le moteur produit des kgCO2e et ne convertit rien. Un facteur vaut des kgCO2e
 * par unité d'activité, et cette unité est celle de la cellule : la porter une
 * seconde fois à côté du facteur créerait deux sources de vérité, donc une
 * occasion de divergence, pour une information déjà présente.
 *
 * Il n'y a donc rien à contrôler ici. La conversion — onces vers kilogrammes,
 * litres vers mètres cubes, facteurs par litre vers facteurs par mètre cube —
 * a lieu une fois, à l'ingestion, là où les unités d'origine existent encore.
 * Au-delà de cette frontière, il n'y a que des nombres, et un nombre n'a pas
 * d'unité à trahir.
 *
 * Publier en tCO2e quand un référentiel l'exige est une affaire de rendu : on
 * divise par mille en écrivant un rapport, jamais en calculant ni en signant.
 */
const RESULT_UNIT = "kgCO2e";

const worstOrigin = (a, b) =>
  ORIGIN_RANK.indexOf(a) >= ORIGIN_RANK.indexOf(b) ? a : b;

/**
 * La clé de regroupement : sous-poste pivot **et** contexte.
 *
 * Le contexte est ce dont la traduction dépend en plus du sous-poste, c'est-à-
 * dire exactement les entrées de la fonction de traduction. Regrouper sur moins
 * que cela fusionnerait des cellules qui n'aboutissent pas à la même ligne.
 */
const groupKey = (cell) => `${cell.subPost}/${cell.partType}/${cell.caracterisation}`;

/** Le mois d'une cellule, « 2025-01 », depuis le début de sa période. */
const monthOf = (cell) => String(cell.periodStart ?? "").slice(0, 7) || "undated";

/**
 * Traduit un groupe vers sa ligne du référentiel cible.
 *
 * Fonction TOTALE du triplet `(subPost, partType, caracterisation)` sous les
 * conditions fixées de la taxonomie. La ligne est **dérivée** et jamais
 * choisie : c'est ce qui distingue une piste d'audit d'une décision humaine
 * sans règle derrière (§19.1).
 *
 * @throws {Error} `CARACTERISATION_REQUIRED` — la deviner reviendrait à choisir
 *         la ligne à la main
 * @throws {Error} `PART_TYPE_EXCLUDED` — une part hors périmètre est refusée et
 *         non ignorée : l'ignorer produirait un écart entre référentiels sans
 *         cause visible
 * @throws {Error} `SUBPOST_UNKNOWN`, `NO_RULE`
 */
export function translate({ subPost, partType, caracterisation }, taxonomy) {
  if (caracterisation === null || caracterisation === undefined) {
    throw fault("CARACTERISATION_REQUIRED", `sous-poste ${subPost}`);
  }

  const excluded = (taxonomy.partTypes?.excluded ?? []).find((p) => p.id === partType);
  if (excluded) throw fault("PART_TYPE_EXCLUDED", excluded.key);

  const translation = (taxonomy.translations ?? [])[0];
  if (!translation) throw fault("NO_TRANSLATION", "la taxonomie n'en porte aucune");

  const forSubPost = translation.rules.filter((r) => r.subPost === subPost);
  if (forSubPost.length === 0) throw fault("SUBPOST_UNKNOWN", String(subPost));

  // Règle spécifique à la part, sinon règle par défaut — celle dont le type de
  // part est nul. C'est le comportement du moteur de référence d'ABC.
  const rule = forSubPost.find((r) => r.partType === partType)
            ?? forSubPost.find((r) => r.partType === null);
  if (!rule) throw fault("NO_RULE", `sous-poste ${subPost}, part ${partType}`);

  const line = rule[String(caracterisation)];
  if (!line) throw fault("NO_RULE", `caractérisation ${caracterisation} sur le sous-poste ${subPost}`);
  return line;
}

/**
 * Agrège des cellules en un profil d'émission.
 *
 * Trois propriétés, chacune exercée par les vecteurs partagés :
 *
 * - **les lignes se somment** par ligne cible dérivée, jamais par ligne
 *   stockée — une cellule ne porte que sa position pivot ;
 * - **l'origine se propage** : un agrégat vaut au mieux sa pire entrée ;
 * - **le non-alloué se déclare** dans son propre poste et ne se répartit jamais
 *   en silence, faute de quoi le total serait complet et faux.
 *
 * @param {Array<object>} cells
 * @param {object} taxonomy
 * @returns {{pivot: Array<object>, lines: Record<string, number>, origin: string,
 *            unallocated: number, unit: string, groups: number}}
 *          `pivot` est ce qui se signe ; `lines` est la vue dérivée. Montants en kgCO2e.
 */
export function aggregate(cells, taxonomy) {
  if (!Array.isArray(cells)) throw fault("CELLS_REQUIRED");
  if (!taxonomy) throw fault("TAXONOMY_REQUIRED");

  const groups = new Map();
  const unallocatedByPeriod = {};
  let unallocated = 0;
  let origin = ORIGIN_RANK[0];

  for (const cell of cells) {
    const emission = cell.value * cell.factor;
    origin = worstOrigin(origin, cell.origin ?? "NOT_MEASURED");

    // Ce que la cartographie n'atteint pas reste visible en tant que tel. Le
    // seau non-alloué est un objet de plein droit, pas un état d'erreur (#6).
    if (cell.subPost === null || cell.subPost === undefined) {
      unallocated += emission;
      // Ventilé par période, parce que la règle d'allocation l'est : le
      // non-alloué d'un mois revient aux barres coulées CE mois-là. Un total
      // global ne saurait plus à quel mois il appartient.
      const key = monthOf(cell);
      unallocatedByPeriod[key] = (unallocatedByPeriod[key] ?? 0) + emission;
      continue;
    }

    const key = groupKey(cell);
    const g = groups.get(key);
    if (g) {
      g.emission += emission;
      g.origin = worstOrigin(g.origin, cell.origin ?? "NOT_MEASURED");
    } else {
      groups.set(key, { cell, emission, origin: cell.origin ?? "NOT_MEASURED" });
    }
  }

  // Une traduction par groupe, et non une par cellule : c'est tout l'intérêt
  // d'avoir agrégé d'abord.
  //
  // Les deux sorties ne jouent pas le même rôle. `pivot` est ce qui part dans
  // l'attestation : une cellule y porte sa position pivot et son contexte, et
  // rien d'autre. `lines` est la vue dérivée sous les conditions du moment,
  // utile à l'affichage — mais figer une ligne de référentiel dans un document
  // signé épinglerait tout inventaire passé à un cadre qui change (#61).
  const lines = {};
  const pivot = [];
  for (const { cell, emission, origin: groupOrigin } of groups.values()) {
    const line = translate(cell, taxonomy);
    lines[line] = (lines[line] ?? 0) + emission;
    pivot.push({
      subPost: cell.subPost,
      partType: cell.partType ?? null,
      caracterisation: cell.caracterisation,
      amount: emission,
      origin: groupOrigin,
    });
  }

  return { lines, pivot, origin, unallocated, unallocatedByPeriod,
           unit: RESULT_UNIT, groups: groups.size };
}

/**
 * La règle d'allocation du non-alloué — §14.2, « règle spécifique validée ».
 *
 * DÉCISION DU 1er AOÛT 2026 : le non-alloué d'un mois se divise entre les
 * barres coulées CE mois-là. Ni au prorata de la masse, ni de l'énergie : au
 * nombre de barres, parce que c'est l'unité que la mine produit et que le
 * chiffre phare est en tCO2e par once.
 *
 * Ce n'est pas une contradiction avec « le non-alloué se déclare et ne se
 * répartit jamais en silence ». Les deux énoncés vivent à des niveaux
 * différents, et il faut que les deux restent vrais :
 *
 *   - au niveau du PÉRIMÈTRE, le seau reste un poste à part. C'est lui que la
 *     réconciliation d'#48 compare au classeur d'AGM, et le répartir là
 *     rendrait l'écart invisible ;
 *   - au niveau de la BARRE, il est réparti — par une règle nommée, versionnée,
 *     et inscrite dans l'attestation. « En silence » est le mot qui compte.
 *
 * Un mois sans production coulée est refusé plutôt que divisé par zéro : ses
 * émissions non allouées existent et n'ont aucune barre à porter. Les taire
 * donnerait un total par barre plus flatteur que la réalité.
 *
 * @param {Record<string, number>} unallocatedByPeriod  « 2025-01 » -> tCO2e
 * @param {Record<string, number>} barsByPeriod         « 2025-01 » -> nombre de barres
 * @returns {{perBar: number, byPeriod: Record<string, number>, rule: string}}
 * @throws {Error} `PRODUCTION_MISSING`, `PRODUCTION_EMPTY`
 */
export function allocateUnallocated(unallocatedByPeriod, barsByPeriod) {
  const byPeriod = {};
  let perBar = 0;

  for (const [month, amount] of Object.entries(unallocatedByPeriod)) {
    if (amount === 0) continue;
    const bars = barsByPeriod?.[month];
    if (bars === undefined || bars === null) throw fault("PRODUCTION_MISSING", month);
    if (!(bars > 0)) throw fault("PRODUCTION_EMPTY", `${month} : ${bars} barre(s)`);
    const share = amount / bars;
    byPeriod[month] = share;
    perBar += share;
  }

  return { perBar, byPeriod, rule: "unallocated/bars-poured-same-month" };
}
