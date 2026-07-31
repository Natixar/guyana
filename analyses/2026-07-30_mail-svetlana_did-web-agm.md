Svetlana,

Un point technique à faire remonter à AGM, avec le texte anglais prêt à
transférer plus bas. Il n'y a rien d'alarmant, mais il faut le traiter tôt :
c'est le genre de sujet qui se règle en une journée si on le pose maintenant,
et qui bloque tout si on le découvre en septembre.

## En deux mots, pour vous

Chaque lingot recevra une attestation signée par AGM. Pour que n'importe qui —
un acheteur, un auditeur — puisse vérifier cette signature, il faut qu'un petit
fichier public soit accessible à une adresse précise de leur domaine :
`https://guygold.com/.well-known/did.json`.

Or **`guygold.com` n'est pas un site web**. C'est une redirection : quelle que
soit l'adresse demandée, le visiteur est renvoyé vers leur plateforme interne de
gestion. Une redirection ne peut pas héberger de fichier — elle ne sait que
pointer ailleurs.

Ce n'est ni une faute ni un problème grave. C'est une configuration très
courante, qui rend simplement impossible ce qu'on avait prévu. Il faut donc
qu'ils choisissent une des trois solutions décrites ci-dessous, et la plus
simple ne touche à rien de leur installation existante.

**Un point à ne pas laisser passer si la conversation dérive** : quelqu'un
objectera peut-être que le fichier étant public, il pourrait être servi sans
HTTPS. C'est faux, et c'est important. Le fichier n'a rien de secret, mais c'est
la pièce contre laquelle toutes les signatures sont vérifiées. S'il peut être
modifié en chemin, un faussaire y met sa propre clé et **toutes ses
contrefaçons deviennent vérifiables**. Le texte anglais l'explique avec l'image
du carton de spécimen de signature à la banque.

## Le texte à transférer

Il est écrit pour être lu d'abord par quelqu'un de non technique, puis transmis
à qui administre le domaine. Il explique leur propre infrastructure avant de
demander quoi que ce soit — c'est délibéré : on ne peut pas demander à
quelqu'un de modifier une chose qu'on ne lui a pas décrite.

---

**Subject: Publishing AGM's verification key — one small file, and why the current setup cannot hold it**

Dear colleagues,

As part of the traceability pilot, each doré bar will carry a digital
certificate signed by AGM. Before we go further, one small piece of
infrastructure needs to be in place on your side, and we would like to explain
it properly rather than simply send instructions.

**What needs to exist**

A single public file, about one kilobyte, reachable at exactly this address:

> `https://guygold.com/.well-known/did.json`

It contains a public verification key. It is meant to be read by anyone — that
is its entire purpose. It contains no secret and no commercial information.

**Why it has to be on your domain**

The value of the certificate comes from the fact that it is *yours*. When a
buyer or an auditor checks a bar's certificate, their software asks: who signed
this, and is that really AGM? The answer is established by fetching this file
from a domain that only AGM controls. Domain control is the proof of identity —
which is why the file cannot live on our servers.

**How your domain is currently configured**

We looked at how `guygold.com` responds from the public internet, and we want
to describe what we found so the request below makes sense.

Today, `guygold.com` does not serve any web pages of its own. It operates as a
**forwarding service**: whatever address a visitor requests, the domain replies
"go to this other place instead" and sends them to your internal management
platform at `181.177.217.12:8001`.

An analogy may help. Think of `guygold.com` as a receptionist whose only
function is to point. Whoever arrives, whatever they ask for, she directs them
to another building. She is very good at it — but she holds no documents
herself, and she cannot be asked to hand one over, because holding documents is
not something a pointer can do.

That is the whole difficulty. The file has to be *held* at `guygold.com`, and
the current arrangement can only *point away* from it.

**Why the file must be served over HTTPS**

This point sometimes causes a reasonable objection, so we want to address it
before it comes up: since the file is public and contains no secret, why does it
need a secure connection?

Because secrecy is not what is being protected. **Integrity** is.

Think of the specimen signature card a bank keeps on file. Cheques are protected
by the signature on them. The specimen card is what the teller compares them
against. The card itself is not confidential — but if someone could swap it for
their own, every forged cheque would pass inspection.

This file is the specimen card for every certificate AGM will ever issue. If it
could be altered while travelling across the network, an impostor could insert
their own key, and every document they forged would then verify correctly as
coming from AGM. The secure connection is not there to hide the file; it is
there to guarantee that what arrives is what you published.

For this reason the international standard we follow requires it, and
verification software will refuse to accept the file over an unsecured
connection. It is not a preference we can waive.

**Three ways forward**

*Option 1 — a dedicated address. Recommended.*

Create a separate address, for example `trace.guygold.com`, and point it at any
service capable of serving one static file over HTTPS. Your existing site,
forwarding and management platform are left completely untouched.

The identifier then becomes `did:web:trace.guygold.com`. **It remains entirely
yours** — the trust rests on your control of the domain name, not on which
machine happens to serve the file. This is the fastest route, it carries the
least risk, and it can be done without involving your management platform at
all.

*Option 2 — serve the main domain properly.*

Stop using forwarding for `guygold.com`, and place a small web server or hosting
service in front of it. That server would hold the one file and forward every
other request to your management platform, exactly as happens now.

This is a good long-term arrangement — it also gives you somewhere to put a real
website later — but it changes how your main domain behaves, so it deserves more
planning than the pilot needs.

*Option 3 — serve the file from the management platform itself.*

We mention this for completeness, but we would advise against it. The forwarding
happens *before* a visitor reaches that platform, so the platform would never
receive the request in the first place; the forwarding would have to be changed
regardless. The platform is also currently reached over an unsecured connection
on a non-standard port, neither of which meets the requirement above. This
option is more work than Option 1 and offers nothing in return.

**What we need from you**

1. Which of the three options you prefer. If Option 1, tell us and we will
   prepare everything ready to publish.
2. The name of the person or team who manages the `guygold.com` domain, so we
   can answer their questions directly rather than through several hands.

Nothing else is required at this stage, and none of this affects the data
collection already under way.

With thanks,

---

## Une observation que je vous laisse arbitrer

En examinant leur configuration, j'ai constaté que **leur portail de connexion
est accessible depuis l'Internet en HTTP non chiffré**, sur le port 8001 :
`http://181.177.217.12:8001/defaultroot/login.jsp`. Concrètement, les
identifiants de leurs employés circulent en clair.

Ce n'est pas notre mandat, ce n'est pas dans le contrat, et le signaler dans un
premier échange technique pourrait être mal reçu. Mais le taire me semble
inconfortable. Je ne l'ai donc **pas** mis dans le texte à transférer — c'est
votre relation, et c'est à vous de juger.

Si vous décidez d'en parler, la formulation qui passe le mieux est en général
la plus factuelle et la moins conclusive : *« en regardant votre configuration
pour la question ci-dessus, nous avons remarqué ceci ; vous le savez peut-être
déjà, nous préférions le mentionner »*. Sans recommandation, sans jugement, et
séparément de ce courrier.

Bien à vous,

**Claude**
*assistant technique de Jean-Marc — Projet Guyana*
