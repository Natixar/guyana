/**
 * Le moteur de calcul carbone — contrat, pas encore implémentation.
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
 * ÉTAT — squelette de tâche 4 (issue #66). Les fonctions lèvent, de sorte que
 * les tests préliminaires échouent pour la bonne raison — « pas encore écrit »
 * — plutôt que de casser la construction. L'implémentation est la tâche 5.
 *
 * @see services/README.md
 * @see poc-data/Categories_taxonomy_GHG_protocol.json
 */

const NOT_IMPLEMENTED = "moteur non implémenté — issue #66, tâche 5";

/**
 * Traduit une cellule vers sa ligne du référentiel cible.
 *
 * Fonction TOTALE du triplet `(subPost, partType, caracterisation)`, sous les
 * conditions fixées de la taxonomie. La ligne est **dérivée** et jamais
 * choisie : c'est ce qui distingue une piste d'audit d'une décision humaine
 * sans règle derrière (§19.1).
 *
 * @param {{subPost: number|null, partType: number|null, caracterisation: number|null}} cell
 * @param {object} taxonomy la taxonomie pivot et ses traductions
 * @returns {string} la ligne cible, par exemple "1.1"
 * @throws {Error} `CARACTERISATION_REQUIRED` si la caractérisation manque —
 *         la deviner reviendrait à choisir la ligne à la main
 * @throws {Error} `PART_TYPE_EXCLUDED` pour une part hors périmètre, refusée
 *         plutôt qu'ignorée : ignorer produirait un écart entre référentiels
 *         sans cause visible
 */
export function translate(cell, taxonomy) {   // eslint-disable-line no-unused-vars
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Agrège des cellules en un profil d'émission.
 *
 * Trois propriétés que les vecteurs exercent :
 *
 * - **les lignes se somment** par ligne cible dérivée, jamais par ligne
 *   stockée ;
 * - **l'origine se propage** : un agrégat vaut au mieux sa pire entrée. Une
 *   entrée `ESTIMATED` rend l'agrégat `ESTIMATED` (#46) ;
 * - **le non-alloué se déclare** dans son propre poste et ne se répartit
 *   jamais en silence, faute de quoi le total serait complet et faux.
 *
 * @param {Array<object>} cells
 * @param {object} taxonomy
 * @returns {{lines: Record<string, number>, origin: string, unallocated: number}}
 * @throws {Error} propage les erreurs de `translate`
 */
export function aggregate(cells, taxonomy) {  // eslint-disable-line no-unused-vars
  throw new Error(NOT_IMPLEMENTED);
}
