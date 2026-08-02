/**
 * Lire une attestation qu'on a reçue — la vue du PORTEUR, pas celle du vérificateur.
 *
 * POURQUOI CET ÉCRAN EXISTE. L'intensité carbone d'une barre est calculée par
 * Natixar et signée sous la clé de Natixar : la mine la subit sans l'avoir
 * faite. Que la justification des données soit automatique ne change rien à
 * cela — un chiffre qui engage un client doit pouvoir être regardé par ce
 * client, et pas seulement par l'acheteur à qui il le remettra.
 *
 * CE N'EST PAS LA PAGE DE VÉRIFICATION, et les deux ne doivent pas fusionner.
 * `/verify/` s'adresse à quelqu'un qui ne nous fait pas confiance : elle est
 * publique, elle ne nous appelle pas, et elle refait le calcul. Cet écran-ci
 * s'adresse à quelqu'un qui est déjà authentifié chez nous et qui regarde SES
 * propres documents. Les mêmes octets, deux lectures, deux positions.
 *
 * CE QUE LE MAGASIN DÉTIENT, ET CE QU'IL NE DÉTIENT PAS. Une attestation
 * carbone déposée porte les ENGAGEMENTS de sa matrice, jamais les montants :
 * ceux-ci voyagent à côté, en divulgations, et c'est ce qui permet d'en retirer
 * une sans casser la signature. Cet écran affiche donc ce que le document dit
 * réellement — combien de cellules, lesquelles ont compté, et pourquoi les
 * autres non — et il le dit au lieu de laisser croire à un affichage tronqué.
 *
 * Tout ce qui vient du document est échappé. Le document arrive du réseau ;
 * qu'il soit signé prouve son origine, pas son innocuité.
 *
 * @see site/assets/js/verify-page.js — l'autre lecture, celle du vérificateur
 * @see site/assets/js/commitments.js — d'où vient le recalcul quand on a les divulgations
 */
import T from "./labels.js";
import { esc } from "./escape.js";

/** Le type W3C significatif : celui qui n'est pas « VerifiableCredential ». */
export function meaningfulType(doc) {
  const types = Array.isArray(doc?.type) ? doc.type : [doc?.type];
  return types.find((t) => t && t !== "VerifiableCredential") ?? "VerifiableCredential";
}

const row = (label, value) =>
  `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`;

/** Un intervalle lisible, ou un tiret. Les bornes sont des instants ISO. */
const period = (p) =>
  p?.start ? `${esc(String(p.start).slice(0, 10))} → ${esc(String(p.end ?? "").slice(0, 10))}` : "—";

/**
 * La matrice, telle qu'elle est DANS le document.
 *
 * Une cellule retenue et une cellule écartée se ressemblent ici, et c'est le
 * sujet : la seconde est présente, dénombrable, avec son motif. Un tableau d'où
 * les exclusions auraient disparu ressemblerait trait pour trait à un tableau
 * complet, ce qui est exactement ce que la décision 1 de l'issue #61 refuse.
 */
function matrix(doc, disclosures = []) {
  const cells = doc?.credentialSubject?.breakdown;
  if (!Array.isArray(cells) || cells.length === 0) return "";

  // LES DIVULGATIONS SONT CE QUI REMPLIT CE TABLEAU, et sans elles il est vide
  // de tout sauf du dénombrement. Une entrée signée ne porte QU'un engagement,
  // le fait qu'elle ait compté, et son motif : la catégorie elle-même est dans
  // l'engagement, parce que « il y a une ligne de minage » est déjà une
  // information sur l'exploitation. Le porteur, lui, détient les divulgations —
  // c'est son propre calcul qu'il regarde — et il peut donc voir les colonnes.
  //
  // Ce tableau avait été écrit en lisant `c.step` sur l'engagement. Ce champ n'y
  // est jamais : chaque ligne affichait « — » sans que rien ne signale l'erreur.
  const byIndex = new Map((disclosures ?? []).map((d) => [d.index, d]));
  const opened = byIndex.size > 0;

  const used = cells.filter((c) => c.used !== false).length;
  const num = (x) => (typeof x === "number"
    ? x.toLocaleString("fr-FR", { maximumSignificantDigits: 3 }) : "—");

  const body = cells.map((c, index) => {
    const withheld = c.used === false;
    const d = byIndex.get(index);
    return `<tr${withheld ? ' class="row--withheld"' : ""}>
      <td class="num">${esc(String(d?.step ?? "—"))}</td>
      <td class="num">${esc(String(d?.subPost ?? "—"))}</td>
      <td>${period(d?.period)}</td>
      <td>${esc(String(d?.origin ?? "—"))}</td>
      <td class="num">${esc(num(d?.amount))}</td>
      <td class="num">${d?.share === undefined ? "—" : esc(num(d.share))}</td>
      <td>${withheld ? esc(T.certExcluded) : esc(T.certCounted)}</td>
      <td>${esc(c.reason ?? "")}</td>
    </tr>`;
  }).join("");

  return `
    <h4 class="subhead">${T.certMatrix}</h4>
    <p class="muted">${T.certCellCount
      .replace("{n}", String(cells.length))
      .replace("{used}", String(used))
      .replace("{out}", String(cells.length - used))}</p>
    <div class="scroll-x">
    <table class="register">
        <thead><tr>
          <th class="num">${T.certStep}</th><th class="num">${T.certSubPost}</th>
          <th>${T.certPeriod}</th><th>${T.certOrigin}</th>
          <th class="num">${T.certAmount}</th><th class="num">${T.certShare}</th>
          <th>${T.certCounted}</th><th>${T.certReason}</th>
        </tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>
    <p class="muted">${opened ? T.certAmountsLocal : T.certAmountsElsewhere}</p>`;
}

/** La méthode : ce sans quoi le chiffre est invérifiable cinq ans plus tard. */
function method(doc) {
  const m = doc?.credentialSubject?.method;
  if (!m || typeof m !== "object") return "";
  const known = [
    [T.certAllocation, m.allocation],
    [T.certLotRule, m.lotRule],
    // LES DEUX DIVISEURS SE LISENT, sans quoi la règle n'est qu'un nom. Le
    // porteur doit pouvoir constater que le partagé a été divisé par le nombre
    // de lots actifs sur la fenêtre — c'est la partie du calcul qui, sans cet
    // affichage, exigerait de nous croire sur parole.
    [T.certDivisors, m.divisors
      ? `${m.divisors.lotsInWindow} × ${m.divisors.barsInLot}`
      : undefined],
    [T.certTaxonomy, m.taxonomy],
    [T.certFactors, m.factorSet ?? m.factors],
    [T.certEventModel, m.eventModel],
  ].filter(([, v]) => v !== undefined && v !== null);
  if (known.length === 0) return "";
  return `<h4 class="subhead">${T.certMethod}</h4>
          <dl class="facts">${known.map(([k, v]) => row(k, esc(String(v)))).join("")}</dl>`;
}

/**
 * Une attestation, rendue pour son porteur.
 *
 * @param {object} record  ce que sert `/api/v1/credentials/{subject}` :
 *                         `{digest, type, receivedAt, document}`
 * @returns {string} du HTML, entièrement échappé
 */
export function renderCertificate(record, disclosures = []) {
  const doc = record?.document ?? record;
  const intensity = doc?.credentialSubject?.carbonIntensity;

  const facts = [
    row(T.certIssuer, esc(String(doc?.issuer ?? "—"))),
    row(T.certReceived, esc(String(record?.receivedAt ?? "—"))),
  ];
  if (intensity?.value !== undefined) {
    facts.push(row(T.certIntensity,
      `${esc(String(intensity.value))} ${esc(String(intensity.unit ?? ""))}`));
  }
  // Le lien vers l'attestation d'origine, par empreinte. Sans lui, n'importe qui
  // pourrait émettre un chiffre carbone pour le même sujet.
  //
  // AU PREMIER NIVEAU, ET NON DANS LE SUJET : c'est là que
  // `buildCarbonCredential` l'écrit, et le chercher au mauvais endroit revenait
  // à ne jamais l'afficher — sans erreur, ce qui est la pire façon de perdre une
  // ligne. Les deux emplacements sont lus, le document faisant foi.
  const from = doc?.derivedFrom ?? doc?.credentialSubject?.derivedFrom;
  if (from?.digestMultibase) {
    facts.push(row(T.certDerivedFrom, `<code>${esc(String(from.digestMultibase))}</code>`));
  }

  return `
    <article class="card">
      <h3>${esc(meaningfulType(doc))}</h3>
      <dl class="facts">${facts.join("")}</dl>
      ${method(doc)}
      ${matrix(doc, disclosures)}
    </article>`;
}

/**
 * Toutes les attestations d'une barre, la plus parlante d'abord.
 *
 * @param {Array<object>} records
 * @param {Record<string, Array>} [disclosuresByDigest] les divulgations que ce
 *        navigateur détient, indexées par l'empreinte de l'attestation. Elles ne
 *        viennent jamais du serveur : elles ne quittent pas le porteur.
 */
export function renderCertificates(records, disclosuresByDigest = {}) {
  if (!Array.isArray(records) || records.length === 0) return "";
  // Celle qui porte une matrice passe devant : c'est celle que la mine n'a pas
  // faite, et donc celle qu'elle a une raison de regarder.
  const ordered = [...records].sort(
    (a, b) => Number(Boolean(b?.document?.credentialSubject?.breakdown))
            - Number(Boolean(a?.document?.credentialSubject?.breakdown)));
  return ordered.map((r) =>
    renderCertificate(r, disclosuresByDigest[r?.digest] ?? r?.disclosures ?? [])).join("");
}
