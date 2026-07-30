# site/ — Natixar Gold Trace

Pages H1 : signature d'une attestation d'origine par la mine, et vérification
publique. Générées par **Hugo** (v0.164 extended requis, pour libwebp).

```bash
hugo server -D     # développement, rechargement à chaud
hugo               # production -> public/
```

## Pourquoi un générateur plutôt que du HTML écrit à la main

Ces pages n'ont pas de serveur : tout se joue côté client. La tentation serait
donc d'écrire trois fichiers à la main. Trois raisons de ne pas le faire.

**Les dérivés d'images.** Le logo source fait 4168×614 en PNG, 65 Ko. Hugo en
produit trois WebP — 220, 440 et 660 px — soit 3,3 / 8,0 / 12,4 Ko, et
construit le `srcset`. Personne ne sert 65 Ko à un téléphone, et personne
n'a à redimensionner quoi que ce soit à la main quand le logo change.

**L'intégrité.** `fingerprint "sha384"` produit l'empreinte SRI et le nom de
fichier versionné en une opération. Le HTML porte
`integrity="sha384-…"` sur la feuille de style et sur le module. C'est
essentiel ici : **cette page signe.** Si son JavaScript est altéré, la
signature couvre autre chose que ce que l'opérateur croit approuver, tout en
restant cryptographiquement valide. La CSP interdit par ailleurs toute origine
externe (`default-src 'none'`).

**La structure.** Les écrans vivent dans `layouts/_partials/`, les libellés
dans `hugo.toml`, le texte dans `content/`. Un rédacteur modifie une phrase
sans ouvrir de balisage ; un développeur change un panneau sans toucher au
texte.

## Organisation

| | |
|---|---|
| `assets/css/tokens.css` | jetons relevés sur la maquette publiée — **ne pas inventer de valeur ici** |
| `assets/css/main.css` | mise en page, importe les jetons |
| `assets/js/app.js` | module ES, **sans aucune dépendance** — WebCrypto est natif |
| `assets/img/` | logos source en PNG ; Hugo produit les WebP |
| `layouts/_partials/logo.html` | logo responsive, un seul endroit à changer |
| `layouts/_partials/panel-*.html` | un panneau d'écran par fichier |
| `hugo.toml` | libellés et ordre des champs d'un lingot |

## Ce qui manque

- **Les fontes.** DM Sans et Inter, sous licence SIL OFL, doivent être déposées
  en `.woff2` dans `assets/fonts/` et le bloc `@font-face` de `main.css`
  décommenté. Elles ne doivent **pas** être appelées chez un tiers : la règle
  d'intégrité ci-dessus vaut aussi pour elles. En attendant, la pile système
  prend le relais.
- La logique de signature elle-même : génération de clé ECDSA P-256 non
  exportable, stockage de la poignée en IndexedDB, sérialisation canonique,
  émission de l'attestation.
- La page de vérification.
