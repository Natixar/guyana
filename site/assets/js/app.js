// Écran de signature. Sans dépendance : WebCrypto est natif.

import { loadKeyPair, createKeyPair, thumbprint, readable } from "./keys.js";
import { buildDidDocument, downloadJson } from "./did.js";

const DID = document.documentElement.dataset.issuerDid || "did:web:example.org";

const $ = (s) => document.querySelector(s);

async function environmentOk() {
  if (!globalThis.isSecureContext) return "Page non servie en HTTPS — la signature est impossible";
  if (!globalThis.crypto?.subtle) return "Ce navigateur ne fournit pas WebCrypto";
  if (!globalThis.indexedDB) return "Ce navigateur ne fournit pas IndexedDB";
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
    if (status) { status.textContent = problem; status.className = "badge badge--warning"; }
    return;
  }

  const pair = await loadKeyPair();

  if (status) {
    status.textContent = pair ? "Clé de signature présente" : "Aucune clé — installation requise";
    status.className = "badge " + (pair ? "badge--verified" : "badge--pending");
  }

  const setup = $("[data-setup]");
  if (setup) setup.hidden = false;
  if (pair) await showFingerprint(pair);

  $("[data-create-key]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await showFingerprint(await createKeyPair());
      if (status) { status.textContent = "Clé de signature créée"; status.className = "badge badge--verified"; }
    } catch (err) {
      if (status) { status.textContent = String(err.message ?? err); status.className = "badge badge--warning"; }
      e.target.disabled = false;
    }
  });

  $("[data-download-did]")?.addEventListener("click", async () => {
    const p = await loadKeyPair();
    if (p) downloadJson(await buildDidDocument(p, DID), "did.json");
  });
});
