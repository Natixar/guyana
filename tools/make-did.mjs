#!/usr/bin/env node
// Produit le document DID de `did:web:natixar.pro` à partir de la clé de
// l'émetteur, et le compare à celui publié.
//
// POURQUOI UN SCRIPT ET PAS UN FICHIER ÉCRIT À LA MAIN. Le document publié et
// la clé que charge `services/signer` doivent désigner la même chose, et rien
// dans un fichier JSON recopié ne le garantit. Ici les deux descendent de la
// même paire : le fragment est l'empreinte RFC 7638 de la clé, donc les deux
// côtés tombent d'accord sans se parler — l'argument déjà tenu par
// `site/assets/js/did.js`, appliqué à l'émetteur serveur.
//
// LE SECRET NE TOUCHE JAMAIS LE DISQUE. `--new` écrit la clé privée sur stdout
// et rien d'autre, conformément à la règle de `deploy/secrets/README.md`. Ce
// script n'écrit sur disque que de la clé PUBLIQUE.
//
// Usage :
//   node tools/make-did.mjs --new [--out <fichier>]
//       crée une paire P-256, émet le JWK privé sur stdout, écrit le document.
//   node tools/make-did.mjs --from-private <fichier|-> [--out <fichier>]
//       reconstruit le document depuis une clé existante. Idempotent.
//   node tools/make-did.mjs --from-private <fichier|-> --check
//       n'écrit rien ; sort 1 si le document sur disque diverge de la clé.
//   node tools/make-did.mjs --verify-file <fichier>
//       contrôle de cohérence interne SANS la clé privée : c'est le seul
//       contrôle exécutable en intégration continue, où le secret n'entre pas.
//
// Options :
//   --did <did>          défaut did:web:natixar.pro
//   --also-key-name <n>  publie EN PLUS la même clé sous le fragment #<n>
//                        (ex. key-1). Filet tant que services/signer emploie
//                        SIGNER_KEY_NAME au lieu de l'empreinte.

import { readFile, writeFile, mkdir } from "node:fs/promises";
// ÉCART ASSUMÉ par rapport aux instructions reçues. Elles lisaient stdin par
// `readFile(0, "utf8")` ; la variante `promises` de fs n'accepte pas un
// descripteur numérique — seulement un chemin ou un FileHandle — et échouait
// sur « The "path" argument must be of type string ». Or `--from-private -` est
// le chemin de publication documenté au § 5 : sans cette correction, la
// procédure entière est inexécutable et le secret devrait passer par un
// fichier, ce que la règle de deploy/secrets/README.md interdit.
import { text as readStdin } from "node:stream/consumers";
import { webcrypto as crypto } from "node:crypto";
import { dirname } from "node:path";

const DEFAULT_DID = "did:web:natixar.pro";
const DEFAULT_OUT = "web/natixar.pro/.well-known/did.json";
// Le contexte est celui de site/assets/js/did.js. Les deux documents — celui de
// l'exploitant et celui de l'émetteur — doivent avoir la même forme, sinon le
// vérificateur du site traite l'un des deux comme une anomalie.
const CONTEXT = ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"];

const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Les quatre membres requis d'une clé EC, et rien d'autre : RFC 7638 §3.2. */
const requiredMembers = (jwk) => ({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });

/**
 * Empreinte JWK, RFC 7638 : SHA-256 de la sérialisation JSON des membres
 * requis, en ordre lexicographique, sans espace, puis base64url.
 * L'ordre est imposé explicitement plutôt que laissé à l'ordre d'insertion.
 */
async function thumbprint(publicJwk) {
  const m = requiredMembers(publicJwk);
  const canonical = JSON.stringify(m, Object.keys(m).sort());
  const digest = await crypto.subtle.digest("SHA-256", Buffer.from(canonical, "utf8"));
  return b64url(new Uint8Array(digest));
}

async function publicFromPrivate(privateJwk) {
  // Import puis export : on ne recopie pas les champs à la main, et un JWK
  // malformé est refusé ici plutôt que découvert au moment de signer.
  const key = await crypto.subtle.importKey(
    "jwk", { ...privateJwk, key_ops: ["sign"], ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  if (key.algorithm.namedCurve !== "P-256") throw new Error("la clé n'est pas sur P-256");
  return requiredMembers({ crv: privateJwk.crv, kty: privateJwk.kty, x: privateJwk.x, y: privateJwk.y });
}

async function buildDidDocument(publicJwk, did, alsoKeyName) {
  const tp = await thumbprint(publicJwk);
  const method = (fragment) => ({
    id: `${did}#${fragment}`,
    type: "JsonWebKey",
    controller: did,
    publicKeyJwk: publicJwk,
  });
  // L'empreinte d'abord : c'est l'identifiant de référence. Le nom logique,
  // s'il est demandé, vient en second et sera retiré le jour où le signeur
  // dérivera son fragment de la clé.
  const methods = [method(tp)];
  if (alsoKeyName) methods.push(method(alsoKeyName));
  return {
    "@context": CONTEXT,
    id: did,
    verificationMethod: methods,
    // `assertionMethod` et pas `authentication` : cette clé atteste, elle
    // n'ouvre pas de session.
    assertionMethod: methods.map((m) => m.id),
  };
}

const serialise = (doc) => JSON.stringify(doc, null, 2) + "\n";

/**
 * Cohérence interne d'un document DID, sans aucun secret.
 *
 * Ce que cela attrape réellement : un document recopié à la main dont le
 * fragment ne correspond plus à la clé qu'il porte — c'est-à-dire une
 * attestation signée sous un identifiant que le document n'annonce pas, donc
 * invérifiable, et invérifiable SILENCIEUSEMENT. Ce que cela n'attrape pas :
 * un document parfaitement cohérent construit sur une clé que personne ne
 * détient. Seul `--check` avec la clé privée le dit.
 */
async function verifyFile(path, did) {
  const doc = JSON.parse(await readFile(path, "utf8"));
  const faults = [];
  if (doc.id !== did) faults.push(`id vaut ${doc.id}, attendu ${did}`);
  if (JSON.stringify(doc["@context"]) !== JSON.stringify(CONTEXT))
    faults.push("@context diffère de celui de site/assets/js/did.js");
  const methods = doc.verificationMethod ?? [];
  let carriesThumbprint = false;
  if (methods.length === 0) faults.push("aucun verificationMethod");
  for (const m of methods) {
    const jwk = m.publicKeyJwk ?? {};
    if ("d" in jwk) faults.push(`${m.id} : CLÉ PRIVÉE PUBLIÉE, membre "d" présent`);
    if (m.controller !== did) faults.push(`${m.id} : controller vaut ${m.controller}`);
    const fragment = String(m.id).split("#")[1];
    const tp = await thumbprint(jwk);
    // DEUX FORMES DE FRAGMENT SONT LÉGITIMES, ET IL FAUT LES SÉPARER.
    //
    // Un nom logique — `key-1` — est accepté : c'est la variante
    // --also-key-name, qui existe tant que services/signer nomme sa clé au lieu
    // de la dériver. Une empreinte est acceptée si elle est JUSTE.
    //
    // Ce qui ne peut pas passer, c'est un fragment qui a la FORME d'une
    // empreinte sans en être une : 43 caractères base64url, c'est-à-dire un
    // condensat SHA-256, qui ne correspond pas à la clé qu'il accompagne. Un
    // lecteur le prendrait pour une empreinte vérifiée et ne la recalculerait
    // pas. C'est exactement ce que produit une retouche à la main du document.
    const looksLikeThumbprint = /^[A-Za-z0-9_-]{43}$/.test(fragment ?? "");
    if (looksLikeThumbprint && fragment !== tp)
      faults.push(`${m.id} : fragment en forme d'empreinte, mais la clé donne ${tp}`);
    if (!looksLikeThumbprint) console.error(`note ${m.id} : fragment nommé, empreinte ${tp}`);
    if (fragment === tp) carriesThumbprint = true;
  }
  // Au moins une entrée doit être adressable par empreinte. Sans elle, un
  // signeur qui dérive son fragment de sa clé — la direction prise par
  // site/assets/js/did.js — n'a rien à quoi se raccrocher.
  if (methods.length && !carriesThumbprint)
    faults.push("aucune clé publiée sous son empreinte RFC 7638");
  const ids = methods.map((m) => m.id);
  for (const a of doc.assertionMethod ?? [])
    if (!ids.includes(a)) faults.push(`assertionMethod ${a} sans verificationMethod`);
  if (faults.length) { faults.forEach((f) => console.error(`ÉCART ${f}`)); process.exit(1); }
  console.error(`OK ${path} cohérent, ${methods.length} clé(s)`);
}

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
  const did = arg("--did", DEFAULT_DID);
  const out = arg("--out", DEFAULT_OUT);
  const alsoKeyName = arg("--also-key-name", null);
  const check = process.argv.includes("--check");

  const toVerify = arg("--verify-file", null);
  if (toVerify) return verifyFile(toVerify, did);

  let publicJwk;
  if (process.argv.includes("--new")) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
    publicJwk = requiredMembers(await crypto.subtle.exportKey("jwk", pair.publicKey));
    // Le seul écrit sur stdout, pour être redirigé vers un coffre. Rien d'autre
    // ne doit sortir sur ce flux : les messages humains partent sur stderr.
    process.stdout.write(JSON.stringify(priv) + "\n");
  } else {
    const from = arg("--from-private");
    if (!from) { console.error("il faut --new ou --from-private <fichier|->"); process.exit(2); }
    const raw = from === "-" ? await readStdin(process.stdin) : await readFile(from, "utf8");
    publicJwk = await publicFromPrivate(JSON.parse(raw));
  }

  const doc = await buildDidDocument(publicJwk, did, alsoKeyName);
  const text = serialise(doc);

  if (check) {
    let onDisk = null;
    try { onDisk = await readFile(out, "utf8"); } catch { /* absent */ }
    if (onDisk === text) { console.error(`OK ${out} correspond à la clé fournie`); return; }
    console.error(onDisk === null
      ? `ÉCART ${out} est absent alors que la clé existe`
      : `ÉCART ${out} ne correspond pas à la clé fournie`);
    process.exit(1);
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, text);
  console.error(`écrit ${out}`);
  console.error(`fragment ${doc.verificationMethod[0].id.split("#")[1]}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
