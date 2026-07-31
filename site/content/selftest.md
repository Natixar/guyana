---
title: "Self-check"
description: "Checks run in the browser: canonicalisation, encoding, key, signature."
jsEntry: "js/selftest.js"
layout: "selftest"
---

These checks run **in your browser**, against the code this page actually
serves. They verify canonical serialisation against RFC 8785, signature
encoding, that the private key genuinely cannot be exported, and a full
sign-then-verify round trip.
