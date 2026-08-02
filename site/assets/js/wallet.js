/**
 * Le portefeuille — les attestations, dans le navigateur, à côté de la clé.
 *
 * PORTEFEUILLE DE NIVEAU POC, ET IL FAUT LE DIRE AINSI. C'en est un par la
 * fonction : il conserve des attestations et les rend sur demande. Ce n'en est
 * pas un par la norme — ni OpenID4VP, ni EUDI, ni EBSI. Le jour où un
 * portefeuille certifié existera pour le client, l'identifiant de sujet est
 * déjà taillé pour y déménager sans rien réémettre.
 *
 * La clé et les attestations partagent une base, et ce n'est pas de la
 * commodité : supprimer la clé doit effacer tout ce qu'elle a signé, et la
 * colocalisation fait tenir cette règle sans que personne ait à s'en souvenir.
 *
 * Ce qui est stocké est le document signé, tel quel. Le reformater
 * l'invaliderait — c'est vrai en base, c'est vrai ici.
 */
import { canonicalBytes } from "./canonical.js";
import { STORES, databaseExists, openDb, tx } from "./idb.js";

/** Le type W3C significatif, « VerifiableCredential » étant porté par toutes. */
export function credentialType(doc) {
  const types = Array.isArray(doc?.type) ? doc.type : [doc?.type].filter(Boolean);
  return types.find((t) => t !== "VerifiableCredential") ?? "VerifiableCredential";
}

/**
 * La clé de rangement : sujet ET type.
 *
 * Une barre porte deux attestations — l'origine et l'intensité carbone — et
 * toutes deux portent le même sujet, puisque c'est ce que `derivedFrom` relie.
 * Ranger par sujet seul écraserait la première avec la seconde ; le magasin a
 * eu exactement ce défaut.
 */
const slot = (subject, type) => `${subject}${type}`;

async function digestOf(doc) {
  const bytes = await crypto.subtle.digest("SHA-256", canonicalBytes(doc));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Range une attestation. Renvoie ce qui a été rangé.
 *
 * Une réémission pour le même sujet et le même type REMPLACE : le portefeuille
 * détient la plus récente, comme le registre l'affiche. L'historique appartient
 * au magasin, qui garde toutes les versions ; un portefeuille qui accumulerait
 * des versions périmées ferait douter l'opérateur de laquelle présenter.
 */
export async function putCredential(doc, ref = null, extras = {}) {
  const subject = doc?.credentialSubject?.id;
  if (!subject) {
    const err = new Error("credential has no credentialSubject.id");
    err.code = "SUBJECT_MISSING";
    throw err;
  }
  const type = credentialType(doc);
  const record = {
    subject, type,
    // Référence LOCALE, hors du document signé. L'identifiant de sujet est un
    // aléa tiré au moment de signer : il ne permet pas de retrouver, plus tard,
    // l'attestation d'une coulée donnée. Le porteur a besoin d'un index sur ce
    // qu'il connaît — le numéro de coulée, le numéro interne de barre — et cet
    // index est de la comptabilité de portefeuille, pas du contenu attesté.
    ref,
    digest: await digestOf(doc),
    storedAt: new Date().toISOString(),
    document: doc,
    // LES DIVULGATIONS SE RANGENT AVEC L'ATTESTATION, et c'est une correction
    // du 3 août 2026. Elles ne vivaient que dans une variable de page : un
    // rechargement les perdait, et l'écran affichait alors une matrice de
    // tirets — un calcul signé dont plus une ligne n'était lisible. Le porteur
    // ne pouvait plus regarder ce que Natixar avait fait sur SA barre, ce qui
    // est très exactement la raison d'être de cet écran.
    //
    // ELLES NE PARTENT TOUJOURS PAS AU MAGASIN. Le dépôt n'envoie que
    // l'attestation — des engagements scellés. Les montants et leurs sels
    // restent dans ce navigateur, à côté de la clé, et c'est ce qui laisse au
    // porteur le droit d'en retirer avant de présenter, sans toucher à un octet
    // de ce qui a été signé. « Local » veut dire durable, pas éphémère.
    ...(extras.disclosures ? { disclosures: extras.disclosures } : {}),
    ...(extras.totalSalt ? { totalSalt: extras.totalSalt } : {}),
  };
  const db = await openDb();
  await tx(db, STORES.CREDENTIALS, "readwrite", (s) => s.put(record, slot(subject, type)));
  db.close();
  return record;
}

/** Les attestations d'une barre, par type. Objet vide si le portefeuille n'a rien. */
export async function credentialsFor(subject) {
  const all = await allCredentials();
  return Object.fromEntries(all.filter((r) => r.subject === subject).map((r) => [r.type, r]));
}

/**
 * Tout ce que le portefeuille détient, CHAQUE ENREGISTREMENT AVEC SA CLÉ RÉELLE.
 *
 * N'ouvre pas la base si elle n'existe pas : une page qui consulte le
 * portefeuille ne doit pas le créer au passage.
 *
 * LA CLÉ EST LUE, JAMAIS RECALCULÉE, et c'est une correction du 2 août 2026.
 * Supprimer par `slot(r.subject, r.type)` suppose que l'enregistrement a été
 * rangé par la version actuelle du schéma. Un navigateur qui a visité le site
 * avant #68 détient des enregistrements rangés SOUS LE SUJET SEUL : la clé
 * reconstruite ne désigne alors rien, la suppression réussit sans rien
 * supprimer, et l'auto-test signale à juste titre que des attestations
 * subsistent. Vider le cache HTTP n'y change rien — IndexedDB n'est pas un
 * cache, et c'est bien pour cela que le symptôme a survécu au correctif
 * précédent.
 *
 * `getAll()` et `getAllKeys()` parcourent le magasin dans le même ordre de clés
 * (§ IDBObjectStore de la spécification) : l'appariement par rang est garanti,
 * pas supposé.
 */
export async function allCredentials() {
  if (!(await databaseExists())) return [];
  const db = await openDb();
  const records = await tx(db, STORES.CREDENTIALS, "readonly", (s) => s.getAll());
  const keys = await tx(db, STORES.CREDENTIALS, "readonly", (s) => s.getAllKeys());
  db.close();
  return (records ?? []).map((r, i) => ({ ...r, key: keys?.[i] }));
}

/** Les attestations rangées sous une référence locale — un numéro de coulée. */
export async function credentialsByRef(ref) {
  const all = await allCredentials();
  return Object.fromEntries(all.filter((r) => r.ref === ref).map((r) => [r.type, r]));
}

/**
 * Les attestations que le DID installé ne peut plus vérifier.
 *
 * ORPHELINE SE JUGE CONTRE LE DOCUMENT PUBLIÉ, PAS CONTRE LA CLÉ LOCALE. Une
 * attestation reste vérifiable tant que la clé qui l'a signée figure dans le
 * document DID de l'émetteur — c'est toute la raison pour laquelle ce document
 * est append-only. Elle devient orpheline le jour où cette clé n'y est plus, et
 * cela peut arriver sans que le navigateur qui la détient ait rien fait.
 *
 * Le critère est donc le `verificationMethod` de la preuve : présent dans le
 * document installé, l'attestation se situe ; absent, personne ne peut plus
 * dire d'où elle vient.
 *
 * Sans document installé on ne rend RIEN plutôt que tout : ne pas savoir n'est
 * pas la même chose que savoir que rien ne vaut, et proposer d'effacer sur une
 * ignorance serait le pire des deux.
 *
 * @param {object|null} didDocument le `did.json` publié, chargé par l'exploitant
 * @returns {Promise<Array<object>>}
 */
export async function orphanedCredentials(didDocument) {
  if (!didDocument) return [];
  const known = new Set((didDocument.verificationMethod ?? []).map((m) => m.id));
  const all = await allCredentials();
  return all.filter((r) => {
    const method = r.document?.proof?.verificationMethod;
    // Une attestation sans méthode déclarée ne se rattache à aucune clé : elle
    // est orpheline par construction, et le rester silencieusement serait pire.
    return !method || !known.has(method);
  });
}

/**
 * Retire des attestations, une à une.
 *
 * Par la clé LUE quand on l'a — c'est le cas de tout ce qui sort
 * d'`allCredentials` — et par la clé reconstruite seulement à défaut. L'ordre
 * des deux est le sujet : la clé lue désigne l'enregistrement quel que soit le
 * schéma sous lequel il a été rangé, la clé reconstruite ne désigne que ce que
 * la version courante aurait écrit.
 */
export async function removeCredentials(records) {
  if (!records.length) return 0;
  const db = await openDb();
  for (const r of records) {
    const key = r.key ?? slot(r.subject, r.type);
    await tx(db, STORES.CREDENTIALS, "readwrite", (s) => s.delete(key));
  }
  db.close();
  return records.length;
}

/** Combien d'attestations, par type. Pour un registre qui compte sans tout charger. */
export async function summary() {
  const all = await allCredentials();
  const byType = {};
  for (const r of all) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { total: all.length, byType, subjects: new Set(all.map((r) => r.subject)) };
}
