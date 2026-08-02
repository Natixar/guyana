// Gestion de la clé de signature.
//
// Choix : ECDSA P-256, clé privée NON EXPORTABLE, poignée conservée dans
// IndexedDB. Le navigateur refuse d'en extraire le matériel — ni cette page,
// ni un script injecté, ni l'utilisateur ne peuvent la sortir.
//
// Ce n'est pas du matériel sécurisé, et c'est assumé : la seule voie vers un
// TPM ou un élément sécurisé depuis un navigateur est WebAuthn, dont
// l'enveloppe de signature n'est pas vérifiable par un vérificateur VC
// standard. Nous préférons une signature ES256 que tout le monde peut
// contrôler à une signature mieux protégée que personne ne sait vérifier.
//
// Le risque réel n'est donc pas le vol mais la PERTE : un profil de navigateur
// effacé et la clé disparaît. La réponse est dans le document DID, qui publie
// un ENSEMBLE de méthodes de vérification — une clé perdue se remplace en
// ajoutant la nouvelle et en conservant l'ancienne, pour que les attestations
// déjà émises restent vérifiables.

import { canonicalBytes } from "./canonical.js";
import { STORES, databaseExists, openDb, tx } from "./idb.js";

const KEY_ID = "signing";

const ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" };

/**
 * La paire existante, ou null.
 *
 * N'ouvre la base que si elle existe déjà — voir `databaseExists` dans idb.js
 * pour la raison et pour la réserve Firefox.
 */
export async function loadKeyPair() {
  if (!(await databaseExists())) return null;
  const db = await openDb();
  const stored = await tx(db, STORES.KEYS, "readonly", (s) => s.get(KEY_ID));
  db.close();
  return stored ?? null;
}

/**
 * Génère la paire et la conserve. Refuse d'écraser une clé existante :
 * la remplacer sans le vouloir rendrait invérifiables les attestations déjà
 * émises sous l'ancienne.
 */
export async function createKeyPair() {
  if (await loadKeyPair()) {
    // Un code, pas une phrase : le texte affiché appartient à la couche
    // d'interface, qui seule connaît la langue.
    const err = new Error("key already exists");
    err.code = "KEY_EXISTS";
    throw err;
  }
  // extractable = false porte sur la clé PRIVÉE ; la publique reste exportable.
  const pair = await crypto.subtle.generateKey(ALG, false, ["sign", "verify"]);
  const db = await openDb();
  await tx(db, STORES.KEYS, "readwrite", (s) => s.put(pair, KEY_ID));
  db.close();
  return pair;
}

/**
 * Supprime la clé, et RIEN D'AUTRE.
 *
 * RÉVISION DU 2 AOÛT 2026, sur revue de la PR #70. La règle précédente —
 * « supprimer la clé efface toutes les attestations qu'elle a signées » —
 * partait d'une bonne intention et se trompait de geste. Supprimer la clé
 * garantit qu'aucune attestation NOUVELLE ne peut être émise : c'est une
 * rotation. Ce n'est pas une raison de détruire les documents déjà émis, qui
 * restent parfaitement vérifiables tant que leur clé publique figure dans le
 * document DID publié — et le document DID est justement fait pour ne jamais
 * perdre une clé.
 *
 * Effacer les attestations est une action SÉPARÉE et facultative, qui relève de
 * la surveillance de compromission. Elle a donc sa propre case à cocher, et son
 * propre critère : est orpheline une attestation dont la clé de signature ne
 * figure plus dans le DID installé. Rien à voir avec la clé qu'on efface ici.
 */
export async function deleteKeyPair() {
  if (!(await databaseExists())) return false;
  const db = await openDb();
  await tx(db, STORES.KEYS, "readwrite", (s) => s.delete(KEY_ID));
  db.close();
  return true;
}

/**
 * Paire jetable, en mémoire, jamais écrite dans IndexedDB.
 *
 * Destinée aux diagnostics. Une page d'auto-vérification qui provisionnerait la
 * vraie clé de signature de la mine créerait une clé n'ayant jamais suivi la
 * cérémonie d'installation — pas de lecture d'empreinte à voix haute, pas de
 * confirmation par Natixar — et qui pourrait finir publiée dans un did.json.
 * Un diagnostic ne doit pas avoir d'effet de bord sur l'état de production.
 */
export function ephemeralKeyPair() {
  return crypto.subtle.generateKey(ALG, false, ["sign", "verify"]);
}

export async function publicJwk(pair) {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  // Champs strictement nécessaires : une empreinte RFC 7638 ne tolère rien d'autre.
  return { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y };
}

/**
 * Empreinte JWK (RFC 7638), en base64url.
 * C'est le nombre court que l'on fait lire à voix haute lors de l'installation
 * pour confirmer que la clé publiée est bien celle du poste.
 */
export async function thumbprint(pair) {
  const jwk = await publicJwk(pair);
  // RFC 7638 exige les membres requis en ordre lexicographique, sans espace.
  // S'en remettre à l'ordre d'insertion d'un littéral d'objet marcherait ici
  // par coïncidence ; on passe par la sérialisation canonique, qui le garantit.
  const bytes = canonicalBytes(jwk);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return b64url(new Uint8Array(digest));
}

/** Découpe l'empreinte en groupes lisibles à l'oral. */
export const readable = (s) => (s.match(/.{1,4}/g) || []).slice(0, 6).join(" ");

export async function sign(pair, bytes) {
  const sig = await crypto.subtle.sign(SIGN_ALG, pair.privateKey, bytes);
  return new Uint8Array(sig);
}

export async function verify(pair, bytes, signature) {
  return crypto.subtle.verify(SIGN_ALG, pair.publicKey, signature, bytes);
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
