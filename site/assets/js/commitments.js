/**
 * Engagements salés, par cellule — la divulgation maîtrisée de l'issue #61.
 *
 * CE QUE LA DÉCISION DU 1er AOÛT IMPOSE. Granularité **par cellule**, et les
 * cellules non divulguées **restent dans l'attestation** : inutilisables, mais
 * toujours dénombrables, et le vérificateur peut voir pourquoi elles n'ont pas
 * servi au calcul. Un engagement unique sur toute la matrice aurait été moins
 * cher à écrire et n'aurait offert qu'un tout-ou-rien ; rien de la granularité
 * fine n'est coûteux aujourd'hui, et tout en est impossible plus tard, une fois
 * les attestations signées.
 *
 * POURQUOI LA VALEUR N'EST PAS DANS CE QUI EST SIGNÉ. C'est le point qui décide
 * de toute la forme. Pour qu'un porteur puisse retirer une ligne sans invalider
 * la signature, le document signé ne doit contenir QUE les engagements ; les
 * valeurs et leurs sels voyagent à côté, en divulgations. Retirer une
 * divulgation ne touche alors pas à un octet de ce qui a été signé. L'inverse —
 * signer les montants puis les effacer — casse la signature, et aucune
 * astuce de sérialisation ne rattrape cela.
 *
 * POURQUOI LA CATÉGORIE EST DANS L'ENGAGEMENT ET NON À CÔTÉ. La publier en clair
 * pour une cellule non divulguée dirait ce qui existe sans dire combien : « il y
 * a une ligne de minage » est déjà une information sur l'exploitation. La
 * structure elle-même fuit, et c'est le reproche que l'issue #61 fait à
 * l'alternative des attestations multiples. Ne restent donc visibles que trois
 * choses, et chacune parce que la décision les exige : qu'une cellule existe,
 * si elle a compté dans le total, et sinon pourquoi.
 *
 * LE SEL EST PAR CELLULE ET PAR ATTESTATION. Un sel partagé rendrait deux
 * cellules de même contenu reconnaissables l'une par l'autre, et un sel réutilisé
 * d'une attestation à l'autre permettrait de tester une hypothèse de montant sur
 * l'ensemble du pilote. 128 bits, tirés à l'émission, jamais dérivés du contenu.
 */
import { canonicalBytes } from "./canonical.js";
import { multibase58 } from "./multibase.js";

/** 128 bits. Un engagement n'est aussi fort que l'imprévisibilité de son sel. */
export function newSalt() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * L'engagement d'une cellule : SHA-256 de sa forme canonique, sel compris.
 *
 * La forme canonique n'est pas un détail d'implémentation : sans elle, le même
 * contenu réordonné donnerait un engagement différent, et un vérificateur qui
 * reconstruit l'objet depuis son propre JSON échouerait sans savoir pourquoi.
 * C'est la même raison qu'ailleurs dans ce produit, et c'est la même fonction.
 *
 * @param {object} disclosure la cellule en clair, sel inclus
 * @returns {Promise<string>} multibase base58btc
 */
export async function commit(disclosure) {
  const digest = await crypto.subtle.digest("SHA-256", canonicalBytes(disclosure));
  return multibase58(new Uint8Array(digest));
}

/**
 * Prépare la matrice : une liste signable et une liste de divulgations.
 *
 * L'ORDRE EST PORTEUR ET IL EST FIGÉ. Une divulgation se rattache à son
 * engagement par son rang, donc réordonner la matrice après signature les
 * désapparie. L'ordre vient de l'agrégation et ne se retrie pas.
 *
 * @param {Array<object>} cells les cellules pivot, montants compris
 * @param {(cell: object) => {used: boolean, reason?: string}} disposition
 * @returns {Promise<{commitments: Array<object>, disclosures: Array<object>}>}
 */
export async function commitMatrix(cells, disposition = () => ({ used: true })) {
  const commitments = [];
  const disclosures = [];

  for (const [index, cell] of cells.entries()) {
    const { used, reason } = disposition(cell, index);
    const disclosure = { index, salt: newSalt(), ...cell };
    disclosures.push(disclosure);

    const entry = { commitment: await commit(disclosure), used: Boolean(used) };
    // Une exclusion sans motif est le trou par lequel la complétude s'en va :
    // elle rend indistinguables « écartée à dessein » et « oubliée ». Le motif
    // est donc en clair, et c'est voulu — c'est ce que la décision demande au
    // vérificateur de pouvoir apprécier.
    if (!used) entry.reason = reason ?? "";
    commitments.push(entry);
  }

  return { commitments, disclosures };
}

/**
 * L'engagement sur le total, qui lie le chiffre à la matrice.
 *
 * Sans lui, un porteur pourrait ne divulguer qu'une partie des cellules et
 * présenter le total de son choix : chaque engagement de cellule tiendrait, et
 * rien ne dirait que leur somme n'est pas celle annoncée. L'engagement porte
 * donc sur la liste ORDONNÉE des engagements de cellules et sur le total, ce qui
 * rend les deux inséparables.
 */
export async function commitTotal(commitments, total, unit, salt = newSalt()) {
  const payload = { salt, total, unit, cells: commitments.map((c) => c.commitment) };
  return { salt, commitment: await commit(payload) };
}

/**
 * Vérifie une matrice partiellement divulguée.
 *
 * Rend un compte rendu et ne lève pas : « trois cellules sur vingt-quatre n'ont
 * pas été divulguées » est un résultat, pas une panne, et c'est même le cas
 * normal d'une divulgation maîtrisée. Ce qui est une panne, c'est une
 * divulgation qui ne correspond pas à son engagement — là, le document ment.
 *
 * @param {Array<{commitment: string, used: boolean, reason?: string}>} commitments
 * @param {Array<object>} disclosures celles que le porteur a bien voulu remettre
 * @returns {Promise<{ok: boolean, disclosed: number, withheld: number,
 *                    total: number, mismatched: Array<number>, unusable: Array<object>}>}
 */
export async function verifyMatrix(commitments, disclosures = []) {
  const byIndex = new Map(disclosures.map((d) => [d.index, d]));
  const mismatched = [];

  for (const [index, entry] of commitments.entries()) {
    const disclosure = byIndex.get(index);
    if (!disclosure) continue;                    // retirée : c'est permis
    if ((await commit(disclosure)) !== entry.commitment) mismatched.push(index);
  }

  return {
    ok: mismatched.length === 0,
    total: commitments.length,
    disclosed: byIndex.size,
    withheld: commitments.length - byIndex.size,
    mismatched,
    // Ce que le vérificateur doit pouvoir apprécier : ce qui n'a pas compté, et
    // pourquoi. Visible même sur une cellule non divulguée — c'est la décision.
    unusable: commitments
      .map((c, index) => ({ index, ...c }))
      .filter((c) => !c.used)
      .map(({ index, reason }) => ({ index, reason })),
  };
}

/**
 * Le total se recalcule-t-il depuis ce qui a été divulgué ?
 *
 * Ne vaut que si TOUTES les cellules comptées dans le total sont divulguées.
 * Autrement la réponse honnête est « on ne peut pas savoir » — et la distinguer
 * de « faux » est tout l'intérêt : une divulgation partielle n'est pas une
 * fraude, et l'afficher comme telle apprendrait au lecteur à ignorer l'alerte.
 */
export function recomputeTotal(commitments, disclosures) {
  const byIndex = new Map(disclosures.map((d) => [d.index, d]));
  const counted = commitments
    .map((c, index) => ({ index, used: c.used }))
    .filter((c) => c.used);

  const missing = counted.filter((c) => !byIndex.has(c.index));
  if (missing.length) {
    return { known: false, withheld: missing.length, total: null };
  }
  const total = counted.reduce((sum, c) => sum + (byIndex.get(c.index).amount ?? 0), 0);
  return { known: true, withheld: 0, total };
}
