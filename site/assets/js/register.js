/**
 * Le registre des barres — groupé par lot.
 *
 * Le lot est la maille, et ce n'est pas un choix d'affichage : c'est ce sur quoi
 * le calcul carbone porte. Trois cent soixante-dix-huit lignes à plat ne sont
 * rien pour un navigateur et beaucoup pour un écran ; onze groupes se lisent.
 *
 * TROIS ÉTATS, ET LE TROISIÈME EST LE PLUS HONNÊTE. Une barre est non
 * certifiée, certifiée et détenue ici, ou **certifiée ailleurs** — le magasin a
 * son attestation, ce navigateur ne l'a pas. Afficher « non certifiée » serait
 * un mensonge ; afficher « certifiée » sans la détenir en serait un autre.
 *
 * Le portefeuille ne se repeuple pas tout seul : l'index dit ce qui existe, la
 * récupération se demande barre par barre. Un rechargement silencieux ferait
 * disparaître le troisième état avant qu'il soit vu, et ferait du serveur la
 * source de vérité de ce que la mine détient.
 */
import T from "./labels.js";
import { allCredentials } from "./wallet.js";
import { massColumn } from "./mass.js";

const $ = (s) => document.querySelector(s);

async function loadFixture() {
  const r = await fetch("/engine/erp-fixture.json", { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/**
 * Ce que le magasin détient, par référence de coulée.
 *
 * Un magasin injoignable n'est pas une erreur du registre : le portefeuille
 * reste lisible et les barres qu'il détient s'affichent. On perd seulement la
 * distinction entre « non certifiée » et « certifiée ailleurs », et il vaut
 * mieux le dire en n'affichant pas le troisième état que l'inventer.
 */
async function loadStoreIndex() {
  try {
    const r = await fetch("/api/v1/credentials/index", { headers: { accept: "application/json" } });
    // Le site répond 200 avec sa page d'accueil pour tout chemin inconnu : sans
    // ce contrôle, une erreur de routage passerait pour un magasin vide.
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return null;
    const { index } = await r.json();
    return new Set(index.map((e) => e.subject));
  } catch {
    return null;
  }
}

function statusOf(bar, heldRefs, storeSubjects) {
  if (heldRefs.has(bar.internalId)) return { key: "here", label: T.barStatusHere, kind: "verified" };
  if (storeSubjects?.has(bar.subjectId)) {
    return { key: "elsewhere", label: T.barStatusElsewhere, kind: "warning" };
  }
  return { key: "none", label: T.barStatusNone, kind: "pending" };
}

function lotSection(lot, bars, heldRefs, storeSubjects) {
  // Une colonne, une unité : l'œil compare des nombres, pas des préfixes.
  const fine = massColumn(bars.map((b) => b.fineGoldKg));
  const gross = massColumn(bars.map((b) => b.grossMassKg));
  const certified = bars.filter((b) => statusOf(b, heldRefs, storeSubjects).key !== "none").length;

  const rows = bars.map((bar) => {
    const st = statusOf(bar, heldRefs, storeSubjects);
    const href = `/bar/?id=${encodeURIComponent(bar.internalId)}`;
    return `<tr>
      <td><a href="${href}">${bar.internalId}</a></td>
      <td class="num">${fine.format(bar.fineGoldKg)}</td>
      <td class="num">${gross.format(bar.grossMassKg)}</td>
      <td><span class="badge badge--${st.kind}">${st.label}</span></td>
      <td><a class="btn btn--small" href="${href}">${T.registerOpen}</a></td>
    </tr>`;
  }).join("");

  return `<details class="lot">
    <summary>
      <strong>${lot.id}</strong>
      <span class="muted">${bars.length} ${T.registerBars} · ${T.registerMonth} ${lot.pourMonth}
        · ${T.registerDrawnFrom} ${lot.productionMonth}${lot.syntheticSource ? ` · ${T.registerSynthetic}` : ""}</span>
      <span class="badge badge--${certified === bars.length ? "verified" : "pending"}">${certified}/${bars.length} ${T.registerCertified}</span>
    </summary>
    <table class="register">
      <thead><tr>
        <th>${T.barInternalId}</th><th class="num">${T.barFineGold} (${fine.unit})</th>
        <th class="num">${T.barGrossMass} (${gross.unit})</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </details>`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const target = $("[data-register]");
  if (!target) return;

  try {
    const [fixture, held, storeSubjects] = await Promise.all([
      loadFixture(), allCredentials(), loadStoreIndex(),
    ]);

    if (!fixture.bars?.length) { target.innerHTML = `<p class="muted">${T.registerEmpty}</p>`; return; }

    // Le portefeuille indexe par référence locale — le numéro interne de barre
    // — parce que l'identifiant de sujet est tiré au hasard à la signature.
    const heldRefs = new Set(held.map((r) => r.ref).filter(Boolean));

    const byLot = new Map(fixture.lots.map((l) => [l.id, []]));
    for (const bar of fixture.bars) byLot.get(bar.lot)?.push(bar);

    target.innerHTML = fixture.lots
      .map((lot) => lotSection(lot, byLot.get(lot.id) ?? [], heldRefs, storeSubjects))
      .join("");

    const total = fixture.bars.length;
    const done = fixture.bars.filter((b) => statusOf(b, heldRefs, storeSubjects).key !== "none").length;
    const count = $("[data-register-count]");
    if (count) count.textContent = `${done} / ${total}`;
  } catch (err) {
    target.innerHTML = `<p class="badge badge--warning">${T.registerEmpty} — ${err.message}</p>`;
  }
});
