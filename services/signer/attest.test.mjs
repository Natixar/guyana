/**
 * Le signataire refuse-t-il ce qu'il doit refuser ?
 *
 *   node --test services/signer/
 *
 * Chaque cas correspond à un contrôle du §« Ce que le signataire vérifie » de
 * services/README.md. Un contrôle qui ne peut pas faire échouer un test est
 * décoratif — c'est la règle de deploy/verify/, elle vaut ici aussi.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalBytes } from "../../site/assets/js/canonical.js";
import { multibase58 } from "../../site/assets/js/multibase.js";
import { decide } from "./attest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const taxonomy = JSON.parse(readFileSync(resolve(root, "site/static/engine/taxonomy.json"), "utf8"));

const storePair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);

/**
 * Ce que le magasin sert : des cellules, et sa signature dessus.
 *
 * Copie profonde des cellules. Sans elle, un cas qui altère une cellule pour
 * vérifier qu'une signature ne tient plus altère le gabarit partagé, et les cas
 * suivants s'exécutent sur des données que personne n'a écrites — ce qui s'est
 * produit, et donnait une erreur de valeur là où la couverture était en cause.
 */
async function extractionOf(cells, signWith = storePair.privateKey) {
  const payload = { cells: structuredClone(cells), servedAt: "2026-08-01T00:00:00Z" };
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, signWith, canonicalBytes(payload));
  return { ...payload, proof: { proofValue: multibase58(new Uint8Array(sig)) } };
}

const CELL = {
  id: "c1", subPost: 1000, partType: 1, caracterisation: 1,
  value: 1000, unit: "L", factor: 2.68, factorUnit: "kgCO2e/L", origin: "MEASURED",
};

async function requestFor(cells, over = {}) {
  return {
    claim: "carbonIntensity",
    subjectKind: "dore-bar",
    conditions: { export: "GHGP", control: "Operational" },
    subjectId: "urn:aurora:dore:0123456789abcdef",
    derivedFrom: { id: "urn:aurora:dore:0123456789abcdef", digestMultibase: "zAbC" },
    extraction: await extractionOf(cells),
    dispositions: cells.map((c) => ({ id: c.id, use: "USED" })),
    denominator: 1,
    denominatorUnit: "kg",
    value: cells.length * 2680,
    ...over,
  };
}

const opts = () => ({ storeKey: storePair.publicKey, taxonomy });

async function refuses(request, code) {
  await assert.rejects(() => decide(request, opts()), (e) => e.code === code,
    `attendu ${code}, obtenu autre chose`);
}

test("signe un cas nominal, et rend le profil recalculé", async () => {
  const out = await decide(await requestFor([CELL]), opts());
  assert.equal(out.unit, "kgCO2e");
  assert.equal(out.lines["1.1"], 2680);
  assert.equal(out.origin, "MEASURED");
  assert.equal(out.value, 2680);
});

test("refuse une revendication hors de l'ensemble admissible", async () => {
  await refuses(await requestFor([CELL], { claim: "waterUse" }), "CLAIM_NOT_ADMISSIBLE");
});

test("refuse des conditions qui ne sont pas celles sous lesquelles le chiffre a un sens", async () => {
  await refuses(await requestFor([CELL], { conditions: { export: "BEGES", control: "Operational" } }),
    "CONDITIONS_MISMATCH");
});

test("refuse une extraction non signée — sans elle, recalculer ne prouve rien", async () => {
  const r = await requestFor([CELL]);
  delete r.extraction.proof;
  await refuses(r, "EXTRACTION_UNSIGNED");
});

test("refuse une extraction signée par quelqu'un d'autre que le magasin", async () => {
  const impostor = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const r = await requestFor([CELL]);
  r.extraction = await extractionOf([CELL], impostor.privateKey);
  await refuses(r, "EXTRACTION_SIGNATURE_INVALID");
});

test("refuse une extraction dont une cellule a été modifiée après signature", async () => {
  const r = await requestFor([CELL]);
  r.extraction.cells[0].value = 999999;
  await refuses(r, "EXTRACTION_SIGNATURE_INVALID");
});

test("refuse une cellule servie dont le client ne rend pas compte", async () => {
  const two = [CELL, { ...CELL, id: "c2" }];
  const r = await requestFor(two);
  r.dispositions = [{ id: "c1", use: "USED" }];   // c2 passée sous silence
  r.value = 2680;
  await refuses(r, "DISPOSITION_MISSING");
});

test("refuse une exclusion sans raison — sinon « écartée » et « oubliée » se confondent", async () => {
  const r = await requestFor([CELL]);
  r.dispositions = [{ id: "c1", use: "EXCLUDED" }];
  await refuses(r, "EXCLUSION_UNEXPLAINED");
});

test("accepte une exclusion motivée, et la fait voyager", async () => {
  const two = [CELL, { ...CELL, id: "c2" }];
  const r = await requestFor(two);
  r.dispositions = [{ id: "c1", use: "USED" },
                    { id: "c2", use: "EXCLUDED", reason: "hors fenêtre pilote" }];
  r.value = 2680;
  const out = await decide(r, opts());
  assert.equal(out.value, 2680);
  assert.equal(out.excluded.length, 1);
  assert.equal(out.excluded[0].reason, "hors fenêtre pilote");
});

test("refuse une disposition qui parle d'une cellule jamais servie", async () => {
  const r = await requestFor([CELL]);
  r.dispositions = [{ id: "c1", use: "USED" }, { id: "inventée", use: "USED" }];
  await refuses(r, "DISPOSITION_UNKNOWN_CELL");
});

test("refuse un chiffre que le recalcul ne redonne pas", async () => {
  await refuses(await requestFor([CELL], { value: 940 }), "VALUE_MISMATCH");
});

test("refuse une requête qui ne dit pas l'unité de son dénominateur", async () => {
  // Sans elle, la borne de vraisemblance supposait une unité : un chiffre
  // divisé par des barres au lieu d'onces est ~355 fois plus grand, et le
  // garde censé attraper une unité que personne n'a voulue en devinait une.
  const r = await requestFor([CELL]);
  delete r.denominatorUnit;
  await refuses(r, "FIELD_MISSING");
});

test("refuse une unité de dénominateur hors du SI", async () => {
  // L'once troy porte un facteur trente et un que quelqu'un finira par
  // appliquer une fois de trop ou pas du tout.
  await refuses(await requestFor([CELL], { denominatorUnit: "oz" }), "DENOMINATOR_UNIT_NOT_SI");
  await refuses(await requestFor([CELL], { denominatorUnit: "t" }), "DENOMINATOR_UNIT_NOT_SI");
});

test("un chiffre faux est rejeté par le RECALCUL, pas par un seuil", async () => {
  // Il n'y a plus de seuil : borner en tCO2e par once d'or mettait la
  // connaissance d'un client dans un service générique, et ne protégeait que
  // d'un problème d'unité que le SI résout à la racine.
  await refuses(await requestFor([CELL], { value: 1e9 }), "VALUE_MISMATCH");
});

test("refuse un dénominateur nul plutôt que de diviser par zéro", async () => {
  await refuses(await requestFor([CELL], { denominator: 0 }), "DENOMINATOR_INVALID");
});

test("propage le refus du moteur : une part exclue reste un refus", async () => {
  const cells = [{ ...CELL, partType: 5 }];
  await refuses(await requestFor(cells), "PART_TYPE_EXCLUDED");
});
