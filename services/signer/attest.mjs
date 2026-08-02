/**
 * La vérification d'extraction, et la décision de signer.
 *
 * Le signataire n'a pas la base. Il recalcule donc à partir de la charge que le
 * client lui envoie — et rien dans cette charge ne se distingue d'une invention,
 * sauf la signature que le magasin a apposée sur ce qu'il a servi. C'est le
 * pivot de toute l'architecture : sans elle, recalculer ne prouve rien, puisque
 * les entrées viennent de celui dont on ne veut justement pas croire la
 * conclusion.
 *
 * Asymétrique, jamais un HMAC : un secret partagé remettrait une clé capable de
 * signer dans les deux processus, et défairait l'invariant selon lequel la clé
 * de signature et les données ne se rencontrent jamais.
 */
import { canonicalBytes } from "../../site/assets/js/canonical.js";
import { multibase58Decode } from "../../site/assets/js/multibase.js";
import { aggregate, emissionOf } from "../../site/assets/js/engine.js";
import { assertAdmissible } from "./admissible.mjs";
import { partition } from "./coverage.mjs";

function fault(code, detail) {
  const e = new Error(detail ? `${code} — ${detail}` : code);
  e.code = code;
  return e;
}

/**
 * Vérifie que l'extraction a bien été servie par le magasin.
 *
 * La preuve couvre l'extraction privée de sa preuve : on la retire avant de
 * canonicaliser, sans quoi rien ne serait vérifiable — la signature ferait
 * partie de ce qu'elle signe.
 */
export async function verifyExtraction(extraction, storeKey) {
  const proof = extraction?.proof;
  if (!proof?.proofValue) throw fault("EXTRACTION_UNSIGNED");

  const { proof: _, ...payload } = extraction;
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    storeKey,
    multibase58Decode(proof.proofValue),
    canonicalBytes(payload),
  );
  if (!ok) throw fault("EXTRACTION_SIGNATURE_INVALID");
  return payload;
}

/**
 * Les quatre contrôles, dans l'ordre, et un échec à n'importe quel rang refuse.
 *
 * L'ordre est délibéré : du moins cher au plus cher, et du plus rejetant au
 * moins rejetant. Recalculer avant d'avoir établi d'où viennent les chiffres
 * serait du travail fait pour rien, et pire, ce serait rassurant.
 *
 * @returns {{lines: object, origin: string, unallocated: number, unit: string,
 *            excluded: Array, value: number}}
 */
export async function decide(request, { storeKey, taxonomy, tolerance = 1e-9 }) {
  // 1 — la requête appartient-elle à ce que nous acceptons d'attester ?
  assertAdmissible(request);

  // 2 — l'extraction vient-elle bien du magasin ?
  const extraction = await verifyExtraction(request.extraction, storeKey);

  // 3 — le client rend-il compte de tout ce qui lui a été servi ?
  const { used, excluded } = partition(extraction, request.dispositions);

  // 4 — le recalcul redonne-t-il le chiffre présenté ?
  //
  // SANS FENÊTRE, DÉLIBÉRÉMENT. Chaque cellule est intégrée sur sa propre
  // période, c'est-à-dire en entier. C'est juste tant que l'extraction est
  // servie pour des périodes que les cellules épousent — le cas d'aujourd'hui,
  // où le cube est mensuel et l'attestation porte sur des mois.
  //
  // Le jour où une attestation portera sur l'empreinte temporelle d'un lot —
  // un multi-intervalle de quelques jours — la fenêtre devra voyager dans la
  // requête et entrer ici, faute de quoi une cellule mensuelle recouvrant à
  // moitié le lot compterait pour un mois entier. Le moteur sait déjà le faire ;
  // ce qui manque est la décision d'admissibilité sur ce que le porteur a le
  // droit de déclarer comme fenêtre. Elle relève de #6.
  const profile = aggregate(used, taxonomy);
  const total = Object.values(profile.lines).reduce((a, b) => a + b, 0);
  const denominator = request.denominator;
  if (!(typeof denominator === "number") || denominator <= 0) {
    throw fault("DENOMINATOR_INVALID", String(denominator));
  }
  const recomputed = total / denominator;

  if (Math.abs(recomputed - request.value) > tolerance) {
    throw fault("VALUE_MISMATCH", `présenté ${request.value}, recalculé ${recomputed}`);
  }

  return { ...profile, excluded, value: recomputed, total };
}

/**
 * La matrice complète : ce qui a compté, puis ce qui n'a pas compté.
 *
 * LES DEUX SONT DANS LE MÊME TABLEAU, et c'est la décision 1 de l'issue #61.
 * Une cellule écartée ne disparaît pas de l'attestation : elle y reste,
 * dénombrable, avec le motif de sa mise à l'écart. Le vérificateur peut donc
 * dire « vingt-quatre cellules, vingt ont compté, quatre non, et voici
 * pourquoi » — ce qu'un document d'où les exclusions auraient été retirées ne
 * permet pas, puisqu'il ressemble trait pour trait à un document complet.
 *
 * L'ordre est figé : les groupes agrégés d'abord, dans l'ordre de l'agrégation,
 * puis les exclues dans l'ordre des dispositions. Une divulgation se rattache à
 * son engagement par son rang, donc retrier après signature les désapparie.
 *
 * Les exclues entrent CELLULE PAR CELLULE et non agrégées : les agréger
 * fusionnerait des motifs différents sous un seul montant, et le motif est
 * précisément ce que la décision demande de rendre appréciable.
 *
 * @returns {{cells: Array<object>, disposition: (cell: object) => object}}
 */
export function matrixOf(verdict) {
  const cells = [
    ...verdict.pivot.map((cell) => ({ ...cell, used: true })),
    ...verdict.excluded.map(({ cell, reason }) => ({
      step: cell.step ?? null,
      subPost: cell.subPost ?? null,
      partType: cell.partType ?? null,
      caracterisation: cell.caracterisation,
      // La période d'une cellule écartée voyage comme celle d'une cellule
      // retenue. Le motif seul ne suffit pas : « écartée, hors périmètre » sans
      // date ne se recoupe avec rien, alors que la matrice existe précisément
      // pour être recoupée.
      period: { start: cell.periodStart, end: cell.periodEnd },
      // Le montant d'une cellule écartée se calcule par LA MÊME formule que
      // celui d'une cellule retenue — débit x facteur x durée — et donc par la
      // même fonction. Deux formules, même d'accord aujourd'hui, divergeraient
      // un jour sans que rien ne le signale, et l'écart apparaîtrait dans un
      // document signé.
      amount: emissionOf(cell),
      origin: cell.origin ?? "NOT_MEASURED",
      used: false,
      reason,
    })),
  ];

  // `used` et `reason` gouvernent l'entrée signée ; ils ne font pas partie du
  // contenu engagé, sinon ils y seraient cachés alors qu'ils doivent être lus.
  return {
    cells: cells.map(({ used: _u, reason: _r, ...content }) => content),
    disposition: (_cell, index) => ({ used: cells[index].used, reason: cells[index].reason }),
  };
}
