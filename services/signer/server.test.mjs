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
import { multibase58, multibase58Decode } from "../../site/assets/js/multibase.js";
import { verifyMatrix, recomputeTotal } from "../../site/assets/js/commitments.js";
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
  // Un mètre cube de gazole, 2 680 kgCO2e.
  //
  // LE FACTEUR EST DÉJÀ EN SI, et c'est ce que le chiffre 2680 dit. La feuille 9
  // du paquet AGM le donne à 2,68 kgCO2e/L parce que les bons de sortie comptent
  // en litres ; un mètre cube en contient mille, donc le facteur se MULTIPLIE
  // par mille en franchissant la frontière — 2,68 kgCO2e/L = 2 680 kgCO2e/m3.
  // La conversion a lieu une seule fois, dans `load_2025.py`, et jamais ici.
  //
  // Le contrôle qui le rend indiscutable est dimensionnel : l'émission vaut
  // `flux × facteur × durée`, donc (m3/s) × (kgCO2e/m3) × s = kgCO2e. Un facteur
  // laissé en kgCO2e/L donnerait des kgCO2e mille fois trop petits sous le même
  // nom.
  //
  // L'intervalle est d'une seconde pour que le débit et la quantité se lisent
  // l'un dans l'autre : ces cas-ci portent sur la forme de l'attestation, pas
  // sur l'arithmétique du temps.
  flux: 1, dimension: "volume", displayUnit: "L",
  factor: 2680, origin: "MEASURED",
  periodStart: "2025-01-01T04:00:00Z", periodEnd: "2025-01-01T04:00:01Z",
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
    // LE DÉNOMINATEUR EST CE PAR QUOI ON DIVISE POUR OBTENIR UNE INTENSITÉ :
    // ici la masse d'or fin du lingot, en kilogrammes. Deux kilogrammes est un
    // chiffre rond choisi pour que l'arithmétique du test se lise à l'œil, pas
    // un lingot plausible — une barre d'AGM en porte environ 11,7.
    //
    // 2 680 kgCO2e / 2 kg = 1 340 kgCO2e/kg, et c'est `value`. L'unité de
    // l'intensité n'est jamais déclarée : le signataire la DÉRIVE en
    // `kgCO2e/${denominatorUnit}`, ce qui est la correction de 90be1a8 — un
    // chiffre qui porte une unité que personne n'a voulue est le défaut que
    // `denominatorUnit` existe pour rendre impossible.
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

test("un cas nominal rend une attestation signée et ses divulgations", async () => {
  const r = await call("/api/v1/sign", await request());
  assert.equal(r.status, 201);
  const c = r.body.credential;
  assert.equal(c.proof?.cryptosuite, "ecdsa-jcs-2019");
  assert.ok(c.proof.proofValue.startsWith("z"));
  assert.equal(c.credentialSubject.carbonIntensity.value, 1340);
  assert.equal(c.credentialSubject.carbonIntensity.unit, "kgCO2e/kg");
  assert.equal(c.type[1], "CarbonIntensityCredential");
  // Les divulgations sortent À CÔTÉ : c'est ce qui rend la redaction possible.
  assert.ok(Array.isArray(r.body.disclosures));
  assert.equal(r.body.disclosures.length, c.credentialSubject.breakdown.length);
});

// La propriété centrale de #61. Une ligne GHGP figée dans un document signé
// épinglerait tout inventaire passé à un cadre qui change régulièrement.
test("l'attestation ne porte AUCUNE ligne de référentiel, seulement le pivot", async () => {
  const r = await call("/api/v1/sign", await request());
  const text = JSON.stringify(r.body);
  for (const line of ["1.1", "1.2", "1.3", "2.1", "3.3"]) {
    assert.ok(!text.includes(`"${line}"`), `la ligne ${line} figure dans l'attestation`);
  }
  // La matrice signée ne porte que des engagements : la position pivot elle-même
  // est dans la divulgation, donc invisible d'une cellule retirée.
  const cell = r.body.credential.credentialSubject.breakdown[0];
  assert.deepEqual(Object.keys(cell).sort(), ["commitment", "used"]);
  assert.ok(cell.commitment.startsWith("z"));
  const disclosed = r.body.disclosures[0];
  assert.equal(disclosed.subPost, 1000);
  assert.equal(disclosed.caracterisation, 1);
  assert.equal(disclosed.origin, "MEASURED");
});

test("la méthode dit sous quelles conditions et quelle taxonomie le chiffre vaut", async () => {
  const r = await call("/api/v1/sign", await request());
  assert.equal(r.body.credential.method.taxonomy, taxonomy.version);
  assert.equal(r.body.credential.method.conditions.export, "GHGP");
  assert.equal(r.body.credential.method.allocation, "period");
});

test("un modèle d'événements simulé est déclaré, jamais tu", async () => {
  const r = await call("/api/v1/sign", await request({ allocation: "flow", eventModel: "simulated-v1" }));
  assert.equal(r.body.credential.method.allocation, "flow");
  assert.equal(r.body.credential.method.eventModel, "simulated-v1");
});

// --- Décision 1 de #61 : engagements par cellule -------------------------

test("une cellule écartée reste dans la matrice, dénombrable et motivée", async () => {
  const cells = [CELL, { ...CELL, id: "c2" }];
  const r = await call("/api/v1/sign", await request({
    extraction: await signedExtraction(cells),
    dispositions: [{ id: "c1", use: "USED" },
                   { id: "c2", use: "EXCLUDED", reason: "hors fenêtre pilote" }],
  }));
  assert.equal(r.status, 201);

  // Elle n'a PAS disparu : un document d'où les exclusions seraient retirées
  // ressemble trait pour trait à un document complet.
  const matrix = r.body.credential.credentialSubject.breakdown;
  assert.equal(matrix.length, 2, "la cellule écartée a disparu de la matrice");

  const withheld = matrix.filter((c) => !c.used);
  assert.equal(withheld.length, 1);
  assert.equal(withheld[0].reason, "hors fenêtre pilote");
  assert.ok(withheld[0].commitment.startsWith("z"));
});

test("une cellule divulguée se décrit seule", async () => {
  // Le porteur peut ne remettre que celle-ci. Un vérificateur qui reçoit un
  // montant sans sa période et sans son mode n'a rien reçu.
  const r = await call("/api/v1/sign", await request());
  const cell = r.body.disclosures[0];

  assert.equal(cell.mode, "aggregate", "le mode d'impact manque");
  assert.equal(cell.subPost, 1000, "la position pivot manque");
  assert.ok("period" in cell, "l'intervalle manque");
  assert.ok("origin" in cell, "l'origine manque");
  // Et jamais une ligne de référentiel : c'est la propriété centrale de #61.
  assert.ok(!("line" in cell) && !("ghgp" in cell));

  // NI L'UNITÉ DU RÉSULTAT. Elle appartient au calcul, pas à la donnée : ce
  // sont des kgCO2e parce qu'on a appliqué un facteur d'émission, et le même
  // débit sous un facteur de consommation d'eau donnerait des mètres cubes.
  // Figée dans la cellule, elle deviendrait fausse sans que rien ne bouge ;
  // l'attestation, elle, dit de quel calcul elle rend compte.
  assert.ok(!("unit" in cell), "l'unité du résultat est collée à la donnée");
  assert.equal(r.body.credential.credentialSubject.carbonIntensity.unit, "kgCO2e/kg");
});

test("l'intervalle survit à l'agrégation", async () => {
  // Sans période dans la maille, douze cellules mensuelles de même position se
  // fondaient en une seule dont personne ne pouvait plus dire le mois — alors
  // que la période est un axe de la matrice.
  const janvier = { ...CELL, id: "j", periodStart: "2025-01-01T04:00:00Z",
                    periodEnd: "2025-01-01T04:00:01Z" };
  const fevrier = { ...CELL, id: "f", periodStart: "2025-02-01T04:00:00Z",
                    periodEnd: "2025-02-01T04:00:01Z" };
  const r = await call("/api/v1/sign", await request({
    extraction: await signedExtraction([janvier, fevrier]),
    dispositions: [{ id: "j", use: "USED" }, { id: "f", use: "USED" }],
    value: (2 * 2680) / 2,
  }));
  assert.equal(r.status, 201);
  assert.equal(r.body.credential.credentialSubject.breakdown.length, 2,
               "deux mois ont fondu en une cellule");
  assert.equal(r.body.disclosures[0].period.start, "2025-01-01T04:00:00Z");
  assert.equal(r.body.disclosures[1].period.start, "2025-02-01T04:00:00Z");
});

test("chaque engagement se recalcule depuis sa divulgation", async () => {
  const r = await call("/api/v1/sign", await request());
  const { credential, disclosures } = r.body;
  const matrix = credential.credentialSubject.breakdown;

  const outcome = await verifyMatrix(matrix, disclosures);
  assert.equal(outcome.ok, true, `engagements non recalculés : ${outcome.mismatched}`);
  assert.equal(outcome.disclosed, matrix.length);
  assert.equal(outcome.withheld, 0);
});

test("retirer une divulgation n'invalide pas la signature", async () => {
  // Deux POSITIONS PIVOT distinctes, sinon l'agrégation les fond en un seul
  // groupe et la matrice n'a qu'une ligne : la combustion et son amont.
  const cells = [CELL, { ...CELL, id: "c2", partType: 2 }];
  const r = await call("/api/v1/sign", await request({
    extraction: await signedExtraction(cells),
    dispositions: [{ id: "c1", use: "USED" }, { id: "c2", use: "USED" }],
    value: (2 * 2680) / 2,
  }));
  assert.equal(r.status, 201);
  const { credential, disclosures } = r.body;

  // Le porteur ne remet que la première ligne. Le document signé, lui, ne
  // bouge pas d'un octet — c'est toute la raison d'avoir sorti les montants.
  const partial = disclosures.slice(0, 1);
  const outcome = await verifyMatrix(credential.credentialSubject.breakdown, partial);
  assert.equal(outcome.ok, true, "une divulgation retirée a cassé la vérification");
  assert.equal(outcome.disclosed, 1);
  assert.equal(outcome.withheld, 1);

  // Et la signature tient toujours, puisqu'elle ne couvrait que les engagements.
  const { proof, ...payload } = credential;
  const config = { "@context": credential["@context"], ...proof };
  delete config.proofValue;
  const sha = async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  const toSign = new Uint8Array(64);
  toSign.set(await sha(canonicalBytes(config)), 0);
  toSign.set(await sha(canonicalBytes(payload)), 32);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, natixarPair.publicKey,
    multibase58Decode(proof.proofValue), toSign);
  assert.equal(ok, true, "la signature ne tient plus après redaction");
});

test("une divulgation altérée est refusée", async () => {
  const r = await call("/api/v1/sign", await request());
  const { credential, disclosures } = r.body;

  const tampered = structuredClone(disclosures);
  tampered[0].amount = tampered[0].amount * 2;
  const outcome = await verifyMatrix(credential.credentialSubject.breakdown, tampered);
  assert.equal(outcome.ok, false, "un montant doublé a été accepté");
  assert.deepEqual(outcome.mismatched, [0]);
});

test("le total ne se recalcule que si tout ce qui a compté est divulgué", async () => {
  // Deux POSITIONS PIVOT distinctes, sinon l'agrégation les fond en un seul
  // groupe et la matrice n'a qu'une ligne : la combustion et son amont.
  const cells = [CELL, { ...CELL, id: "c2", partType: 2 }];
  const r = await call("/api/v1/sign", await request({
    extraction: await signedExtraction(cells),
    dispositions: [{ id: "c1", use: "USED" }, { id: "c2", use: "USED" }],
    value: (2 * 2680) / 2,
  }));
  const { credential, disclosures } = r.body;
  const matrix = credential.credentialSubject.breakdown;

  const whole = recomputeTotal(matrix, disclosures);
  assert.equal(whole.known, true);

  // Divulgation partielle : « on ne peut pas savoir » n'est pas « faux ». Les
  // confondre apprendrait au lecteur à ignorer l'alerte.
  const partial = recomputeTotal(matrix, disclosures.slice(0, 1));
  assert.equal(partial.known, false);
  assert.equal(partial.total, null);
  assert.equal(partial.withheld, 1);
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
