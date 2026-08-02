/**
 * La sélection des données du contenu carbone d'une barre — AUTOMATIQUE.
 *
 * ─── POURQUOI ELLE NE DEMANDE RIEN À PERSONNE ────────────────────────────
 *
 * Une interface où l'opérateur cocherait les cellules à retenir serait une
 * interface où le chiffre dépend de qui l'a produit. Pire, le seul endroit où
 * elle serait vraiment nécessaire est le plus difficile à expliquer : « décochez
 * le non-alloué du second mois » n'a pas de justification qu'on puisse écrire
 * dans une attestation sans rougir. La sélection est donc DÉRIVÉE — de la barre,
 * de son lot, et du modèle de procédé — et le motif de chaque décision est
 * calculé en même temps que la décision.
 *
 * ─── LA JOINTURE, EN TROIS FAITS ─────────────────────────────────────────
 *
 * 1. Une barre porte son lot. Un lot porte son mois de production et son mois de
 *    coulée — le suivant. La fenêtre d'étude est donc celle des DEUX mois, et
 *    elle se lit dans le jeu d'essai, elle ne se saisit pas.
 *
 * 2. Un procédé nomme ses étapes, et chaque étape nomme ses départements. Un
 *    département cité par une étape est sur le CHEMIN DE LA MATIÈRE : ce qu'il
 *    consomme un mois donné appartient au lot produit ce mois-là. Un département
 *    qui n'est cité par aucune étape consomme sans qu'on puisse dire pour quel
 *    lot ; il n'appartient à aucun, et sa consommation se partage.
 *
 * 3. Sur une fenêtre de deux mois, DEUX lots sont actifs. Le partagé se divise
 *    donc d'abord par le nombre de lots vus, puis par le nombre de barres du
 *    lot. C'est ce comptage qui rend l'élargissement de la fenêtre neutre, et
 *    c'est lui qui remplace la case à décocher.
 *
 * ─── CE QUE CE MODULE N'EST PAS ──────────────────────────────────────────
 *
 * Il ne calcule aucune émission et ne connaît aucun facteur : il classe. Le
 * montant vient du moteur, la part vient de la règle d'allocation, et le
 * signataire refait les deux. Ce qu'il produit est une liste de DISPOSITIONS,
 * c'est-à-dire exactement ce dont la couche de couverture du signataire a
 * besoin pour constater que le client a rendu compte de tout ce qu'on lui a
 * servi.
 *
 * Les motifs sont en anglais : ils voyagent dans un document W3C destiné à un
 * affineur, un acheteur ou un auditeur qui n'est pas forcément francophone.
 *
 * @see site/assets/js/engine.js — `allocateToBar`, la règle des deux diviseurs
 * @see services/signer/coverage.mjs — USED / SHARED / EXCLUDED
 */

/** Une erreur dont le code est stable, pour que l'appelant décide sans lire le texte. */
function fault(code, detail) {
  const e = new Error(detail ? `${code} — ${detail}` : code);
  e.code = code;
  return e;
}

/**
 * Le même instant, un mois plus tard.
 *
 * Les bornes du jeu d'essai sont à minuit guyanien, soit 04:00 UTC : les
 * décaler d'un nombre fixe de jours désalignerait février de janvier. `Date`
 * connaît la longueur des mois ; on la laisse faire.
 */
function addMonth(iso) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}

const overlaps = (a, b) =>
  Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

const contains = (span, instant) =>
  Date.parse(span.start) <= Date.parse(instant) && Date.parse(instant) < Date.parse(span.end);

/**
 * Les départements que le procédé place sur le chemin de la matière.
 *
 * L'union des départements de toutes les étapes. Ce qui n'y est pas n'est pas
 * « hors périmètre » — ces émissions comptent — mais « sans lot » : la
 * maintenance générale, l'administration, les campements consomment pour
 * l'exploitation entière et pour aucun lot en particulier.
 */
export function departmentsOnPath(fixture) {
  const steps = fixture?.process?.steps ?? [];
  return new Set(steps.flatMap((s) => s.departments ?? []));
}

/**
 * Le plan d'étude d'une barre : la fenêtre, les lots vus, les barres du lot.
 *
 * Tout y est dérivé du jeu d'essai. Rien n'y est saisi, et c'est la propriété
 * qui compte : deux opérateurs qui certifient la même barre obtiennent le même
 * plan, donc le même chiffre.
 *
 * @param {object} bar     la barre, telle que le registre la porte
 * @param {object} fixture le jeu d'essai ERP
 * @returns {{lot: object, window: {start: string, end: string},
 *            lotsInWindow: string[], barsInLot: number, onPath: Set<number>,
 *            byLot: Array<{id: string, period: object}>}}
 * @throws {Error} `LOT_UNKNOWN`, `LOT_PERIOD_MISSING`, `LOT_HAS_NO_BAR`
 */
export function planForBar(bar, fixture) {
  const lot = (fixture?.lots ?? []).find((l) => l.id === bar?.lot);
  if (!lot) throw fault("LOT_UNKNOWN", String(bar?.lot));
  if (!lot.period?.start || !lot.period?.end) throw fault("LOT_PERIOD_MISSING", lot.id);

  // Le mois de production, PUIS le mois de coulée. Les deux, parce que la barre
  // n'existe qu'au second et que ce qui l'a produite a été consommé au premier.
  const window = { start: lot.period.start, end: addMonth(lot.period.end) };

  // Les lots ACTIFS sur la fenêtre, comptés et non supposés. Sur le dernier mois
  // du jeu d'essai il n'y en a qu'un, et c'est juste : il n'y a rien à partager
  // avec un lot qui n'existe pas.
  const active = (fixture.lots ?? []).filter((l) => l.period && overlaps(l.period, window));

  const barsInLot = (fixture.bars ?? []).filter((b) => b.lot === lot.id).length;
  if (barsInLot < 1) throw fault("LOT_HAS_NO_BAR", lot.id);

  return {
    lot,
    window,
    lotsInWindow: active.map((l) => l.id),
    barsInLot,
    onPath: departmentsOnPath(fixture),
    byLot: active.map((l) => ({ id: l.id, period: l.period })),
  };
}

/** Le lot dont la période de production contient l'instant, ou rien. */
const lotAt = (plan, instant) =>
  plan.byLot.find((l) => contains(l.period, instant))?.id ?? null;

/**
 * Une disposition par cellule servie, avec son motif.
 *
 * Trois issues, et une seule règle pour les départager — le département est-il
 * sur le chemin de la matière, et si oui, à quel lot son mois appartient-il :
 *
 *   - `USED`     — chemin de la matière, mois du lot de la barre ;
 *   - `EXCLUDED` — chemin de la matière, mois d'un AUTRE lot. Elle reste dans la
 *                  matrice, avec son montant et son motif, part nulle ;
 *   - `SHARED`   — hors du chemin de la matière : aucun lot ne la revendique.
 *
 * Le quatrième cas — sur le chemin, mais aucun lot actif à cette date — ne
 * devrait pas se produire puisque la fenêtre est bâtie sur des lots. S'il se
 * produit, la cellule est PARTAGÉE et non écartée : la faire disparaître au
 * motif qu'on ne sait pas la classer réduirait le chiffre sans le dire.
 *
 * @param {Array<object>} cells ce que le magasin a servi, déjà taillé
 * @param {object} plan le plan rendu par `planForBar`
 * @returns {Array<{id: string, use: string, reason?: string}>}
 */
export function disposeCells(cells, plan) {
  return (cells ?? []).map((cell) => {
    if (!plan.onPath.has(cell.step)) {
      return { id: cell.id, use: "SHARED",
               reason: "support department: consumed for the operation, not for one lot" };
    }
    const owner = lotAt(plan, cell.periodStart);
    if (owner === plan.lot.id) return { id: cell.id, use: "USED" };
    if (owner === null) {
      return { id: cell.id, use: "SHARED",
               reason: "no production lot active over this period" };
    }
    return { id: cell.id, use: "EXCLUDED",
             reason: `production lot ${owner}, not ${plan.lot.id}` };
  });
}

/** Un dénombrement lisible des dispositions, pour l'écran et pour le journal. */
export function tally(dispositions) {
  const n = { USED: 0, SHARED: 0, EXCLUDED: 0 };
  for (const d of dispositions) n[d.use] = (n[d.use] ?? 0) + 1;
  return n;
}
