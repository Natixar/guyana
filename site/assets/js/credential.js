// Construction et signature de l'attestation d'origine.
//
// Suite cryptographique : ecdsa-jcs-2019, définie par le W3C
// (VC Data Integrity ECDSA Cryptosuites). Elle canonicalise en JCS (RFC 8785),
// hache en SHA-256 pour P-256, signe en ECDSA. C'est un choix délibéré : la
// signature est vérifiable par n'importe quelle implémentation conforme, ce
// qui est l'argument même du dossier — « sans avoir à nous faire confiance ».
//
// Deux émetteurs, deux bases de confiance : la mine atteste ce qu'elle
// observe (le lingot, sa masse, son titre), le calculateur atteste ce qu'il
// calcule (l'intensité carbone, avec sa méthode). Ce module produit la
// PREMIÈRE attestation, celle de la mine.

import { canonicalBytes } from "./canonical.js";
import { multibase58 } from "./multibase.js";
import { sign } from "./keys.js";

const CONTEXTS = [
  "https://www.w3.org/ns/credentials/v2",
];

/**
 * @param {object} p
 * @param {string} p.issuerDid     ex. "did:web:guygold.com"
 * @param {string} p.subjectId     URN opaque du lingot — jamais l'identifiant interne
 * @param {object} p.claims        faits physiques observés par la mine
 * @param {Date}   [p.now]
 * @param {object} [p.confirmedBy] identité de l'opérateur, si elle est connue
 */
export function buildCredential({ issuerDid, subjectId, claims, confirmedBy = null, now = new Date() }) {
  const cred = {
    "@context": CONTEXTS,
    type: ["VerifiableCredential", "DoreBarOriginCredential"],
    issuer: issuerDid,
    validFrom: now.toISOString(),
    credentialSubject: { id: subjectId, ...claims },
  };
  // L'organisation signe ; l'opérateur est enregistré comme revendication.
  // La confiance dans cette identité repose alors sur le processus d'AGM et sur
  // la journalisation, pas sur la cryptographie — et il faut le dire ainsi.
  // Une clé par opérateur (H3) déplacerait cette garantie vers la signature.
  if (confirmedBy) cred.confirmedBy = confirmedBy;
  return cred;
}

/**
 * L'attestation carbone de Natixar.
 *
 * Elle ne porte QUE des positions dans la taxonomie pivot, jamais une ligne de
 * référentiel. BEGES change régulièrement, et comparer des tendances suppose de
 * recalculer les inventaires passés dans le cadre nouveau — ce qu'une ligne
 * figée dans un document signé interdit à jamais (#61). Le vérificateur dérive
 * la ligne lui-même à partir de la taxonomie publiée, ce qui est une propriété
 * plus forte que de croire la nôtre.
 *
 * LA MATRICE EST SIGNÉE PAR SES ENGAGEMENTS, PAS PAR SES MONTANTS. Décision 1
 * de l'issue #61, tranchée le 1er août : granularité par cellule, et les
 * cellules non divulguées restent là — inutilisables, toujours dénombrables,
 * avec le motif de leur mise à l'écart. C'est ce qui permet à un porteur de
 * remettre sa ligne de transport sans sa ligne de minage **sans invalider la
 * signature** : les montants et leurs sels voyagent à côté du document, en
 * divulgations, et en retirer une ne touche à aucun octet de ce qui est signé.
 * Voir `commitments.js` pour la raison détaillée du placement.
 *
 * `derivedFrom` porte l'empreinte de l'attestation d'origine : sans elle,
 * n'importe qui pourrait émettre un chiffre carbone pour ce sujet.
 *
 * @param {object} p
 * @param {string} p.issuerDid     l'émetteur du chiffre, ici Natixar
 * @param {string} p.subjectId     le même URN opaque que l'attestation d'origine
 * @param {{id: string, digestMultibase: string}} p.derivedFrom
 * @param {{value: number, unit: string}} p.intensity
 * @param {Array<{commitment: string, used: boolean, reason?: string}>} p.commitments
 * @param {{salt: string, commitment: string}} p.totalCommitment
 * @param {object} p.method        conditions, version de taxonomie, allocation
 */
export function buildCarbonCredential({
  issuerDid, subjectId, derivedFrom, intensity, commitments, totalCommitment,
  method, unallocated = 0, now = new Date(),
}) {
  return {
    "@context": CONTEXTS,
    type: ["VerifiableCredential", "CarbonIntensityCredential"],
    issuer: issuerDid,
    validFrom: now.toISOString(),
    credentialSubject: {
      id: subjectId,
      carbonIntensity: intensity,
      // La matrice telle qu'elle se signe : un engagement par cellule, le fait
      // qu'elle ait compté ou non, et le motif quand elle n'a pas compté. Rien
      // d'autre — publier la catégorie en clair d'une cellule retirée dirait ce
      // qui existe sans dire combien, et la structure fuirait toute seule.
      breakdown: commitments,
      // Il lie le chiffre à la matrice : sans lui, divulguer un sous-ensemble
      // et annoncer le total de son choix passerait tous les contrôles.
      totalCommitment: totalCommitment.commitment,
      // Un total complet et faux serait pire qu'un total incomplet et déclaré.
      unallocated,
    },
    derivedFrom,
    method,
  };
}

/**
 * Signe selon ecdsa-jcs-2019.
 *
 * Le hachage porte sur la concaténation de deux condensats — celui de la
 * configuration de preuve et celui du document — conformément à la suite.
 * Le champ proofValue est retiré de la configuration avant canonicalisation :
 * on ne signe pas la signature.
 */
export async function signCredential(credential, pair, verificationMethod) {
  const proofConfig = {
    "@context": credential["@context"],
    type: "DataIntegrityProof",
    cryptosuite: "ecdsa-jcs-2019",
    created: new Date().toISOString(),
    verificationMethod,
    proofPurpose: "assertionMethod",
  };

  const proofDigest = await sha256(canonicalBytes(proofConfig));
  const docDigest = await sha256(canonicalBytes(credential));

  const toSign = new Uint8Array(proofDigest.length + docDigest.length);
  toSign.set(proofDigest, 0);
  toSign.set(docDigest, proofDigest.length);

  const signature = await sign(pair, toSign);

  // @context n'appartient pas à la preuve dans le document final.
  const { "@context": _ctx, ...proof } = proofConfig;
  return { ...credential, proof: { ...proof, proofValue: multibase58(signature) } };
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/**
 * Identifiant de sujet : 128 bits tirés au hasard.
 *
 * Surtout pas d'UUIDv7 ni d'ULID : ces formats sont ordonnés dans le temps,
 * donc ils divulguent l'instant et l'ordre des coulées — la même fuite qu'une
 * numérotation séquentielle, en moins visible. L'identifiant interne de la
 * mine reste une revendication à divulgation contrôlée, jamais l'identifiant.
 */
export function newSubjectId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return "urn:aurora:dore:" + [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
