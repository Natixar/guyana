# services/ — le back-office, en deux processus qui ne se font pas confiance

> **La clé de signature et les données ne se rencontrent jamais dans un même
> processus.**

C'est l'invariant fondateur de ce répertoire, et la raison pour laquelle il y a
deux services au lieu d'un. Compromettre le signataire donne une clé qui ne peut
attester que ce qu'elle voit déjà ; compromettre le magasin donne des données
que personne ne peut attester.

Décidé le 31 juillet 2026, issue #66.

## Les deux services

| | `signer` | `store` |
|---|---|---|
| Rôle | reçoit, recalcule, **signe** | conserve le cube et les index, **ne signe rien** |
| Exécution | Node / Express | libre — Python convient |
| Détient | la clé de signature de Natixar | la base de données |
| Ne détient pas | **aucune route vers PostgreSQL** | aucune clé de signature |
| Routage | Traefik, par préfixe de chemin | réseau Docker uniquement |

PostgreSQL est un troisième conteneur, image épinglée par digest, état dans un
**volume nommé**, joignable sur le réseau Docker et jamais routé par Traefik.
Cela découle des invariants de `deploy/` — le contenu vit dans l'image, l'état
dans un volume nommé — et non d'une préférence.

## Pourquoi le signataire n'a pas la base

Signer, c'est affirmer une vérité. Pour une agrégation linéaire il n'existe pas
de raccourci de vérification : contrôler un résultat coûte ce que le calculer
coûte. Le signataire recalcule donc avant de signer.

Mais il recalcule à partir de la charge que le client lui envoie, et rien dans
cette charge ne se distingue d'une invention. D'où le troisième mécanisme :

> **Le magasin signe ses propres extractions.** Chaque réponse `/ranges` porte
> une signature faite avec la clé du magasin. Le client la transmet telle
> quelle. Le signataire la vérifie avec la clé publique correspondante — et ne
> touche toujours pas à la base.

Asymétrique, jamais un HMAC : un secret partagé remettrait une clé capable de
signer dans les deux processus, et défairait l'invariant du haut de page.

Deux propriétés viennent avec, sans coût supplémentaire :

- **la couche 2 de la complétude** — *la livraison couvre l'enveloppe* —
  devient vérifiable par le signataire, puisque l'attestation d'extraction
  nomme ce qui a été servi ;
- les privilèges du signataire restent minimaux : une clé de signature à lui,
  une clé de vérification qui appartient à quelqu'un d'autre.

## Un moteur, deux hôtes

L'exploration — cartes de chaleur, descentes, curseurs — appartient entièrement
au navigateur : elle se produit des milliers de fois par session et n'a aucune
raison de charger nos machines. La signature se produit **une fois par
attestation**. Ce sont deux chemins, et l'argument de charge ne porte que sur le
premier.

Le même moteur sert les deux, et c'est le seul moyen de prouver que la page de
vérification et le back-office sont d'accord.

### Comment on prouve qu'il s'agit du même moteur

L'égalité d'octets ne tiendra pas : Hugo et esbuild minifient la copie du
navigateur et y injectent la table de libellés. Ce qui tient :

1. **Un seul fichier source**, `site/assets/js/engine.js`, importé par la page
   et copié tel quel dans l'image du signataire ;
2. **Un jeu de vecteurs partagé**, `site/static/engine/vectors.json`, exécuté
   des deux côtés — la page d'auto-test le fait dans le navigateur, la suite du
   signataire le fait dans Node.

Le second est la vraie garantie. Si les deux hôtes s'accordent sur les vecteurs,
ils s'accordent en pratique, et une divergence casse une construction au lieu de
produire une attestation que personne ne sait reproduire.

Le fichier de vecteurs est servi à `/engine/vectors.json` pour le navigateur et
lu directement dans le dépôt par le signataire : une source, deux lecteurs,
aucune étape de construction pour les désynchroniser.

## La sérialisation se duplique, la sémantique jamais

Le magasin est en Python et signe ce qu'il sert ; le signataire est en Node et
vérifie cette signature. Ce qui est signé, ce sont des octets — donc RFC 8785
existe deux fois dans ce dépôt.

C'est un arbitrage assumé, et la règle qui le gouverne mérite d'être écrite :

> **On duplique la sérialisation, jamais la sémantique.** Cent vingt lignes de
> JCS écrites deux fois se tiennent par des vecteurs partagés. Le moteur écrit
> deux fois ne se tiendrait par rien.

### L'alternative écartée : un proxy Node devant le magasin

Elle vaut mieux que son sort ici, et elle reviendra. Un conteneur Node placé
devant le service Python sérialiserait et signerait en JavaScript ; JCS
n'existerait qu'une fois. Ce n'est pas cher — nous ne sommes pas à un conteneur
près — et c'était probablement le chemin le plus court.

Ce qu'elle échange :

- **Elle ne supprime pas le risque, elle le déplace.** Python produirait la
  structure, Node la sérialiserait, et entre les deux passe un aller-retour
  JSON. Les flottants IEEE 754 y survivent exactement, mais un entier au-delà
  de 2^53 perdrait sa précision en silence côté JavaScript, et un `NUMERIC`
  PostgreSQL arrive en `Decimal` — chaîne ou flottant, et le choix compte.
  « Deux sérialiseurs doivent s'accorder » devient « un sérialiseur doit
  recevoir exactement ce que l'autre voulait dire » : plus étroit et mieux
  balisé, pas nul.
- **Elle ajoute un saut sur le chemin de lecture**, celui-là même qui doit
  rester rapide et streamable. Un proxy qui doit analyser toute la charge pour
  la re-sérialiser double la mémoire et interdit le streaming. Négligeable en
  H1, réel à l'échelle H3.
- **Elle rend le magasin incapable de signer seul.** Les vecteurs partagés, eux,
  sont devenus un actif de spécification : le jour où un SDK client apparaît
  dans un troisième langage, il a de quoi se conformer.

**À revisiter** si le magasin doit signer autre chose que des extractions, ou si
un troisième langage apparaît côté serveur. À ce moment-là le proxy redevient le
bon choix, et il vaut mieux que la raison soit écrite que redécouverte.

## Admissible, et non « bien formée »

Tout ce qu'un client sait exprimer, Natixar l'attestera. La grammaire de requête
est donc une surface de politique et non un contrôle de syntaxe : quelles
agrégations sont signables, sur quels périmètres, sous quelle méthode et quelle
version de taxonomie.

En H1 l'ensemble admissible est minuscule — une coulée, un lingot — et il est
**énuméré**. Une requête hors de cet ensemble est refusée avec une raison
énoncée, jamais signée.

## Ce que le signataire vérifie avant de signer

Dans cet ordre, et un échec à n'importe quel rang refuse la signature :

1. la requête appartient à l'ensemble admissible ;
2. l'extraction est signée par le magasin, et la signature se vérifie ;
3. **chaque enregistrement servi est justifié** — employé dans le calcul, ou
   référencé avec une raison de ne pas l'avoir employé. La raison voyage dans
   l'attestation, où un vérificateur peut la juger ;
4. le recalcul du moteur redonne le chiffre présenté.

Le point 3 est la couche 3 de l'argument de complétude d'#6. C'est un contrôle
de **couverture** et non de sémantique : le signataire n'a pas à comprendre
pourquoi une cellule est écartée, seulement que le client s'est engagé sur une
raison.

## Ce que ce répertoire n'a délibérément pas

- **Pas d'authentification applicative.** Traefik authentifie par `basicAuth` et
  transmet l'utilisateur ; le service traduit l'en-tête en identité. FusionAuth
  et le cadre d'autorisation sont H2, issues #2, #3 et #39.
- **Pas de chiffrement au repos.** La décision D1 d'#6 n'est pas prise, et le
  schéma en dépend. H1 stocke en clair et le dit.
- **Pas d'ancrage, pas de multiscale, pas de `/ranges` incrémental.** H2 et H3.
