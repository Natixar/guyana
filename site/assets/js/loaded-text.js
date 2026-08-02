/**
 * Rendre LISIBLE le fichier qu'on vient de choisir.
 *
 * ─── LE DÉFAUT, ET POURQUOI IL COMPTAIT ──────────────────────────────────
 *
 * Trois écrans acceptent un document de deux façons : coller son texte, ou
 * choisir un fichier sur le disque. Le second chemin lisait le fichier, le
 * traitait, affichait son verdict — et laissait la zone de texte vide. À
 * l'écran, un jugement apparaissait sans que rien ne dise sur quoi il portait.
 *
 * Ce n'est pas un défaut d'agrément. Sur la page de vérification, le postulat
 * est que le vérificateur ne nous fait pas confiance : lui demander de nous
 * croire sur le contenu de son PROPRE fichier était le seul endroit de la
 * démonstration où l'on exigeait de la confiance. Sur l'écran de fusion de DID,
 * l'exploitant décidait d'une fusion de clés sans pouvoir relire le document
 * fusionné. Dans les deux cas, on ne pouvait pas non plus constater qu'on avait
 * simplement ouvert le mauvais fichier.
 *
 * ─── DEUX GESTES, ET LE SECOND EST AUSSI NÉCESSAIRE QUE LE PREMIER ───────
 *
 * Écrire le texte ne suffit pas : ces zones vivent dans un `<details>` replié,
 * parce qu'un document JSON de quarante lignes n'a pas à occuper l'écran tant
 * que personne ne le demande. Un texte écrit dans un tiroir fermé reste
 * invisible, et l'on aurait corrigé le symptôme sans corriger la panne. Le
 * tiroir s'ouvre donc, une fois, à l'endroit exact où l'utilisateur vient
 * d'agir.
 *
 * Écrire dans `value` NE DÉCLENCHE PAS l'événement `input` — c'est la règle du
 * DOM, pas une chance. Le document n'est donc traité qu'une fois, par
 * l'appelant, et ce qui s'affiche est exactement ce qui a été traité. Verbatim,
 * sans reformatage : la zone doit montrer le fichier, pas notre idée du fichier.
 */

/**
 * Affiche le contenu chargé et déplie ce qui le cache.
 *
 * @param {HTMLTextAreaElement|null} box la zone de texte jumelle du sélecteur
 * @param {string} raw le contenu du fichier, tel qu'il a été lu
 * @returns {string} le même contenu, pour enchaîner sur le traitement
 */
export function showLoaded(box, raw) {
  if (box) {
    box.value = raw;
    // `closest` remonte jusqu'au tiroir, s'il y en a un. Aucun n'est un cas
    // normal : la zone est alors déjà visible.
    box.closest("details")?.setAttribute("open", "");
  }
  return raw;
}
