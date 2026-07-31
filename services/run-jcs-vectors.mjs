#!/usr/bin/env node
/**
 * Les vecteurs de sérialisation canonique, exécutés côté JavaScript.
 *
 * Le magasin signe ce qu'il sert, en Python ; le signataire vérifie cette
 * signature, en JavaScript. Ce qui est signé, ce sont des octets — donc les
 * deux langages doivent sérialiser au même octet, sinon rien ne se vérifie et
 * la panne est muette : une signature qui ne correspond pas ressemble à une
 * signature invalide, pas à un désaccord d'encodage.
 *
 * `services/store/test_jcs.py` exécute exactement les mêmes cas. Deux
 * implémentations qui passent chacune ses propres tests ne prouvent rien ;
 * deux implémentations qui passent les mêmes vecteurs se sont mises d'accord.
 *
 *   node services/run-jcs-vectors.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { canonicalize } = await import(resolve(root, "site/assets/js/canonical.js"));
const vectors = JSON.parse(readFileSync(resolve(root, "site/static/engine/jcs-vectors.json"), "utf8"));

const failures = [];

for (const c of vectors.cases) {
  let got;
  try {
    got = canonicalize(c.value);
  } catch (e) {
    failures.push(`${c.name} : a levé — ${e.message}`);
    continue;
  }
  if (got !== c.expect) failures.push(`${c.name} :\n      attendu ${c.expect}\n      obtenu  ${got}`);
}

for (const c of vectors.refuse) {
  const value = { NaN: NaN, Infinity: Infinity }[c.value];
  try {
    canonicalize({ a: value });
    failures.push(`${c.name} : aurait dû lever`);
  } catch { /* attendu */ }
}

const total = vectors.cases.length + vectors.refuse.length;
console.log(`JCS — ${total} vecteurs, ${total - failures.length} passent`);
for (const f of failures) console.error("  ÉCHEC " + f);

process.exit(failures.length ? 1 : 0);
