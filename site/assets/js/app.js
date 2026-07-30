// Écran de signature. Sans dépendance : WebCrypto est natif.

import T from "@params";
import { loadKeyPair, createKeyPair, thumbprint, readable } from "./keys.js";
import { buildDidDocument, downloadJson } from "./did.js";

const DID = document.documentElement.dataset.issuerDid || "did:web:example.org";

const $ = (s) => document.querySelector(s);

/**
 * Écrit dans une pastille. Refuse le vide : une pastille sans texte a été
 * observée deux fois sans être reproductible, et je n'ai pas d'explication.
 * Plutôt que de laisser le symptôme muet, on le rend visible.
 */
function setBadge(el, text, kind) {
  if (!el) return;
  el.textContent = text || `[libellé manquant: ${kind}]`;
  el.className = "badge badge--" + (kind === "warning" ? "warning" : kind);
}

// Les libellés viennent du document, pas du code.


async function environmentOk() {
  if (!globalThis.isSecureContext) return T.notSecure;
  if (!globalThis.crypto?.subtle) return T.noWebCrypto;
  if (!globalThis.indexedDB) return T.noIndexedDb;
  return null;
}

async function showFingerprint(pair) {
  $("[data-fingerprint]").textContent = readable(await thumbprint(pair));
  $("[data-setup-result]").hidden = false;
}

document.addEventListener("DOMContentLoaded", async () => {
  const status = $("[data-key-status]");
  const problem = await environmentOk();

  if (problem) {
    setBadge(status, problem, "warning");
    return;
  }

  const pair = await loadKeyPair();

  setBadge(status, pair ? T.keyPresent : T.keyMissing, pair ? "verified" : "pending");

  const setup = $("[data-setup]");
  if (setup) setup.hidden = false;
  if (pair) await showFingerprint(pair);

  $("[data-create-key]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await showFingerprint(await createKeyPair());
      setBadge(status, T.keyCreated, "verified");
    } catch (err) {
      setBadge(status, err.code === "KEY_EXISTS" ? T.keyExists : String(err.message ?? err), "warning");
      e.target.disabled = false;
    }
  });

  $("[data-download-did]")?.addEventListener("click", async () => {
    const p = await loadKeyPair();
    if (p) downloadJson(await buildDidDocument(p, DID), "did.json");
  });
});
