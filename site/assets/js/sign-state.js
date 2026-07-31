/**
 * L'état du bouton de signature, dérivé et non écrit.
 *
 * Fonction pure, dans son propre module pour deux raisons : elle n'a besoin ni
 * du DOM ni d'IndexedDB, et l'auto-test peut donc l'exercer sans importer
 * `app.js`, dont le chargement installerait l'écouteur de la page d'accueil.
 *
 * C'est la règle qui manquait derrière #64 : trois obstacles possibles, un
 * ordre, et un seul endroit qui décide.
 */
import T from "./labels.js";

/**
 * Ce qui empêche de signer, ou `null` s'il n'y a pas d'obstacle.
 *
 * Une seule raison est renvoyée, la première dans l'ordre où l'opérateur peut y
 * remédier : sans clé il ne peut rien faire d'autre, et lui reprocher en même
 * temps l'absence de coulée ne l'avancerait pas.
 *
 * `null` plutôt qu'une chaîne vide : l'appelant distingue « pas d'obstacle » de
 * « je n'ai pas regardé ».
 */
export function signBlocker({ pair, did, pour }) {
  if (!pair) return T.signNeedsKey;
  if (!did) return T.issuerUnknown;
  if (!pour) return T.signNoPour;
  return null;
}

/**
 * L'affichage de la zone de signature, pour un état donné.
 *
 * Une coulée déjà signée ne se resigne pas : un second passage émettrait une
 * attestation de plus, avec un nouvel identifiant de sujet, pour le même lingot
 * physique. Le texte est vide quand la signature est possible — c'est l'état
 * par défaut du gabarit, et le bouton porte déjà son propre libellé.
 */
export function signView(state) {
  const blocker = signBlocker(state);
  return {
    disabled: Boolean(blocker) || Boolean(state.signed),
    text: state.signed ? T.signDone : (blocker ?? ""),
  };
}
