/**
 * Le menu, déduit des droits que le service déclare.
 *
 * CE MENU NE PROTÈGE RIEN, et il ne prétend pas le faire. Une page en
 * JavaScript se lit, un lien se devine, et `curl` ne consulte pas les menus.
 * Le refus vit dans le magasin — `ROLES` dans `services/store/app.py` — et ces
 * cas sont couverts par des tests qui interrogent le service, pas l'écran.
 *
 * Ce que le menu fait, c'est ne pas proposer ce qui serait refusé. C'est une
 * question d'égards, pas de sécurité : un vérificateur indépendant qui clique
 * sur « Production » et reçoit un 403 apprend qu'il existe une page qu'on lui
 * cache, ce qui est exactement ce qu'on voulait éviter en la lui cachant.
 *
 * La liste des droits vient de `/api/v1/me`, une seule source. Recopier ici la
 * table des rôles ferait deux vérités qui divergeraient au premier changement.
 */
import T from "./labels.js";

/**
 * Les destinations, et le droit que chacune suppose.
 *
 * `null` signifie « sans condition » : la page de vérification n'appelle aucune
 * de nos API — clé publique depuis le domaine de l'émetteur, signature,
 * recalcul — donc rien ne justifierait de la restreindre.
 */
const DESTINATIONS = [
  { href: "/", label: () => T.navHome, grant: "credentials" },
  { href: "/register/", label: () => T.navProduction, grant: "credentials" },
  { href: "/quality/", label: () => T.navQuality, grant: "counts" },
  { href: "/selftest/", label: () => T.navSelftest, grant: "credentials" },
  { href: "/verify/", label: () => T.navVerify, grant: null },
];

export async function renderNav() {
  const slot = document.querySelector("[data-nav]");
  if (!slot) return;

  let me = null;
  try {
    const r = await fetch("/api/v1/me", { headers: { accept: "application/json" } });
    if (r.ok && (r.headers.get("content-type") ?? "").includes("json")) me = await r.json();
  } catch { /* hors ligne : on retombe sur le minimum */ }

  const grants = new Set(me?.grants ?? []);
  const here = location.pathname.replace(/\/+$/, "") || "/";

  const links = DESTINATIONS
    .filter((d) => d.grant === null || grants.has(d.grant))
    .map((d) => {
      const path = d.href.replace(/\/+$/, "") || "/";
      const current = path === here ? ' aria-current="page"' : "";
      return `<a href="${d.href}"${current}>${d.label()}</a>`;
    });

  slot.innerHTML = links.join("");

  renderIdentity(me);
}

/**
 * QUI EST CONNECTÉ — dans le bandeau, sur toutes les pages, en permanence.
 *
 * LE DÉFAUT. L'information existait : `/api/v1/me` la donne, le menu l'appelle
 * déjà, et le gabarit portait un emplacement. Mais elle s'affichait en un mot
 * gris, à 70 % d'opacité, au bout d'un bandeau en dégradé — invisible en
 * pratique. En revenant sur une page on ne pouvait pas dire si l'on était
 * anonyme, sous le compte de la mine, ou sous celui de la plateforme.
 *
 * Les conséquences n'étaient pas cosmétiques : les trois états ne permettent
 * pas les mêmes actions, et un refus légitime — « ce compte n'appartient à
 * aucune organisation émettrice » — se lit comme une panne quand rien à
 * l'écran ne rappelle sous quel compte on se trouve.
 *
 * L'ORGANISATION EST AFFICHÉE, ET PAS SEULEMENT LA PERSONNE. C'est elle qui
 * gouverne : signer l'origine d'un lingot suppose d'appartenir à la mine. Un
 * nom d'utilisateur seul ne dit pas si l'on peut agir ; le couple le dit.
 *
 * Trois états, trois pastilles, parce que trois est le nombre de situations
 * réelles — et que la première, l'anonyme, est celle du vérificateur sur la
 * page publique : elle doit se voir aussi, c'est même ce qu'elle démontre.
 */
export function renderIdentity(me, root = document) {
  const who = root.querySelector("[data-nav-user]");
  if (!who) return null;

  const person = me?.person?.name ?? me?.person?.id ?? null;
  const org = me?.organisation?.name ?? null;

  const [state, text] =
    !me?.authenticated ? ["anonymous", T.navNotSignedIn]
    : org              ? ["issuer", `${T.signedInAs} ${person} · ${org}`]
    // Authentifié mais sans organisation émettrice : l'exploitant de la
    // plateforme, un vérificateur muni d'un compte. Ce n'est pas une anomalie,
    // et le dire ici évite de le découvrir en cliquant sur un bouton inerte.
    :                    ["no-org", `${T.signedInAs} ${person} · ${T.navNoOrganisation}`];

  who.textContent = text;
  who.dataset.state = state;
  who.hidden = false;
  return state;
}

document.addEventListener("DOMContentLoaded", renderNav);
