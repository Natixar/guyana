// Wiring for the verification page. Two inputs, one verdict.

import T from "@params";
import { verifyCredential, didWebUrl } from "./verify.js";

const $ = (s) => document.querySelector(s);
const state = { credential: null, didDoc: null };

const esc = (s) => String(s).replace(/[<&]/g, (c) => ({ "<": "&lt;", "&": "&amp;" })[c]);

/** Accepts either a chosen file or pasted text — pasting is the easier path. */
function wireInput(name, onLoad) {
  const file = $(`[data-${name}-file]`);
  const text = $(`[data-${name}-text]`);
  const status = $(`[data-${name}-status]`);

  const accept = (raw, origin) => {
    try {
      onLoad(JSON.parse(raw));
      status.textContent = `${T.vLoaded} (${origin})`;
      status.className = "badge badge--verified";
    } catch (e) {
      state[name === "vc" ? "credential" : "didDoc"] = null;
      status.textContent = `${T.vNotJson} ${e.message}`;
      status.className = "badge badge--warning";
    }
    refresh();
  };

  file?.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (f) accept(await f.text(), f.name);
  });
  text?.addEventListener("input", () => {
    const raw = text.value.trim();
    if (raw) accept(raw, T.vPasted);
  });
}

function renderClaims(doc) {
  const rows = [];
  const s = doc.credentialSubject ?? {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "id") continue;
    const value = v && typeof v === "object" ? v.value : v;
    const origin = v && typeof v === "object" ? v.origin : null;
    rows.push(`<div><dt>${esc(k)}</dt><dd>${esc(value ?? "—")}` +
      (origin && origin !== "MEASURED" ? ` <span class="origin-tag">${esc(origin.toLowerCase())}</span>` : "") +
      `</dd></div>`);
  }
  return rows.join("");
}

async function refresh() {
  const hint = $("[data-did-hint]");
  const out = $("[data-verdict]");
  const body = $("[data-contents]");

  // As soon as the credential is in, say where its issuer's key lives.
  if (state.credential?.issuer) {
    const url = didWebUrl(state.credential.issuer);
    hint.hidden = false;
    hint.innerHTML = `<p>${T.vIssuerIs} <code>${esc(state.credential.issuer)}</code></p>` +
      (url ? `<p>${T.vFetchAt} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>
              <p class="muted">${T.vFetchHow}</p>`
           : `<p class="muted">${T.vNotDidWeb}</p>`);
  } else {
    hint.hidden = true;
  }

  if (!state.credential || !state.didDoc) { out.hidden = true; body.hidden = true; return; }

  const r = await verifyCredential(state.credential, state.didDoc);
  out.hidden = false;
  out.innerHTML = r.ok
    ? `<span class="badge badge--verified">${T.vValid}</span> <span class="muted">${T.vValidBody}</span>`
    : `<span class="badge badge--warning">${T.vInvalid}</span> <span class="muted">${esc(r.reason ?? "")}</span>`;
  for (const n of r.notes ?? []) out.innerHTML += `<p class="muted">${esc(n)}</p>`;

  if (!r.ok) { body.hidden = true; return; }

  const d = r.document;
  body.hidden = false;
  body.innerHTML = `
    <h3 class="subhead">${T.vAttested}</h3>
    <dl class="facts">${renderClaims(d)}</dl>
    <h3 class="subhead">${T.vProvenance}</h3>
    <dl class="facts">
      <div><dt>${T.vIssuer}</dt><dd>${esc(d.issuer ?? "—")}</dd></div>
      <div><dt>${T.vSubject}</dt><dd>${esc(d.credentialSubject?.id ?? "—")}</dd></div>
      <div><dt>${T.vSignedOn}</dt><dd>${esc(r.proof?.created ?? "—")}</dd></div>
      <div><dt>${T.vConfirmedBy}</dt><dd>${esc(d.confirmedBy?.name ?? T.vNotIdentified)}</dd></div>
    </dl>`;
}

document.addEventListener("DOMContentLoaded", () => {
  wireInput("vc", (j) => { state.credential = j; });
  wireInput("did", (j) => { state.didDoc = j; });
});
