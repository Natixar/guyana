// Identité — obtenue du serveur, jamais figée à la construction.
//
// Le serveur dit QUI VOUS ÊTES. Il ne touche jamais à la clé : celle-ci naît
// dans le navigateur, y reste, et ne sort pas. C'est la séparation qui permet
// d'ajouter une authentification sans réintroduire un problème de garde de clé
// côté serveur.
//
// Aujourd'hui /api/me est un fichier statique. Demain c'est un point d'entrée
// qui interroge FusionAuth. La page ne verra pas la différence — c'est tout
// l'intérêt d'avoir écrit le contrat avant l'implémentation.
//
// RÈGLE À NE JAMAIS ASSOUPLIR : /api/me ne reçoit, ne stocke et ne relaie
// aucune clé privée. Le jour où l'on proposera de « sauvegarder la clé côté
// serveur pour éviter les pertes », ce sera la fin de la propriété qui fait la
// valeur du dispositif. Une clé perdue se remplace par rotation.

const FALLBACK = {
  authenticated: false,
  mode: "unreachable",
  person: null,
  organisation: null,
  roles: [],
};

export async function fetchMe() {
  try {
    const r = await fetch("/api/v1/me", { credentials: "same-origin" });
    if (!r.ok) return { ...FALLBACK, mode: "error", status: r.status };
    return await r.json();
  } catch {
    return FALLBACK;
  }
}

/** Le DID d'émetteur vient de l'identité, pas de la configuration du site. */
import T from "./labels.js";

export const issuerDid = (me) => me?.organisation?.did ?? null;

/** Vrai quand rien ne garantit qui opère : la page doit alors le dire. */
export const isDemo = (me) => !me?.authenticated;

/**
 * Pourquoi ce compte ne peut pas signer — en nommant le compte et le remède.
 *
 * « No organisation identity available » est vrai et inutilisable. Il ne dit ni
 * QUI est connecté, ni que le refus est NORMAL, ni quoi faire. L'opérateur en
 * conclut que le produit est cassé, alors qu'une règle d'autorisation vient de
 * faire exactement son travail : signer l'origine d'un lingot est un acte de la
 * MINE, et un compte de la plateforme ou de vérification n'est pas la mine.
 *
 * Rendre `null` quand tout va bien : l'appelant n'a alors rien à afficher.
 */
export function issuerBlocker(me) {
  if (issuerDid(me)) return null;
  const who = me?.person?.name ?? me?.person?.id;
  return who ? `${T.issuerUnknownFor.replace("{who}", who)}` : T.issuerUnknown;
}
