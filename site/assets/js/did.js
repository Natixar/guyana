// Document DID et export local.
//
// Ce que l'exploitant télécharge n'est pas « une clé publique » : c'est le
// document DID complet, prêt à déposer. Aucun JSON à éditer, aucun champ à
// recopier — la seule opération manuelle est de placer un fichier à un chemin.
//
// verificationMethod est un TABLEAU, et c'est délibéré : une clé perdue se
// remplace en AJOUTANT la nouvelle sans retirer l'ancienne, sinon toutes les
// attestations déjà émises deviennent invérifiables. Sur un poste où la clé
// vit dans un navigateur, la perte est le risque principal.

import { publicJwk } from "./keys.js";
import { canonicalBytes } from "./canonical.js";
import { multibase58 } from "./multibase.js";

const CONTEXT = ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"];

/**
 * L'empreinte porte sur LE DOCUMENT, jamais sur une clé.
 *
 * La question mérite d'être tranchée parce que les deux empreintes existent
 * dans cette application et ne répondent pas à la même chose :
 *
 * - l'empreinte de CLÉ sert à un humain — l'opérateur la lit à voix haute pour
 *   confirmer *quelle* clé se trouve sur sa machine ;
 * - l'empreinte de DOCUMENT sert à détecter une modification concurrente —
 *   elle dit *sur quel état* le nouveau document a été construit.
 *
 * Seule la seconde convient ici. Si deux personnes ajoutent chacune une clé en
 * partant du même document, la seconde publication écrase la première ; une
 * empreinte de clé ne peut pas exprimer « il y avait DEUX clés et il n'en reste
 * qu'une », alors qu'une empreinte de document change dès qu'un élément bouge.
 * C'est exactement un ETag, et l'opération voulue est un If-Match.
 *
 * Elle porte sur la SÉRIALISATION CANONIQUE : sans cela, un éditeur de texte
 * qui reformate le fichier — indentation, ordre des clés — changerait
 * l'empreinte sans changer le contenu, et l'avertissement crierait au loup.
 */
async function documentDigest(doc) {
  const bytes = await crypto.subtle.digest("SHA-256", canonicalBytes(doc));
  return multibase58(new Uint8Array(bytes));
}

/** Publique : la page l'affiche pour que l'opérateur compare avant de publier. */
export { documentDigest };

export async function buildDidDocument(pair, did, keyName = "key-1", previous = null) {
  const jwk = await publicJwk(pair);
  const vm = {
    id: `${did}#${keyName}`,
    type: "JsonWebKey",
    controller: did,
    publicKeyJwk: jwk,
  };

  // Fusion avec un document existant : on ajoute, on ne remplace jamais.
  const existing = previous?.verificationMethod ?? [];
  const kept = existing.filter((m) => m.id !== vm.id);

  const next = {
    "@context": CONTEXT,
    id: did,
    verificationMethod: [...kept, vm],
    assertionMethod: [...kept.map((m) => m.id), vm.id],
  };

  // Le chaînage. Convention locale — le modèle W3C n'a pas de champ de version
  // dans le document lui-même, et `did:web` n'a pas de métadonnées de
  // résolution où le loger. Un lecteur qui détient un ancien exemplaire peut
  // ainsi vérifier que le document publié en descend, ce qui vaut plus qu'un
  // contrôle de concurrence : c'est une trace de l'historique des clés.
  if (previous) next.previousVersionDigest = await documentDigest(previous);

  return next;
}

/** Déclenche le téléchargement du fichier, sans aucun serveur. */
export function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  // Révoqué au tour suivant : Safari a besoin que l'URL survive au clic.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
