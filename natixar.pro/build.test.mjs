// natixar.pro/build.test.mjs — ce que le document DID engendré doit satisfaire.
//
// LE CAS QUI COMPTE EST LE TROISIÈME. Vérifier la forme du document — les bons
// champs, aux bons endroits — confirmerait mes hypothèses au lieu de les
// éprouver. Ce que le document doit faire, c'est permettre à une attestation
// RÉELLEMENT SIGNÉE par le signataire de se vérifier. Le test signe donc avec
// le même code que `services/signer/server.mjs` appelle, puis vérifie contre le
// document produit ici. Si les deux conventions de fragment divergent à
// nouveau, c'est ce cas qui tombe, et il nomme la cause.
//
// Les tests sont HERMÉTIQUES : ils engendrent leur propre paire P-256. La clé
// du signataire vit dans `deploy/secrets/local/`, hors dépôt — un test qui en
// dépendrait ne s'exécuterait jamais en intégration continue, ce qui est la
// définition d'un test décoratif.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildDidDocument } from "./build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// Le MÊME module que le signataire importe. Copier une variante romprait
// « un moteur, deux hôtes » sans le signaler.
const { signCredential } = await import(resolve(REPO, "site/assets/js/credential.js"));
const { canonicalBytes } = await import(resolve(REPO, "site/assets/js/canonical.js"));
const { multibase58Decode } = await import(resolve(REPO, "site/assets/js/multibase.js"));

const ISSUER = "did:web:natixar.pro";
const METHOD = `${ISSUER}#key-1`;

async function freshKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { pair, jwk };
}

/** Un répertoire jetable, et le chemin du document qui y sera écrit. */
async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "did-"));
  return join(dir, ".well-known/did.json");
}

async function generate({ jwk, outPath, previous = null }) {
  const keyPath = join(dirname(outPath), "..", "key.jwk");
  await mkdir(dirname(keyPath), { recursive: true });
  await writeFile(keyPath, JSON.stringify(jwk));
  if (previous) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(previous, null, 2) + "\n");
  }
  return buildDidDocument({ keyPath, outPath });
}

// --- 1. le secret ne sort pas ---------------------------------------------

test("la sortie ne porte jamais la clé privée", async () => {
  const { jwk } = await freshKey();
  const { text } = await generate({ jwk, outPath: await scratch() });

  assert.ok(jwk.d && jwk.d.length > 0, "la clé de test devrait être privée");
  assert.ok(!text.includes(jwk.d), "le scalaire privé se trouve dans la sortie");
  assert.ok(!text.includes('"d"'), "un champ « d » se trouve dans la sortie");
});

// --- 2. le fragment, qui est le piège de ce dossier ------------------------

test("le fragment est celui que le signataire inscrit dans ses preuves", async () => {
  const { jwk } = await freshKey();
  const { doc } = await generate({ jwk, outPath: await scratch() });

  assert.equal(doc.verificationMethod[0].id, METHOD);
  assert.equal(doc.id, ISSUER);
});

// --- 3. le cas qui compte -------------------------------------------------

test("bout en bout : une attestation signée se vérifie contre le document engendré", async () => {
  const { pair, jwk } = await freshKey();
  const { doc } = await generate({ jwk, outPath: await scratch() });

  const credential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer: ISSUER,
    credentialSubject: { id: "urn:bar:test", carbonIntensity: 12.5 },
  };

  // Exactement l'appel de services/signer/server.mjs.
  const signed = await signCredential(credential, { privateKey: pair.privateKey }, METHOD);

  // --- ce que verify.js exige du document, point par point ---
  const { proof, ...payload } = signed;
  assert.equal(doc.id, payload.issuer, "l'émetteur du document et celui de l'attestation diffèrent");

  const method = doc.verificationMethod.find((m) => m.id === proof.verificationMethod);
  assert.ok(method, `aucune clé nommée ${proof.verificationMethod} — c'est le piège du fragment`);
  assert.ok(method.publicKeyJwk, "la méthode ne publie pas de matière de clé");
  assert.ok(doc.assertionMethod.includes(method.id), "la clé n'est pas autorisée à faire des assertions");
  assert.equal(method.controller, doc.id, "la clé n'est pas contrôlée par le document qui la publie");

  // --- et la signature elle-même, recalculée comme la suite l'impose ---
  const key = await crypto.subtle.importKey(
    "jwk", method.publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

  const { proofValue, ...proofConfig } = proof;
  const sha = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const proofDigest = await sha(canonicalBytes({ "@context": payload["@context"], ...proofConfig }));
  const docDigest = await sha(canonicalBytes(payload));
  const toSign = new Uint8Array(proofDigest.length + docDigest.length);
  toSign.set(proofDigest, 0);
  toSign.set(docDigest, proofDigest.length);

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, multibase58Decode(proofValue), toSign);
  assert.ok(ok, "la signature du signataire ne se vérifie pas contre la clé publiée");
});

test("un contrôle qui ne peut pas échouer est décoratif : l'altération est rejetée", async () => {
  const { pair, jwk } = await freshKey();
  const { doc } = await generate({ jwk, outPath: await scratch() });

  const credential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer: ISSUER,
    credentialSubject: { id: "urn:bar:test", carbonIntensity: 12.5 },
  };
  const signed = await signCredential(credential, { privateKey: pair.privateKey }, METHOD);

  const { proof, ...payload } = signed;
  payload.credentialSubject.carbonIntensity = 0.1;

  const key = await crypto.subtle.importKey(
    "jwk", doc.verificationMethod[0].publicKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

  const { proofValue, ...proofConfig } = proof;
  const sha = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const proofDigest = await sha(canonicalBytes({ "@context": payload["@context"], ...proofConfig }));
  const docDigest = await sha(canonicalBytes(payload));
  const toSign = new Uint8Array(proofDigest.length + docDigest.length);
  toSign.set(proofDigest, 0);
  toSign.set(docDigest, proofDigest.length);

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, multibase58Decode(proofValue), toSign);
  assert.equal(ok, false, "une attestation altérée se vérifie encore");
});

// --- 4. append-only -------------------------------------------------------

test("une clé plus ancienne, sous un autre identifiant, est conservée", async () => {
  const { jwk } = await freshKey();
  const previous = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
    id: ISSUER,
    verificationMethod: [{
      id: `${ISSUER}#key-0`,
      type: "JsonWebKey",
      controller: ISSUER,
      publicKeyJwk: { kty: "EC", crv: "P-256", x: "AAAA", y: "BBBB" },
    }],
    assertionMethod: [`${ISSUER}#key-0`],
  };

  const { doc } = await generate({ jwk, outPath: await scratch(), previous });

  const ids = doc.verificationMethod.map((m) => m.id);
  assert.deepEqual(ids, [`${ISSUER}#key-0`, METHOD],
    "retirer une clé rendrait invérifiable toute attestation qu'elle a signée");
  assert.ok(doc.assertionMethod.includes(`${ISSUER}#key-0`));
});

test("remplacer une clé sous le même identifiant est refusé", async () => {
  const { jwk } = await freshKey();
  const previous = {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/jwk/v1"],
    id: ISSUER,
    verificationMethod: [{
      id: METHOD,                      // le MÊME identifiant, une AUTRE clé
      type: "JsonWebKey",
      controller: ISSUER,
      publicKeyJwk: { kty: "EC", crv: "P-256", x: "AUTRE", y: "AUTRE" },
    }],
    assertionMethod: [METHOD],
  };

  const outPath = await scratch();
  await assert.rejects(
    () => generate({ jwk, outPath, previous }),
    /append-only|AUTRE clé/,
    "un remplacement silencieux invaliderait tout l'historique");
});

// --- 5. le fichier versionné ne bouge pas sans raison ----------------------

test("relancer sans changement ne produit aucun diff", async () => {
  const { jwk } = await freshKey();
  const outPath = await scratch();

  const first = await generate({ jwk, outPath });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, first.text);

  const second = await generate({ jwk, outPath });
  assert.equal(second.text, first.text);
  assert.equal(second.text, await readFile(outPath, "utf8"));
});

test("une clé qui n'est pas P-256 est refusée plutôt que publiée de travers", async () => {
  const outPath = await scratch();
  await assert.rejects(
    () => generate({ jwk: { kty: "RSA", n: "…", e: "AQAB", d: "secret" }, outPath }),
    /P-256|kty/);
});

// --- 6. le fichier réellement versionné -----------------------------------
//
// Les cas précédents éprouvent le GÉNÉRATEUR. Celui-ci éprouve le PRODUIT : le
// document que Netlify servira, tel qu'il est dans le dépôt. Il ne peut pas
// être régénéré en intégration continue — la clé du signataire n'y est pas —
// donc rien d'autre ne l'empêcherait d'être édité à la main, ou d'être resté en
// arrière d'un changement de convention.

test("le document versionné satisfait le contrat que verify.js impose", async () => {
  const published = JSON.parse(
    await readFile(join(HERE, "public/.well-known/did.json"), "utf8"));

  assert.equal(published.id, ISSUER);

  const method = published.verificationMethod.find((m) => m.id === METHOD);
  assert.ok(method, `le document publié ne nomme pas ${METHOD}`);
  assert.equal(method.controller, published.id);
  assert.equal(method.type, "JsonWebKey");
  assert.equal(method.publicKeyJwk.kty, "EC");
  assert.equal(method.publicKeyJwk.crv, "P-256");
  assert.ok(published.assertionMethod.includes(METHOD),
    "la clé est publiée mais pas autorisée à signer des attestations");
});

test("le document versionné ne contient aucune matière privée", async () => {
  const text = await readFile(join(HERE, "public/.well-known/did.json"), "utf8");
  assert.ok(!text.includes('"d"'), "un champ « d » est parti dans le dépôt public");
  for (const m of JSON.parse(text).verificationMethod) {
    assert.deepEqual(Object.keys(m.publicKeyJwk).sort(), ["crv", "kty", "x", "y"],
      "la clé publiée porte des champs inattendus");
  }
});
