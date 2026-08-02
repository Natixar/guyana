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
import { commitMatrix, commitTotal } from "../../site/assets/js/commitments.js";
import { decide, matrixOf } from "./attest.mjs";

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

      // La matrice — ce qui a compté et ce qui n'a pas compté — puis ses
      // engagements. Les sels naissent ici, à l'émission, et une seule fois.
      const { cells, disposition } = matrixOf(verdict);
      const { commitments, disclosures } = await commitMatrix(cells, disposition);
      // L'unité vient du VERDICT et n'est pas récrite ici. C'est celle du
      // calcul qu'on vient de refaire ; la retaper en littéral créerait la
      // seconde source de vérité que retirer l'unité des cellules avait
      // justement supprimée, et l'engagement sur le total serait le premier
      // endroit où les deux divergeraient sans bruit.
      const totalCommitment = await commitTotal(
        commitments, verdict.total, verdict.unit);

      const credential = buildCarbonCredential({
        issuerDid: ISSUER_DID,
        subjectId: request.subjectId,
        derivedFrom: request.derivedFrom,
        // L'unité est dérivée, jamais déclarée : kgCO2e par unité de dénominateur.
        intensity: { value: verdict.value, unit: `kgCO2e/${request.denominatorUnit}` },
        commitments,
        totalCommitment,
        unallocated: verdict.unallocated,
        method: {
          // Par attestation en H1, et sous ce nom précisément pour qu'elle
          // puisse descendre dans la cellule sans que la cellule change de
          // forme — décision 4 de l'issue #61.
          taxonomy: taxonomy.version,
          conditions: request.conditions,
          // La méthode dit la vérité sur ce qu'elle a fait. `period` tant que
          // les événements matière n'existent pas ; `flow` le jour où ils
          // existent. Le passage devient lisible au lieu d'être silencieux.
          //
          allocation: request.allocation ?? "period",
          // DEUX ALLOCATIONS DISTINCTES, ET IL FAUT LES NOMMER SÉPARÉMENT.
          // `allocation` dit comment le TEMPS a été alloué — par période tant
          // que les événements matière n'existent pas, par flux le jour où ils
          // existent. `lotRule` dit comment les émissions ont été réparties
          // entre les LOTS et les barres. Les écrire dans le même champ ferait
          // disparaître l'une des deux sans que rien ne le signale.
          //
          // LA RÈGLE VIENT DU VERDICT, PAS DE LA REQUÊTE : ce qui est écrit est
          // le nom de la règle réellement appliquée. Recopier le nom fourni
          // permettrait d'attester « lot » en ayant divisé autrement.
          //
          // LES DEUX DIVISEURS VOYAGENT, et c'est ce qui rend la règle
          // vérifiable au lieu d'être seulement nommée. Sans eux, « réparti
          // entre les lots vus » est une phrase ; avec eux, c'est une division
          // qu'un tiers refait.
          ...(verdict.alloc ? {
            lotRule: verdict.alloc.rule,
            divisors: {
              lotsInWindow: verdict.alloc.lotsInWindow,
              barsInLot: verdict.alloc.barsInLot,
            },
          } : {}),
          ...(request.eventModel ? { eventModel: request.eventModel } : {}),
        },
      });

      const signed = await signCredential(credential, { privateKey: signingKey },
                                          `${ISSUER_DID}#${KEY_NAME}`);
      // LES DIVULGATIONS VOYAGENT À CÔTÉ, JAMAIS DEDANS. C'est ce qui permet au
      // porteur d'en retirer avant de présenter l'attestation sans toucher à un
      // octet de ce qui a été signé. Les remettre à l'intérieur rendrait la
      // divulgation maîtrisée impossible, et le ferait silencieusement.
      res.status(201).json({
        credential: signed,
        disclosures,
        totalSalt: totalCommitment.salt,
      });
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
