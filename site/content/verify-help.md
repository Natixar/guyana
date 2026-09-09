---
title: "How to read a verification"
description: "What the verification page proves, what it does not, and what each result means."
layout: "page"
url: "/verify/help/"
public: true
---

This page explains what the [verification page](/verify/) does. It is text only —
nothing here talks to a server, and you need no account to read it.

## What a verification proves, and what it does not

A valid signature proves two things, and only two: the certificate comes from
the issuer it names, and not one byte of it has changed since it was signed.

It does **not** prove that the figures are true. That is audit, not
cryptography. What cryptography gives you is the certainty that you are
auditing the same document the issuer signed, and that nobody — including us —
altered it on the way.

## Where the issuer's key comes from

A certificate names its issuer as a `did:web` identifier — for example
`did:web:natixar.pro`. That identifier resolves to one address and one only:
`https://natixar.pro/.well-known/did.json`, on the issuer's own domain.

This page reads that document from there, in your browser. It is not relayed by
us and we cannot alter it on the way. The link is shown so you can open it
yourself and see the same file; anyone auditing this page's code can confirm it
reads that address and no other.

You may also supply the document yourself, and an offline verifier must: save
it and load it, or paste it. That path is the stronger one, because the
document then passes through none of our hands.

The page always states **which** of the two happened. If it fell back to a copy
that is not the issuer's published one, it says so rather than letting you
assume otherwise.

## Cells that were withheld

A carbon certificate covers a matrix of cells — each one a measured quantity
over a period. The holder may withhold any of them before presenting the
certificate to you, and doing so does not break the signature.

This is deliberate. Those figures are a mine's commercial position, and
requiring their full disclosure to make a certificate believable would make
certificates unusable. What you get instead: every cell remains **counted** and
**visible as existing**, each carries a commitment that a disclosed value must
match, and every cell excluded from the total carries the reason it was
excluded.

So a withheld cell is not a hidden one. You can see it is there, whether it
counted, and if not, why.

## The total, and its tolerance

The page recomputes the total from the cells you were given and checks it
against the total the issuer signed. That check allows a difference of up to
**one gram of CO₂ equivalent**, in either direction.

**Why any tolerance at all.** The issuer and this page both compute the total,
but not in the same order — the issuer aggregates by emission line, this page
sums cell by cell. Those two are equal in arithmetic and not equal in binary:
floating-point addition is not associative, so the last digits differ by around
a ten-billionth of a kilogram. A signed commitment is a hash, and a hash has no
notion of "nearly": one bit of difference gives an unrelated result. Without a
tolerance, three certificates in four would be reported as mismatched when
nothing was wrong with them.

**Why a gram.** On a certificate totalling six hundred tonnes, a gram is nine
orders of magnitude below the figure — far finer than any carbon accounting
means anything at. It is also six orders of magnitude *above* the largest
difference the two computations were measured to produce. The margin is taken
on both sides.

**What it concedes.** A holder could state a total that is wrong by one gram.
That is the whole of it, and it is stated here rather than left to be
discovered.

**A mismatch is therefore not a rounding artefact.** If this page reports that
the total does not match, a gram either way has already been allowed. Something
else is wrong.

## If something comes back red

- **Signature not valid** — the document was altered after signing, or it was
  not signed by the key the issuer publishes. Ask the holder for the original.
- **A commitment does not match its disclosure** — a disclosed figure is not the
  one that was signed. The document is claiming something the issuer did not.
- **The total does not match** — see above; a gram was already allowed, so the
  disclosed cells do not add up to the signed total.
- **The key that signed is not in the issuer's document** — the certificate was
  signed with a key the issuer no longer publishes, or does not publish yet.
  This is what key rotation looks like when the published document has not
  caught up.

None of these mean "the numbers are wrong". They mean the document in front of
you is not the document that was signed, and that is a different, more serious
problem.
