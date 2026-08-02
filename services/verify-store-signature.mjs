#!/usr/bin/env node
/**
 * L'autre moitié du contrôle d'interopérabilité.
 *
 * `services/store/test_signing.py` écrit un échantillon signé en Python. Ce
 * script le vérifie avec WebCrypto, exactement comme le signataire le fera en
 * production — même canonicalisation, même décodage multibase, même appel.
 *
 * Deux implémentations qui se croient d'accord ne valent rien tant qu'aucune
 * n'a vérifié la signature de l'autre. Et l'échec, ici, serait muet : une
 * signature DER là où WebCrypto attend `r || s` ne lève pas, elle renvoie
 * `false` — ce qui ressemble à une clé fausse ou à des octets altérés.
 *
 *   python3 -m pytest services/store/test_signing.py -q   # écrit l'échantillon
 *   node services/verify-store-signature.mjs              # le vérifie
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { canonicalBytes } = await import(resolve(root, "site/assets/js/canonical.js"));
const { multibase58Decode } = await import(resolve(root, "site/assets/js/multibase.js"));

const samplePath = resolve(root, "services/store/store-signature-sample.json");
let sample;
try {
  sample = JSON.parse(readFileSync(samplePath, "utf8"));
} catch {
  console.error("échantillon absent — exécuter d'abord pytest services/store/test_signing.py");
  process.exit(1);
}

const key = await crypto.subtle.importKey(
  "jwk", sample.publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

const { proof, ...payload } = sample.extraction;

const ok = await crypto.subtle.verify(
  { name: "ECDSA", hash: "SHA-256" },
  key,
  multibase58Decode(proof.proofValue),
  canonicalBytes(payload),
);

if (!ok) {
  console.error("ÉCHEC — la signature produite en Python ne se vérifie pas en JavaScript.");
  console.error("Causes usuelles : signature laissée en DER au lieu de r||s, ou");
  console.error("sérialisations divergentes. La forme canonique vue ici est :");
  console.error("  " + new TextDecoder().decode(canonicalBytes(payload)));
  process.exit(1);
}

// Un contrôle qui ne peut pas échouer est décoratif : on vérifie aussi qu'une
// charge altérée est bien rejetée.
const tampered = structuredClone(payload);
tampered.cells[0].flux = 999999;
const stillOk = await crypto.subtle.verify(
  { name: "ECDSA", hash: "SHA-256" }, key,
  multibase58Decode(proof.proofValue), canonicalBytes(tampered));

if (stillOk) {
  console.error("ÉCHEC — une charge altérée se vérifie encore.");
  process.exit(1);
}

console.log("interopérabilité — la signature Python se vérifie en JavaScript, et l'altération est rejetée");
