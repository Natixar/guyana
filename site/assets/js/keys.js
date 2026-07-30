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

const DB_NAME = "natixar-gold-trace";
const DB_VERSION = 1;
const STORE = "keys";
const KEY_ID = "signing";

const ALG = { name: "ECDSA", namedCurve: "P-256" };
const SIGN_ALG = { name: "ECDSA", hash: "SHA-256" };

function rawOpen(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

/**
 * Ouvre la base en garantissant que le magasin existe.
 *
 * Ne pas supposer qu'une base à la bonne version contient ses magasins : une
 * base peut avoir été créée en version 1 sans aucun magasin par n'importe quel
 * autre code — une commande tapée dans la console, un autre outil. Dans ce cas
 * `onupgradeneeded` ne se déclenche pas et la transaction échoue par
 * NotFoundError. On force alors une montée de version, seul moyen de créer un
 * magasin manquant.
 */
async function openDb() {
  let db = await rawOpen();                       // version courante, quelle qu'elle soit
  if (db.objectStoreNames.contains(STORE)) return db;
  const next = db.version + 1;
  db.close();
  return rawOpen(next);
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * La paire existante, ou null.
 *
 * N'ouvre la base que si elle existe déjà : `indexedDB.open` la CRÉE sinon,
 * et une page d'auto-vérification qui laisse une base vide derrière elle ne
 * tient pas tout à fait sa promesse de ne rien laisser.
 *
 * `indexedDB.databases()` n'existe pas dans Firefox ; on y retombe sur
 * l'ouverture directe, qui crée une base vide. C'est sans conséquence — un
 * conteneur vide n'est pas une clé — mais autant que ce soit écrit.
 */
export async function loadKeyPair() {
  if (typeof indexedDB.databases === "function") {
    const known = await indexedDB.databases();
    if (!known.some((d) => d.name === DB_NAME)) return null;
  }
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
  await tx(db, "readwrite", (s) => s.put(pair, KEY_ID));
  db.close();
  return pair;
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
