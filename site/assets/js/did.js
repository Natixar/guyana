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

const CONTEXT = ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"];

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

  return {
    "@context": CONTEXT,
    id: did,
    verificationMethod: [...kept, vm],
    assertionMethod: [...kept.map((m) => m.id), vm.id],
  };
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
