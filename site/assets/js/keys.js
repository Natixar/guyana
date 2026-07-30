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

const DB_NAME = "natixar-gold-trace";
const DB_VERSION = 1;
const STORE = "keys";
const KEY_ID = "signing";

const ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" };

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** La paire existante, ou null. */
export async function loadKeyPair() {
  const db = await openDb();
  const stored = await tx(db, "readonly", (s) => s.get(KEY_ID));
  db.close();
  return stored ?? null;
}

/**
 * Génère la paire et la conserve. Refuse d'écraser une clé existante :
 * la remplacer sans le vouloir rendrait invérifiables les attestations déjà
 * émises sous l'ancienne.
 */
export async function createKeyPair() {
  if (await loadKeyPair()) throw new Error("une clé existe déjà — la remplacer exige une rotation explicite");
  // extractable = false porte sur la clé PRIVÉE ; la publique reste exportable.
  const pair = await crypto.subtle.generateKey(ALG, false, ["sign", "verify"]);
  const db = await openDb();
  await tx(db, "readwrite", (s) => s.put(pair, KEY_ID));
  db.close();
  return pair;
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
  const bytes = new TextEncoder().encode(JSON.stringify(jwk)); // déjà en ordre lexicographique
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
