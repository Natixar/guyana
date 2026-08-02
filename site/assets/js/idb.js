/**
 * La base locale du navigateur — schéma et ouverture, en un seul endroit.
 *
 * UNE SEULE BASE POUR LA CLÉ ET LES ATTESTATIONS, et c'est le point important.
 * La règle produit est que supprimer la clé efface toutes les attestations
 * qu'elle a produites : une attestation dont la clé signataire n'existe plus
 * est un document que personne ne peut situer.
 *
 * Colocaliser les deux magasins fait tenir cette règle **par construction**.
 * La réinitialisation supprime la base, donc les deux partent ensemble, et
 * personne ne peut oublier le second effacement en ajoutant une fonctionnalité.
 * Deux bases distinctes auraient demandé de la discipline ; celle-ci n'en
 * demande pas.
 *
 * L'ouverture est ici et non dupliquée par magasin : deux modules faisant
 * chacun monter la version de la même base se marcheraient dessus.
 */

const DB_NAME = "natixar-gold-trace";

/** Tous les magasins de l'application. En ajouter un ici suffit. */
export const STORES = {
  KEYS: "keys",
  CREDENTIALS: "credentials",
};

const REQUIRED = Object.values(STORES);

function rawOpen(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
    req.onupgradeneeded = () => {
      for (const name of REQUIRED) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  });
}

/**
 * Ouvre la base en garantissant que TOUS les magasins existent.
 *
 * Ne pas supposer qu'une base à la bonne version contient ses magasins : une
 * base peut avoir été créée en version 1 sans aucun magasin par n'importe quel
 * autre code — une commande tapée dans la console, un autre outil. Dans ce cas
 * `onupgradeneeded` ne se déclenche pas et la transaction échoue par
 * NotFoundError. On force alors une montée de version, seul moyen de créer un
 * magasin manquant.
 *
 * Le même mécanisme fait migrer une base existante qui n'a que « keys » : elle
 * gagne « credentials » à la première ouverture, sans rien perdre.
 */
export async function openDb() {
  let db = await rawOpen();
  if (REQUIRED.every((name) => db.objectStoreNames.contains(name))) return db;
  const next = db.version + 1;
  db.close();
  return rawOpen(next);
}

/** Une transaction sur un magasin, ramenée à une promesse. */
export function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * La base existe-t-elle déjà ?
 *
 * `indexedDB.open` la CRÉE sinon, et une page d'auto-vérification qui laisse
 * une base vide derrière elle ne tient pas tout à fait sa promesse de ne rien
 * laisser. `indexedDB.databases()` n'existe pas dans Firefox ; on y répond oui,
 * et l'appelant crée une base vide — sans conséquence, un conteneur vide n'est
 * ni une clé ni une attestation, mais autant que ce soit écrit.
 */
export async function databaseExists() {
  if (typeof indexedDB.databases !== "function") return true;
  const known = await indexedDB.databases();
  return known.some((d) => d.name === DB_NAME);
}

/** Efface tout : la clé et les attestations, ensemble et sans exception. */
export function deleteDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("suppression bloquée par un autre onglet"));
  });
}

export { DB_NAME };
