/**
 * Échapper ce qui entre dans du HTML — une seule fonction, partout.
 *
 * LE DÉFAUT QUE CE MODULE CORRIGE. `bar.js` reprenait le paramètre `?id=` de
 * l'URL et le posait tel quel dans `innerHTML` pour dire « barre inconnue ».
 * Un lien fabriqué exécutait donc du script **sur la page qui détient la clé de
 * signature**. C'est la pire cible possible du produit : la clé ne quitte jamais
 * le navigateur, ce qui protège d'un serveur curieux mais pas d'un script qui
 * s'exécute dans ce navigateur-là. CodeQL l'a signalée en sévérité haute, et
 * elle était là depuis l'écriture de la page.
 *
 * TROIS ÉCHAPPEMENTS PARTIELS VALENT MOINS QU'UN SEUL COMPLET. Il en existait un
 * dans `verify-page.js` qui ne traitait que `<` et `&` — suffisant pour du texte,
 * insuffisant dès qu'une valeur approche un attribut, où une apostrophe ferme le
 * guillemet et rouvre le document. Plutôt que d'en ajouter un troisième, celui-ci
 * les remplace : une fonction que l'on relit une fois vaut mieux que trois que
 * l'on croit équivalentes.
 *
 * CE N'EST PAS LA SEULE DÉFENSE, ET IL NE FAUT PAS QUE ÇA LE DEVIENNE. La
 * politique de sécurité du site interdit déjà les scripts en ligne
 * (`script-src 'self'`), ce qui neutralise la charge la plus courante. Mais une
 * CSP est une seconde ligne : elle rattrape ce qui a échappé, elle ne dispense
 * pas d'échapper. Le jour où quelqu'un l'assouplira pour une bibliothèque, la
 * page ne doit pas devenir vulnérable du même coup.
 */

const REPLACEMENTS = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Rend une valeur inoffensive dans du HTML, texte comme attribut.
 *
 * `&` d'abord dans la table, sinon les entités produites par les autres
 * remplacements seraient elles-mêmes ré-échappées ; l'expression régulière
 * unique évite le problème en ne passant qu'une fois sur chaque caractère.
 *
 * `null` et `undefined` deviennent la chaîne vide plutôt que « null » : afficher
 * le mot « undefined » dans une interface est une fuite d'implémentation, et
 * c'est arrivé assez souvent ailleurs pour être traité ici.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function esc(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => REPLACEMENTS[c]);
}

export default esc;
