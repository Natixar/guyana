/**
 * Accès aux libellés d'interface.
 *
 * Les libellés sont injectés à la construction depuis `data/ui/<lang>.toml`
 * (voir `layouts/_partials/head.html`). Passer la table entière a supprimé une
 * classe d'erreur — des chaînes recopiées à la main et oubliées — mais en a
 * laissé une autre : une clé demandée sous un nom qui n'existe pas renvoie
 * `undefined`, sans erreur de construction, sans test rouge, sans avertissement
 * en console. C'est ainsi que neuf libellés sont restés muets (#62).
 *
 * Ce mandataire rend la faute bavarde à l'endroit exact où elle se produit :
 * une clé inconnue renvoie son propre nom. `[missing label: envKeyPresent]`
 * dit quoi corriger ; `[libellé manquant: pending]` disait la couleur de la
 * pastille.
 *
 * Le garde de construction (`site/check-labels.py`, exécuté en intégration
 * continue) empêche la faute d'atteindre une page. Celui-ci la nomme si elle y
 * parvient tout de même — par exemple sur une langue ajoutée plus tard dont la
 * table serait incomplète.
 */
import PARAMS from "@params";

export default new Proxy(PARAMS, {
  get(table, key) {
    if (typeof key !== "string") return table[key];
    return key in table ? table[key] : `[missing label: ${key}]`;
  },
});
