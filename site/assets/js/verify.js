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

import T from "@params";
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

function findKey(didDoc, methodId) {
  const methods = didDoc?.verificationMethod ?? [];
  // Exact match first; fall back to the fragment, since a document may be
  // published under a slightly different base identifier.
  return methods.find((m) => m.id === methodId)
      ?? methods.find((m) => m.id?.split("#")[1] === methodId?.split("#")[1])
      ?? null;
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

  if (didDoc?.id && document.issuer && didDoc.id !== document.issuer) {
    return { ok: false, reason: `${T.vIssuerMismatch} ${document.issuer} ≠ ${didDoc.id}`, notes };
  }

  const method = findKey(didDoc, proof.verificationMethod);
  if (!method?.publicKeyJwk) return { ok: false, reason: T.vNoKey, notes };
  if (method.id !== proof.verificationMethod) notes.push(T.vKeyByFragment);

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
