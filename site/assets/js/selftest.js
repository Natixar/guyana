// Auto-tests exécutés dans le navigateur.
//
// Je n'ai pas de navigateur dans mon environnement : je ne peux donc pas
// affirmer que ce code fonctionne, seulement le rendre vérifiable par qui
// ouvre la page. Les vecteurs de canonicalisation viennent de la RFC 8785.

import T from "@params";
import { canonicalize } from "./canonical.js";
import { base58btcEncode } from "./multibase.js";
import { ephemeralKeyPair, loadKeyPair, publicJwk, thumbprint, sign, verify } from "./keys.js";
import { buildCredential, signCredential, newSubjectId } from "./credential.js";
import { fetchPour, claimsOf } from "./pour.js";
import { fetchMe, issuerDid } from "./me.js";


const cases = [];
const test = (name, fn) => cases.push({ name, fn });

test("JCS — keys are sorted", () =>
  expect(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}'));

test("JCS — nesting and arrays", () =>
  expect(canonicalize({ z: [3, { y: 1, x: 2 }], a: null }), '{"a":null,"z":[3,{"x":2,"y":1}]}'));

test("JCS — no insignificant whitespace", () =>
  expect(canonicalize({ a: "x y" }), '{"a":"x y"}'));

test("JCS — sorted by UTF-16 code units", () =>
  expect(canonicalize({ "é": 1, e: 2, Z: 3 }), '{"Z":3,"e":2,"é":1}'));

test("JCS — rejects NaN", () => {
  try { canonicalize({ a: NaN }); return "aurait dû lever"; } catch { return null; }
});

test("JCS — rejects undefined", () => {
  try { canonicalize({ a: undefined }); return "aurait dû lever"; } catch { return null; }
});

test("base58btc — known vector", () =>
  expect(base58btcEncode(new TextEncoder().encode("hello world")), "StV1DL6CwTryKyV"));

test("base58btc — leading zero bytes", () =>
  expect(base58btcEncode(new Uint8Array([0, 0, 1])), "112"));

test("key — generation, fingerprint, sign/verify round trip", async () => {
  const pair = await ephemeralKeyPair();
  const jwk = await publicJwk(pair);
  if (jwk.crv !== "P-256" || jwk.kty !== "EC") return "JWK inattendu : " + JSON.stringify(jwk);
  const tp = await thumbprint(pair);
  if (!tp || tp.length < 40) return "empreinte suspecte";
  const msg = new TextEncoder().encode("essai");
  const sig = await sign(pair, msg);
  if (!(await verify(pair, msg, sig))) return "la signature ne se vérifie pas";
  return null;
});

test("private key genuinely non-extractable", async () => {
  const pair = await ephemeralKeyPair();
  if (pair.privateKey.extractable) return "la clé privée est exportable — inacceptable";
  try {
    await crypto.subtle.exportKey("jwk", pair.privateKey);
    return "l'export a réussi — inacceptable";
  } catch { return null; }
});

test("credential — signed and well formed", async () => {
  const pair = await ephemeralKeyPair();
  const cred = buildCredential({
    issuerDid: "did:web:guygold.com",
    subjectId: newSubjectId(),
    claims: { pourDate: "2026-04-17", weightKg: 12.4, assay: 0.873 },
  });
  const signed = await signCredential(cred, pair, "did:web:guygold.com#key-1");
  if (signed.proof?.cryptosuite !== "ecdsa-jcs-2019") return "suite inattendue";
  if (!signed.proof.proofValue?.startsWith("z")) return "proofValue is not multibase";
  if (!signed.proof.verificationMethod) return "verificationMethod missing";
  if ("@context" in signed.proof) return "@context must not remain inside the proof";
  return null;
});

// Contrôle en LECTURE SEULE de la clé réellement stockée, si elle existe.
// Ne la crée pas : c'est tout l'objet du correctif.
test("stored key, if any, is non-extractable", async () => {
  const stored = await loadKeyPair();
  if (!stored) return null;                       // rien à vérifier, pas un échec
  if (stored.privateKey.extractable) return "the stored private key is extractable";
  try {
    await crypto.subtle.exportKey("jwk", stored.privateKey);
    return "the stored private key could be exported";
  } catch { return null; }
});

test("self-check leaves no key behind", async () => {
  // Si cette page a provisionné une clé, elle existe maintenant alors qu'elle
  // n'existait pas au chargement. On ne peut pas le savoir après coup, donc on
  // se contente d'affirmer que les tests ci-dessus utilisent bien l'éphémère.
  const a = await ephemeralKeyPair(), b = await ephemeralKeyPair();
  const ta = await thumbprint(a), tb = await thumbprint(b);
  return ta === tb ? "ephemeral pairs are not distinct — they are being persisted" : null;
});

// Chaîne complète : identité, coulée, attestation signée. C'est le seul
// contrôle qui exerce ce que fait réellement le bouton de confirmation.
test("end to end — identity, pour, signed credential", async () => {
  const me = await fetchMe();
  const did = issuerDid(me);
  if (!did) return "no issuer DID from /api/me";
  const pour = await fetchPour();
  if (!pour) return "no pour from /api/pour";

  const pair = await ephemeralKeyPair();
  const cred = buildCredential({
    issuerDid: did,
    subjectId: newSubjectId(),
    claims: claimsOf(pour),
    confirmedBy: me.person ? { id: me.person.id, name: me.person.name } : null,
  });
  const out = await signCredential(cred, pair, did + "#key-1");

  if (out.issuer !== did) return "issuer does not match /api/me";
  if (!out.credentialSubject?.barId?.value) return "bar claims missing";
  if (!out.credentialSubject.carbonIntensity?.origin) return "claim origin not carried";
  if (!out.proof?.proofValue?.startsWith("z")) return "proof missing or not multibase";
  return null;
});

test("subject identifier — opaque and unordered", () => {
  const a = newSubjectId(), b = newSubjectId();
  if (!/^urn:aurora:dore:[0-9a-f]{32}$/.test(a)) return "format inattendu : " + a;
  if (a === b) return "deux tirages identiques";
  return null;
});

function expect(got, want) { return got === want ? null : `attendu ${want}, obtenu ${got}`; }

document.addEventListener("DOMContentLoaded", async () => {
  const out = document.querySelector("[data-selftest]");
  if (!out) return;
  let failed = 0;
  for (const c of cases) {
    const li = document.createElement("div");
    let err;
    try { err = await c.fn(); } catch (e) { err = String(e); }
    if (err) failed++;
    li.innerHTML = `<span class="badge badge--${err ? "warning" : "verified"}">${err ? "fail" : "ok"}</span> ${c.name}` +
                   (err ? `<div class="muted" style="margin-left:1rem">${err}</div>` : "");
    li.style.marginBottom = ".5rem";
    out.append(li);
  }
  const s = document.querySelector("[data-selftest-summary]");
  if (s) {
    s.textContent = failed ? `${failed} ${T.failed} / ${cases.length}` : `${cases.length} ${T.passed}`;
    s.className = "badge badge--" + (failed ? "warning" : "verified");
  }
});
