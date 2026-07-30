// Écran de signature. Sans dépendance : WebCrypto est natif.

import { loadKeyPair, createKeyPair, thumbprint, readable } from "./keys.js";
import { buildDidDocument, downloadJson } from "./did.js";

const DID = document.documentElement.dataset.issuerDid || "did:web:example.org";

const $ = (s) => document.querySelector(s);

// Les libellés viennent du document, pas du code.
const T = JSON.parse(document.getElementById("i18n")?.textContent || "{}");

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
    if (status) { status.textContent = problem; status.className = "badge badge--warning"; }
    return;
  }

  const pair = await loadKeyPair();

  if (status) {
    status.textContent = pair ? T.keyPresent : T.keyMissing;
    status.className = "badge " + (pair ? "badge--verified" : "badge--pending");
  }

  const setup = $("[data-setup]");
  if (setup) setup.hidden = false;
  if (pair) await showFingerprint(pair);

  $("[data-create-key]")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await showFingerprint(await createKeyPair());
      if (status) { status.textContent = T.keyCreated; status.className = "badge badge--verified"; }
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
