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
import { aggregate } from "../../site/assets/js/engine.js";
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

  return { ...profile, excluded, value: recomputed };
}
