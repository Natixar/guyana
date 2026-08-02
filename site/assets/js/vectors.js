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
export function runVectors(aggregate, vectors, taxonomy, allocate) {
  const failures = [];

  // La dérive de version rendrait toutes les attentes silencieusement fausses
  // pendant que tout continuerait de tourner.
  if (vectors.taxonomy !== taxonomy.version) {
    return [`vecteurs pour ${vectors.taxonomy}, taxonomie servie en ${taxonomy.version}`];
  }

  for (const c of vectors.cases) {
    try {
      // La fenêtre d'intégration fait partie du cas : un débit ne désigne une
      // quantité qu'une fois l'intervalle fixé, et les cas qui n'en donnent pas
      // intègrent chaque cellule sur sa propre période.
      const got = aggregate(c.cells, taxonomy, c.windows ?? null);

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
      if (c.expect.unallocatedByPeriod) {
        for (const [m, want] of Object.entries(c.expect.unallocatedByPeriod)) {
          if (!near(got.unallocatedByPeriod?.[m], want)) {
            failures.push(`${c.name} : non-alloué ${m} = ${got.unallocatedByPeriod?.[m]}, attendu ${want}`);
          }
        }
      }
      // L'allocation est une étape distincte de l'agrégation : la règle peut
      // changer sans que le cube bouge, et le vecteur la teste séparément.
      //
      // ELLE NE PREND PLUS L'AGRÉGAT EN ENTRÉE, et c'est ce qui a changé le
      // 2 août 2026. L'ancienne règle lisait le non-alloué par mois et sommait
      // les mois ; elle ne pouvait donc pas compter les lots, puisqu'un mois ne
      // dit pas combien de lots il porte. La nouvelle prend deux totaux et deux
      // diviseurs, tous quatre déclarés par l'appelant — et donc tous quatre
      // vérifiables dans l'attestation.
      if (c.allocateToBar && allocate) {
        const spec = c.allocateToBar;
        try {
          const out = allocate(spec);
          if (spec.expectError) {
            failures.push(`${c.name} : allocation aurait dû lever ${spec.expectError}`);
          } else if (Math.abs(out.perBar - spec.expectPerBar) > 5e-3) {
            failures.push(`${c.name} : ${out.perBar.toFixed(3)} par barre, ${spec.expectPerBar} attendu`);
          }
        } catch (e) {
          if (e.code !== spec.expectError) {
            failures.push(`${c.name} : allocation ${e.code ?? "erreur"} — ${e.message}`);
          }
        }
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
