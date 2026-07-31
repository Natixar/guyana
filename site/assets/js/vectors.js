/**
 * Exécution des vecteurs partagés.
 *
 * Les vecteurs seuls ne suffisaient pas. Deux hôtes qui lisent le même
 * `vectors.json` mais comparent les résultats avec deux bouts de code écrits
 * séparément peuvent diverger sur ce que « passer » veut dire — une tolérance
 * ici, une ligne inattendue tolérée là. Le comparateur est donc partagé lui
 * aussi : la page d'auto-test et la suite du signataire appellent cette
 * fonction, et rien d'autre.
 *
 * @see site/static/engine/vectors.json
 * @see services/run-vectors.mjs
 */

/**
 * Les facteurs sont décimaux : 0.61 + 2.68 ne vaut pas exactement 3.29 en
 * binaire. On compare à la tolérance du flottant, jamais à l'égalité stricte.
 */
const near = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= 1e-9;

/**
 * Exécute tous les cas et renvoie la liste des écarts — vide si tout passe.
 *
 * @param {(cells: Array, taxonomy: object) => object} aggregate le moteur
 * @param {object} vectors le contenu de vectors.json
 * @param {object} taxonomy la taxonomie servie
 * @returns {string[]} un message par écart constaté
 */
export function runVectors(aggregate, vectors, taxonomy) {
  const failures = [];

  // La dérive de version rendrait toutes les attentes silencieusement fausses
  // pendant que tout continuerait de tourner.
  if (vectors.taxonomy !== taxonomy.version) {
    return [`vecteurs pour ${vectors.taxonomy}, taxonomie servie en ${taxonomy.version}`];
  }

  for (const c of vectors.cases) {
    try {
      const got = aggregate(c.cells, taxonomy);

      if (c.expect.error) {
        failures.push(`${c.name} : aurait dû lever ${c.expect.error}`);
        continue;
      }

      for (const [line, want] of Object.entries(c.expect.lines)) {
        if (!near(got.lines[line], want)) {
          failures.push(`${c.name} : ligne ${line} attendue ${want}, obtenue ${got.lines[line]}`);
        }
      }
      // Une ligne en trop est un écart au même titre qu'une ligne fausse : elle
      // signalerait une traduction qui invente une destination.
      for (const line of Object.keys(got.lines)) {
        if (!(line in c.expect.lines)) failures.push(`${c.name} : ligne ${line} inattendue`);
      }
      if (got.origin !== c.expect.origin) {
        failures.push(`${c.name} : origine ${got.origin}, attendue ${c.expect.origin}`);
      }
      if (!near(got.unallocated, c.expect.unallocated)) {
        failures.push(`${c.name} : non-alloué ${got.unallocated}, attendu ${c.expect.unallocated}`);
      }
      if (got.unit !== vectors.resultUnit) {
        failures.push(`${c.name} : unité ${got.unit}, attendue ${vectors.resultUnit}`);
      }
      if (c.expect.groups !== undefined && got.groups !== c.expect.groups) {
        failures.push(`${c.name} : ${got.groups} groupe(s), ${c.expect.groups} attendu(s)`);
      }
    } catch (e) {
      // Le code compte, pas le texte : un message reformulé ne doit pas faire
      // passer un cas qui devait lever autre chose.
      if (c.expect.error && e.code === c.expect.error) continue;
      failures.push(`${c.name} : ${e.code ?? "erreur"} — ${e.message}`);
    }
  }

  return failures;
}
