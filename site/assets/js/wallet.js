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
export async function putCredential(doc, ref = null) {
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
 * Tout ce que le portefeuille détient.
 *
 * N'ouvre pas la base si elle n'existe pas : une page qui consulte le
 * portefeuille ne doit pas le créer au passage.
 */
export async function allCredentials() {
  if (!(await databaseExists())) return [];
  const db = await openDb();
  const records = await tx(db, STORES.CREDENTIALS, "readonly", (s) => s.getAll());
  db.close();
  return records ?? [];
}

/** Les attestations rangées sous une référence locale — un numéro de coulée. */
export async function credentialsByRef(ref) {
  const all = await allCredentials();
  return Object.fromEntries(all.filter((r) => r.ref === ref).map((r) => [r.type, r]));
}

/** Combien d'attestations, par type. Pour un registre qui compte sans tout charger. */
export async function summary() {
  const all = await allCredentials();
  const byType = {};
  for (const r of all) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { total: all.length, byType, subjects: new Set(all.map((r) => r.subject)) };
}
