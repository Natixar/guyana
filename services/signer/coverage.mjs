/**
 * La couverture : chaque enregistrement servi doit être justifié.
 *
 * C'est la couche 3 de l'argument de complétude (#6). Le magasin sait ce qu'il
 * a servi ; le client doit rendre compte de chaque cellule — employée dans le
 * calcul, ou écartée avec une raison. La raison voyage ensuite dans
 * l'attestation, où un vérificateur peut la juger.
 *
 * Le signataire n'a PAS à comprendre pourquoi une cellule est écartée. C'est un
 * contrôle de couverture et non de sémantique, et c'est ce qui le rend
 * praticable : juger les raisons demanderait de connaître le métier, les
 * dénombrer ne demande rien.
 *
 * Ce que cette couche ne prouve pas, et qu'il faut dire : elle établit que le
 * client a employé tout ce qu'on lui a donné, pas qu'on lui a donné tout ce
 * qui comptait. Cette question-là est l'enveloppe, couche 1, et elle vit dans
 * `admissible.mjs`. Ni l'une ni l'autre ne dit si le cube couvre la réalité —
 * c'est le seau non-alloué qui en répond.
 */

function fault(code, detail) {
  const e = new Error(detail ? `${code} — ${detail}` : code);
  e.code = code;
  return e;
}

const USED = "USED";
const EXCLUDED = "EXCLUDED";

/**
 * Répartit les cellules servies selon leur disposition, ou refuse.
 *
 * @param {{cells: Array<{id: string}>}} extraction ce que le magasin a servi
 * @param {Array<{id: string, use: "USED"|"EXCLUDED", reason?: string}>} dispositions
 * @returns {{used: Array<object>, excluded: Array<{cell: object, reason: string}>}}
 * @throws {Error} `DISPOSITION_MISSING`, `DISPOSITION_UNKNOWN_CELL`,
 *   `DISPOSITION_DUPLICATE`, `DISPOSITION_INVALID`, `EXCLUSION_UNEXPLAINED`
 */
export function partition(extraction, dispositions) {
  const cells = extraction?.cells;
  if (!Array.isArray(cells)) throw fault("EXTRACTION_INVALID", "cells absent");
  if (!Array.isArray(dispositions)) throw fault("DISPOSITION_INVALID", "liste attendue");

  const byId = new Map();
  for (const cell of cells) {
    if (cell.id === undefined) throw fault("EXTRACTION_INVALID", "cellule sans identifiant");
    if (byId.has(cell.id)) throw fault("EXTRACTION_INVALID", `identifiant en double : ${cell.id}`);
    byId.set(cell.id, cell);
  }

  const seen = new Set();
  const used = [];
  const excluded = [];

  for (const d of dispositions) {
    const cell = byId.get(d?.id);
    // Une disposition qui ne correspond à rien de servi : soit le client parle
    // d'une extraction différente, soit il en invente une. Dans les deux cas la
    // requête ne décrit pas ce qui s'est passé.
    if (!cell) throw fault("DISPOSITION_UNKNOWN_CELL", String(d?.id));
    if (seen.has(d.id)) throw fault("DISPOSITION_DUPLICATE", String(d.id));
    seen.add(d.id);

    if (d.use === USED) {
      used.push(cell);
    } else if (d.use === EXCLUDED) {
      // Une exclusion sans raison est le trou par lequel la complétude s'en va :
      // elle rend indistinguables « écartée à dessein » et « oubliée ».
      const reason = typeof d.reason === "string" ? d.reason.trim() : "";
      if (!reason) throw fault("EXCLUSION_UNEXPLAINED", String(d.id));
      excluded.push({ cell, reason });
    } else {
      throw fault("DISPOSITION_INVALID", `${d.use} sur ${d.id}`);
    }
  }

  const missing = [...byId.keys()].filter((id) => !seen.has(id));
  if (missing.length) {
    throw fault("DISPOSITION_MISSING", `${missing.length} cellule(s) : ${missing.slice(0, 5).join(", ")}`);
  }

  return { used, excluded };
}
