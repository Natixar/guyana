---
title: "Verify a certificate"
description: "Check an origin certificate against the issuer's published key."
jsEntry: "js/verify-page.js"
layout: "verify"
# La seule page servie sans identifiants. Le marqueur est lu par `baseof.html`
# et empêche `nav.js` d'appeler une route authentifiée depuis ici : sans lui,
# le navigateur ouvre sa fenêtre de mot de passe sur la page qui démontre
# qu'il n'en faut pas.
public: true
---

Everything below happens **in your browser**. Nothing is sent anywhere, and no
account is needed — the check is a local computation against the key the issuer
has published on their own domain.
