/**
 * Le signataire — Express, une clé, aucune base.
 *
 * SURFACE MINIMALE, DÉLIBÉRÉMENT. Un seul point d'entrée qui agit :
 * `POST /api/v1/sign`. Tout le reste — réception des attestations, identité,
 * back-office, extractions — appartient au magasin. Ce n'est pas de l'économie
 * de code : chaque route ajoutée ici est une route servie par le processus qui
 * détient la clé de signature de Natixar.
 *
 * Ce service ne joint pas PostgreSQL. C'est vérifié par
 * `deploy/verify/verify-service-isolation.bats`, deux fois — l'absence de
 * réseau se lit dans la configuration, l'injoignabilité se constate, et la
 * première peut être vraie pendant que la seconde est fausse.
 */
import { readFile } from "node:fs/promises";
import express from "express";

import { buildCarbonCredential, signCredential } from "../../site/assets/js/credential.js";
import { decide } from "./attest.mjs";

const PORT = Number(process.env.SIGNER_PORT ?? 8081);
const ISSUER_DID = process.env.SIGNER_ISSUER_DID ?? "did:web:natixar.pro";
const KEY_NAME = process.env.SIGNER_KEY_NAME ?? "key-1";

/**
 * Les secrets viennent de l'adaptateur, jamais du dépôt et jamais de l'image.
 *
 * Une clé cuite dans l'image se retrouverait dans son digest, donc dans le
 * registre, donc dans toute copie de l'image. Elle arrive donc par un secret
 * monté, et le chemin seul est configurable.
 */
async function loadJwk(path, usages) {
  const jwk = JSON.parse(await readFile(path, "utf8"));
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, usages);
}

export async function createApp({ signingKey, storeKey, taxonomy }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  // Sonde de vie. Ne lit rien, ne signe rien, ne dit rien de l'état interne.
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  app.post("/api/v1/sign", async (req, res) => {
    try {
      const request = req.body ?? {};
      const verdict = await decide(request, { storeKey, taxonomy });

      const credential = buildCarbonCredential({
        issuerDid: ISSUER_DID,
        subjectId: request.subjectId,
        derivedFrom: request.derivedFrom,
        // L'unité est dérivée, jamais déclarée : kgCO2e par unité de dénominateur.
        intensity: { value: verdict.value, unit: `kgCO2e/${request.denominatorUnit}` },
        pivot: verdict.pivot,
        unallocated: verdict.unallocated,
        excluded: verdict.excluded,
        method: {
          taxonomy: taxonomy.version,
          conditions: request.conditions,
          // La méthode dit la vérité sur ce qu'elle a fait. `period` tant que
          // les événements matière n'existent pas ; `flow` le jour où ils
          // existent. Le passage devient lisible au lieu d'être silencieux.
          allocation: request.allocation ?? "period",
          ...(request.eventModel ? { eventModel: request.eventModel } : {}),
        },
      });

      const signed = await signCredential(credential, { privateKey: signingKey },
                                          `${ISSUER_DID}#${KEY_NAME}`);
      res.status(201).json(signed);
    } catch (err) {
      // Le code part au client, pas la pile : il doit pouvoir corriger sa
      // requête sans lire un message rédigé pour un humain. Un refus est une
      // réponse, pas un incident — d'où 422 et non 500.
      const code = err.code ?? "SIGNING_FAILED";
      const status = code === "SIGNING_FAILED" ? 500 : 422;
      if (status === 500) console.error(err);
      res.status(status).json({ error: code, detail: err.message });
    }
  });

  return app;
}

// Démarrage seulement si ce fichier est le point d'entrée : les tests importent
// createApp sans ouvrir de port.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [signingKey, storeKey, taxonomy] = await Promise.all([
    loadJwk(process.env.SIGNER_KEY_PATH ?? "/run/secrets/signer_key", ["sign"]),
    loadJwk(process.env.STORE_PUBKEY_PATH ?? "/run/secrets/store_pubkey", ["verify"]),
    readFile(process.env.TAXONOMY_PATH ?? "/app/taxonomy.json", "utf8").then(JSON.parse),
  ]);

  const app = await createApp({ signingKey, storeKey, taxonomy });
  app.listen(PORT, () => console.log(`signataire à l'écoute sur :${PORT}`));
}
