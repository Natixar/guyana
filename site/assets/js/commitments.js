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
 *
 * `commitTotal` QUANTIFIE SON TOTAL AVANT DE LE HACHER — #104. Le signataire
 * engage un total obtenu par une sommation agrégée par ligne de taxonomie, le
 * vérificateur recalcule par somme directe cellule à cellule ; les deux sont
 * mathématiquement égaux et numériquement différents de quelques ULP, ce qu'un
 * condensat ne pardonne pas. Mesuré : les deux chemins divergeaient dans 76 %
 * des cas. La quantification les rend comparables sans changer la granularité
 * par cellule décrite ci-dessus, et sans exiger qu'ils calculent de la même
 * façon — c'est un correctif d'ENGAGEMENT, pas un correctif de calcul.
 * Harmoniser les deux sommations est un lot distinct, et le seul qui puisse
 * rendre l'accord exact plutôt que très probable.
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
 * LE QUANTUM D'ENGAGEMENT : un gramme, exprimé dans l'unité des totaux.
 *
 * Le calcul rend des kgCO2e — `RESULT_UNIT` dans `engine.js`, et le signataire
 * engage l'unité du verdict plutôt qu'un littéral. Un millième de kilogramme
 * est donc un gramme.
 *
 * POURQUOI CETTE VALEUR. Sur l'attestation qui a révélé #104, le total vaut
 * 612 284 kg : un gramme y est neuf ordres de grandeur en dessous, très
 * au-delà de ce qu'un bilan carbone signifie — trois chiffres justes sont déjà
 * un bon résultat. Et il est six ordres de grandeur AU-DESSUS de la dérive
 * mesurée entre les deux chemins de sommation (5,8 × 10⁻¹⁰ kg au pire sur
 * 300 000 tirages). La marge est donc prise des deux côtés.
 *
 * CE QUE CETTE VALEUR NE COUVRE PAS. Un bilan proche de zéro — par
 * compensation ou par réduction réelle — retourne ce rapport favorable, et le
 * gramme n'est pas une résolution utile pour toute substance. La question est
 * ouverte séparément, en #108 ; elle ne se pose pas pour l'or en barres.
 */
export const TOTAL_QUANTUM = 0.001;

/**
 * Le total, ramené sur une grille de pas `quantum`.
 *
 * C'EST LA SEULE OPÉRATION QUI RENDE DEUX CALCULS ÉQUIVALENTS COMPARABLES.
 * Un engagement est un condensat : personne ne peut lire « de combien la
 * valeur signée diffère du recalcul », seule son empreinte est publique, et
 * SHA-256 n'a aucun voisinage — un ULP d'écart donne une empreinte sans
 * rapport. Il n'existe donc pas de comparaison tolérante ; il n'existe que des
 * candidats qu'on propose. Quantifier des DEUX CÔTÉS, par cette même fonction,
 * est ce qui fait tomber deux sommations différentes sur la même case, donc
 * sur la même empreinte.
 *
 * LA CASE ZÉRO EST ZÉRO, ET C'EST DIT PLUTÔT QUE SUPPOSÉ. `Math.round` rend
 * `-0` pour tout total dans la moitié négative de la case zéro, et `-0 * q`
 * vaut `-0`. La forme canonique écrit déjà « 0 » dans les deux cas — RFC 8785
 * l'exige et `canonical.js` s'y conforme, vérifié — mais faire dépendre un
 * engagement d'un détail de sérialisation qu'un autre langage pourrait
 * trancher autrement serait exactement la faute #82. On le tranche ici.
 */
function onGrid(total, quantum) {
  const steps = Math.round(total / quantum);
  return steps === 0 ? 0 : steps * quantum;
}

/**
 * L'engagement sur le total, qui lie le chiffre à la matrice.
 *
 * Sans lui, un porteur pourrait ne divulguer qu'une partie des cellules et
 * présenter le total de son choix : chaque engagement de cellule tiendrait, et
 * rien ne dirait que leur somme n'est pas celle annoncée. L'engagement porte
 * donc sur la liste ORDONNÉE des engagements de cellules et sur le total, ce qui
 * rend les deux inséparables.
 *
 * Le total est posé sur la grille avant d'être haché — voir `onGrid`. Les deux
 * côtés appellent CETTE fonction, à l'émission comme à la vérification : c'est
 * ce qui fait que la quantification n'a pas à être répétée ailleurs, et qu'elle
 * ne peut pas diverger d'un côté à l'autre.
 *
 * @param {number} [quantum] pas de la grille ; le défaut convient aux kgCO2e.
 */
export async function commitTotal(commitments, total, unit, salt = newSalt(), quantum = TOTAL_QUANTUM) {
  const payload = { salt, total: onGrid(total, quantum), unit, cells: commitments.map((c) => c.commitment) };
  return { salt, commitment: await commit(payload) };
}

/**
 * Le total recalculé est-il celui qui a été engagé ? {n−1, n, n+1}, jamais plus.
 *
 * POURQUOI TROIS CANDIDATS ET NON LE SEUL RECALCUL ARRONDI. Quantifier ne
 * suffit pas : si la somme vraie — au sens mathématique, infiniment précise —
 * tombe presque exactement sur une frontière de grille, un bruit flottant de
 * 10⁻¹⁰ fait arrondir un côté vers le bas et l'autre vers le haut. La grille
 * elle-même se traverse, et un total pourtant juste échouerait. Les deux
 * voisins immédiats couvrent ce cas, et lui seul.
 *
 * TROIS, ET PAS UNE FENÊTRE. Ce n'est pas « accepter un écart inférieur au
 * quantum » — un condensat ne le permettrait pas — mais essayer trois valeurs
 * exactes. Ce que le porteur y gagne se chiffre : la faculté d'annoncer un
 * total faux d'un gramme sur 612 tonnes. Élargir cette liste élargirait
 * d'autant ce qu'il peut annoncer, et personne ne doit le faire en croyant
 * que la marge a toujours été là.
 *
 * LIMITE CONNUE. Les candidats se construisent en ajoutant le quantum au
 * total, donc un total assez grand pour absorber un gramme les ferait
 * coïncider — au-delà de 10¹² kg, où la quantification n'a de toute façon plus
 * de sens. Relève de #108.
 *
 * @returns {Promise<boolean>}
 */
export async function checkTotalCommitment(commitments, recomputedTotal, unit, salt,
                                           committed, quantum = TOTAL_QUANTUM) {
  for (const delta of [-quantum, 0, quantum]) {
    const { commitment } = await commitTotal(commitments, recomputedTotal + delta, unit, salt, quantum);
    if (commitment === committed) return true;
  }
  return false;
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
  // MONTANT × PART, et non montant seul. Une cellule de la matrice porte ce que
  // la mine a réellement consommé sur sa période — donc un chiffre comparable au
  // cube et au classeur d'AGM — et, à côté, la fraction que CETTE barre en
  // supporte. Le contenu carbone est le produit des deux, sommé : la règle
  // d'allocation devient une multiplication que le vérificateur refait, au lieu
  // d'un chiffre déjà divisé sur lequel il faudrait nous croire.
  //
  // `share ?? 1` garde vérifiables les attestations émises avant le 2 août 2026,
  // où la part n'existait pas et valait implicitement l'unité.
  const total = counted.reduce((sum, c) => {
    const d = byIndex.get(c.index);
    return sum + (d.amount ?? 0) * (d.share ?? 1);
  }, 0);
  return { known: true, withheld: 0, total };
}
