// tools/make-did.test.mjs — les cas que `--verify-file` doit trancher.
//
// Le § 3 des instructions annonce cinq cas « couverts et éprouvés ». Les voici
// éprouvés : sans eux, le tableau est une intention, et le contrôle
// d'intégration continue passerait tout aussi bien s'il ne contrôlait rien.
//
// Le dernier cas n'est pas dans ce tableau et vaut le plus cher : il SIGNE une
// attestation avec le module que `services/signer/server.mjs` appelle, sous
// `#key-1`, puis la vérifie contre le document produit avec `--also-key-name`.
// C'est ce qui rend vraie l'affirmation du § 4 sortie 2 — « rien à changer au
// signeur ». Sans lui, on l'espère.
//
// LA CLÉ PRIVÉE PASSE PAR STDIN, JAMAIS PAR UN FICHIER, y compris ici : la
// règle de deploy/secrets/README.md ne souffre pas d'exception « c'est un
// test ». Les paires sont engendrées à la volée et meurent avec le processus.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SCRIPT = join(HERE, "make-did.mjs");

const DID = "did:web:natixar.pro";

async function freshKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { pair, jwk: await crypto.subtle.exportKey("jwk", pair.privateKey) };
}

const scratch = async () => join(await mkdtemp(join(tmpdir(), "did-")), "did.json");

/** Engendre un document, la clé privée passant par stdin. */
function make(jwk, out, extra = []) {
  const r = spawnSync("node", [SCRIPT, "--from-private", "-", "--out", out, ...extra],
    { input: JSON.stringify(jwk), encoding: "utf8", cwd: REPO });
  assert.equal(r.status, 0, `génération en échec : ${r.stderr}`);
  return r;
}

/** Le contrôle de cohérence interne, tel que la CI l'exécute. */
function verify(path) {
  return spawnSync("node", [SCRIPT, "--verify-file", path], { encoding: "utf8", cwd: REPO });
}

// --- le tableau du § 3 -----------------------------------------------------

test("document sain, fragment = empreinte : accepté", async () => {
  const { jwk } = await freshKey();
  const out = await scratch();
  make(jwk, out);
  assert.equal(verify(out).status, 0);
});

test("variante --also-key-name, deux entrées : accepté, avec la note", async () => {
  const { jwk } = await freshKey();
  const out = await scratch();
  make(jwk, out, ["--also-key-name", "key-1"]);

  const doc = JSON.parse(await readFile(out, "utf8"));
  assert.equal(doc.verificationMethod.length, 2);
  assert.ok(doc.verificationMethod.some((m) => m.id === `${DID}#key-1`));

  const r = verify(out);
  assert.equal(r.status, 0);
  assert.match(r.stderr, /fragment nommé/);
});

test("publicKeyJwk retouchée, fragment inchangé : refusé", async () => {
  const { jwk } = await freshKey();
  const other = await freshKey();
  const out = await scratch();
  make(jwk, out);

  // La retouche exacte qu'une main produirait : on remplace la clé, on laisse
  // le fragment. Le document reste parfaitement bien formé.
  const doc = JSON.parse(await readFile(out, "utf8"));
  doc.verificationMethod[0].publicKeyJwk =
    { crv: "P-256", kty: "EC", x: other.jwk.x, y: other.jwk.y };
  await writeFile(out, JSON.stringify(doc, null, 2) + "\n");

  const r = verify(out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /forme d'empreinte, mais la clé donne/);
});

test("membre « d » présent — clé privée publiée : refusé", async () => {
  const { jwk } = await freshKey();
  const out = await scratch();
  make(jwk, out);

  const doc = JSON.parse(await readFile(out, "utf8"));
  doc.verificationMethod[0].publicKeyJwk.d = jwk.d;
  await writeFile(out, JSON.stringify(doc, null, 2) + "\n");

  const r = verify(out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CLÉ PRIVÉE PUBLIÉE/);
});

test("seul fragment nommé, aucune empreinte : refusé", async () => {
  const { jwk } = await freshKey();
  const out = await scratch();
  make(jwk, out, ["--also-key-name", "key-1"]);

  // On retire l'entrée par empreinte : il ne reste que `#key-1`. C'est
  // exactement la sortie 3 du § 4, celle qui est écartée.
  const doc = JSON.parse(await readFile(out, "utf8"));
  doc.verificationMethod = doc.verificationMethod.filter((m) => m.id.endsWith("#key-1"));
  doc.assertionMethod = doc.verificationMethod.map((m) => m.id);
  await writeFile(out, JSON.stringify(doc, null, 2) + "\n");

  const r = verify(out);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /aucune clé publiée sous son empreinte/);
});

// --- ce qui rend vraie la sortie 2 du § 4 ----------------------------------

test("une attestation signée sous #key-1 se vérifie contre le document publié", async () => {
  const { signCredential } = await import(resolve(REPO, "site/assets/js/credential.js"));
  const { canonicalBytes } = await import(resolve(REPO, "site/assets/js/canonical.js"));
  const { multibase58Decode } = await import(resolve(REPO, "site/assets/js/multibase.js"));

  const { pair, jwk } = await freshKey();
  const out = await scratch();
  make(jwk, out, ["--also-key-name", "key-1"]);
  const doc = JSON.parse(await readFile(out, "utf8"));

  const credential = {
    "@context": ["https://www.w3.org/ns/credentials/v2"],
    type: ["VerifiableCredential"],
    issuer: DID,
    credentialSubject: { id: "urn:bar:test", carbonIntensity: 12.5 },
  };

  // Exactement l'appel de services/signer/server.mjs, fragment compris.
  const signed = await signCredential(credential, { privateKey: pair.privateKey }, `${DID}#key-1`);
  const { proof, ...payload } = signed;

  // Ce que verify.js exige du document, point par point.
  assert.equal(doc.id, payload.issuer);
  const method = doc.verificationMethod.find((m) => m.id === proof.verificationMethod);
  assert.ok(method, "le signeur signe sous un identifiant que le document n'annonce pas");
  assert.ok(doc.assertionMethod.includes(method.id), "clé publiée mais non autorisée à attester");
  assert.equal(method.controller, doc.id);

  const key = await crypto.subtle.importKey(
    "jwk", method.publicKeyJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

  const { proofValue, ...proofConfig } = proof;
  const sha = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const proofDigest = await sha(canonicalBytes({ "@context": payload["@context"], ...proofConfig }));
  const docDigest = await sha(canonicalBytes(payload));
  const toSign = new Uint8Array(proofDigest.length + docDigest.length);
  toSign.set(proofDigest, 0);
  toSign.set(docDigest, proofDigest.length);

  assert.ok(await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, key, multibase58Decode(proofValue), toSign),
    "la signature du signeur ne se vérifie pas contre la clé publiée");
});

// --- le document réellement versionné --------------------------------------

test("le document versionné, s'il existe, passe le contrôle de la CI", async () => {
  const published = join(REPO, "web/natixar.pro/.well-known/did.json");
  try {
    await readFile(published, "utf8");
  } catch {
    return; // absent tant que l'émetteur n'a pas de clé : rien à vérifier.
  }
  assert.equal(verify(published).status, 0);
});
