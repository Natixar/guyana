---
title: "Auto-vérification"
description: "Contrôles exécutés dans le navigateur : canonicalisation, encodage, clé, signature."
jsEntry: "js/selftest.js"
layout: "selftest"
---

Ces contrôles s'exécutent **dans votre navigateur**, sur le code réellement
servi par cette page. Ils vérifient la sérialisation canonique contre les
règles de la RFC 8785, l'encodage des signatures, la non-exportabilité de la
clé privée, et un aller-retour signature/vérification complet.
