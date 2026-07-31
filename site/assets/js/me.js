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
export const issuerDid = (me) => me?.organisation?.did ?? null;

/** Vrai quand rien ne garantit qui opère : la page doit alors le dire. */
export const isDemo = (me) => !me?.authenticated;
