-- Le cube et ses index — schéma H1.
--
-- Deux décisions structurent ce fichier, et aucune n'est cosmétique.
--
-- 1. LA PÉRIODE EST UN INTERVALLE, PAS DEUX COLONNES.
--
-- Une cellule porte un flux moyen sur une période, jamais une valeur à un
-- instant. Toutes nos interrogations sont donc des recouvrements : « intégrer
-- sur un intervalle quelconque » se dit `&&`. Indexer (début, fin) en deux
-- scalaires donne un B-tree qui se dégrade précisément sur cette requête-là.
-- `tstzrange` + GiST y répond en une passe, et le stockage est identique.
--
-- 2. SEULE LA PÉRIODE EST INDEXABLE, DONC INTERROGEABLE, DONC VISIBLE.
--
-- Ce que le serveur doit indexer est ce qu'il peut interroger, et ce qu'il peut
-- interroger est ce qu'il peut apprendre : l'ensemble indexable, la surface de
-- requête et la surface de fuite sont le même ensemble. `/ranges` ne sélectionne
-- que sur le temps ; le client filtre les autres dimensions après réception.
-- Ajouter une dimension d'interrogation n'est donc pas une fonctionnalité, c'est
-- une divulgation, et cela se décide comme telle.
--
-- CE QUE CE SCHÉMA N'A PAS, ET POURQUOI.
--
-- Pas de chiffrement au repos : la décision D1 de l'issue #6 n'est pas prise, et
-- le schéma en dépend. H1 stocke en clair et le dit, plutôt que d'inventer un
-- demi-chiffrement qu'il faudrait défaire.
--
-- Pas de partitionnement : 1 100 lignes mensuelles. La question se re-décide sur
-- des volumes réels, issue #43.

BEGIN;

-- Index de dimensions. Numériques dans la table de faits, résolus ici.
-- La taxonomie pivot, elle, n'est PAS en base : elle est publiée
-- (site/static/engine/taxonomy.json) parce qu'un vérificateur doit pouvoir
-- dériver la ligne GHGP lui-même sans nous appeler.

CREATE TABLE IF NOT EXISTS unit (
    id      integer PRIMARY KEY,
    symbol  text NOT NULL UNIQUE          -- « L », « kg », « t.km »
);

-- La taxonomie d'organisation. Statique pour le PoC, et en clair
-- PROVISOIREMENT : c'est elle qui porte les noms révélant l'organigramme du
-- client, et c'est elle que le chiffrement des dimensions couvrira le jour où
-- D1 de l'issue #6 sera tranchée. Le client, lui, n'en connaît déjà que les
-- identifiants entiers — rien du front ne changera ce jour-là.
--
-- `industrial` distingue ce que la matière traverse de ce qui la soutient. Un
-- département de soutien émet réellement et n'appartient à aucun lot : ses
-- émissions deviennent le non-alloué, que la règle du 1er août 2026 divise
-- entre les barres coulées le mois même.
CREATE TABLE IF NOT EXISTS entity (
    id          integer PRIMARY KEY,
    label       text NOT NULL,
    parent      integer REFERENCES entity(id),
    industrial  boolean NOT NULL DEFAULT false
);

-- Les colonnes ajoutées après coup : une base du pilote peut précéder ce champ.
ALTER TABLE entity ADD COLUMN IF NOT EXISTS industrial boolean NOT NULL DEFAULT false;

-- La table de faits. Rien que des nombres et un intervalle.
CREATE TABLE IF NOT EXISTS cell (
    id               text PRIMARY KEY,
    period           tstzrange NOT NULL,
    entity_id        integer NOT NULL REFERENCES entity(id),
    sub_post         integer,             -- NULL = non alloué, et c'est un état légitime
    part_type        integer,
    caracterisation  integer NOT NULL,
    value            double precision NOT NULL,
    unit_id          integer NOT NULL REFERENCES unit(id),
    factor           double precision NOT NULL,
    factor_unit      text NOT NULL,       -- « kgCO2e/L » — l'unité du facteur, pas de l'activité
    origin           text NOT NULL
                     CHECK (origin IN ('MEASURED','DERIVED','ESTIMATED','NOT_MEASURED')),

    -- Un intervalle vide ne porte aucun flux : ce serait une ligne qui existe
    -- sans rien dire, et qui fausserait un dénombrement de couverture.
    CONSTRAINT period_not_empty CHECK (NOT isempty(period))
);

-- L'index qui rend `/ranges` possible. GiST, parce que l'opérateur est `&&`.
CREATE INDEX IF NOT EXISTS cell_period_gist ON cell USING gist (period);

-- Les attestations reçues de la mine. Stockées telles quelles : elles sont
-- signées, donc figées, et les reformater les invaliderait.
-- Les attestations reçues. Stockées telles quelles : elles sont signées, donc
-- figées, et les reformater les invaliderait.
--
-- LA CLÉ N'EST PAS LE SUJET. Une barre porte DEUX attestations — l'origine,
-- signée par la mine, et l'intensité carbone, signée par Natixar — et toutes
-- deux portent le même `credentialSubject.id`, puisque c'est ce que `derivedFrom`
-- relie. Clé sur le sujet, la seconde arrivée était silencieusement jetée, et un
-- vérificateur ne recevait que la moitié de ce dont il a besoin.
--
-- La clé est donc l'empreinte du document, qui est l'identité naturelle d'un
-- objet signé : renvoyer deux fois le même fichier ne crée rien, alors qu'une
-- réémission pour le même sujet est une ligne de plus — ce qui est voulu, le
-- registre prenant la plus récente par (sujet, type).
CREATE TABLE IF NOT EXISTS credential (
    digest       text PRIMARY KEY,        -- SHA-256 de la sérialisation canonique
    subject      text NOT NULL,           -- credentialSubject.id, un URN opaque
    type         text NOT NULL,           -- le type W3C significatif, hors « VerifiableCredential »
    received_at  timestamptz NOT NULL DEFAULT now(),
    received_by  text,                    -- X-Webauth-User, ou NULL en mode dégradé
    document     jsonb NOT NULL
);

-- L'ordre du registre : la plus récente par barre et par type.
CREATE INDEX IF NOT EXISTS credential_latest
    ON credential (subject, type, received_at DESC);

COMMIT;
