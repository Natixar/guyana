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
 * ─── UNE DONNÉE EST UN DÉBIT, PAS UNE QUANTITÉ ───────────────────────────
 *
 * H1 n'a qu'un mode de calcul, et c'est ce qui le rend simple : une métrique
 * multipliée par un facteur d'émission. La métrique est stockée DIVISÉE PAR LA
 * DURÉE de son intervalle — un débit moyen, supposé uniforme sur l'intervalle —
 * et l'émission se lit donc
 *
 *     débit × facteur × durée de l'intervalle d'intégration
 *
 * Cette division n'est pas une commodité. Sans elle, « intégrer sur un
 * intervalle quelconque » n'a pas de sens : une cellule mensuelle recouvrant à
 * moitié la fenêtre demandée devrait compter pour moitié, et la seule façon d'y
 * arriver en partant d'une quantité est de la rediviser par sa durée — c'est-à-
 * dire de reconstituer le débit qu'on avait refusé de stocker. Le cube indexe
 * les périodes en `tstzrange` et interroge en `&&` précisément pour servir des
 * recouvrements partiels ; les servir puis les sommer entiers serait un
 * sur-comptage silencieux.
 *
 * L'hypothèse d'uniformité est le prix, et elle est explicite : entre deux
 * relevés mensuels, rien ne dit comment la consommation s'est répartie, et un
 * débit constant est la seule répartition qui n'invente pas de structure.
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
 * par unité d'activité, et cette unité se déduit de la dimension de la cellule
 * sous l'hypothèse SI : un débit de carburant est en m3/s, et il n'y a rien à
 * porter à côté du nombre.
 *
 * Il n'y a donc rien à contrôler ici. La conversion — onces vers kilogrammes,
 * litres vers mètres cubes, facteurs par litre vers facteurs par mètre cube —
 * a lieu une fois, à l'ingestion, là où les unités d'origine existent encore.
 * Au-delà de cette frontière, il n'y a que des nombres, et un nombre n'a pas
 * d'unité à trahir.
 *
 * L'UNITÉ EST CELLE DU CALCUL, PAS CELLE DE LA DONNÉE, et c'est pourquoi elle
 * est ici et non sur chaque cellule. Une cellule porte un débit de gazole ; que
 * ce débit devienne des kgCO2e tient au facteur qu'on lui applique, et le jour
 * où le même débit servira à calculer une consommation d'eau, une cellule qui
 * aurait emporté « kgCO2e » dans sa forme serait devenue fausse sans que rien
 * ne bouge. L'unité appartient donc au profil — au résultat d'UN calcul.
 *
 * Publier en tCO2e quand un référentiel l'exige est une affaire de rendu : on
 * divise par mille en écrivant un rapport, jamais en calculant ni en signant.
 */
const RESULT_UNIT = "kgCO2e";

/**
 * Le mode d'impact — UN champ d'annotation, jamais sept colonnes.
 *
 * Décision 3 de l'issue #61. Les facteurs par gaz sont rares dans les bases :
 * sept colonnes seraient vides presque partout. On n'émet sept cellules que là
 * où un facteur est réellement décomposé, ce qui répète la mesure de base et
 * reste acceptable puisque le cas est rare. Le champ nomme aussi le fluide dans
 * une cellule de fuite directe, et c'est par lui que les impacts non
 * climatiques entreront.
 */
const MODE_DEFAULT = "aggregate";

const worstOrigin = (a, b) =>
  ORIGIN_RANK.indexOf(a) >= ORIGIN_RANK.indexOf(b) ? a : b;

/**
 * La clé de regroupement : sous-poste pivot **et** contexte.
 *
 * Le contexte est ce dont la traduction dépend en plus du sous-poste, c'est-à-
 * dire exactement les entrées de la fonction de traduction. Regrouper sur moins
 * que cela fusionnerait des cellules qui n'aboutissent pas à la même ligne.
 */
/**
 * La maille d'agrégation, et ce qu'elle refuse de fondre ensemble.
 *
 * LA PÉRIODE Y ENTRE, ET C'EST UNE CORRECTION. Sans elle, douze cellules
 * mensuelles de même position pivot se fondaient en une seule dont personne ne
 * pouvait plus dire à quel mois elle appartenait. Or la période est un axe de la
 * matrice de l'issue #61 : une cellule porte un flux moyen SUR UN INTERVALLE, et
 * une intégration sur un intervalle quelconque n'a de sens que si l'intervalle
 * a survécu à l'agrégation.
 *
 * LA MÉTROLOGIE DE LA CELLULE N'Y ENTRE PAS, et le vecteur qui l'affirme a
 * raison : ce qui se somme dans un groupe est l'ÉMISSION, pas la donnée
 * d'activité. Ni la dimension ni l'unité d'affichage ne comptent — mille
 * kilogrammes d'explosif et une tonne sont le même débit SI écrit de deux
 * façons, et leurs émissions se somment. Séparer les groupes là-dessus
 * produirait deux cellules là où le référentiel n'en voit qu'une.
 */
const groupKey = (cell, span) =>
  [cell.subPost, cell.partType, cell.caracterisation,
   span.start, span.end,
   cell.mode ?? MODE_DEFAULT].join("/");

/** Le mois d'un intervalle, « 2025-01 », depuis son début. */
const monthOf = (span) => span.start.slice(0, 7);

/** Millisecondes vers secondes : le débit est en unité SI PAR SECONDE. */
const secondsBetween = (fromMs, toMs) => (toMs - fromMs) / 1000;

/**
 * L'intervalle propre d'une cellule, en millisecondes epoch.
 *
 * Une cellule SANS période est refusée et non intégrée sur une durée par
 * défaut : un débit sans intervalle ne désigne aucune quantité, et lui en
 * prêter une produirait un nombre plausible que la signature figerait.
 */
function ownSpan(cell) {
  const from = Date.parse(cell.periodStart ?? "");
  const to = Date.parse(cell.periodEnd ?? "");
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw fault("PERIOD_REQUIRED", String(cell.id ?? "cellule sans identifiant"));
  }
  if (!(to > from)) {
    throw fault("PERIOD_EMPTY", String(cell.id ?? "cellule sans identifiant"));
  }
  return [from, to];
}

/**
 * Normalise une liste de fenêtres : triées, fusionnées, jamais chevauchantes.
 *
 * L'empreinte temporelle d'un lot est un MULTI-intervalle — un par opération —
 * et deux opérations peuvent se recouvrir. Intégrer sur chacune séparément
 * compterait deux fois le recouvrement, ce qui gonflerait l'empreinte du lot
 * exactement là où les opérations sont les plus denses. La fusion se fait donc
 * ici, une fois, avant toute arithmétique.
 */
function mergedWindows(windows) {
  const spans = windows
    .map((w) => [Date.parse(w.start ?? w.periodStart), Date.parse(w.end ?? w.periodEnd)])
    .filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b) && b > a)
    .sort((x, y) => x[0] - y[0]);

  const out = [];
  for (const [a, b] of spans) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Les intervalles sur lesquels une cellule est réellement intégrée.
 *
 * Sans fenêtre, c'est sa propre période : la quantité entière que la cellule
 * décrit. Avec des fenêtres, c'est le recouvrement — et il en sort UN
 * intervalle par morceau, jamais un intervalle enveloppe. Une enveloppe
 * couvrant deux opérations séparées d'un mois prétendrait avoir intégré le mois
 * qui les sépare.
 */
function integrationSpans(cell, windows) {
  const [from, to] = ownSpan(cell);

  // LES BORNES INCHANGÉES SONT RENDUES TELLES QUELLES, et non reformatées. Le
  // magasin a signé ses horodatages sous une certaine écriture ; les réécrire
  // ferait diverger le document signé de l'extraction dont il est tiré, pour
  // rien. Seul un intervalle que le moteur a lui-même découpé — un morceau
  // taillé par une fenêtre — sort dans la forme normalisée du moteur.
  const whole = { start: cell.periodStart, end: cell.periodEnd,
                  seconds: secondsBetween(from, to) };
  if (!windows) return [whole];

  const spans = [];
  for (const [a, b] of windows) {
    const start = Math.max(from, a);
    const end = Math.min(to, b);
    if (end <= start) continue;
    spans.push(start === from && end === to
      ? whole
      : { start: iso(start), end: iso(end), seconds: secondsBetween(start, end) });
  }
  return spans;
}

/**
 * L'émission d'une cellule sur sa propre période, en kgCO2e.
 *
 * Exportée parce que le signataire en a besoin hors agrégation : une cellule
 * ÉCARTÉE entre dans la matrice avec son montant, et ce montant doit se calculer
 * par la même formule que celui d'une cellule retenue. Deux formules, même
 * d'accord aujourd'hui, divergeraient un jour sans que rien ne le signale.
 */
export function emissionOf(cell) {
  const [from, to] = ownSpan(cell);
  return cell.flux * cell.factor * secondsBetween(from, to);
}

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
 * @param {Array<{start: string, end: string}>} [windows] les intervalles sur
 *        lesquels intégrer. Absents, chaque cellule est intégrée sur sa propre
 *        période — la quantité entière qu'elle décrit.
 * @returns {{pivot: Array<object>, lines: Record<string, number>, origin: string,
 *            unallocated: number, unit: string, groups: number}}
 *          `pivot` est ce qui se signe ; `lines` est la vue dérivée. Montants en kgCO2e.
 */
export function aggregate(cells, taxonomy, windows = null) {
  if (!Array.isArray(cells)) throw fault("CELLS_REQUIRED");
  if (!taxonomy) throw fault("TAXONOMY_REQUIRED");

  const merged = Array.isArray(windows) && windows.length ? mergedWindows(windows) : null;

  const groups = new Map();
  const unallocatedByPeriod = {};
  let unallocated = 0;
  let origin = ORIGIN_RANK[0];

  for (const cell of cells) {
    // L'origine se propage même quand la fenêtre ne retient rien de la cellule :
    // une cellule servie a été jugée pertinente, et la taire au motif qu'elle
    // pèse zéro sur cette fenêtre-ci embellirait l'agrégat par un effet de bord.
    origin = worstOrigin(origin, cell.origin ?? "NOT_MEASURED");

    // Un débit s'intègre sur une durée, et sur chaque morceau séparément : deux
    // fenêtres disjointes donnent deux cellules pivot datées, pas une moyenne
    // que personne ne saurait situer.
    for (const span of integrationSpans(cell, merged)) {
      const emission = cell.flux * cell.factor * span.seconds;

      // Ce que la cartographie n'atteint pas reste visible en tant que tel. Le
      // seau non-alloué est un objet de plein droit, pas un état d'erreur (#6).
      if (cell.subPost === null || cell.subPost === undefined) {
        unallocated += emission;
        // Ventilé par période, parce que la règle d'allocation l'est : le
        // non-alloué d'un mois revient aux barres coulées CE mois-là. Un total
        // global ne saurait plus à quel mois il appartient.
        const key = monthOf(span);
        unallocatedByPeriod[key] = (unallocatedByPeriod[key] ?? 0) + emission;
        continue;
      }

      const key = groupKey(cell, span);
      const g = groups.get(key);
      if (g) {
        g.emission += emission;
        g.origin = worstOrigin(g.origin, cell.origin ?? "NOT_MEASURED");
      } else {
        groups.set(key, { cell, span, emission, origin: cell.origin ?? "NOT_MEASURED" });
      }
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
  for (const { cell, span, emission, origin: groupOrigin } of groups.values()) {
    const line = translate(cell, taxonomy);
    lines[line] = (lines[line] ?? 0) + emission;
    pivot.push({
      // La catégorie : une position dans la taxonomie pivot, JAMAIS une ligne
      // de référentiel. C'est `lines` qui porte la ligne dérivée, et elle ne se
      // signe pas — un cadre qui change épinglerait tout inventaire passé.
      subPost: cell.subPost,
      partType: cell.partType ?? null,
      caracterisation: cell.caracterisation,
      // L'INTERVALLE RÉELLEMENT INTÉGRÉ, et non la période déclarée de la
      // cellule. Les deux coïncident quand on intègre tout ; ils divergent dès
      // qu'une fenêtre ne prend qu'un morceau, et c'est alors le morceau qui
      // rend compte du montant. Afficher la période déclarée à côté d'un montant
      // partiel dirait « voici janvier » en montrant trois jours.
      period: { start: span.start, end: span.end },
      amount: emission,
      mode: cell.mode ?? MODE_DEFAULT,
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
