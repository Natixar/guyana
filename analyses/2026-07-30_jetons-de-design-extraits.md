# Jetons de design — extraits de la maquette publiée

*30 juillet 2026. Source : `https://video-snort-80174231.figma.site/`, feuille de style
`/_components/v2/6efa729e7a5aa3c8bc5ccce5116c670e77266f75.css` (167 Ko).*

Le site publié porte l'intégralité du système de design sous forme de propriétés CSS
personnalisées. **Aucun accès Figma n'est nécessaire** — ni MCP, ni jeton, ni export
manuel. Les valeurs ci-dessous sont relevées, pas interprétées.

---

## Typographie

| | |
|---|---|
| Titres | `"DM Sans", sans-serif` |
| Corps | `"Inter", sans-serif` |
| Monospace | pile système (`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas…`) |
| Taille de base | **15 px** |
| Graisses | 300 · 400 · 500 · 600 · 700 |

DM Sans et Inter sont toutes deux sous licence SIL Open Font — utilisables sur le web
sans restriction, et auto-hébergeables. C'est important : la page de signature ne doit
charger **aucune ressource externe** (§ sur la chaîne d'approvisionnement), donc les
deux fontes seront embarquées dans l'image, pas appelées chez Google Fonts.

## Marque

| Jeton | Valeur |
|---|---|
| `--primary` | `#2563eb` *(voir ambiguïté ci-dessous)* |
| `--primary-hover` | `#2563eb` |
| `--primary-light` | `#dbeafe` |
| `--primary-foreground` | `#ffffff` |
| `--accent` | `#0ea5e9` |
| `--accent-foreground` | `#ffffff` |
| `--ring` | `#2563eb` |

## Chrome — jetons manqués à la première extraction

Je les avais écartés en les prenant pour des couleurs accessoires. C'est une
erreur : ils décrivent l'en-tête bleu de la marque, et c'est la surface à
laquelle le `logo-white.png` est destiné.

| Jeton | Valeur |
|---|---|
| `--header-gradient-start` | `#3b6ba5` |
| `--header-gradient-end` | `#2c5282` |
| `--header-blue` | `#2c5282` |

Le corps de page, lui, **reste clair** (`#f7f9fc`) dans la maquette : les cartes
blanches et les pastilles de statut y gardent leur contraste. Un fond de page
entièrement bleu s'écarterait du modèle et rendrait cette page moins assortie
aux autres applications, pas plus.

## Neutres

| Jeton | Valeur |
|---|---|
| `--background` | `#f7f9fc` |
| `--background-secondary` | `#ffffff` |
| `--background-tertiary` | `#eff3f8` |
| `--card` | `#ffffff` |
| `--foreground` | `#0f172a` *(voir ambiguïté)* |
| `--muted` | `#f8f9fb` |
| `--muted-foreground` | `#64748b` |
| `--secondary` | `#f1f3f6` |
| `--border` | `#e2e8f0` |
| `--border-light` | `#f1f5f9` |
| `--input` / `--input-background` | `#ffffff` |
| `--input-border` | `#d1d5db` |

## Sémantique — et c'est la découverte utile

La maquette porte déjà un vocabulaire visuel de **statut de vérification**, exactement
ce dont les pages de signature et de vérification ont besoin :

| Jeton | Valeur | Usage évident |
|---|---|---|
| `--status-verified` | `#10b981` | attestation vérifiée |
| `--status-pending` | `#f59e0b` | en attente |
| `--status-info` | `#0ea5e9` | information |
| `--status-warning` | `#ef4444` | anomalie |
| `--destructive` | `#ef4444` | action destructrice |
| `--co2-accent` | `#10b981` | grandeurs carbone |

Il n'y a donc pas de langage visuel à inventer : il existe, et il faut le suivre.

## Graphiques

`--chart-1` … `--chart-6` : `#2563eb` · `#0ea5e9` · `#10b981` · `#f59e0b` · `#8b5cf6` · `#ec4899`

Réutilisable tel quel pour la carte de chaleur (#49) et le tableau de bord (#50).

## Rayons

`--radius-xs: .125rem` · `--radius: .5rem` · `--radius-2xl: 1rem`

---

## Une ambiguïté à faire trancher

Deux jetons sont déclarés **deux fois avec des valeurs différentes**, ce qui indique
deux portées de thème dans la feuille :

| Jeton | Valeur A | Valeur B |
|---|---|---|
| `--primary` | `#3b82f6` | `#2563eb` |
| `--foreground` | `#0f172a` | `#1a2b3c` |
| `--card-foreground` | `#0f172a` | `#1a2b3c` |

`#3b82f6` est la couleur brute la plus fréquente de la feuille (30 occurrences),
mais `#2563eb` est celle qui sert aussi de `--primary-hover` et de `--ring`. Je retiens
**`#2563eb` comme primaire** et `#3b82f6` comme variante claire, ce qui est la
combinaison la plus cohérente — **à confirmer par Svetlana**, c'est une question de
trente secondes et la seule qu'elle ait à trancher.

---

## Bloc prêt à l'emploi

```css
:root {
  /* typographie — fontes auto-hébergées, aucune ressource externe */
  --font-heading: "DM Sans", sans-serif;
  --font-body: "Inter", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-size: 15px;

  /* marque */
  --primary: #2563eb;
  --primary-light: #3b82f6;
  --primary-soft: #dbeafe;
  --primary-foreground: #fff;
  --accent: #0ea5e9;
  --accent-foreground: #fff;
  --ring: #2563eb;

  /* neutres */
  --background: #f7f9fc;
  --background-secondary: #fff;
  --background-tertiary: #eff3f8;
  --card: #fff;
  --foreground: #0f172a;
  --muted: #f8f9fb;
  --muted-foreground: #64748b;
  --secondary: #f1f3f6;
  --border: #e2e8f0;
  --border-light: #f1f5f9;
  --input: #fff;
  --input-border: #d1d5db;

  /* statuts */
  --status-verified: #10b981;
  --status-pending: #f59e0b;
  --status-info: #0ea5e9;
  --status-warning: #ef4444;
  --destructive: #ef4444;
  --co2-accent: #10b981;

  /* graphiques */
  --chart-1: #2563eb; --chart-2: #0ea5e9; --chart-3: #10b981;
  --chart-4: #f59e0b; --chart-5: #8b5cf6; --chart-6: #ec4899;

  /* rayons */
  --radius-xs: .125rem;
  --radius: .5rem;
  --radius-2xl: 1rem;
}
```

---

## Ce qui manque encore

- **Le logo**, en SVG. Non extractible de la feuille de style ; c'est le seul élément
  qu'il faut réellement demander.
- **Le nom de plateforme** tel qu'il doit s'afficher.
- L'arbitrage sur `--primary`.

Rien d'autre. La demande à Svetlana passe de cinq éléments à deux, plus une
confirmation.

## Destination

Ce fichier appartiendra au CI des bundles front (B2.x du plan de déploiement) dès
qu'un dépôt applicatif existera. En attendant, il vit ici et alimente directement la
page de signature H1, la page de vérification, puis le tableau de bord #50.
