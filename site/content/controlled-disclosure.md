---
title: "Controlled disclosure"
description: "Nothing leaves that you did not decide to release. What that means, and what it does not."
layout: "page"
---

A carbon certificate is only useful if someone else believes it. That normally
means handing over the workings — the fuel volumes, the departments, the
production figures — to whoever is asking. For a mine, those numbers *are* the
commercial position.

**Controlled disclosure** is the alternative. One signature covers the whole
calculation; you decide, at each presentation, which lines the other party
sees. What you keep back stays hidden, and the certificate still verifies.

## Two guarantees, in two directions

### Towards whoever you show it to

You choose **line by line**. A refiner who needs your haulage figure does not
thereby receive your blasting figure. Each line of the calculation is sealed
separately, the signature covers all the seals at once, and you open only the
ones you choose.

The party you are showing it to can check two things without asking anyone's
permission: that each line you opened matches its seal, and that the signature
over the whole still holds. They learn nothing about the lines you did not
open — not their value, not their order of magnitude.

### Towards us

{{< roadmap when="From H2 — not in the August demonstration." >}}
The store currently keeps the pilot data in clear. The design below is settled
and the schema provides for it; what runs today is everything in the previous
section, and the verification that follows.
{{< /roadmap >}}

Your figures are held encrypted, and the platform computes without reading them
in clear. What is indexed in the open is time alone — enough to answer "give me
this period", not enough to learn what happened in it. The tables that would
name your departments and your sites are encrypted too, so counting how often a
record appears reveals a shape with no labels on it.

## What a third party can actually do

This is the part that distinguishes a certificate from a claim. Whoever
receives one can, **in their own browser and without calling us**:

1. fetch the mine's public key from `guygold.com` and ours from `natixar.pro`;
2. check both signatures;
3. check that the carbon certificate really refers to that bar's origin
   certificate, by fingerprint;
4. **redo the calculation** from the lines you opened, with the published
   method, and confirm it gives the signed figure;
5. read which lines were set aside from the calculation, and why.

Step 4 is the point. Steps 1 to 3 say the signature holds. Step 4 says the
figure is the one the method gives — and that is a different, larger claim.

Step 5 matters for the same reason. When a figure is computed from a subset of
the available records, the ones left out carry a stated reason, and that reason
travels inside the certificate. Nobody has to take our word for what was
excluded, or discover it later.

## What is not claimed

The published categories are the reference framework's own, so a figure can be
recomputed under a later version of that framework rather than being frozen
under the one in force on the day it was signed. That is deliberate: emission
frameworks are revised, and trends across years are worth more than a number
that cannot be restated.

Beyond that, this page describes what the product does, not everything the
field can do. The full comparison against the standardised approaches — what
they offer that this does not — is in the technical dossier, and we will hand
it to anyone who asks rather than making them work it out.

<p class="muted">Questions about any of the above: they are the right questions,
and a clear answer is part of what we are selling.</p>
