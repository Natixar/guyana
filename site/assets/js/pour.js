// La coulée en attente de confirmation.
//
// Chaque champ porte son ORIGINE — mesurée, dérivée, estimée, non mesurée —
// conformément à la décision de modèle de l'issue #46. Ce n'est pas une
// décoration : un opérateur qui confirme doit voir ce qu'il atteste, et une
// valeur estimée ne s'atteste pas de la même façon qu'une valeur mesurée.

export async function fetchPour() {
  try {
    const r = await fetch("/api/v1/pour", { credentials: "same-origin" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function row(field, key) {
  const div = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = field.label ?? key;
  const dd = document.createElement("dd");
  dd.textContent = field.value ?? "—";
  dd.dataset.field = key;
  if (field.origin && field.origin !== "MEASURED") {
    const tag = document.createElement("span");
    tag.className = "origin-tag";
    tag.textContent = field.origin.toLowerCase();
    dd.append(" ", tag);
  }
  div.append(dt, dd);
  return div;
}

/**
 * Rend les deux blocs séparément, parce que ce sont deux attestations
 * distinctes signées par deux émetteurs différents. L'opérateur doit voir
 * exactement ce qu'il engage : les faits physiques qu'il observe, et rien
 * d'autre. L'intensité carbone est affichée à côté, mais explicitement comme
 * n'étant pas de son ressort.
 */
export function renderPour(pour, root = document) {
  if (!pour) return false;
  const own = root.querySelector("[data-operator-facts]");
  const calc = root.querySelector("[data-calculator-facts]");
  if (own) for (const [k, f] of Object.entries(pour.attestedByOperator ?? {})) own.append(row(f, k));
  if (calc) {
    const c = pour.computedByCalculator ?? {};
    for (const [k, f] of Object.entries(c)) {
      if (f && typeof f === "object" && "value" in f) calc.append(row(f, k));
    }
  }
  return true;
}

/** Les seules revendications que l'opérateur signe : ce qu'il observe. */
export const operatorClaims = (pour) =>
  Object.fromEntries(
    Object.entries(pour.attestedByOperator ?? {})
      .map(([k, f]) => [k, { value: f.value, origin: f.origin }])
  );
