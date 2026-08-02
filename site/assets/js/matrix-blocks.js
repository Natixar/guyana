/**
 * Regrouper la matrice en BLOCS lisibles.
 *
 * ─── LE PROBLÈME ────────────────────────────────────────────────────────
 *
 * Une attestation carbone de barre porte cent quarante cellules. Servies
 * telles quelles, ligne à ligne, elles ne se lisent pas : personne ne compare
 * cent quarante nombres, et la structure — quel poste pèse, quelle unité de
 * production, ce qui a été écarté et pourquoi — disparaît sous le détail.
 *
 * Le détail doit pourtant RESTER. C'est la décision 1 de l'issue #61 : une
 * cellule écartée demeure dans l'attestation, dénombrable, avec son motif. On
 * ne peut donc pas résumer en jetant ; on regroupe, et chaque bloc rend compte
 * de tout ce qu'il contient.
 *
 * ─── LA MAILLE, ET POURQUOI CELLE-LÀ ────────────────────────────────────
 *
 * Deux cellules appartiennent au même bloc quand elles ont la même POSITION —
 * sous-poste, type de part, caractérisation, mode — et la même DISPOSITION.
 *
 * L'UNITÉ DE PRODUCTION N'EST PAS DANS LA MAILLE, ET C'EST MESURÉ. En H1
 * l'étape est le département, et le cube porte déjà une cellule par
 * (département, sous-poste, mois) : la mettre dans la maille donne 110 blocs
 * d'une à trois cellules sur une extraction réelle de 142 — c'est-à-dire un
 * tableau à peine plus court, où le total, le minimum et le maximum d'un bloc
 * ne disent rien puisqu'il n'y a rien à comparer. Retirée, la même extraction
 * donne 12 blocs de trois à vingt-huit cellules, et les trois chiffres
 * retrouvent leur sens : ils comparent les unités de production entre elles.
 *
 * Elle n'est pas perdue pour autant. Le bloc dénombre les unités qu'il couvre
 * et les nomme, et l'étendue min–max est précisément la dispersion entre elles.
 * Le jour où une unité flexible ferait tantôt une opération tantôt une autre,
 * la question se reposera — c'est une propriété de H1, pas une simplification.
 *
 * LA DISPOSITION EN FAIT PARTIE, ET C'EST ELLE QUI PORTE LE LOT. Le lot n'est
 * pas un champ de la cellule — il n'a pas à l'être, il ne se signe pas — mais
 * une cellule écartée porte son motif, et ce motif nomme le lot : « production
 * lot LOT-2025-01, not LOT-2024-12 ». Regrouper par motif regroupe donc par
 * lot, sans avoir eu à faire voyager le lot dans le document.
 *
 * LA PÉRIODE N'EN FAIT PAS PARTIE, et c'est le point du regroupement : ce sont
 * précisément les douze mois d'une même position qu'on veut voir réunis. Le
 * bloc rend l'intervalle qu'il couvre, du plus tôt au plus tard.
 *
 * ─── CE QUE CHAQUE BLOC DIT ─────────────────────────────────────────────
 *
 * Le total, le plus petit, le plus grand, et le nombre de cellules. Les trois
 * derniers ne sont pas de l'ornement : un total seul ne distingue pas douze
 * mois réguliers d'un mois qui porte tout. L'écart entre le minimum et le
 * maximum est la première chose qu'un auditeur regarde, et la seule qui
 * suggère où creuser.
 *
 * PART COMPRISE. Une cellule porte le montant réellement consommé et, à côté,
 * la fraction que cette barre en supporte. Le bloc porte donc les deux : le
 * montant brut, comparable au cube, et ce que la barre en tire.
 */

/** La maille. Ce qui change ici sépare deux blocs. */
const key = (c) => [
  c.subPost ?? "", c.partType ?? "", c.caracterisation ?? "", c.mode ?? "",
  c.used === false ? "out" : "in", c.reason ?? "",
].join("/");

const earliest = (a, b) => (!a || (b && b < a) ? b : a);
const latest = (a, b) => (!a || (b && b > a) ? b : a);

/**
 * Regroupe des cellules divulguées en blocs.
 *
 * L'ORDRE DES BLOCS EST CELUI DU POIDS, décroissant. Un tableau trié par
 * identifiant fait chercher ; un tableau trié par contribution répond à la
 * question qu'on se pose en l'ouvrant. Les cellules écartées passent après
 * celles qui comptent, à contribution nulle.
 *
 * @param {Array<object>} cells cellules divulguées : `{step, subPost, partType,
 *        caracterisation, mode, period, amount, share, origin, used, reason}`
 * @returns {Array<object>} un bloc par maille, le plus lourd d'abord
 */
export function groupCells(cells) {
  const blocks = new Map();

  for (const c of cells ?? []) {
    const amount = typeof c.amount === "number" ? c.amount : 0;
    // Part absente : les attestations d'avant le 2 août 2026 n'en portaient
    // pas, et l'unité est alors la bonne lecture.
    const share = typeof c.share === "number" ? c.share : 1;
    const borne = amount * share;

    const k = key(c);
    const b = blocks.get(k);
    if (!b) {
      blocks.set(k, {
        steps: new Set(c.step === undefined || c.step === null ? [] : [c.step]),
        subPost: c.subPost ?? null,
        partType: c.partType ?? null, caracterisation: c.caracterisation ?? null,
        mode: c.mode ?? null,
        used: c.used !== false, reason: c.reason ?? "",
        share,
        cells: 1,
        total: amount, min: amount, max: amount,
        borneTotal: borne,
        from: c.period?.start ?? null, to: c.period?.end ?? null,
        origin: c.origin ?? null,
        indexes: c.index === undefined ? [] : [c.index],
      });
      continue;
    }
    b.cells += 1;
    if (c.step !== undefined && c.step !== null) b.steps.add(c.step);
    b.total += amount;
    b.borneTotal += borne;
    if (amount < b.min) b.min = amount;
    if (amount > b.max) b.max = amount;
    b.from = earliest(b.from, c.period?.start ?? null);
    b.to = latest(b.to, c.period?.end ?? null);
    // L'ORIGINE SE PROPAGE PAR LE PIRE, comme dans le moteur : un bloc ne vaut
    // pas mieux que sa plus faible entrée, et prétendre le contraire au moment
    // de résumer défairait la règle au seul endroit où elle se lit.
    b.origin = worseOrigin(b.origin, c.origin ?? null);
    // Une part qui varie dans un bloc n'a pas de sens — la disposition est dans
    // la maille — mais si cela arrivait, ne pas en inventer une.
    if (b.share !== share) b.share = null;
    if (c.index !== undefined) b.indexes.push(c.index);
  }

  return [...blocks.values()].sort((a, b) => b.borneTotal - a.borneTotal);
}

const ORIGIN_RANK = ["MEASURED", "DERIVED", "ESTIMATED", "NOT_MEASURED"];

function worseOrigin(a, b) {
  if (!a) return b;
  if (!b) return a;
  return ORIGIN_RANK.indexOf(a) >= ORIGIN_RANK.indexOf(b) ? a : b;
}

/**
 * Le compte rendu d'ensemble : ce que la barre porte, et ce qui n'a pas compté.
 *
 * Les deux totaux sont rendus séparément et jamais additionnés. Additionner ce
 * qui compte et ce qui a été écarté donnerait un nombre qui ne veut rien dire
 * mais qui ressemble à un total.
 */
export function summarise(blocks) {
  let borne = 0, setAside = 0, cells = 0, kept = 0;
  for (const b of blocks) {
    cells += b.cells;
    if (b.used) { borne += b.borneTotal; kept += b.cells; }
    else setAside += b.total;
  }
  return { borne, setAside, cells, kept, out: cells - kept, blocks: blocks.length };
}
