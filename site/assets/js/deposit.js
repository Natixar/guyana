/**
 * Déposer une attestation au magasin.
 *
 * LE DÉPÔT N'EST PAS LA CONSERVATION. Le portefeuille du navigateur détient
 * l'attestation ; le magasin en garde une copie pour que la barre reste
 * retrouvable après une réinitialisation, et pour que le registre puisse dire
 * « certifiée ailleurs » plutôt que de mentir. L'ordre est donc imposé : on
 * range d'abord, on dépose ensuite. Un dépôt réussi suivi d'un rangement échoué
 * laisserait l'opérateur croire qu'il ne détient rien alors que le magasin le
 * contredit.
 *
 * UN ÉCHEC DE DÉPÔT N'EST PAS UN ÉCHEC DE SIGNATURE. La signature a eu lieu
 * dans le navigateur, avec une clé qui n'en sort pas ; le magasin est
 * joignable ou il ne l'est pas, et cela ne retire rien à ce qui est signé. La
 * fonction rend donc un compte rendu et ne lève pas.
 */

/**
 * @param {object} doc l'attestation signée, telle quelle
 * @returns {Promise<{ok: boolean, why: string}>}
 */
export async function depositCredential(doc) {
  let res;
  try {
    res = await fetch("/api/v1/credentials", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      // Sérialisé tel quel : le document est signé, donc figé. Le reformater —
      // même pour l'embellir — l'invaliderait. Même règle qu'en base.
      body: JSON.stringify(doc),
    });
  } catch (err) {
    return { ok: false, why: err.message ?? String(err) };
  }

  // Le site répond 200 avec sa page d'accueil pour tout chemin inconnu : sans
  // ce contrôle, un magasin non routé passerait pour un dépôt réussi.
  const type = res.headers.get("content-type") ?? "";
  if (res.status === 201 && type.includes("json")) return { ok: true, why: "" };
  if (!type.includes("json")) return { ok: false, why: `HTTP ${res.status} — routage ?` };

  const body = await res.json().catch(() => null);
  const detail = body?.detail?.detail ?? body?.detail ?? body?.error ?? "";
  return { ok: false, why: `HTTP ${res.status}${detail ? ` — ${detail}` : ""}` };
}
