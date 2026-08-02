#!/usr/bin/env node
/**
 * Les vecteurs partagés, exécutés dans Node — le second des deux hôtes.
 *
 * Ce script ne contient ni cas de test ni comparaison : les cas viennent de
 * `site/static/engine/vectors.json` et la comparaison de
 * `site/assets/js/vectors.js`. Il ne fait que les réunir avec le moteur, qui
 * est le fichier source même que la page importe.
 *
 * C'est ce qui rend la propriété « un moteur, deux hôtes » vérifiable plutôt
 * qu'affirmée. Deux copies de cas de test tenues synchrones à la main ne
 * prouveraient rien, et deux comparateurs écrits séparément pourraient
 * diverger sur ce que « passer » veut dire.
 *
 *   node services/run-vectors.mjs          # depuis la racine du dépôt
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

const { aggregate, allocateUnallocated } = await import(resolve(root, "site/assets/js/engine.js"));
const { runVectors } = await import(resolve(root, "site/assets/js/vectors.js"));

const vectors = read("site/static/engine/vectors.json");
const taxonomy = read("site/static/engine/taxonomy.json");

const failures = runVectors(aggregate, vectors, taxonomy, allocateUnallocated);
const total = vectors.cases.length;

console.log(`vecteurs v${vectors.version}, taxonomie ${taxonomy.version}, ${total} cas`);
console.log(`${total - failures.length}/${total} cas passent`);
for (const f of failures) console.error("  ÉCHEC " + f);

process.exit(failures.length ? 1 : 0);
