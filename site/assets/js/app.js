// Point d'entrée. Volontairement sans dépendance : cette page signe, donc
// chaque octet de code exécuté doit être vérifiable. WebCrypto est natif,
// il n'y a rien à importer.
//
// À ce stade, seule la structure est posée. La génération de clé et la
// signature arrivent avec l'issue H1 correspondante.

const KEY_STORE = "natixar-gold-trace";

export async function keyStatus() {
  if (!globalThis.crypto?.subtle) {
    return { ok: false, reason: "WebCrypto indisponible — navigateur trop ancien ou page non servie en HTTPS" };
  }
  return { ok: true, store: KEY_STORE };
}

document.addEventListener("DOMContentLoaded", async () => {
  const el = document.querySelector("[data-key-status]");
  if (!el) return;
  const s = await keyStatus();
  el.textContent = s.ok ? "Environnement compatible" : s.reason;
  el.className = "badge " + (s.ok ? "badge--verified" : "badge--warning");
});
