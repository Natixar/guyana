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

/**
 * L'ensemble admissible en H1. Toute addition ici est une décision produit.
 *
 * RIEN ICI NE CONNAÎT L'OR. Ce service est celui de Natixar, pas celui d'AGM :
 * il signera demain du cuivre, du nickel, du ciment. Une borne de vraisemblance
 * exprimée en tonnes de CO2 par once d'or a vécu ici quelques heures, et c'était
 * deux fautes en une — une couche client dans une couche produit, et un pansement
 * sur un problème d'unité.
 *
 * Ce problème d'unité a maintenant une vraie réponse : tout est en SI. Le moteur
 * produit des kgCO2e et refuse un facteur qui n'y est pas ; le dénominateur
 * déclare son unité SI ; l'intensité en découle. Il ne reste rien à borner, donc
 * on ne borne rien — un seuil qui ne protège de rien finirait par refuser un
 * client légitimement inhabituel.
 */
export const CLAIMS = {
  carbonIntensity: {
    subjectKind: "dore-bar",
    /** Le référentiel et le contexte sous lesquels le chiffre a un sens. */
    conditions: { export: "GHGP", control: "Operational" },
  },
};

/**
 * Les unités de dénominateur admises — SI, et rien d'autre.
 *
 * L'once troy, la tonne courte, le baril : toutes véhiculent un facteur de
 * conversion que quelqu'un finit par appliquer une fois de trop ou pas du tout.
 * Le rendu peut afficher ce qu'il veut ; ce qui est signé est en SI.
 */
const SI_DENOMINATORS = new Set(["kg", "m3", "kWh", "t.km"]);

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
 *   `CONDITIONS_MISMATCH`, `FIELD_MISSING`, `DENOMINATOR_UNIT_NOT_SI`,
 *   `VALUE_NOT_A_NUMBER`
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

  // L'unité du dénominateur est une unité SI de base, pas une unité d'usage.
  // Accepter l'once rouvrirait la porte : un chiffre par once et un chiffre par
  // kilogramme diffèrent d'un facteur trente et un, et rien dans une requête ne
  // dirait lequel a été voulu.
  if (!SI_DENOMINATORS.has(request.denominatorUnit)) {
    throw fault("DENOMINATOR_UNIT_NOT_SI", String(request.denominatorUnit));
  }

  // Une borne de vraisemblance n'est pas un contrôle de sécurité — le recalcul
  // l'est. Elle attrape la classe d'erreur que le recalcul ne peut pas voir :
  // une extraction correctement signée, correctement couverte, correctement
  // recalculée, et portant une unité que personne n'a voulue.
  if (typeof request.value !== "number" || !Number.isFinite(request.value)) {
    throw fault("VALUE_NOT_A_NUMBER", String(request.value));
  }

  return spec;
}
