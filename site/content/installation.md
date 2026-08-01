---
title: "Installation guide"
description: "How to publish the mine's public key, step by step."
layout: "page"
---

This guide is written for whoever manages the `guygold.com` domain and website.
It takes about fifteen minutes. No programming is involved: you will download
one small file and place it at one address.

If anything below does not match what you see, stop and tell us — a mismatch
usually means we made an assumption about your setup that is wrong, and it is
quicker for us to adjust than for you to work around it.

## What this is for

Every doré bar in the pilot receives a digital certificate, signed on your side.
Anyone receiving that certificate — a buyer, a refiner, an auditor — needs a way
to check the signature is genuinely yours. They do that by fetching one small
public file from your domain.

The file contains only a **public** key. It can be read by anyone; that is its
purpose. The private half never leaves the computer where it was created, and it
is not in this file.

## Step 1 — Create the key

On the computer that will confirm pours, open the signing page and select
**Create the signing key**.

A short code appears, in six groups of four characters. Read it aloud to your
Natixar contact. They will confirm it matches what they see. This takes a minute
and it is the only check that guarantees the key we publish is the key on your
machine.

Do this **once**, on **one** computer. If you later need a second machine, tell
us — a second key is added alongside the first, not in place of it.

## Step 2 — Download the file

Select **Download did.json**. Your browser saves a file named `did.json`,
about one kilobyte.

Do not rename it, and do not open it in Word or a similar program — a text
editor may add formatting that makes it unreadable to a machine. If you need to
look at it, use Notepad on Windows or any plain-text viewer.

## Step 3 — Publish it at the right address

The file must be reachable at exactly this address:

```
https://guygold.com/.well-known/did.json
```

Three details, and all three matter:

- **`https`**, not `http`. The address must be secure. This is a requirement of
  the standard, not a preference of ours.
- The folder name starts with a **dot**: `.well-known`. On some systems, files
  and folders beginning with a dot are hidden by default. It is a standard name,
  reserved for exactly this kind of file.
- The file name is `did.json`, in lower case.

**We think this step will require help from whoever runs your web hosting.**
From the outside, `guygold.com` currently forwards visitors to your internal
management portal rather than serving pages of its own, which means there may
not be a place to put a file yet. That is a normal setup and not a problem — it
simply means the person who configured the domain needs to be involved.

If that turns out to be complicated, there is an alternative that avoids
touching your existing setup entirely: use a dedicated address such as
`trace.guygold.com`, pointed wherever is convenient. **The address remains
yours**, which is what matters — the trust rests on your control of the domain,
not on which machine serves the file. Tell us if you prefer this and we will
prepare it.

## Step 4 — Check it worked

Open this address in any browser:

```
https://guygold.com/.well-known/did.json
```

You should see text beginning with `{"@context"`. If instead you see an error,
a login page, or you are redirected somewhere else, the file is not in place
yet. Send us a screenshot and we will work out what happened.

## What to do if the key is lost

If the computer is replaced, the browser is reset, or the profile is cleared,
the private key is gone. This is not a disaster and it is not unusual.

**Do not delete anything.** Create a new key by repeating steps 1 to 3 — but at
step 2, first load the `did.json` that is currently published. The new key is
then **added** to it, and certificates signed with the previous key stay
verifiable. The old entry is kept rather than replaced, and that is the whole
point: the signing keys never leave the browsers that hold them, so a key
dropped from the published file cannot be put back.

### Do this one at a time

Reading the published file, adding a key, and publishing the result are three
separate steps, and nothing in the tool can make them one — the file lives on
your web server, not ours. If a colleague adds a key between your reading and
your publishing, your file overwrites theirs, silently.

Two habits close the gap:

1. **Open the published file with an editor that locks it**, and keep it locked
   until the new version is in place. On a shared drive this is usually enough
   on its own.
2. **Compare the fingerprint before publishing.** When you load the existing
   document, the tool shows the fingerprint of what it read, and records it in
   the new file as `previousVersionDigest`. Load the online file again just
   before publishing: if its fingerprint still matches, nothing changed
   underneath you.

That fingerprint covers **the whole document**, not the key — which is what
makes it useful. A key fingerprint would tell you which key was there; only a
document fingerprint changes when a key you never saw has been added, and that
is precisely the case you are trying to catch. Reformatting the file does not
change it: the fingerprint is taken on the canonical form, so indentation and
key order are irrelevant.

## Questions worth asking us

- Who at your organisation should own this key day to day?
- Should a second computer be able to sign, for continuity?
- Do you already hold a company certificate on a USB token, used for tax or
  invoicing? If so, tell us — it may be usable, and it would be worth checking
  before you create a new key.
