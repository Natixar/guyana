// Wiring for the verification page. Two inputs, one verdict.

import T from "./labels.js";
import { verifyCredential, didWebUrl } from "./verify.js";
import { resolveDid } from "./did-source.js";

const $ = (s) => document.querySelector(s);
const state = { credential: null, didDoc: null, didSource: null };

/** Accolades équilibrées, en ignorant celles qui sont dans une chaîne. */
function looksComplete(raw) {
  if (!raw.startsWith("{") && !raw.startsWith("[")) return false;
  let depth = 0, inStr = false, escaped = false;
  for (const ch of raw) {
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return !inStr && depth === 0;
}

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
  // Un JSON incomplet n'est pas une erreur : c'est quelqu'un en train de taper.
  // On attend une pause, et l'on ne signale un défaut que si le texte semble
  // fini — accolades équilibrées hors chaînes. Sinon on reste « en attente ».
  let timer;
  text?.addEventListener("input", () => {
    clearTimeout(timer);
    const raw = text.value.trim();
    if (!raw) {
      status.textContent = T.vAwaiting;
      status.className = "badge badge--pending";
      return;
    }
    status.textContent = T.vTyping;
    status.className = "badge badge--pending";
    timer = setTimeout(() => {
      if (looksComplete(raw)) accept(raw, T.vPasted);
    }, 400);
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

/**
 * D'où vient la clé qui sert à vérifier — annoncé, jamais tu.
 *
 * C'est la seule phrase que cette page existe pour démontrer : si la clé ne
 * vient pas du domaine de l'émetteur, le dire vaut mieux que de le laisser
 * découvrir dans les outils de développement.
 */
function provenance() {
  const label = {
    network: [T.vDidFromNetwork, "verified"],
    bundled: [T.vDidFromBundle, "warning"],
    browser: [T.vDidFromBrowser, "warning"],
    supplied: [T.vDidFromSupplied, "info"],
    none: [T.vDidUnresolved, "warning"],
  }[state.didSource];
  if (!label) return "";
  const [text, kind] = label;
  return `<p><span class="badge badge--${kind}">${esc(text)}</span></p>`;
}

async function refresh() {
  const hint = $("[data-did-hint]");
  const out = $("[data-verdict]");
  const body = $("[data-contents]");

  // As soon as the credential is in, say where its issuer's key lives.
  if (state.credential?.issuer) {
    const url = didWebUrl(state.credential.issuer);

    // Résolution automatique, réseau d'abord. Sans elle il fallait déposer un
    // fichier à la main, ce qui fonctionne et se filme mal.
    if (!state.didDoc) {
      try {
        const got = await resolveDid(state.credential.issuer);
        state.didDoc = got.document;
        state.didSource = got.source;
      } catch { state.didSource = "none"; }
    }

    hint.hidden = false;
    hint.innerHTML = `<p>${T.vIssuerIs} <code>${esc(state.credential.issuer)}</code></p>` +
      (url ? `<p>${T.vFetchAt} <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a></p>`
           : `<p class="muted">${T.vNotDidWeb}</p>`) +
      provenance();
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
  // Un document déposé à la main l'emporte : le vérificateur qui apporte le
  // sien sait ce qu'il fait, et la provenance devient « fourni ».
  wireInput("did", (j) => { state.didDoc = j; state.didSource = "supplied"; });
});
