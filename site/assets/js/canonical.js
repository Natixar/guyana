// Sérialisation canonique JSON — RFC 8785 (JCS).
//
// C'est la pièce qu'il ne faut pas rater : ce qui est signé, ce sont des
// octets. Si deux implémentations sérialisent le même objet différemment, la
// signature ne se vérifie pas. Et un historique déjà signé ne se re-sérialise
// pas : une erreur ici devient permanente.
//
// RFC 8785 impose : clés triées par unités de code UTF-16, aucun espace
// insignifiant, nombres au format ECMAScript, échappement JSON minimal.
// JSON.stringify respecte déjà l'échappement et le format des nombres ; il
// reste à trier les clés et à interdire ce que la RFC exclut.

export function canonicalize(value) {
  return serialize(value);
}

function serialize(v) {
  if (v === null) return "null";

  const t = typeof v;

  if (t === "boolean") return v ? "true" : "false";

  if (t === "number") {
    // RFC 8785 §3.2.2.3 : NaN et les infinis n'ont pas de représentation.
    if (!Number.isFinite(v)) throw new TypeError("nombre non sérialisable : " + v);
    return JSON.stringify(v);
  }

  if (t === "string") return JSON.stringify(v);

  if (Array.isArray(v)) {
    return "[" + v.map(serialize).join(",") + "]";
  }

  if (t === "object") {
    // undefined en valeur d'objet est écarté par JSON ; on refuse plutôt que
    // de laisser disparaître silencieusement un champ d'une attestation.
    const keys = Object.keys(v).filter((k) => {
      if (v[k] === undefined) throw new TypeError("valeur undefined pour la clé « " + k + " »");
      return true;
    });
    // Tri par unités de code UTF-16, ce que fait déjà la comparaison < de JS.
    keys.sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + serialize(v[k])).join(",") + "}";
  }

  throw new TypeError("type non sérialisable : " + t);
}

export function canonicalBytes(value) {
  return new TextEncoder().encode(canonicalize(value));
}
