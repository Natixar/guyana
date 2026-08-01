/**
 * Ce que Natixar accepte d'attester.
 *
 * Tout ce qu'un client sait exprimer, Natixar le signera. La grammaire de
 * requête est donc une surface de politique et non un contrôle de syntaxe.
 * « Bien formée » dit que le JSON se lit ; « admissible » dit que nous sommes
 * prêts à en répondre. Ce fichier tient la seconde liste, et elle est
 * ÉNUMÉRÉE : en H1 il y a une revendication, une seule.
 *
 * Chaque refus porte un code stable. Un client doit pouvoir corriger sa
 * requête sans lire un message rédigé pour un humain.
 */

/** L'ensemble admissible en H1. Toute addition ici est une décision produit. */
export const CLAIMS = {
  carbonIntensity: {
    subjectKind: "dore-bar",
    /** Le référentiel et le contexte sous lesquels le chiffre a un sens. */
    conditions: { export: "GHGP", control: "Operational" },
    /**
     * Bornes de vraisemblance, PAR UNITÉ DE DÉNOMINATEUR.
     *
     * Une borne unique supposait une unité que la requête ne déclare pas. Un
     * chiffre divisé par des barres au lieu d'onces est ~355 fois plus grand,
     * et rien dans la requête ne permettait de trancher : le garde censé
     * attraper une unité que personne n'a voulue en supposait une lui-même.
     *
     * Les ordres de grandeur viennent du pilote : une once de doré porte de
     * l'ordre de l'unité en tCO2e, une barre de 355 onces quelques centaines.
     */
    plausible: {
      "tCO2e/oz": { min: 0, max: 100 },
      "tCO2e/bar": { min: 0, max: 35000 },
    },
  },
};

function fault(code, detail) {
  const e = new Error(detail ? `${code} — ${detail}` : code);
  e.code = code;
  return e;
}

/**
 * Vérifie qu'une requête appartient à l'ensemble admissible.
 *
 * Ne regarde ni les chiffres ni les signatures : uniquement la forme de ce qui
 * est demandé. Les quatre contrôles du signataire sont séquentiels et celui-ci
 * est le premier, parce qu'il est le moins cher et qu'il rejette le plus.
 *
 * @throws {Error} `CLAIM_NOT_ADMISSIBLE`, `SUBJECT_KIND_UNEXPECTED`,
 *   `CONDITIONS_MISMATCH`, `FIELD_MISSING`, `VALUE_IMPLAUSIBLE`
 */
export function assertAdmissible(request) {
  const spec = CLAIMS[request?.claim];
  if (!spec) throw fault("CLAIM_NOT_ADMISSIBLE", String(request?.claim));

  if (request.subjectKind !== spec.subjectKind) {
    throw fault("SUBJECT_KIND_UNEXPECTED", `${request.subjectKind} au lieu de ${spec.subjectKind}`);
  }

  for (const [k, v] of Object.entries(spec.conditions)) {
    if (request.conditions?.[k] !== v) {
      throw fault("CONDITIONS_MISMATCH", `${k} = ${request.conditions?.[k]}, attendu ${v}`);
    }
  }

  for (const field of ["subjectId", "derivedFrom", "extraction", "dispositions",
                       "value", "denominatorUnit"]) {
    if (request[field] === undefined || request[field] === null) throw fault("FIELD_MISSING", field);
  }

  // Une borne de vraisemblance n'est pas un contrôle de sécurité — le recalcul
  // l'est. Elle attrape la classe d'erreur que le recalcul ne peut pas voir :
  // une extraction correctement signée, correctement couverte, correctement
  // recalculée, et portant une unité que personne n'a voulue.
  const bounds = spec.plausible[request.denominatorUnit];
  if (!bounds) throw fault("DENOMINATOR_UNIT_UNKNOWN", String(request.denominatorUnit));

  const { min, max } = bounds;
  if (!(typeof request.value === "number") || !(request.value >= min && request.value <= max)) {
    throw fault("VALUE_IMPLAUSIBLE",
                `${request.value} ${request.denominatorUnit} hors de [${min}, ${max}]`);
  }

  return spec;
}
