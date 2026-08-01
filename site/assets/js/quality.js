/**
 * La vue de l'exploitant : des nombres, jamais un lingot.
 *
 * C'est ce que Natixar voit de la plateforme — combien d'objets, de quelle
 * origine — et c'est délibérément tout. Aucun identifiant de barre, aucun nom de
 * département : de quoi surveiller un service sans lire les affaires d'un
 * client. L'énoncé de confidentialité de la page publique se tient ou tombe ici.
 *
 * Le refus vient du service, pas de cet écran : un compte sans le droit reçoit
 * un 403 même en tapant l'adresse. La page se contente de le dire lisiblement.
 */
import T from "./labels.js";

const $ = (s) => document.querySelector(s);

const card = (label, value) =>
  `<div><dt>${label}</dt><dd>${value}</dd></div>`;

document.addEventListener("DOMContentLoaded", async () => {
  const target = $("[data-quality]");
  if (!target) return;

  let res;
  try {
    res = await fetch("/api/v1/counts", { headers: { accept: "application/json" } });
  } catch (err) {
    target.innerHTML = `<p class="badge badge--warning">${err.message}</p>`;
    return;
  }

  if (res.status === 403) {
    target.innerHTML = `<p class="badge badge--warning">${T.qualityDenied}</p>`;
    return;
  }
  // Le site répond 200 avec sa page d'accueil pour tout chemin inconnu : sans
  // ce contrôle, une erreur de routage passerait pour une plateforme vide.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) {
    target.innerHTML = `<p class="badge badge--warning">${T.registerEmpty}</p>`;
    return;
  }

  const { totals, byOrigin } = await res.json();
  const total = byOrigin.reduce((a, r) => a + r.n, 0) || 1;

  target.innerHTML = `
    <dl class="facts">
      ${card(T.qualityCells, totals.cells.toLocaleString("fr-FR"))}
      ${card(T.qualityEntities, totals.entities.toLocaleString("fr-FR"))}
      ${card(T.qualityCredentials, totals.credentials.toLocaleString("fr-FR"))}
    </dl>

    <h3 class="subhead">${T.qualityByOrigin}</h3>
    <table class="register">
      <thead><tr><th>Origin</th><th class="num">Records</th><th class="num">Share</th></tr></thead>
      <tbody>${byOrigin.map((r) => `<tr>
        <td>${r.origin}</td>
        <td class="num">${r.n.toLocaleString("fr-FR")}</td>
        <td class="num">${((100 * r.n) / total).toFixed(1)} %</td>
      </tr>`).join("")}</tbody>
    </table>
  `;
});
