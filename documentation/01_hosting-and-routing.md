# 01 — Hosting and routing of the static site

*State observed on 8 September 2026. An early note: it describes the chain actually
deployed, not a target.*

---

## In one sentence

The site is a set of static files built by Hugo on the control post, sealed inside a
Docker image, run on kubb in a container that publishes no port, and exposed by a
Traefik **that is not ours** — which we address only through labels placed on our own
containers.

---

## The chain, end to end

```
   CONTROL POST (JM's laptop)                         TARGET (kubb)
   ──────────────────────────                         ────────────────────────

   site/  ── hugo ──▶  site/public/
                          │
                          │  tar over stdin, through ssh
                          │  (nothing is written on the target)
                          ▼
                     docker build ────────────────▶  image  aurora-site
                                                        │
                                                        │  docker run, `proxy` network
                                                        ▼
                                                   container  guyana-site
                                                   ├─ /static-web-server
                                                   ├─ --root=/public
                                                   └─ traefik.* labels
                                                        │
                                                        │  docker discovery
                                                        ▼
                                                     TRAEFIK  (another project)
                                                        │  TLS, ACME "porkbun"
                                                        ▼
                                              https://guyana.natixar.pro/
```

Three things in that drawing deserve to be singled out.

**The content lives inside the image.** Never as a bind mount from the host. An image
has a digest: it can be attested and deployed by digest. A directory dropped on the
host cannot — it drifts silently, and nothing says any more what is being served. That
is invariant 3 of [`deploy/README.md`](../deploy/README.md).

**Nothing is written on the target.** The build context and the step scripts travel
over `stdin`. A file left on kubb would outlive the container and our attention.

**We are tenants of the proxy.** kubb is ours, its Traefik is not: it is installed and
configured by a dedicated script, and any manual edit of its configuration would be
overwritten on its next run. So we write neither in `traefik.yml` nor in
`/home/traefik/routing`. All our routing goes through labels on our containers — which
has one constant practical consequence: **changing a routing rule means recreating the
container**, since Docker labels cannot be modified in place.

---

## Who serves which domain — and what the question hides

This is the most misunderstood part of the setup, and it is worth a table.

| Domain | Resolution (8 Sept 2026) | Served by | Ours? |
|---|---|---|---|
| `guyana.natixar.pro` | `90.53.125.57` = `proxy.critical-optimisation.com` | Traefik on kubb → `guyana-site` | **yes** |
| `natixar.pro` | `75.2.60.5`, `99.83.231.61` | **Netlify** | no |
| `www.natixar.pro` | CNAME `heroic-dango-aec695.netlify.app` | **Netlify** | no |

**The main domain does not go through us.** Our Traefik never sees a request for
`natixar.pro`. No label, no configuration of our static server can change what it
answers.

That is not an obstacle, because that site is a **pure file deployment** whose source
we hold:

- `/` and `/index.html` return 388 bytes of HTML redirecting to `www.natixar.com` — the
  domain is only a redirection, there is no site behind it;
- **deep linking works**: any file dropped there is served at its path, `.well-known/`
  included;
- an absent path returns a **plain 404**, not a fallback dressed up as success — which
  is the behaviour our own static server does not have (see
  [02](02_static-web-server.md)).

That site's source is **`web/natixar.pro/` in this repository**, and it is also the
directory Netlify publishes — declared in [`netlify.toml`](../netlify.toml) at the
root. The Netlify project is called `natixar-pro` (formerly `heroic-dango-aec695`); it
clones the repository and serves that directory as it stands.

Three settings in `netlify.toml` are worth reading.

**`command = "true"`** — an explicit no-op. With no command, Netlify's framework
detection would decide on its own, and it decides badly on a repository that contains a
Hugo site it must on no account build.

**`publish = "web/natixar.pro"`** — the Hugo site is NOT published here. It goes to
kubb, under `guyana.natixar.pro`, through `deploy/`. The two domains are served by two
different systems out of the same repository, and it is this line that separates them.

**`ignore = "git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- web/natixar.pro netlify.toml"`**
— sixty-odd tickets touch `services/`, `deploy/` and `site/`; letting them publish
`natixar.pro` would be noise and a risk. `git diff --quiet` exits 0 when nothing
changed, and Netlify cancels the build on exit code 0. On the first build
`$CACHED_COMMIT_REF` is empty, the command fails, the code is non-zero: we build.
**The failure is on the right side.**

Since Netlify runs no build, **the generated DID document is version-controlled**: a
file produced by a step nobody plays must exist in the repository, or it exists
nowhere.

### The DID document of `did:web:natixar.pro`

The declared issuer of the whole signing chain is `did:web:natixar.pro`
(`services/store/app.py`, `services/signer/server.mjs`), which resolves to
`https://natixar.pro/.well-known/did.json`. A verifier reads there the public key that
lets it check a credential **without asking us anything**: that is the claim the whole
project exists to hold.

The document is **generated**, never written by hand, by
[`tools/make-did.mjs`](../tools/make-did.mjs). The private key reaches it over `stdin`
and never touches the disk — the rule of `deploy/secrets/README.md`:

```bash
deploy/secrets/fetch.sh signer_key \
  | node tools/make-did.mjs --from-private - --also-key-name key-1
```

`web/natixar.pro/_headers` completes the service: `application/did+json`,
`Access-Control-Allow-Origin: *` and `max-age=0, must-revalidate`. **CORS is not
decorative** — `did-source.js` resolves the DID from the browser, hence from
`guyana.natixar.pro`, a different origin. Without that header the read fails silently
and the verifier falls back on the embedded copy: it would believe it was verifying
online without doing so.

#### Two fragments for one key

The document publishes the same public key under **two identifiers**, and that
redundancy is a choice, not an accident.

| Fragment | Why |
|---|---|
| `#<RFC 7638 thumbprint>` | the reference identifier. `site/assets/js/did.js` publishes this way, and argues it: under a logical name, two distinct keys receive the same identifier, and the merge removes the older one every time — exactly the loss it existed to prevent. |
| `#key-1` | what `services/signer/server.mjs` actually writes into its proofs, through `${ISSUER_DID}#${KEY_NAME}`. |

The two conventions cannot coexist in a single identifier: a credential from the server
signer is orphaned in a document built by `did.js`, and `verify.js` requires the
**exact** identifier, with no approximate match — the case is already tested by
`selftest.js` under `missingKey`. Publishing both entries closes no door and unblocks
publication; the signer's convergence towards the thumbprint is a separate, open
decision.

Checked with the key actually deployed: a credential signed under **each** of the two
fragments verifies against the published document.

#### What the checks catch

`tools/make-did.mjs --verify-file` establishes the document's **internal** consistency,
with no secret at all — it is therefore the only check runnable in continuous
integration. It refuses a fragment that has the *shape* of a thumbprint without being
one, a `controller` that does not designate the document, a `d` member — a published
private key is burnt — an `assertionMethod` with no matching method, and a document
where no key is addressable by its thumbprint.

What it does not catch: a perfectly consistent document built on a key nobody holds.
Only `--check`, with the private key, says that — and it therefore cannot run in CI.

`deploy/verify/verify-did.bats` takes over on the **online** document: publication,
type, CORS, issuer, absence of a private key, and presence of the identifier the signer
signs under.

---

## Traefik routing, in full

Everything is declared in [`deploy/steps/60-app.sh`](../deploy/steps/60-app.sh) and
[`deploy/steps/50-services.sh`](../deploy/steps/50-services.sh). Three containers share
one host name, and it is **priority** that settles it.

| Priority | Router | Rule | To | Authenticated |
|---:|---|---|---|---|
| 3000 | `guyana-pour` | `Path(/api/v1/pour)` | site | yes |
| 2500 | `guyana-public` | `/verify`, `/css/`, `/js/`, `/fonts/`, `/img/`, `/favicon.svg`, `Path(/engine/taxonomy.json)` | site | **no** |
| 2000 | `guyana-signer` | `PathPrefix(/api/v1/sign)` | signer | yes |
| 1000 | `guyana-store` | `PathPrefix(/api/v1)` | store | yes |
| 10 | `guyana-r1` | `Host(guyana.natixar.pro)` | site | yes |
| 1 | `guyana-any` | `HostRegexp(^guyana\..+$)` | site | yes |

### Why the priorities are explicit, and so large

With no declared priority, **Traefik computes it from the length of the rule**. The
site's router carries ``Host(`guyana.natixar.pro`)`` — some thirty characters, hence a
priority of about thirty. Values of 10 and 20 placed on the API were being beaten by a
router that did not even mention `/api/v1`. The store was never reachable from the
browser, and nobody saw it: **the site answers 200 with its home page for any unknown
path**, so a routing error took on the appearance of success.

That failure mode — a 200 masking an absence — recurs three times in this deployment's
history, and a fourth time on hidden files: measurements in
[02](02_static-web-server.md).

### The named exceptions

`/api/v1/pour` and `/api/v1/sign` are paths the `/api/v1` prefix would carry off to the
store, which does not serve them. Rather than weaken the store's rule, we **name the
exception** with a higher priority, and `verify-http.bats` asserts it.

### The public page

`/verify/` is open with no password, and that is a decision of substance: this page
exists to demonstrate that a buyer or an auditor can check a credential **without
trusting us**. One does not prove oneself superfluous from behind a door one holds the
key to.

A public page means **the page and everything it loads**. On 3 August 2026 the page was
open but its logo and fonts were not: a browser receiving `401` with
`WWW-Authenticate: Basic` on an `<img>` or an `@font-face` **opens the credentials
dialog** — for the resource, not for the page. So the verifier found itself asked for a
password on a page answering 200. `verify-public.bats` now follows sub-resources,
`url()` in stylesheets included.

`/engine/` stays **closed**, deliberately: it carries the embedded copy of the DID
document, and the public page must not be able to fall back on it silently — that would
be a rigged demonstration. Only `/engine/taxonomy.json` is open, by **exact** path
rather than by prefix, because a prefix would carry `/engine/did/` along with it.

---

## The middlewares

Three, declared on our containers, applied by the routers above.

| Name | Effect |
|---|---|
| `guyana-auth` | `basicauth`, with `headerfield=X-Webauth-User` |
| `guyana-sec` | `frameDeny`, `contentTypeNosniff`, `referrerPolicy=strict-origin-when-cross-origin` |
| `guyana-fresh` | `Cache-Control: no-cache` on everything the site serves |

**`headerfield` is the identity mechanism.** The middleware does not merely filter: it
**sets** `X-Webauth-User` on the request, and that is where `/api/v1/me` takes the
identity it returns. A counter-intuitive corollary, learnt on 3 August 2026: opening
`/api/v1/me` without that middleware does not make the route permissive, it makes it
**blind** — no header any more, hence "not authenticated" for everyone, including a duly
logged-in operator.

**Each container declares its own middlewares.** The API's routers used to reference the
site's; but the launcher recreates the site *after* the services, and during that
interval Traefik saw routers pointing at an absent middleware. The API answered 404 on
every redeployment until the site came back. A few more labels remove an ordering
dependency between steps.

**`guyana-fresh` has a precise reason.** Hugo names every module by the digest of its
content; the static server caches those URLs for a year, which is correct. But the HTML
is the one document whose URL never changes: a browser that loaded it yesterday serves
it again today, with yesterday's digests, and therefore loads yesterday's modules from
its year-long cache. On 2 August 2026 the self-test page ran the previous day's engine
against the day's vectors; twenty-one cases failed. The server was serving the right
code — the browser never asked for it.

`no-cache` does not mean "keep nothing" but "revalidate before serving": with the ETag,
an unchanged resource costs a 304 and zero bytes.

> **One emitter per header.** The static server can set its own `Cache-Control`. Two
> authorities for one header is a state in which the question "who wins?" has an answer
> nobody decided — it depends on the order of writing, hence on a version of Traefik. The
> container is therefore run with `--cache-control-headers=false`: Traefik is the sole
> emitter, and the behaviour reads in one place.

---

## The certificate

Every TLS router carries `tls.certresolver=porkbun`, whose name comes from the
environment descriptor and has **no default value**. That is deliberate: `tls=true`
without a resolver requests no certificate — Traefik serves its own, internal one, and
the browser raises a security warning on a perfectly healthy service. Every invariant
that reads an HTTP code passes. That is the failure mode of 3 August 2026, and
`verify-tls.bats` now names it explicitly ("not Traefik's internal fallback"), rather
than letting it show up as a handshake failure.

An invented resolver name would fail not at deployment but at renewal, ninety days
later, on a machine nobody is watching that day. Hence the invariant "the certificate
does not expire within 14 days".

---

## The other containers

To place the site within the whole — the detail belongs to a note still to be written.

| Container | Networks | Holds |
|---|---|---|
| `guyana-site` | `proxy` | nothing |
| `guyana-signer` | `proxy` | the signing key, **no database** |
| `guyana-store` | `proxy` + `guyana-data` | the database, **no credential key** |
| `guyana-db` | `guyana-data` (internal) | the state, in a named volume |

The founding invariant — *the signing key and the data never meet* — is a **topology**
here, not an intention: the signer is not on the database's network, and
`50-services.sh` observes that afterwards rather than assuming it.

---

## How we deploy, and how we verify

```bash
./deploy/deploy.sh --env kubb              # dry run (default)
./deploy/deploy.sh --env kubb --apply      # real execution
bats deploy/verify/*.bats                  # afterwards — that is half the work
```

`--apply` refuses to run on a modified working tree: what is deployed must be what is
committed.

`deploy/verify/` is kept apart from `deploy/steps/` because those are
**specifications**, not implementation tests: "the container publishes no port" stays
true if we move from Docker to Podman. That is what lets the same files run in three
contexts — the continuous integration job, a nightly cron, and `deploy.sh` after every
deployment.

The verification that matters most is `verify-neighbours.bats`: on shared
infrastructure, the risk is not that our deployment fails, it is that it breaks
something else. (See the anomaly reported above: that list today contains a domain that
is not on the machine.)

---
