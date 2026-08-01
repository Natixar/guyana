# Dossier FIDES — partie technique

**Pour Svetlana Cranga · Catégorie visée : Innovation Award 2026 · Date limite de publication : 20 août 2026**

*Préparé par Claude, relu et validé par Jean-Marc. Ce document est votre matière première : les blocs en anglais sont à copier tels quels dans l'Ecosystem Explorer, le reste est là pour que vous puissiez défendre le dossier sans nous.*

---

## ⛔ Condition préalable — à régler avant toute publication

Le paquet de données AGM porte la mention : *« All content is Confidential Information under Clause 9 of the Collaboration Agreement »*.

**Publier une fiche qui nomme AGM Inc., la mine Aurora, Zijin, ou qui cite des chiffres de production ou de consommation est une divulgation.** Il faut l'accord écrit d'AGM avant publication — pas un accord oral, pas un accord implicite parce qu'ils sont contents du projet.

Deux versions du dossier sont donc préparées ci-dessous :

- **Version A — nommée.** Meilleur dossier, nécessite l'accord écrit d'AGM.
- **Version B — anonymisée.** « A gold mining operation in South America ». Publiable sans accord, moins convaincante mais parfaitement recevable : plusieurs fiches du catalogue FIDES ne nomment pas leur client final.

Si l'accord n'est pas obtenu **avant le 8 août**, on publie la version B. Ne pas attendre le 19 : les autres candidats rassemblent déjà des voix.

---

## 1. Ce que nous soumettons, en une phrase

> Chaque lingot de doré coulé à la mine reçoit une attestation numérique vérifiable qui porte à la fois **son origine physique** et **son intensité carbone calculée**, de sorte qu'un acheteur ou un auditeur puisse la vérifier lui-même, sans nous appeler et sans avoir à nous faire confiance.

Si vous ne deviez retenir qu'une chose pour répondre au jury, c'est la fin de la phrase : **sans avoir à nous faire confiance.** C'est ce qui distingue une attestation vérifiable d'un simple certificat PDF ou d'un lien vers notre plateforme.

---

## 2. Pourquoi c'est innovant — les cinq arguments, dans l'ordre

Le jury Innovation évalue : originalité de l'approche, application inédite de la technologie, innovation d'écosystème, potentiel de nouveaux cas d'usage, modèles économiques et de gouvernance innovants. Voici nos cinq arguments, alignés sur ces critères.

**1. Nous sommes en amont de tout le catalogue.** Les 24 cas d'usage publiés traitent de produits finis ou de services : textile, batteries de bus, location de voiture, livraison de repas, identité citoyenne. **Aucun ne traite d'une matière première à son point d'extraction.** Un passeport produit numérique de batterie commence là où notre chaîne s'arrête. Nous attestons la première étape, celle dont tout le reste hérite.

**2. Nous attestons une valeur *calculée*, pas un fait déclaré.** Toutes les attestations du catalogue portent des faits statiques : cette personne a plus de 18 ans, ce diplôme existe, cette société est enregistrée. Une intensité carbone n'est pas un fait, c'est le **résultat d'un calcul** — donc l'attestation doit porter la méthode et la version des facteurs d'émission employés, faute de quoi elle est invérifiable dans cinq ans. C'est un problème techniquement différent, et personne dans le catalogue ne l'a résolu.

**3. Deux émetteurs, deux bases de confiance, dans une même chaîne.** La mine atteste ce qu'elle observe — le lingot existe, il pèse tant, il titre tant, il a été coulé tel jour. Nous attestons ce que nous calculons — l'intensité carbone, avec sa méthode. **Nous ne signons pas le poids d'un lingot que nous n'avons jamais vu, et la mine ne signe pas un calcul qu'elle n'a pas fait.** Le vérificateur contrôle les deux signatures séparément. C'est honnête, et c'est rare.

**4. La minimisation des données est ici une exigence commerciale, pas réglementaire.** Dans la plupart des cas d'usage du catalogue, on protège des données personnelles parce que la loi l'impose. Ici, les prix, les contreparties et les volumes doivent rester invisibles parce que **les révéler détruirait la position commerciale du vendeur**. La divulgation maîtrisée n'est pas une case de conformité, c'est la condition sans laquelle la mine ne participe pas du tout.

**5. Vérifiable sans l'opérateur de la plateforme.** Une chaîne d'approvisionnement de métaux met en présence des acteurs qui sont concurrents entre eux. Un système où il faut appeler l'intermédiaire pour vérifier une affirmation est un système où l'intermédiaire sait tout. Notre attestation se vérifie contre la clé publique de son émetteur : nous pouvons refuser l'accès, nous ne pouvons pas mentir.

---

## 3. Les blocs à copier dans le formulaire

La fiche FIDES suit cette structure : **Title · Summary · Problem · Solution · Sector · Country · Theme · Status · Organisations · Credentials Used · Standards Applied · Wallet types · Benefits · Links.** La plateforme est anglophone : le texte ci-dessous est prêt à coller.

### Title

```
Gold Origin and Carbon Credential: verifiable provenance and carbon
intensity for doré bars, from mine to refinery
```

### Summary *(1–2 phrases)*

```
Every doré bar poured at the mine receives a verifiable credential
carrying both its physical provenance and its computed cradle-to-gate
carbon intensity. Buyers, refiners and auditors verify it against the
issuers' published keys, without calling the platform and without
having to trust it.
```

### Problem *(50–100 mots)*

```
Gold reaches refineries and buyers with its origin documented on paper
and its carbon footprint documented, at best, in an annual sustainability
report covering a whole site for a whole year. Neither travels with the
metal. A buyer wanting to know the carbon intensity of the specific bars
they purchased has no way to obtain it, and no way to check any figure
they are given.

Meanwhile the mine cannot simply publish its data: production volumes,
counterparties and prices are commercially sensitive, and disclosing them
to obtain traceability would cost more than the traceability is worth.
```

### Solution *(75–125 mots)*

```
Operational data already produced by the mine — fuel issued, power
generated, explosives consumed, tonnes moved and milled, ounces poured —
is structured and converted into activity-based emissions, then attributed
down to the doré poured in a given period.

Two credentials are issued for each bar. The mine attests the physical
facts it observes: bar identifier, pour date, weight, assay. The carbon
calculator attests the computed intensity in tCO2e per ounce, together
with the methodology version and the emission-factor set used, and
references the mine's credential as its input.

A verifier checks both signatures independently against the issuers'
published keys. Selective disclosure lets a buyer obtain the carbon
figure without seeing volumes, counterparties or prices.
```

### Champs de métadonnées

| Champ | Valeur — version A (nommée) | Valeur — version B (anonymisée) |
|---|---|---|
| **Sector** | Mining & Metals / Raw Materials | idem |
| **Country** | Guyana *(opérations)* + pays de Natixar *(à confirmer par vous)* | idem sans Guyana si trop identifiant |
| **Theme** | Supply chain traceability · Sustainability & ESG · Product passports | idem |
| **Status** | **Pilot / Proof of Concept — in progress** | idem |
| **Organisations** | Natixar · AGM Inc. *(sous réserve d'accord)* | Natixar seul |
| **Credentials Used** | Origin Credential *(mine → bar)* · Carbon Intensity Credential *(calculator → bar)* | idem |
| **Standards Applied** | W3C Verifiable Credentials · W3C Decentralized Identifiers *(`did:web`)* · GHG Protocol Scope 1 & 2 | idem |
| **Wallet types** | *(aucun — voir §5)* | idem |

**Sur le champ Status, ne cédez pas à la tentation.** Écrivez « Pilot / Proof of Concept — in progress ». Le catalogue contient déjà des pilotes assumés, dont « Direct e-Invoicing **Small Scale Pilot** » publié par FIDES Labs eux-mêmes. Un pilote honnête est recevable ; un pilote présenté comme un déploiement se démonte en une question du jury.

### Benefits *(3 à 5 puces)*

```
- The carbon figure travels with the metal, per bar and per pour, instead
  of existing only as a site-wide annual average.
- Verification requires no call to the platform operator and no trust in
  it — only the credential and the issuers' public keys.
- Commercially sensitive data never leaves the operator: selective
  disclosure separates what must be proven from what must stay private.
- Physical facts and computed values carry different signatures, so each
  party attests only what it is actually in a position to know.
- The credential records its methodology and emission-factor versions,
  so it remains verifiable years after issuance.
```

### Links

À remplir avec : la page de vérification publique (nous la livrons, voir l'artéfact 2), et éventuellement une capture du tableau de bord. **Pas de lien vers un environnement non protégé contenant des données AGM réelles.**

---

## 4. Dictionnaire — les termes que vous aurez à défendre

Rangés dans l'ordre où ils apparaissent dans le dossier. Chacun tient en trois lignes ; c'est volontaire : si vous ne pouvez pas l'expliquer en trois lignes, vous ne pourrez pas le défendre devant un jury.

**Attestation vérifiable** *(verifiable credential, VC)* — un document numérique signé cryptographiquement par celui qui l'émet. Sa particularité : n'importe qui peut vérifier la signature avec la clé publique de l'émetteur, sans demander la permission à personne et sans se connecter au système qui l'a produit. C'est ce qui la distingue d'un PDF ou d'un lien vers un site.

**Émetteur / porteur / vérificateur** *(issuer / holder / verifier)* — les trois rôles du modèle. L'**émetteur** signe l'attestation (ici : la mine, puis nous). Le **porteur** la détient et la présente (ici : le vendeur du lot, puis l'acheteur). Le **vérificateur** contrôle la signature (ici : l'acheteur, le raffineur, l'auditeur). Ce sont trois rôles, pas trois logiciels — la même organisation peut en tenir plusieurs.

**Identifiant décentralisé** *(DID)* — un identifiant qui permet de retrouver la clé publique d'un émetteur. Nous employons la variante `did:web`, la plus simple : l'identifiant `did:web:guygold.com` signifie « la clé publique est publiée à une adresse convenue sur le site guygold.com ». Aucune blockchain n'est nécessaire. AGM nous a déjà fourni le sien, ainsi que son identifiant légal international (LEI).

**Divulgation maîtrisée** — notre terme, et il est délibéré. La capacité de prouver une partie d'une attestation sans révéler le reste, **plus** le fait que la plateforme elle-même ne lise pas les chiffres en clair. Un acheteur obtient l'intensité carbone et la date de coulée sans voir les volumes ni les contreparties. Techniquement, chaque information est engagée séparément dans l'attestation, et on ne révèle que celles que l'on choisit.

*Pourquoi pas « divulgation sélective ».* L'expression désigne, dans les normes du domaine, des constructions précises — SD-JWT, signatures BBS+ — que nous n'implémentons pas. Employer le terme exposerait à une question à laquelle nous ne pourrions pas répondre par oui. **Le tableau ci-dessous est la réponse à préparer** : il dit ce que nous offrons et ce que la voie normalisée offre en plus. Il n'est pas destiné au formulaire ; il est là pour que vous ne soyez jamais prise de court.

| | Notre divulgation maîtrisée | Divulgation sélective normalisée |
|---|---|---|
| Révéler une partie, garder le reste | **oui**, ligne par ligne | oui |
| Une seule signature couvre tout | **oui** | oui |
| Le vérificateur contrôle sans nous appeler | **oui** | oui |
| Le vérificateur **refait le calcul** | **oui** — c'est notre apport | non prévu |
| Les exclusions voyagent avec leur motif | **oui** — notre apport | non prévu |
| La plateforme ne lit pas les chiffres | **oui, à partir de H2** | hors sujet — la norme ne traite que la présentation |
| Conforme SD-JWT / BBS+ | non | oui |
| Fonctionne dans un portefeuille EUDI / EBSI | non | oui |
| Deux présentations non corrélables entre elles | **non** — un vérificateur qui en reçoit deux sait que c'est le même lot | oui, avec BBS+ |
| Prouver « moins de X » sans donner X | non | oui, en preuve à divulgation nulle |

**Les trois « non » se disent sans gêne, dans cet ordre :** ils décrivent une compatibilité avec un écosystème de portefeuilles qui n'existe pas encore en production, et notre identifiant de sujet est déjà conçu pour l'y accueillir sans réémettre quoi que ce soit. La non-corrélation, elle, est le seul écart de propriété réelle — et elle ne mord que si un même acheteur reçoit plusieurs présentations du même lot, ce qui n'est pas le cas d'usage.

**Intensité carbone, du berceau à la sortie d'usine** *(cradle-to-gate)* — la quantité de CO₂ équivalent émise pour produire une unité, depuis l'extraction jusqu'à la sortie du site, transport aval exclu. Notre unité est le **tCO2e par once d'or**. « Du berceau à la sortie d'usine » est une convention normalisée : elle dit exactement où le périmètre commence et où il s'arrête.

**Doré** — le lingot d'or brut coulé à la mine, alliage impur qui sera raffiné ensuite. C'est notre unité physique de traçabilité : identifié, pesé, titré, daté.

**Version du jeu de facteurs** *(emission factor set version)* — un calcul carbone multiplie des quantités physiques par des facteurs d'émission conventionnels, lesquels sont révisés au fil des années. Une attestation qui ne dit pas quels facteurs elle a employés est invérifiable a posteriori. La nôtre le dit, et c'est un de nos arguments d'innovation.

**Périmètres 1 et 2** *(Scope 1 & 2)* — convention du GHG Protocol. Le **périmètre 1** couvre les émissions directes du site (le gazole brûlé sur place). Le **périmètre 2** couvre l'électricité achetée. Le **périmètre 3**, tout le reste de la chaîne de valeur, est **hors du champ de notre pilote** — dites-le si on vous pose la question, plutôt que de laisser penser le contraire.

---

## 5. Ce qu'il ne faut surtout pas affirmer

Un dossier qui surpromet se démonte en une question. Voici les cinq limites, avec la réponse juste à donner si le sujet vient.

| Ne dites pas | Dites |
|---|---|
| « Nous avons un portefeuille numérique » | Nous n'en construisons pas. L'attestation est un fichier signé, vérifiable par n'importe quel outil conforme à la norme W3C. Un portefeuille peut la porter ; ce n'est pas nous qui le fournissons. |
| « C'est sur la blockchain » | Non, et c'est un choix. Une attestation vérifiable ne nécessite aucune chaîne. Un ancrage horodaté est prévu ultérieurement, hors du périmètre du pilote. |
| « C'est compatible EUDI / EBSI » | Nous employons les mêmes normes W3C sur lesquelles ces écosystèmes reposent, ce qui rend l'interopérabilité future possible. Nous n'avons pas fait l'intégration, et nous ne le prétendons pas. |
| « Le système garantit que la donnée est vraie » | Il garantit **l'intégrité et l'attribution** : la donnée vient bien de l'émetteur déclaré et n'a pas été modifiée. Que la mesure d'origine soit juste relève de l'audit, pas de la cryptographie. C'est une distinction que le jury connaît — l'énoncer vous crédibilise. |
| « Nous couvrons toute l'empreinte » | Périmètres 1 et 2, sur un périmètre pilote choisi, année 2025. |
| « C'est de la divulgation sélective » | **Divulgation maîtrisée.** Les propriétés utiles sont les mêmes ; la construction n'est pas celle des normes SD-JWT ou BBS+. Le tableau du §4 dit exactement en quoi, et il vaut mieux le sortir que le laisser deviner. |
| « Vos données sont chiffrées chez nous » | **Ce sera vrai à partir de H2.** Aujourd'hui le magasin conserve les données du pilote en clair, derrière une authentification. Le schéma le prévoit, la décision de conception est prise ; ce n'est pas encore construit. La page publique porte la mention de date — ne la retirez pas d'une capture d'écran. |

---

## 5 bis. Les hypothèses de production — à dire avant qu'on les demande

La démonstration porte sur **378 lingots de doré, année 2025**. Quatre hypothèses
les font exister, et elles sont toutes assumées. Si le jury les découvre en
posant une question, elles ressemblent à un raccourci ; énoncées d'avance, elles
ressemblent à ce qu'elles sont — un modèle explicite, versionné, et remplaçable
par les vraies données le jour où elles arrivent.

| Hypothèse | Pourquoi |
|---|---|
| Le cycle de production dure **un mois** | Le minerai extrait un mois est traité et coulé le suivant. C'est court pour une mine, et c'est le seul point où nous simplifions la réalité physique. |
| Les lingots sont coulés **en début de mois** | Le volume est faible — une trentaine de lingots par mois — donc la coulée est intermittente et non continue. |
| Les opérations d'un lot sont les consommations des départements de production du **mois précédent** | C'est le cycle d'un mois, appliqué. Un lingot coulé le 1er mars porte le gazole de février. |
| La fenêtre est **février à décembre**, pas l'année pleine | Des lingots coulés début janvier puiseraient dans décembre 2024, que nous n'avons pas. La fenêtre couvre **93,2 % des onces de l'année**. |

**Ce qui est fabriqué, et ce qui ne l'est pas.** Le registre de coulée d'AGM — le
jeu de données G-01 — est encore partiel : les onces mensuelles existent, mais la
date de coulée, l'identifiant de lingot, le poids et le titre n'ont pas été
fournis. Ces quatre champs sont donc simulés, et l'attestation le déclare dans un
champ prévu pour cela (`eventModel: "simulated-v1"`). Tout le reste — les litres
de gazole, les départements, les explosifs, les onces par mois — vient du paquet
réel d'AGM.

**La phrase à dire si on vous interroge :** *« La chaîne de preuve est réelle et
tourne ; le registre de coulée est simulé parce que la mine ne nous l'a pas encore
transmis, et l'attestation le déclare elle-même. »* C'est plus fort qu'un silence,
et c'est vérifiable — le champ est dans le fichier signé.

**Le périmètre organisationnel.** Pour le pilote, la mine est traitée comme un
ensemble, et les entreprises sous-traitantes comme des directions regroupant des
départements. Distinguer ce qu'AGM exploite de ce qu'elle ne fait que financer —
les engins lourds de Sinohydro, par exemple — demanderait un audit du pouvoir de
décision. **Cela ne change pas le chiffre par lingot** : cela change la ligne du
référentiel où l'émission se range, pas le total qu'un lingot porte.

---

## 6. Les cinq questions que le jury posera, et les réponses vraies

**« Combien d'utilisateurs, quelle adoption ? »**
C'est un pilote sur un site, avec un client industriel réel et des données de production réelles de l'année 2025. Nous concourons dans la catégorie Innovation, pas Impact — nous ne prétendons pas à l'échelle.

**« En quoi est-ce différent d'un certificat signé classique ? »**
Un certificat signé se vérifie auprès de celui qui l'a émis. Une attestation vérifiable se vérifie contre une clé publique, par un tiers, hors ligne, sans permission. Et la nôtre porte deux signatures d'origines différentes plutôt qu'une seule.

**« Pourquoi deux émetteurs ? »**
Parce que personne ne devrait signer ce qu'il ne peut pas savoir. La mine observe le lingot ; nous calculons son empreinte. Fusionner les deux signatures reviendrait à demander à l'un de garantir le travail de l'autre.

**« Et si les facteurs d'émission changent ? »**
L'attestation porte la version employée. Un recalcul produit une nouvelle attestation qui référence la précédente. L'ancienne reste valable comme trace de ce qui était affirmé à sa date.

**« Que voit exactement l'acheteur ? »**
Ce qu'on lui accorde : l'origine, la date, l'intensité carbone, la méthode. Pas les volumes, pas les contreparties, pas les prix. C'est la condition pour que la mine accepte de participer.

---

## 7. Votre calendrier

| Date | Ce qui doit être fait | Qui |
|---|---|---|
| **1er–5 août** | Accord écrit d'AGM sur la version A, ou décision de partir en version B | Svetlana |
| **avant le 5 août** | Texte de la fiche validé par Jean-Marc | Svetlana + Jean-Marc |
| **~12 août** | Nous vous livrons la page de vérification et le lien à insérer | Claude |
| **8 août** | Point de bascule : sans accord AGM, on publie la version B | Svetlana |
| **20 août** | **Publication dans l'Ecosystem Explorer — date limite** | Svetlana |
| 21 août | Finalistes annoncés | — |
| 22 août → | Vote communautaire — mobilisation des réseaux | Svetlana |
| 15 septembre | Remise des prix, Utrecht | — |

Deux remarques sur la fin du tableau. Le vote communautaire **compte pour la moitié du résultat**, et il favorise les organisations à large base d'utilisateurs — Swiggy et ses 120 millions d'utilisateurs sont dans le catalogue. C'est là que votre travail de mobilisation vaut plus que toute notre technique. Et l'inscription doit être faite **avant** l'annonce des finalistes : rien ne se rattrape après le 20.
