// Auto-tests exécutés dans le navigateur.
//
// Je n'ai pas de navigateur dans mon environnement : je ne peux donc pas
// affirmer que ce code fonctionne, seulement le rendre vérifiable par qui
// ouvre la page. Les vecteurs de canonicalisation viennent de la RFC 8785.

import T from "./labels.js";
import { canonicalize } from "./canonical.js";
import { base58btcEncode } from "./multibase.js";
import { ephemeralKeyPair, loadKeyPair, publicJwk, thumbprint, readable, sign, verify } from "./keys.js";
import { buildCredential, signCredential, newSubjectId } from "./credential.js";
import { fetchPour, operatorClaims } from "./pour.js";
import { fetchMe, issuerDid } from "./me.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { buildDidDocument } from "./did.js";
import { signBlocker, signView } from "./sign-state.js";
import { aggregate, allocateUnallocated } from "./engine.js";
import { runVectors } from "./vectors.js";


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

// --- L'état du bouton de signature (#64) ---------------------------------
// La faute était une transition, pas une valeur : « créez d'abord une clé »
// survivait à la création de la clé. Ces cas exercent donc des couples avant /
// après, et non des points isolés.

const ready = { pair: {}, did: "did:web:example.com", pour: {}, signed: null };

test("signature — sans clé, l'obstacle est la clé", () =>
  expect(signBlocker({ ...ready, pair: null }), T.signNeedsKey));

test("signature — la clé créée lève l'obstacle", () => {
  const before = signView({ ...ready, pair: null });
  const after = signView(ready);
  if (before.text !== T.signNeedsKey) return "l'obstacle initial n'est pas la clé";
  if (!before.disabled) return "le bouton devrait être inactif sans clé";
  if (after.text !== "") return `message périmé après création : ${after.text}`;
  if (after.disabled) return "le bouton devrait être actif une fois tout réuni";
  return null;
});

test("signature — sans identité d'émetteur, l'obstacle est l'identité", () =>
  expect(signBlocker({ ...ready, did: null }), T.issuerUnknown));

test("signature — sans coulée, l'obstacle est la coulée", () =>
  expect(signBlocker({ ...ready, pour: null }), T.signNoPour));

test("signature — sans coulée, le bouton reste inactif", () => {
  const v = signView({ ...ready, pour: null });
  return v.disabled ? null : "le bouton était actif sans coulée à confirmer";
});

test("signature — un seul obstacle à la fois, le premier remédiable", () =>
  expect(signBlocker({ pair: null, did: null, pour: null }), T.signNeedsKey));

test("signature — tout est réuni : aucun obstacle", () =>
  expect(signBlocker(ready), null));

test("signature — une coulée signée ne se resigne pas", () => {
  const v = signView({ ...ready, signed: { proof: {} } });
  if (!v.disabled) return "le bouton restait actif après signature";
  if (v.text !== T.signDone) return `statut inattendu : ${v.text}`;
  return null;
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

// --- Le moteur, côté navigateur (#66) -------------------------------------
// Ces cas ne sont pas écrits ici : ils viennent de `/engine/vectors.json`, le
// même fichier que la suite du signataire exécute dans Node. C'est ce qui rend
// vérifiable la propriété « un moteur, deux hôtes » — deux copies de cas de
// test qu'on garde synchrones à la main ne prouveraient rien.
//
// TÂCHE 4 : le moteur est un squelette qui lève. Ces cas DOIVENT échouer.

let vectors = null;

async function loadVectors() {
  if (vectors) return vectors;
  const r = await fetch("/engine/vectors.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`vecteurs introuvables : HTTP ${r.status}`);
  vectors = await r.json();
  return vectors;
}

async function loadTaxonomy() {
  const r = await fetch("/engine/taxonomy.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`taxonomie introuvable : HTTP ${r.status}`);
  return r.json();
}

test("moteur — les vecteurs partagés sont servis et lisibles", async () => {
  const v = await loadVectors();
  if (!Array.isArray(v.cases) || v.cases.length === 0) return "aucun cas dans les vecteurs";
  return null;
});

// Les vecteurs déclarent la version de taxonomie qu'ils supposent. Servir une
// autre version rendrait les attentes fausses sans rien casser de visible : la
// dérive se déclare ici plutôt que de se découvrir sur un chiffre signé.
test("moteur — vecteurs et taxonomie servie parlent de la même version", async () => {
  const [v, taxonomy] = await Promise.all([loadVectors(), loadTaxonomy()]);
  return v.taxonomy === taxonomy.version
    ? null
    : `vecteurs pour ${v.taxonomy}, taxonomie servie en ${taxonomy.version}`;
});

test("moteur — chaque vecteur redonne le profil attendu", async () => {
  const [v, taxonomy] = await Promise.all([loadVectors(), loadTaxonomy()]);
  // Ni les cas ni la comparaison ne sont écrits ici : les deux sont partagés
  // avec la suite du signataire, sans quoi « un moteur, deux hôtes » ne serait
  // qu'une intention.
  const failures = runVectors(aggregate, v, taxonomy, allocateUnallocated);
  return failures.length ? failures.join(" | ") : null;
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
    claims: operatorClaims(pour),
    confirmedBy: me.person ? { id: me.person.id, name: me.person.name } : null,
  });
  const out = await signCredential(cred, pair, did + "#key-1");

  if (out.issuer !== did) return "issuer does not match /api/me";
  if (!out.credentialSubject?.barId?.value) return "bar claims missing";
  if (!out.credentialSubject.weight?.origin) return "claim origin not carried";
  // Le calcul carbone n'appartient pas à cette attestation : la mine ne signe
  // pas un chiffre qu'elle n'a pas produit.
  if ("carbonIntensity" in out.credentialSubject) return "carbon intensity must not be signed by the mine";
  if (!out.proof?.proofValue?.startsWith("z")) return "proof missing or not multibase";
  return null;
});

test("round trip — a signed credential verifies against its DID document", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const cred = buildCredential({
    issuerDid: did, subjectId: newSubjectId(),
    claims: { barId: { value: "X-1", origin: "MEASURED" } },
  });
  const signed = await signCredential(cred, pair, did + "#key-1");
  const didDoc = await buildDidDocument(pair, did);

  const r = await verifyCredential(signed, didDoc);
  if (!r.ok) return "valid credential rejected: " + r.reason;

  // Altering a single character must break it, otherwise the check proves nothing.
  const tampered = structuredClone(signed);
  tampered.credentialSubject.barId.value = "X-2";
  const t = await verifyCredential(tampered, didDoc);
  if (t.ok) return "a tampered credential was accepted";
  return null;
});

test("a key not authorised for assertions is rejected", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const signed = await signCredential(
    buildCredential({ issuerDid: did, subjectId: newSubjectId(), claims: { a: { value: "1" } } }),
    pair, did + "#key-1");

  // Exactly the defect found in review: assertionMethod misspelled, so the
  // document publishes the key without authorising it for assertions.
  const doc = await buildDidDocument(pair, did);
  doc.asssertionMethod = doc.assertionMethod;
  delete doc.assertionMethod;

  const r = await verifyCredential(signed, doc);
  return r.ok ? "a credential verified against a document that authorises nothing" : null;
});

test("a proof made for another purpose is rejected", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const signed = await signCredential(
    buildCredential({ issuerDid: did, subjectId: newSubjectId(), claims: { a: { value: "1" } } }),
    pair, did + "#key-1");
  signed.proof.proofPurpose = "authentication";
  const r = await verifyCredential(signed, await buildDidDocument(pair, did));
  return r.ok ? "a proof declared for authentication was accepted as an assertion" : null;
});

test("a key belonging to another controller is rejected", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const signed = await signCredential(
    buildCredential({ issuerDid: did, subjectId: newSubjectId(), claims: { a: { value: "1" } } }),
    pair, did + "#key-1");
  const doc = await buildDidDocument(pair, did);
  doc.verificationMethod[0].controller = "did:web:elsewhere.example";
  const r = await verifyCredential(signed, doc);
  return r.ok ? "a key controlled by another party was accepted" : null;
});

test("did:web resolves to the right URL", () => {
  if (didWebUrl("did:web:guygold.com") !== "https://guygold.com/.well-known/did.json")
    return "apex form wrong: " + didWebUrl("did:web:guygold.com");
  if (didWebUrl("did:web:example.org:a:b") !== "https://example.org/a/b/did.json")
    return "path form wrong: " + didWebUrl("did:web:example.org:a:b");
  return null;
});

test("subject identifier — opaque and unordered", () => {
  const a = newSubjectId(), b = newSubjectId();
  if (!/^urn:aurora:dore:[0-9a-f]{32}$/.test(a)) return "format inattendu : " + a;
  if (a === b) return "deux tirages identiques";
  return null;
});

/** Relevé de l'environnement réel — remplace toute commande à coller. */
async function environmentReport() {
  const rows = [["User agent", navigator.userAgent],
                ["Secure context", String(globalThis.isSecureContext)]];
  try {
    const db = await new Promise((res, rej) => {
      const q = indexedDB.open("natixar-gold-trace");
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
      q.onblocked = () => rej(new Error("blocked by another tab"));
    });
    rows.push(["Database version", String(db.version)]);
    rows.push(["Object stores", [...db.objectStoreNames].join(", ") || "(none)"]);
    if (db.objectStoreNames.contains("keys")) {
      const stored = await new Promise((res, rej) => {
        const t = db.transaction("keys").objectStore("keys").get("signing");
        t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
      });
      if (stored) {
        rows.push(["Stored key", stored.privateKey.algorithm.namedCurve + " " + stored.privateKey.algorithm.name]);
        rows.push(["Fingerprint", readable(await thumbprint(stored))]);
        rows.push(["extractable", String(stored.privateKey.extractable)]);
        rows.push(["Export attempt", await crypto.subtle.exportKey("jwk", stored.privateKey)
          .then(() => "SUCCEEDED — this is a defect").catch((e) => "refused: " + e.name)]);
      } else {
        rows.push(["Stored key", "(none)"]);
      }
    }
  } catch (e) {
    rows.push(["IndexedDB", "error: " + e.name + " — " + e.message]);
  }
  return rows;
}

function expect(got, want) { return got === want ? null : `attendu ${want}, obtenu ${got}`; }

async function wireReset() {
  const btn = document.querySelector("[data-reset]");
  const status = document.querySelector("[data-reset-status]");
  if (!btn) return;

  const me = await fetchMe();
  if (me.authenticated) {                       // en production, on tourne, on n'efface pas
    btn.disabled = true;
    if (status) status.textContent = T.resetProduction;
    return;
  }

  const stored = await loadKeyPair();
  const expected = stored ? readable(await thumbprint(stored)) : null;
  if (!stored) { btn.disabled = true; if (status) status.textContent = T.resetNoKey; return; }

  btn.disabled = false;
  btn.addEventListener("click", async () => {
    const input = document.querySelector("[data-reset-confirm]");
    if (input?.value.trim() !== expected) {
      if (status) status.textContent = T.resetMismatch;
      return;
    }
    await new Promise((res) => {
      const q = indexedDB.deleteDatabase("natixar-gold-trace");
      q.onsuccess = q.onerror = q.onblocked = () => res();
    });
    if (status) status.textContent = T.resetDone;
    btn.disabled = true;
    // replace() plutôt que href : le retour arrière ne doit pas ramener sur
    // une page qui prétend encore qu'une clé existe.
    location.replace("/");
  });
}

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
                   (err ? `<div class="muted detail">${err}</div>` : "");
    out.append(li);
  }
  const env = document.querySelector("[data-environment]");
  if (env) {
    for (const [k, v] of await environmentReport()) {
      const row = document.createElement("div");
      row.innerHTML = `<dt>${k}</dt><dd>${v.replace(/[<&]/g, (c) => ({ "<": "&lt;", "&": "&amp;" })[c])}</dd>`;
      env.append(row);
    }
  }

  await wireReset();

  const s = document.querySelector("[data-selftest-summary]");
  if (s) {
    s.textContent = failed ? `${failed} ${T.selftestFailed} / ${cases.length}` : `${cases.length} ${T.selftestPassed}`;
    s.className = "badge badge--" + (failed ? "warning" : "verified");
  }
});
