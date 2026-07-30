// La coulée en attente de confirmation.
//
// Chaque champ porte son ORIGINE — mesurée, dérivée, estimée, non mesurée —
// conformément à la décision de modèle de l'issue #46. Ce n'est pas une
// décoration : un opérateur qui confirme doit voir ce qu'il atteste, et une
// valeur estimée ne s'atteste pas de la même façon qu'une valeur mesurée.

export async function fetchPour() {
  try {
    const r = await fetch("/api/pour", { credentials: "same-origin" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Remplit le panneau et rend visible l'origine de chaque valeur. */
export function renderPour(pour, root = document) {
  if (!pour) return false;
  for (const [key, field] of Object.entries(pour.fields ?? {})) {
    const cell = root.querySelector(`[data-field="${key}"]`);
    if (!cell) continue;
    cell.textContent = field.value ?? "—";
    if (field.origin && field.origin !== "MEASURED") {
      const tag = document.createElement("span");
      tag.className = "origin-tag";
      tag.textContent = field.origin.toLowerCase();
      cell.append(" ", tag);
    }
  }
  return true;
}

/** Les revendications signées : les valeurs, et l'origine de chacune. */
export const claimsOf = (pour) =>
  Object.fromEntries(
    Object.entries(pour.fields ?? {}).map(([k, f]) => [k, { value: f.value, origin: f.origin }])
  );
