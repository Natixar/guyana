#!/usr/bin/env node
// natixar.pro/build.mjs — engendre le document DID publié sur le domaine principal.
//
// CE QUE CE SCRIPT EXISTE POUR EMPÊCHER.
//
// `did:web:natixar.pro` se résout en `https://natixar.pro/.well-known/did.json`,
// et c'est là que le vérificateur va chercher la clé publique de l'émetteur. Le
// document n'était jusqu'ici produit par rien : il fallait le composer à la
// main, et trois erreurs y attendaient patiemment leur tour.
//
// 1. LE FRAGMENT. Le signataire inscrit dans chaque preuve
//    `${ISSUER_DID}#${KEY_NAME}`, soit « did:web:natixar.pro#key-1 ». Or
//    `site/assets/js/did.js` construit ses documents avec l'empreinte RFC 7638
//    comme fragment — une correction délibérée, pour que deux clés distinctes
//    cessent de recevoir le même identifiant. Les deux conventions sont
//    défendables ; elles ne sont pas compatibles. Un document engendré par
//    `buildDidDocument()` pour la clé de Natixar ne correspondrait à AUCUNE
//    preuve émise, et `verify.js` refuse la correspondance approximative — il
//    exige l'identifiant exact. Le diagnostic serait « clé absente du
//    document », qui est exact et n'oriente vers rien.
//
//    Ce script lit donc les mêmes variables d'environnement que le signataire,
//    avec les mêmes défauts. Les changer d'un côté sans l'autre reste possible,
//    mais ne peut plus se faire par inadvertance de rédaction.
//
// 2. LA CLÉ PRIVÉE. Le JWK du signataire porte `d`. Le publier reviendrait à
//    déposer la clé de signature sur un domaine public, dans un dépôt public.
//    La sortie est donc construite champ par champ — jamais par copie de
//    l'entrée moins un champ — et un garde relit le texte produit avant
//    écriture.
//
// 3. LE REMPLACEMENT SILENCIEUX. Le document DID est APPEND-ONLY : retirer une
//    clé rend invérifiable toute attestation qu'elle a signée. Comme le nom de
//    clé est fixe (« key-1 »), engendrer ce document après une rotation
//    écraserait la clé publiée sous le même identifiant — sans rien casser
//    visiblement, et en invalidant tout l'historique. Ce cas est REFUSÉ, avec
//    la manœuvre à suivre.
//
// Usage :
//   node natixar.pro/build.mjs            # écrit public/.well-known/did.json
//   node natixar.pro/build.mjs --check    # n'écrit rien ; sort 1 si le fichier diffère

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// Les mêmes noms et les mêmes défauts que services/signer/server.mjs. Le
// signataire est la source de vérité : c'est lui qui signe, ce document ne fait
// que publier de quoi le vérifier.
const ISSUER_DID = process.env.SIGNER_ISSUER_DID ?? "did:web:natixar.pro";
const KEY_NAME = process.env.SIGNER_KEY_NAME ?? "key-1";

const KEY_PATH = process.env.SIGNER_KEY_PATH
  ?? join(REPO, "deploy/secrets/local/signer_key.jwk");
const OUT_PATH = process.env.DID_OUT
  ?? join(HERE, "public/.well-known/did.json");

const CONTEXT = ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"];

/**
 * La partie publique, reconstruite et non rognée.
 *
 * `const { d, ...pub } = jwk` donnerait le bon résultat aujourd'hui et
 * emporterait demain tout champ que l'on ajouterait à la clé privée. On nomme
 * donc ce qui sort, et le reste ne sort pas.
 */
function publicJwkOf(jwk) {
  if (jwk?.kty !== "EC" || jwk?.crv !== "P-256") {
    throw new Error(`clé inattendue : kty=${jwk?.kty} crv=${jwk?.crv} — le signataire signe en ES256 (P-256)`);
  }
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new Error("la clé ne porte pas de coordonnées publiques x/y");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

function sameKey(a, b) {
  return a?.kty === b?.kty && a?.crv === b?.crv && a?.x === b?.x && a?.y === b?.y;
}

/**
 * Fusion append-only : on ajoute, on ne remplace jamais.
 *
 * Une entrée dont l'identifiant diffère est CONSERVÉE telle quelle — c'est une
 * clé plus ancienne, et des attestations en dépendent. Une entrée de même
 * identifiant portant une AUTRE clé est un remplacement : refusé ici.
 */
function merge(previous, method) {
  const existing = previous?.verificationMethod ?? [];
  const clash = existing.find((m) => m.id === method.id);

  if (clash && !sameKey(clash.publicKeyJwk, method.publicKeyJwk)) {
    throw new Error(
      `le document publie déjà une AUTRE clé sous « ${method.id} ».\n` +
      `  L'écraser rendrait invérifiable toute attestation qu'elle a signée.\n` +
      `  Le document DID est append-only : une clé se remplace en AJOUTANT la\n` +
      `  nouvelle, sous un identifiant neuf.\n` +
      `  Manœuvre : relancer avec SIGNER_KEY_NAME=key-2 — et poser la MÊME\n` +
      `  valeur sur le signataire, sans quoi il signera sous un nom que le\n` +
      `  document ne publie pas.`);
  }

  const kept = existing.filter((m) => m.id !== method.id);
  return {
    "@context": CONTEXT,
    id: ISSUER_DID,
    verificationMethod: [...kept, method],
    // `verificationMethod` publie la matière ; `assertionMethod` dit ce que
    // chaque clé a le droit de faire. verify.js exige la seconde : une clé
    // seulement publiée ne peut pas signer d'attestation.
    assertionMethod: [...kept.map((m) => m.id), method.id],
  };
}

/** Sortie stable : relancer sans changement ne doit produire aucun diff. */
function serialise(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

export async function buildDidDocument({ keyPath = KEY_PATH, outPath = OUT_PATH } = {}) {
  const jwk = JSON.parse(await readFile(keyPath, "utf8"));
  const publicKeyJwk = publicJwkOf(jwk);

  const method = {
    id: `${ISSUER_DID}#${KEY_NAME}`,
    type: "JsonWebKey",
    controller: ISSUER_DID,
    publicKeyJwk,
  };

  const doc = merge(await readJsonIfPresent(outPath), method);
  const text = serialise(doc);

  // LE GARDE. Il relit le TEXTE, pas l'objet : c'est le texte qui part sur le
  // réseau, et c'est lui qui doit être exempt de secret. Un champ ajouté à la
  // clé privée par une évolution future retomberait ici, pas en revue.
  if (typeof jwk.d === "string" && jwk.d.length > 0 && text.includes(jwk.d)) {
    throw new Error("REFUS : la sortie contient la clé privée. Rien n'a été écrit.");
  }
  if (JSON.stringify(doc).includes('"d"')) {
    throw new Error("REFUS : la sortie porte un champ « d ». Rien n'a été écrit.");
  }

  return { doc, text, outPath };
}

async function main() {
  const check = process.argv.includes("--check");
  const { text, outPath, doc } = await buildDidDocument();

  if (check) {
    const current = await readFile(outPath, "utf8").catch(() => null);
    if (current !== text) {
      console.error(`${outPath} n'est pas à jour — relancez : node natixar.pro/build.mjs`);
      process.exit(1);
    }
    console.log(`${outPath} est à jour`);
    return;
  }

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text);

  const ids = doc.verificationMethod.map((m) => m.id);
  console.log(`écrit  ${outPath}`);
  console.log(`  émetteur : ${doc.id}`);
  console.log(`  clés publiées (${ids.length}) : ${ids.join(", ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  });
}
