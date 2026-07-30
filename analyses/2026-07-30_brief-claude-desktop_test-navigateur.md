# Brief pour Claude Desktop — vérification navigateur

*À copier-coller tel quel dans Claude Desktop, qui dispose de Claude for Chrome.
Le brief est autonome : il ne suppose aucune connaissance du projet.*

---

Bonjour. J'ai besoin que tu vérifies dans Chrome une page web que je ne peux pas
ouvrir moi-même : je travaille dans WSL2, sans navigateur. Toi tu en as un.

Un serveur de développement tourne déjà sur **http://localhost:1313**. Il est
lancé depuis WSL2 ; Windows le voit normalement à la même adresse.

C'est une page qui **génère une clé cryptographique et signe des documents**.
Tout se passe dans le navigateur, il n'y a pas de serveur applicatif. Ce que je
veux savoir, c'est si ça fonctionne réellement — pas si le code a l'air correct,
je l'ai déjà relu.

## Trois choses à ne pas faire

1. **Ne modifie aucun fichier.** Si tu vois un défaut, décris-le ; ne le corrige
   pas. Je n'ai pas les mêmes fichiers sous les yeux que toi et une correction
   invisible pour moi serait pire qu'un bug connu.
2. **Ne diagnostique pas.** Rapporte ce que tu observes, littéralement. Si tu
   ajoutes « c'est probablement un problème de CSP », je vais chasser une CSP
   alors que c'était autre chose. Les faits me suffisent, l'analyse est mon
   travail.
3. **Ne résume pas les messages d'erreur.** Recopie-les mot pour mot, y compris
   les URL et les codes. Un message tronqué me fait perdre une heure.

## Les neuf vérifications

Fais-les dans l'ordre. Si l'une échoue, continue quand même les suivantes —
savoir *combien* de choses cassent m'aide à trouver la cause commune.

### 1 — La page se charge

Ouvre `http://localhost:1313/`. Tu dois voir un logo, le titre *Natixar Gold
Trace*, et trois panneaux.

Si la page ne se charge pas du tout, arrête-toi et dis-le : c'est un problème de
réseau entre Windows et WSL2, pas un problème de code, et le reste n'a plus de
sens.

### 2 — La console au chargement

Ouvre les outils de développement (F12), onglet **Console**, puis recharge la
page avec `Ctrl+Shift+R`.

Recopie **tous** les messages, y compris les avertissements. S'il n'y en a
aucun, écris « aucun » — c'est une information en soi.

Je m'intéresse particulièrement à trois familles de messages, sans te
suggérer qu'ils sont présents : ceux qui mentionnent `Content Security Policy`,
ceux qui mentionnent `integrity` ou `Failed to find a valid digest`, et ceux qui
mentionnent `module`.

### 3 — La police est-elle réellement chargée

Onglet **Network**, filtre **Font**, puis recharge. Dis-moi combien de fichiers
`.woff2` sont chargés et avec quel code de statut.

Ensuite, clique sur le titre *Origin attestation* dans la page, va dans
l'onglet **Computed** de l'inspecteur, et donne-moi la valeur de
`font-family` telle qu'elle est calculée.

Attendu : `Inter`. Si tu lis autre chose — `system-ui`, `Times`, `sans-serif` —
dis-le, c'est exactement ce que je cherche à savoir.

### 4 — L'apparence

Prends une **capture d'écran** de la page d'accueil, entière.

Puis, sans chercher à interpréter, dis-moi simplement : le bouton principal
est-il bleu, ou gris/sans couleur ? Les blocs ont-ils des coins arrondis et une
bordure claire, ou sont-ils sans style ?

### 5 — Les auto-tests

Ouvre `http://localhost:1313/selftest/`.

La page exécute une douzaine de contrôles et affiche pour chacun une pastille
`ok` ou `fail`. **Recopie la liste complète**, ligne par ligne, avec le texte
de chaque contrôle et son résultat. S'il y a des échecs, recopie aussi le détail
affiché en dessous.

Donne-moi également le compteur affiché à côté du titre *Results*.

### 6 — L'état de l'environnement

Reviens sur `http://localhost:1313/`. Dans le panneau **Environment**, une
pastille affiche un texte. Recopie-le exactement.

### 7 — Créer la clé

Dans le panneau **Setup**, clique sur **Create the signing key**.

Dis-moi :
- ce qui s'affiche ensuite (un bloc devrait apparaître) ;
- la valeur affichée en face de *Key fingerprint*, recopiée exactement — ce sont
  six groupes de quatre caractères ;
- tout nouveau message dans la console.

### 8 — La clé survit-elle au rechargement

Recharge la page avec `Ctrl+Shift+R`.

Dis-moi ce qu'affiche maintenant la pastille du panneau **Environment**, et si
l'empreinte réapparaît — et si oui, **si c'est la même** que celle notée à
l'étape 7. C'est le point le plus important de tout le test : si l'empreinte
change ou disparaît, la clé n'est pas conservée et rien de ce projet ne
fonctionne.

### 9 — Télécharger le document, et vérifier que la clé privée est bien captive

Clique sur **Download did.json**. Un fichier est téléchargé. Ouvre-le dans un
éditeur de texte et **recopie-le intégralement** — il fait moins de trente
lignes.

Puis, dans la console, colle exactement ceci et donne-moi les deux lignes
qu'il affiche :

```js
const db = await new Promise(r => { const q = indexedDB.open("natixar-gold-trace", 1); q.onsuccess = () => r(q.result); });
const pair = await new Promise(r => { const t = db.transaction("keys").objectStore("keys").get("signing"); t.onsuccess = () => r(t.result); });
console.log("extractable =", pair.privateKey.extractable);
console.log(await crypto.subtle.exportKey("jwk", pair.privateKey).then(() => "EXPORT REUSSI").catch(e => "export refuse : " + e.name));
```

Attendu : `extractable = false`, puis `export refuse : InvalidAccessError`.

Si tu lis `EXPORT REUSSI`, c'est un défaut grave et je veux le savoir en
priorité : cela signifierait que la clé privée de la mine peut être extraite du
navigateur.

## Le format du compte rendu

Réponds en reprenant cette structure, une section par vérification. Pas de
préambule, pas de conclusion générale.

```
### 1 — La page se charge
Résultat : OK | ÉCHEC | NON TESTÉ
Observé  : …
Console  : … (verbatim, ou « aucun »)

### 2 — La console au chargement
…
```

Trois règles pour le compte rendu :

- **Verbatim plutôt que résumé** partout où il s'agit d'un texte affiché par la
  machine : messages de console, empreinte, contenu du fichier, libellés des
  auto-tests.
- **« Je ne sais pas » est une réponse valable.** Si une étape est ambiguë ou si
  tu n'as pas réussi à faire quelque chose, écris-le plutôt que d'approximer.
  Une observation fausse me coûte plus cher qu'une observation manquante.
- Termine par une section **« Ce qui m'a surpris »**, libre, où tu notes tout ce
  que tu as remarqué et que je n'ai pas demandé. C'est souvent là que se trouve
  l'information la plus utile.

## Si tu manques de temps

Par ordre décroissant d'importance : **9** (la clé privée est-elle captive),
**8** (la clé survit-elle au rechargement), **5** (les auto-tests), **2** (la
console), **3** (la police). Les autres peuvent attendre.
