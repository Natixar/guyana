// Verification of an origin credential.
//
// The point of this page is what it does NOT need: no account, no API call to
// us, no network at all once the two files are in hand. Verification is a
// local computation against the issuer's published key. That is the whole
// argument of the project, and this is the only page that demonstrates it
// rather than asserting it.
//
// What it proves: the credential comes from the declared issuer and has not
// been altered since signing. What it does not prove: that the figures are
// true. That is audit, not cryptography — and the page says so.

import T from "./labels.js";
import { canonicalBytes } from "./canonical.js";
import { multibase58Decode } from "./multibase.js";

/** did:web:example.com:a:b  ->  https://example.com/a/b/did.json */
export function didWebUrl(did) {
  if (!did?.startsWith("did:web:")) return null;
  const parts = did.slice("did:web:".length).split(":").map(decodeURIComponent);
  const host = parts.shift();
  return parts.length
    ? `https://${host}/${parts.join("/")}/did.json`
    : `https://${host}/.well-known/did.json`;
}

/**
 * Exact match only.
 *
 * An earlier version fell back to matching on the fragment when the full
 * identifier differed. That was helpfulness in the wrong direction: the
 * identifier is what binds a key to a controller, and accepting a near-match
 * means accepting a key the document did not name.
 */
function findKey(didDoc, methodId) {
  return (didDoc?.verificationMethod ?? []).find((m) => m.id === methodId) ?? null;
}

/**
 * Is this method authorised to make assertions?
 *
 * verificationMethod publishes key material; the verification relationships —
 * assertionMethod, authentication, keyAgreement — say what each key may be used
 * for. A credential is an assertion, so its key must appear in assertionMethod.
 *
 * Skipping this check means a key published for authentication only could be
 * used to forge credentials. It also means a document whose assertionMethod is
 * missing — or misspelled — verifies anyway, which is how this was found.
 *
 * Entries may be identifier strings or embedded methods; both forms are valid.
 */
function isAssertionMethod(didDoc, methodId) {
  const rel = didDoc?.assertionMethod;
  if (!Array.isArray(rel)) return false;
  return rel.some((e) => (typeof e === "string" ? e : e?.id) === methodId);
}

export async function verifyCredential(credential, didDoc) {
  const notes = [];
  const { proof, ...document } = credential ?? {};
  if (!proof) return { ok: false, reason: T.vNoProof, notes };

  const { proofValue, ...proofConfig } = proof;
  if (!proofValue) return { ok: false, reason: T.vNoProofValue, notes };
  if (proof.cryptosuite !== "ecdsa-jcs-2019") {
    return { ok: false, reason: `${T.vSuite} ${proof.cryptosuite ?? "—"}`, notes };
  }

  // A credential is an assertion. Any other purpose is out of scope here, and
  // silently accepting one would defeat the point of declaring purposes.
  if (proof.proofPurpose !== "assertionMethod") {
    return { ok: false, reason: `${T.vPurpose} ${proof.proofPurpose ?? "—"}`, notes };
  }

  if (didDoc?.id && document.issuer && didDoc.id !== document.issuer) {
    return { ok: false, reason: `${T.vIssuerMismatch} ${document.issuer} ≠ ${didDoc.id}`, notes };
  }

  const method = findKey(didDoc, proof.verificationMethod);
  if (!method?.publicKeyJwk) {
    return { ok: false, reason: `${T.vNoKey} ${proof.verificationMethod ?? "—"}`, notes };
  }

  // The document must authorise this key for assertions, not merely publish it.
  if (!isAssertionMethod(didDoc, method.id)) {
    return { ok: false, reason: `${T.vNotAuthorised} ${method.id}`, notes };
  }

  // The key must be controlled by the document that publishes it.
  if (method.controller && didDoc?.id && method.controller !== didDoc.id) {
    return { ok: false, reason: `${T.vBadController} ${method.controller} ≠ ${didDoc.id}`, notes };
  }

  let key;
  try {
    key = await crypto.subtle.importKey(
      "jwk", method.publicKeyJwk,
      { name: "ECDSA", namedCurve: method.publicKeyJwk.crv ?? "P-256" },
      false, ["verify"]);
  } catch (e) {
    return { ok: false, reason: `${T.vBadKey} ${e.name}`, notes };
  }

  // Reconstruct exactly what was signed: the proof configuration carries the
  // credential's @context and omits proofValue — one does not sign a signature.
  proofConfig["@context"] = document["@context"];
  const proofDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", canonicalBytes(proofConfig)));
  const docDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", canonicalBytes(document)));
  const signed = new Uint8Array(proofDigest.length + docDigest.length);
  signed.set(proofDigest, 0);
  signed.set(docDigest, proofDigest.length);

  let signature;
  try { signature = multibase58Decode(proofValue); }
  catch (e) { return { ok: false, reason: `${T.vBadSignature} ${e.message}`, notes }; }

  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, signed);
  return { ok, reason: ok ? null : T.vMismatch, notes, document, proof };
}
