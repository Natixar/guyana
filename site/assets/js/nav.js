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

  const who = document.querySelector("[data-nav-user]");
  if (who) {
    who.textContent = me?.authenticated ? me.person.name : T.vNotIdentified;
  }
}

document.addEventListener("DOMContentLoaded", renderNav);
