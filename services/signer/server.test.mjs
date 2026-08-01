/**
 * Le signataire, de bout en bout : une requête HTTP, une attestation signée.
 *
 * Ce que ces cas ajoutent aux refus d'`attest.test.mjs`, c'est la forme de ce
 * qui SORT — et la propriété la plus importante de tout le lot : l'attestation
 * ne porte aucune ligne de référentiel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalBytes } from "../../site/assets/js/canonical.js";
import { multibase58 } from "../../site/assets/js/multibase.js";
import { createApp } from "./server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const taxonomy = JSON.parse(readFileSync(resolve(root, "site/static/engine/taxonomy.json"), "utf8"));

const gen = () => crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);

const storePair = await gen();
const natixarPair = await gen();

const app = await createApp({
  signingKey: natixarPair.privateKey,
  storeKey: storePair.publicKey,
  taxonomy,
});

/** Démarre sur un port éphémère, appelle, referme. */
async function call(path, body) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

const CELL = {
  id: "c1", subPost: 1000, partType: 1, caracterisation: 1,
  // Un mètre cube de gazole, 2 680 kgCO2e. Mille m3 seraient absurdes,
  // et un gabarit invraisemblable rend illisible ce que le cas mesure.
  value: 1, unit: "m3", factor: 2680, origin: "MEASURED",
};

async function signedExtraction(cells) {
  const payload = { cells: structuredClone(cells), servedAt: "2026-08-01T00:00:00Z" };
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, storePair.privateKey, canonicalBytes(payload));
  return { ...payload, proof: { proofValue: multibase58(new Uint8Array(sig)) } };
}

async function request(over = {}) {
  return {
    claim: "carbonIntensity",
    subjectKind: "dore-bar",
    conditions: { export: "GHGP", control: "Operational" },
    subjectId: "urn:aurora:dore:0123456789abcdef",
    derivedFrom: { id: "urn:aurora:dore:0123456789abcdef", digestMultibase: "zAbC" },
    extraction: await signedExtraction([CELL]),
    dispositions: [{ id: "c1", use: "USED" }],
    denominator: 2,
    denominatorUnit: "kg",
    value: 1340,
    ...over,
  };
}

test("healthz ne dit rien de l'état interne", async () => {
  const r = await call("/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ["ok"]);
});

test("un cas nominal rend une attestation signée", async () => {
  const r = await call("/api/v1/sign", await request());
  assert.equal(r.status, 201);
  assert.equal(r.body.proof?.cryptosuite, "ecdsa-jcs-2019");
  assert.ok(r.body.proof.proofValue.startsWith("z"));
  assert.equal(r.body.credentialSubject.carbonIntensity.value, 1340);
  assert.equal(r.body.credentialSubject.carbonIntensity.unit, "kgCO2e/kg");
  assert.equal(r.body.type[1], "CarbonIntensityCredential");
});

// La propriété centrale de #61. Une ligne GHGP figée dans un document signé
// épinglerait tout inventaire passé à un cadre qui change régulièrement.
test("l'attestation ne porte AUCUNE ligne de référentiel, seulement le pivot", async () => {
  const r = await call("/api/v1/sign", await request());
  const text = JSON.stringify(r.body);
  for (const line of ["1.1", "1.2", "1.3", "2.1", "3.3"]) {
    assert.ok(!text.includes(`"${line}"`), `la ligne ${line} figure dans l'attestation`);
  }
  const cell = r.body.credentialSubject.breakdown[0];
  assert.equal(cell.subPost, 1000);
  assert.equal(cell.caracterisation, 1);
  assert.equal(cell.origin, "MEASURED");
});

test("la méthode dit sous quelles conditions et quelle taxonomie le chiffre vaut", async () => {
  const r = await call("/api/v1/sign", await request());
  assert.equal(r.body.method.taxonomy, taxonomy.version);
  assert.equal(r.body.method.conditions.export, "GHGP");
  assert.equal(r.body.method.allocation, "period");
});

test("un modèle d'événements simulé est déclaré, jamais tu", async () => {
  const r = await call("/api/v1/sign", await request({ allocation: "flow", eventModel: "simulated-v1" }));
  assert.equal(r.body.method.allocation, "flow");
  assert.equal(r.body.method.eventModel, "simulated-v1");
});

test("les exclusions voyagent jusqu'au vérificateur", async () => {
  const cells = [CELL, { ...CELL, id: "c2" }];
  const r = await call("/api/v1/sign", await request({
    extraction: await signedExtraction(cells),
    dispositions: [{ id: "c1", use: "USED" },
                   { id: "c2", use: "EXCLUDED", reason: "hors fenêtre pilote" }],
  }));
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.excluded, [{ id: "c2", reason: "hors fenêtre pilote" }]);
});

test("un refus est une réponse, pas un incident : 422 et un code stable", async () => {
  const r = await call("/api/v1/sign", await request({ value: 5000 }));
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "VALUE_MISMATCH");
});

test("l'ordre des contrôles tient : l'admissibilité passe avant le recalcul", async () => {
  // Unité hors SI ET chiffre faux : c'est l'admissibilité qui répond, parce
  // qu'elle est le premier contrôle et le moins cher.
  const r = await call("/api/v1/sign", await request({ denominatorUnit: "oz", value: 9e9 }));
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "DENOMINATOR_UNIT_NOT_SI");
});

test("une extraction non signée est refusée avec son code", async () => {
  const req = await request();
  delete req.extraction.proof;
  const r = await call("/api/v1/sign", req);
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "EXTRACTION_UNSIGNED");
});
