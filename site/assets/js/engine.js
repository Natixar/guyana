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
 * L'ÉTAPE Y ENTRE, et elle y entre en PREMIER parce que c'est l'axe de
 * trajectoire matière de l'issue #61. Sans elle, deux unités de production qui
 * font la même chose au même moment se fondent en une cellule dont plus rien ne
 * dit où elle a eu lieu — et c'est justement le long de cet axe qu'un porteur
 * divulgue la ligne de transport sans la ligne de minage.
 *
 * LA MÉTROLOGIE DE LA CELLULE N'Y ENTRE PAS, et le vecteur qui l'affirme a
 * raison : ce qui se somme dans un groupe est l'ÉMISSION, pas la donnée
 * d'activité. Ni la dimension ni l'unité d'affichage ne comptent — mille
 * kilogrammes d'explosif et une tonne sont le même débit SI écrit de deux
 * façons, et leurs émissions se somment. Séparer les groupes là-dessus
 * produirait deux cellules là où le référentiel n'en voit qu'une.
 */
const groupKey = (cell, span) =>
  [cell.step ?? "", cell.subPost, cell.partType, cell.caracterisation,
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
 * L'intervalle d'intégration d'une cellule : le sien, et jamais un autre.
 *
 * LE DÉCOUPAGE APPARTIENT AU MAGASIN, décision du 2 août 2026. Une extraction
 * revient déjà taillée à la fenêtre demandée : une cellule mensuelle
 * interrogée sur trois jours arrive avec trois jours de période et son débit
 * inchangé — un débit est extensif dans le temps, le lire sur un intervalle
 * plus court ne le modifie pas.
 *
 * Ce moteur avait un temps porté ce découpage, avec des fenêtres qu'il
 * fusionnait avant de calculer. C'était deux endroits pour une seule
 * arithmétique, et le mauvais : le magasin est le seul à connaître à la fois la
 * période stockée et la fenêtre demandée, et il signe ce qu'il sert. Ce qui
 * arrive ici a donc déjà la bonne durée, et il ne reste qu'à intégrer.
 */
function ownInterval(cell) {
  const [from, to] = ownSpan(cell);
  return { start: cell.periodStart, end: cell.periodEnd,
           seconds: secondsBetween(from, to) };
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
 * @param {Array<object>} cells déjà taillées à la fenêtre par le magasin
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
    // L'origine se propage même quand la fenêtre ne retient rien de la cellule :
    // une cellule servie a été jugée pertinente, et la taire au motif qu'elle
    // pèse zéro sur cette fenêtre-ci embellirait l'agrégat par un effet de bord.
    origin = worstOrigin(origin, cell.origin ?? "NOT_MEASURED");

    // Un débit s'intègre sur une durée, et celle-ci est celle que le magasin a
    // servie — déjà taillée à la fenêtre demandée, déjà signée.
    const span = ownInterval(cell);
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
      // L'ÉTAPE — l'unité de production, qui est l'opération sous les bijections
      // H1. Un ENTIER d'une taxonomie masquée, et c'est ce qui rend l'axe
      // publiable : « étape 7 » ne dit rien de l'organigramme du client, alors
      // que « Sinohydro » le dirait. Une attestation sans cet axe ne permettrait
      // pas de retirer une ligne de minage en gardant une ligne de transport,
      // ce qui est l'usage même de la divulgation maîtrisée.
      step: cell.step ?? null,
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
 * La règle d'allocation — §14.2, « règle spécifique validée ».
 *
 * ─── CE QU'ELLE REMPLACE, ET POURQUOI ────────────────────────────────────
 *
 * La règle du 1er août divisait le non-alloué d'un mois entre les barres
 * coulées CE mois-là, puis sommait les mois de la fenêtre. Elle ne savait pas
 * COMPTER LES LOTS, et c'est la faute : le contenu carbone d'une barre se
 * calcule sur une fenêtre de deux mois — celui où son lot est produit, celui où
 * il est coulé — et sur cette fenêtre DEUX lots sont actifs. Sommer les deux
 * mois faisait porter à la barre les frais généraux d'un lot qui n'est pas le
 * sien, et l'unique échappatoire était une case à décocher, dans une interface,
 * avec un motif que personne n'aurait su rédiger.
 *
 * Élargir la fenêtre ne doit rien changer au résultat. C'est la même exigence
 * que l'invariance de fenêtre du cube, une couche plus haut : l'utilisateur
 * choisit ses bornes, et son choix ne déplace pas le chiffre.
 *
 * ─── LA RÈGLE ────────────────────────────────────────────────────────────
 *
 * Trois dispositions, et donc trois parts. Ce que la barre porte d'une cellule
 * est le produit de son montant par sa PART, et rien d'autre :
 *
 *   - RETENUE — la cellule appartient au lot de la barre. Part `1/barsInLot` :
 *     le lot se divise entre ses barres, au nombre, parce que c'est l'unité que
 *     la mine produit et que le chiffre phare est par once ;
 *   - PARTAGÉE — la cellule n'appartient à aucun lot : un département hors du
 *     chemin de la matière consomme sans qu'on puisse dire pour quel lot. Elle
 *     se divise D'ABORD entre les lots actifs sur la fenêtre, PUIS entre les
 *     barres du lot. Part `1/(lotsInWindow × barsInLot)` ;
 *   - ÉCARTÉE — la cellule appartient à un AUTRE lot. Part nulle, et elle reste
 *     dans la matrice avec son motif (décision 1 de l'issue #61).
 *
 * La division par `lotsInWindow` est exactement ce qui rend la fenêtre neutre :
 * doubler la fenêtre double le partagé et double le nombre de lots vus.
 *
 * Ce n'est pas une contradiction avec « le non-alloué se déclare et ne se
 * répartit jamais en silence ». Les deux énoncés vivent à des niveaux
 * différents, et il faut que les deux restent vrais :
 *
 *   - au niveau du PÉRIMÈTRE, le seau reste un poste à part. C'est lui que la
 *     réconciliation d'#48 compare au classeur d'AGM, et le répartir là
 *     rendrait l'écart invisible ;
 *   - au niveau de la BARRE, il est réparti — par une règle nommée, versionnée,
 *     et dont les deux diviseurs voyagent dans l'attestation. « En silence » est
 *     le mot qui compte : un vérificateur lit `lotsInWindow` et `barsInLot`, et
 *     refait la division.
 *
 * Un lot sans barre, une fenêtre sans lot : refusés plutôt que divisés par
 * zéro. Les émissions existent et n'ont personne à porter ; les taire donnerait
 * un chiffre par barre plus flatteur que la réalité.
 *
 * @param {{allocated?: number, shared?: number,
 *          lotsInWindow?: number, barsInLot?: number}} input
 *        `allocated` et `shared` en kgCO2e, avant application des parts.
 * @returns {{perBar: number, lotTotal: number, shareUsed: number,
 *            shareShared: number, lotsInWindow: number, barsInLot: number,
 *            rule: string}}
 * @throws {Error} `LOTS_IN_WINDOW_INVALID`, `BARS_IN_LOT_INVALID`
 */
export function allocateToBar({ allocated = 0, shared = 0,
                                lotsInWindow = 1, barsInLot = 1 } = {}) {
  if (!Number.isInteger(lotsInWindow) || lotsInWindow < 1) {
    throw fault("LOTS_IN_WINDOW_INVALID", String(lotsInWindow));
  }
  if (!Number.isInteger(barsInLot) || barsInLot < 1) {
    throw fault("BARS_IN_LOT_INVALID", String(barsInLot));
  }

  const lotTotal = allocated + shared / lotsInWindow;
  return {
    lotTotal,
    perBar: lotTotal / barsInLot,
    shareUsed: 1 / barsInLot,
    shareShared: 1 / (lotsInWindow * barsInLot),
    lotsInWindow,
    barsInLot,
    rule: "lot/shared-over-lots-in-window-then-bars-in-lot",
  };
}
