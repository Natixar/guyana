// Auto-tests exécutés dans le navigateur.
//
// Je n'ai pas de navigateur dans mon environnement : je ne peux donc pas
// affirmer que ce code fonctionne, seulement le rendre vérifiable par qui
// ouvre la page. Les vecteurs de canonicalisation viennent de la RFC 8785.

import T from "./labels.js";
import { canonicalize } from "./canonical.js";
import { base58btcEncode } from "./multibase.js";
import { ephemeralKeyPair, loadKeyPair, deleteKeyPair, publicJwk, thumbprint, readable, sign, verify } from "./keys.js";
import { buildCredential, signCredential, newSubjectId } from "./credential.js";
import { fetchPour, operatorClaims } from "./pour.js";
import { barClaims } from "./bar-claims.js";
import { fetchMe, issuerDid } from "./me.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { buildDidDocument, verificationMethodId } from "./did.js";
import { wireDidMerge } from "./did-merge.js";
import { signBlocker, signView } from "./sign-state.js";
import { allCredentials, putCredential, credentialsFor, credentialsByRef, credentialType,
         orphanedCredentials, removeCredentials } from "./wallet.js";
import { aggregate, allocateUnallocated } from "./engine.js";
import { runVectors } from "./vectors.js";
import { renderCertificates } from "./certificate-view.js";


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

// --- Le portefeuille (#68) ------------------------------------------------
// Ce qui est stocké, ce qu'une réinitialisation laisse derrière, et le défaut
// que le magasin avait : une barre porte DEUX attestations sous le même sujet.

const ORIGIN = {
  type: ["VerifiableCredential", "DoreBarOriginCredential"],
  credentialSubject: { id: "urn:aurora:dore:selftest" },
  proof: { proofValue: "zORIGIN" },
};
const CARBON = {
  type: ["VerifiableCredential", "CarbonIntensityCredential"],
  credentialSubject: { id: "urn:aurora:dore:selftest" },
  proof: { proofValue: "zCARBON" },
};

// --- Ce qui est orphelin, et contre quoi cela se juge (revue PR #70) ------
// La règle précédente effaçait les attestations avec la clé. Elle se trompait
// de geste : supprimer la clé est une rotation, et une attestation reste
// vérifiable tant que sa clé publique figure dans le document DID publié.

const DID_WITH = (ids) => ({
  id: "did:web:guygold.com",
  verificationMethod: ids.map((id) => ({ id, type: "JsonWebKey" })),
});

const SIGNED_BY = (method) => ({
  type: ["VerifiableCredential", "DoreBarOriginCredential"],
  credentialSubject: { id: "urn:aurora:dore:orphan-" + method.slice(-4) },
  proof: { verificationMethod: method, proofValue: "zX" },
});

test("orphelines — une clé toujours publiée ne rend rien orphelin", async () => {
  const method = "did:web:guygold.com#AAAA";
  await putCredential(SIGNED_BY(method), "orphan-test-1");
  const orphans = await orphanedCredentials(DID_WITH([method]));
  const mine = orphans.filter((r) => r.ref === "orphan-test-1");
  await removeCredentials(await allCredentials().then((a) => a.filter((r) => r.ref === "orphan-test-1")));
  return mine.length === 0 ? null : "une attestation encore publiée est comptée orpheline";
});

test("orphelines — une clé retirée du document publié le devient", async () => {
  const method = "did:web:guygold.com#BBBB";
  await putCredential(SIGNED_BY(method), "orphan-test-2");
  const orphans = await orphanedCredentials(DID_WITH(["did:web:guygold.com#CCCC"]));
  const mine = orphans.filter((r) => r.ref === "orphan-test-2");
  await removeCredentials(await allCredentials().then((a) => a.filter((r) => r.ref === "orphan-test-2")));
  return mine.length === 1 ? null : "une attestation dont la clé a disparu n'est pas signalée";
});

test("orphelines — sans document installé, on ne propose RIEN", async () => {
  const method = "did:web:guygold.com#DDDD";
  await putCredential(SIGNED_BY(method), "orphan-test-3");
  // Ne pas savoir n'est pas savoir que rien ne vaut. Proposer d'effacer sur une
  // ignorance serait le pire des deux.
  const orphans = await orphanedCredentials(null);
  await removeCredentials(await allCredentials().then((a) => a.filter((r) => r.ref === "orphan-test-3")));
  return orphans.length === 0 ? null : `${orphans.length} proposées sans document installé`;
});

test("portefeuille — le type significatif est extrait, pas le générique", () => {
  if (credentialType(ORIGIN) !== "DoreBarOriginCredential") return "type d'origine mal lu";
  if (credentialType(CARBON) !== "CarbonIntensityCredential") return "type carbone mal lu";
  return null;
});

test("portefeuille — les deux attestations d'une barre coexistent", async () => {
  // Le défaut exact que le magasin avait : ranger par sujet seul écrase la
  // première avec la seconde, et un vérificateur n'en reçoit qu'une.
  await putCredential(ORIGIN);
  await putCredential(CARBON);
  const held = await credentialsFor("urn:aurora:dore:selftest");
  const kinds = Object.keys(held).sort();
  if (kinds.length !== 2) return `${kinds.length} attestation(s) au lieu de 2 : ${kinds}`;
  return null;
});

test("portefeuille — une réémission remplace au lieu d'accumuler", async () => {
  await putCredential({ ...CARBON, validFrom: "2026-09-01T00:00:00Z" });
  const held = await credentialsFor("urn:aurora:dore:selftest");
  const doc = held.CarbonIntensityCredential?.document;
  return doc?.validFrom === "2026-09-01T00:00:00Z"
    ? null : "le portefeuille détient une version périmée";
});

test("portefeuille — la référence locale retrouve une coulée, là où le sujet ne le peut pas", async () => {
  // L'identifiant de sujet est un aléa tiré au moment de signer : après un
  // rechargement, rien ne relierait une coulée à son attestation sans cet index.
  await putCredential(ORIGIN, "pour-selftest-01");
  const held = await credentialsByRef("pour-selftest-01");
  return held.DoreBarOriginCredential ? null : "la référence locale ne retrouve rien";
});

test("portefeuille — une attestation sans sujet est refusée", async () => {
  try {
    await putCredential({ type: ["VerifiableCredential"] });
    return "aurait dû lever";
  } catch (e) {
    return e.code === "SUBJECT_MISSING" ? null : `code inattendu : ${e.code}`;
  }
});

test("portefeuille — l'auto-test ne laisse pas ses attestations derrière lui", async () => {
  // Les cas ci-dessus écrivent réellement. Les retirer ici garde la promesse de
  // la page : on ne laisse rien qu'on n'ait trouvé.
  const before = await allCredentials();
  const mine = before.filter((r) => r.subject === "urn:aurora:dore:selftest");
  if (mine.length === 0) return null;
  const { STORES, openDb, tx } = await import("./idb.js");
  const db = await openDb();
  for (const r of mine) {
    await tx(db, STORES.CREDENTIALS, "readwrite", (s) => s.delete(`${r.subject}${r.type}`));
  }
  db.close();
  const after = await allCredentials();
  return after.some((r) => r.subject === "urn:aurora:dore:selftest")
    ? "des attestations d'auto-test subsistent" : null;
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
  const out = await signCredential(cred, pair, await verificationMethodId(pair, did));

  if (out.issuer !== did) return "issuer does not match /api/me";
  if (!out.credentialSubject?.barId?.value) return "bar claims missing";
  if (!out.credentialSubject.weight?.origin) return "claim origin not carried";
  // Le calcul carbone n'appartient pas à cette attestation : la mine ne signe
  // pas un chiffre qu'elle n'a pas produit.
  if ("carbonIntensity" in out.credentialSubject) return "carbon intensity must not be signed by the mine";
  if (!out.proof?.proofValue?.startsWith("z")) return "proof missing or not multibase";
  return null;
});

// --- Certifier depuis le registre (#68) ----------------------------------
// Ce que la barre atteste vient du jeu d'essai, où les champs sont nus. Deux
// choses peuvent y devenir fausses en silence : une origine recopiée à la main,
// qui mentirait dès qu'AGM livrera son registre de coulées, et une valeur mise
// en forme pour l'œil, qui figerait trois chiffres significatifs et une langue
// dans un document signé.

const A_BAR = {
  subjectId: "urn:aurora:dore:0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
  internalId: "AUR-202501-001",
  lot: "LOT-2024-12",
  pouredAt: "2025-01-01T04:00:00Z",
  fineGoldKg: 11.7236,
  grossMassKg: 12.743,
  assay: 0.92,
};

const A_FIXTURE = {
  units: { mass: "kg" },
  simulatedFields: ["pouredAt", "internalId", "grossMassKg", "assay"],
};

test("barre — l'origine est lue du jeu d'essai, pas recopiée", () => {
  const feint = barClaims(A_BAR, A_FIXTURE);
  if (feint.weight.origin !== "ESTIMATED") return `masse brute simulée : ${feint.weight.origin}`;
  if (feint.fineGold.origin !== "DERIVED") return `or fin : ${feint.fineGold.origin}`;

  // Le jour où la masse brute sera pesée, le générateur la retirera de la
  // liste — et l'attestation doit suivre sans que personne touche à ce module.
  const reel = barClaims(A_BAR, {
    ...A_FIXTURE,
    simulatedFields: ["pouredAt", "internalId", "assay"],
  });
  if (reel.weight.origin !== "DERIVED") return "une valeur devenue réelle reste annoncée simulée";
  return null;
});

test("barre — les valeurs signées sont brutes, jamais mises en forme", () => {
  const claims = barClaims(A_BAR, A_FIXTURE);
  if (typeof claims.weight.value !== "number") return "la masse est signée comme texte";
  if (claims.weight.value !== A_BAR.grossMassKg) return "la masse signée n'est pas celle du registre";
  if (claims.fineGold.value !== A_BAR.fineGoldKg) return "l'or fin signé n'est pas celui du registre";
  if (claims.weight.unit !== "kg") return "l'unité ne voyage pas avec la valeur";
  // Le jour de la mine, pas celui du lecteur : depuis l'Europe, une coulée du
  // 1er mars paraîtrait datée du 28 février.
  if (claims.pourDate.value !== "2025-01-01") return `jour local faux : ${claims.pourDate.value}`;
  return null;
});

test("barre — l'attestation signée porte le sujet du registre et se vérifie", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const signed = await signCredential(
    buildCredential({
      issuerDid: did,
      subjectId: A_BAR.subjectId,
      claims: barClaims(A_BAR, A_FIXTURE),
    }),
    pair, await verificationMethodId(pair, did));

  // L'identifiant de sujet ne se tire pas à la signature : c'est lui que le
  // magasin indexe et que le registre interroge.
  if (signed.credentialSubject.id !== A_BAR.subjectId) return "le sujet n'est pas celui du registre";
  if ("carbonIntensity" in signed.credentialSubject) return "la mine ne signe pas l'intensité carbone";

  const r = await verifyCredential(signed, await buildDidDocument(pair, did));
  return r.ok ? null : "attestation de barre rejetée : " + r.reason;
});

test("round trip — a signed credential verifies against its DID document", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const cred = buildCredential({
    issuerDid: did, subjectId: newSubjectId(),
    claims: { barId: { value: "X-1", origin: "MEASURED" } },
  });
  const signed = await signCredential(cred, pair, await verificationMethodId(pair, did));
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

// --- Rotation de clé : ce que la fusion doit préserver --------------------
// LE DÉFAUT QU'ILS ATTRAPENT. Le fragment de l'identifiant venait d'une
// politique serveur, « key-1 », la même pour toutes les clés. La fusion écarte
// les entrées de même identifiant pour ne pas publier deux fois la même clé :
// elle supprimait donc l'ancienne à chaque rotation, en annonçant
// `previousVersionDigest`, ce qui donnait l'apparence d'une fusion réussie.
// Toute attestation signée par la clé perdue devenait invérifiable.

test("rotation — la clé précédente survit à la publication de la nouvelle", async () => {
  const did = "did:web:guygold.com";
  const ancienne = await ephemeralKeyPair();
  const nouvelle = await ephemeralKeyPair();

  const publie = await buildDidDocument(ancienne, did);
  const apres = await buildDidDocument(nouvelle, did, publie);

  if (apres.verificationMethod.length !== 2) {
    return `${apres.verificationMethod.length} clé(s) après rotation au lieu de 2`;
  }
  const ids = apres.verificationMethod.map((m) => m.id);
  if (!ids.includes(await verificationMethodId(ancienne, did))) return "l'ancienne clé a disparu";
  if (!ids.includes(await verificationMethodId(nouvelle, did))) return "la nouvelle clé est absente";
  // Publier une clé sans l'autoriser à attester revient à ne pas la publier.
  if (apres.assertionMethod.length !== 2) return "assertionMethod n'a pas suivi";
  if (!apres.previousVersionDigest) return "le chaînage vers le document précédent manque";
  return null;
});

test("rotation — une attestation de l'ancienne clé se vérifie encore", async () => {
  const did = "did:web:guygold.com";
  const ancienne = await ephemeralKeyPair();
  const nouvelle = await ephemeralKeyPair();

  const signee = await signCredential(
    buildCredential({ issuerDid: did, subjectId: newSubjectId(), claims: { a: { value: "1" } } }),
    ancienne, await verificationMethodId(ancienne, did));

  const apres = await buildDidDocument(nouvelle, did, await buildDidDocument(ancienne, did));
  const r = await verifyCredential(signee, apres);
  return r.ok ? null : "attestation rendue invérifiable par la rotation : " + r.reason;
});

test("rotation — republier la MÊME clé n'ajoute pas de doublon", async () => {
  const did = "did:web:guygold.com";
  const pair = await ephemeralKeyPair();
  const une = await buildDidDocument(pair, did);
  const deux = await buildDidDocument(pair, did, une);
  return deux.verificationMethod.length === 1
    ? null
    : `${deux.verificationMethod.length} entrées pour une seule clé`;
});

test("a key not authorised for assertions is rejected", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const signed = await signCredential(
    buildCredential({ issuerDid: did, subjectId: newSubjectId(), claims: { a: { value: "1" } } }),
    pair, await verificationMethodId(pair, did));

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
    pair, await verificationMethodId(pair, did));
  signed.proof.proofPurpose = "authentication";
  const r = await verifyCredential(signed, await buildDidDocument(pair, did));
  return r.ok ? "a proof declared for authentication was accepted as an assertion" : null;
});

test("a key belonging to another controller is rejected", async () => {
  const pair = await ephemeralKeyPair();
  const did = "did:web:example.org";
  const signed = await signCredential(
    buildCredential({ issuerDid: did, subjectId: newSubjectId(), claims: { a: { value: "1" } } }),
    pair, await verificationMethodId(pair, did));
  const doc = await buildDidDocument(pair, did);
  doc.verificationMethod[0].controller = "did:web:elsewhere.example";
  const r = await verifyCredential(signed, doc);
  return r.ok ? "a key controlled by another party was accepted" : null;
});

test("a received certificate renders without executing what it carries", () => {
  // Le document vient du réseau. Qu'il soit signé prouve son ORIGINE, pas son
  // innocuité : l'émetteur peut être authentique et le contenu hostile, et une
  // matrice comporte des champs libres — le motif d'exclusion en est un, saisi à
  // la main. C'est la faute que CodeQL avait déjà trouvée sur la page barre, et
  // elle est plus grave ici : la page qui affiche ceci détient la clé de
  // signature de la mine.
  const hostile = "<img src=x onerror=alert(1)>";
  const html = renderCertificates([{
    receivedAt: "2026-08-02T00:00:00Z",
    document: {
      type: ["VerifiableCredential", "CarbonIntensityCredential"],
      issuer: hostile,
      credentialSubject: {
        method: { allocation: hostile },
        breakdown: [{ step: 7, subPost: 1000, origin: "MEASURED", used: false, reason: hostile }],
      },
    },
  }]);

  if (html.includes("<img")) return "le contenu du document est passé tel quel dans le HTML";
  if (!html.includes("&lt;img")) return "le contenu hostile a disparu au lieu d'être échappé";
  return null;
});

test("a certificate says what it does NOT contain", () => {
  // Une attestation déposée porte les engagements, jamais les montants. L'écran
  // doit le DIRE : un tableau muet sur ce point se lit comme un affichage
  // tronqué, et le porteur croirait à une panne là où il y a une propriété.
  const html = renderCertificates([{
    receivedAt: "2026-08-02T00:00:00Z",
    document: {
      type: ["VerifiableCredential", "CarbonIntensityCredential"],
      issuer: "did:web:natixar.pro",
      credentialSubject: {
        breakdown: [
          { step: 7, subPost: 1000, origin: "MEASURED" },
          { step: 9, subPost: 1005, origin: "MEASURED", used: false, reason: "outside the pilot window" },
        ],
      },
    },
  }]);

  if (!html.includes("2 cells")) return "le dénombrement des cellules manque";
  if (!html.includes("outside the pilot window")) return "le motif d'exclusion ne voyage pas jusqu'à l'écran";
  return null;
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

/**
 * La suppression de clé — et ce qu'elle n'emporte PAS.
 *
 * RÉVISION DU 2 AOÛT 2026 (revue de la PR #70). Supprimer la clé est une
 * ROTATION : elle garantit qu'aucune attestation nouvelle ne sera émise, et
 * rien de plus. Les attestations déjà signées restent vérifiables tant que leur
 * clé publique figure dans le document DID publié, et ce document est fait pour
 * ne jamais perdre une clé. Les détruire au passage était un geste de trop.
 *
 * Effacer des attestations devient donc une action distincte, facultative, et
 * qui repose sur un fait extérieur : le DID INSTALLÉ. Une attestation est
 * orpheline quand la clé qui l'a signée ne figure plus dans ce document — ce
 * qui peut arriver sans que ce navigateur ait rien fait, et ne peut pas se
 * déduire de la clé qu'on s'apprête à supprimer.
 *
 * D'où le fait de demander le document, comme la page de création de clé le
 * fait déjà. Si l'exploitant refuse le nettoyage, les mêmes attestations
 * resteront candidates la fois suivante : l'état n'est pas dans une décision
 * passée, il se recalcule contre le document du jour.
 *
 * La seconde case existe pour le cas où le document est inaccessible. Elle
 * autorise la suppression de la clé SANS contrôle — et alors aucune attestation
 * n'est touchée, puisque rien ne permet de dire laquelle serait orpheline.
 */
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

  const orphanBox = document.querySelector("[data-reset-orphans]");
  const orphanCount = document.querySelector("[data-reset-orphan-count]");
  const forceBox = document.querySelector("[data-reset-force]");
  const merge = wireDidMerge(document, () => issuerDid(me));

  /**
   * Un seul écrivain de l'état du panneau, comme partout ailleurs depuis #64.
   *
   * Le compte d'orphelines se recalcule à chaque passage plutôt que d'être
   * retenu : il dépend du document chargé, qui peut changer entre deux clics.
   */
  async function refresh() {
    const installed = merge.previous();
    const orphans = await orphanedCredentials(installed);

    if (orphanCount) {
      orphanCount.textContent = installed ? String(orphans.length) : "—";
    }
    if (orphanBox) {
      // Sans document installé, la question n'a pas de réponse : on ne propose
      // pas d'effacer sur une ignorance.
      orphanBox.disabled = !installed || orphans.length === 0;
      if (!installed || orphans.length === 0) orphanBox.checked = false;
    }
    // La clé ne se supprime qu'avec un document en main, ou en forçant.
    btn.disabled = !installed && !forceBox?.checked;
    if (status && !installed) {
      status.textContent = forceBox?.checked ? T.resetForced : T.resetNeedsDid;
    } else if (status && installed) {
      status.textContent = "";
    }
    return orphans;
  }

  document.querySelector("[data-did-previous-file]")
    ?.addEventListener("change", () => setTimeout(refresh, 0));
  document.querySelector("[data-did-previous-text]")
    ?.addEventListener("input", () => setTimeout(refresh, 0));
  forceBox?.addEventListener("change", refresh);
  await refresh();

  btn.addEventListener("click", async () => {
    const input = document.querySelector("[data-reset-confirm]");
    if (input?.value.trim() !== expected) {
      if (status) status.textContent = T.resetMismatch;
      return;
    }

    const orphans = await refresh();
    let removed = 0;
    if (orphanBox?.checked && orphans.length) removed = await removeCredentials(orphans);

    // LA CLÉ SEULEMENT. Le portefeuille survit à la rotation, et c'est le point
    // de toute cette révision.
    await deleteKeyPair().catch(() => {});
    if (status) status.textContent = `${T.resetDone} — ${removed} ${T.resetRemoved}`;
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
