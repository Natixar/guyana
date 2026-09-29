# 04 — Loading the data

*State as of 29 September 2026. The code is authoritative:
`services/store/load_2025.py`, `services/store/make_fixture.py`.*

*The names of the files under `poc-data/`, and the fact that the ERP fixture is no
longer tracked, are those of #121 — the first step of #120.*

---

## In one sentence

An Excel workbook supplied by the client becomes, through **three scripts** — two of
them in the repository — **and a hand-held assignment**, one data file for the site
and one cube in the database. There is no ingestion pipeline to speak of: there is a
one-off load, and it says so itself.

`load_2025.py` states it in its header: *"a one-off load, explicitly authorised for
FIDES, and not the beginning of an ingestion chain"*. The source → model mapping, and
its computed coverage rate, are the subject of issue #47.

---

## The chain

```
   CONTROL POST                                                        kubb
   ────────────                                                        ────

   poc-data/                          (outside the repository — clause 9)
   ├─ client-physical-data-pack.xlsx
   │     │
   │     ├──▶ build_assignment.py ──▶ client-h1-subpost-assignment.json
   │     │                                     │
   │     ├──▶ make_fixture.py ────────────────┼──▶ site/static/engine/erp-fixture.json
   │     │     (sheets 3, 6, 7)                │       (not tracked — #120)
   │     │                                     │               │
   │     └──▶ load_2025.py ◀───────────────────┴───────────────┘
   │           (sheets 3, 7)
   │                │
   │                │  --sql: SQL on stdout, over ssh           ┌────────────┐
   │                └───────────────────────────────────────────▶│ PostgreSQL │
   │                   or a direct connection (STORE_DSN)         │ entity     │
   │                                                              │ cell       │
                                                                  └────────────┘
```

**Three scripts, and an order.** The assignment first, since the other two read it;
the fixture next, since the loader reads the department numbering from it; the loader
last. Only two of the three are in the repository: `build_assignment.py` lives beside
the workbook, for the reason given below.

---

## What never leaves the control post

**The client's workbook is confidential under clause 9 of the collaboration
agreement.** It lives in `poc-data/`, which `.gitignore` excludes; no script copies
its content into a tracked file.

The assignment `client-h1-subpost-assignment.json` and the script that produces it
live in the same place, for the same reason: they name the client's departments. So
does `client-head-organisation.json`, which carries the head organisation's identity —
it was written into the loader until 11 September 2026, and #120 took it out.

The ERP fixture is in the same situation since #121: **it is no longer tracked**, it
is produced locally, and the deployment takes it from the control post.

When the loader writes to kubb's database, **the workbook stays on the control
post**: only the SQL derived from it crosses, over stdin, and nothing is written to
the target's filesystem. That is the doctrine of `deploy/`, applied here.

---

## The workbook

Twelve sheets, filled in by the client on the data-request templates. Each template
carries its identifier at the top — `D-01`, `E-01/E-03`, `G-01` — its priority, an
example row, and a comment column in which the client says **how the value was
obtained**.

| Sheet | Content | Read by |
|---|---|---|
| 0 — Read me | notice | — |
| 1 — Use case list | use cases UC-01 to UC-04 | — |
| 2 — Data request tracker | tracking of the data requests | — |
| 3 — Fuel by consumer | diesel issued, by month and consumer category | `make_fixture.py`, `load_2025.py` |
| 4 — Equipment register | register of plant and installations | consulted to establish the assignment |
| 5 — Power generation | generator sets and solar | — |
| 6 — Production | gold produced, by month | `make_fixture.py` |
| 7 — Explosives | explosives consumed, by month and product | `make_fixture.py`, `load_2025.py` |
| 8 — Other sources | other sources | — |
| 9 — Emission factors | emission factors, and their status | copied by hand into `load_2025.py` |
| 10 — KPI tracker | tracking of the Annex 2 indicators | — |
| 11 — Plan | schedule | — |

The columns actually read are, in sheet 3: the month, the consumer category, the
quantity; in sheet 7: the month, the product, the quantity; in sheet 6: the month and
the ounces produced.

---

## The assignment — `build_assignment.py`

**What the workbook does not say, and which must nonetheless be known.** Sheet 3 files
diesel by *consumer category* — the name of a department or of a subcontractor. The
taxonomy, for its part, expects a **sub-post**: stationary combustion
(`CombustiblesFossiles`, a generator set) or internal freight (`FretInterne`, a
machine that drives). Going from one to the other is a **decision**, and this script
carries it.

To each category it attaches:

- a sub-post and a caracterisation;
- a **degree of confidence** — confirmed, or awaiting the client's confirmation;
- a **justification**: the department's name, and what the equipment register of sheet
  4 says about its fleet.

It also declares the sources the workbook mentions without measuring, and the open
decisions. Its status is written into the file it produces: *proposed — assigned by
Natixar from department names and the equipment register, pending the client's
verification*.

The correspondence itself is a Python dictionary, written by hand: it is a judgement,
not a computation.

---

## The fixture — `make_fixture.py`

It builds the "ERP" data the site needs in order to show a bar: the organisation
taxonomy, the process, the lots and the bars. It is written to
`site/static/engine/erp-fixture.json`, which the site reads. **That file is not
tracked** (#120): it carries the client's data, and the deployment takes it from the
control post.

**What comes from the workbook**: the ounces produced per month, the departments, the
diesel and the explosives.

**What is simulated** — and the file declares it, `simulated: true`, with the list of
the fields concerned: the client's pour register (template `G-01`) is still partial,
so the pour date, the bar identifier, the weight and the assay are fabricated.

**The department numbering comes from here.** The integer identifiers follow the order
of the assignment file, which is itself by decreasing share. The loader **reads** them
from the fixture rather than assigning its own: two numberings would agree until the
day a department was added, and the divergence would be silent.

**The missing months are declared here.** The production window starts in February,
because January would draw on a December 2024 the workbook does not contain. The
fixture writes the list of synthetic months into `model.syntheticMonths`; the loader
reads it rather than recomputing it.

---

## The loader — `load_2025.py`

### What it writes

**The `entity` table**: the client's head organisation — identifier 100, its legal
identity and its DID — then its departments, attached to it, with the identifiers from
the fixture. The head is inserted **before** the departments: otherwise the `parent`
foreign key would abort the whole load.

The identifier 100 is structural and lives in the code; **the identity is not, and
lives outside the repository**, in `client-head-organisation.json` (#120). The loader
reads it when it runs, never at import time — `test_units.py` imports this module in
continuous integration, where `poc-data/` does not exist. A missing field stops the
load: a head without a DID would produce an organisation the front end could not
designate as an issuer, and the failure would surface only at signing time.

**The `cell` table**:

- **two cells per diesel row** — combustion, and the upstream share of every litre,
  the term a naive model loses entirely;
- **one cell per explosives row**, attached to the mining department: the workbook
  gives them by product and by month, never by department, and splitting them would
  invent a breakdown nobody has.

The category → sub-post correspondence is **read** from the assignment; a category
absent from it, or with no department in the fixture, is set aside with a message on
standard error.

### What it transforms, and where

**Every transformation happens here, at the boundary**, because this is the last point
at which the data still exists as the client wrote it. Beyond it, there is nothing but
a flow over an interval.

| Transformation | Rule |
|---|---|
| **period** | the month `YYYY-MM` becomes an interval `[start, end)` from **local** midnight — UTC−4, no daylight saving — to local midnight, stored in UTC |
| **flow** | quantity ÷ duration of the period in seconds |
| **activity unit** | the litre becomes the cubic metre; the kilogram stays the kilogram |
| **factor** | the per-litre factor becomes a per-cubic-metre factor, multiplied by a thousand |
| **display** | the source's unit — the litre — and its factor from SI are kept, so the raw data can be read back |

**The direction of the conversion is checked by a test**, `test_units.py`, rather than
proof-read: a litre is a thousandth of a cubic metre, so the value is divided by a
thousand and the factor multiplied by a thousand. It is the product that is physical,
not either number taken alone.

**The factors** are those of sheet 9, copied into `SOURCE_FACTORS`: diesel combustion,
diesel upstream, explosives. A factor unit that `TO_SI` cannot bring back to SI is
**refused**: converting by guesswork would produce a plausible, wrong number, which
the signature would then freeze.

### The reconstructed months

For every month the fixture declares missing, the loader copies the rows of the **same
month of the following year** — December 2024 from December 2025, the only seasonality
twelve months of data allow one to invoke — and marks them `coverage = MISSING`. The
cell exists, and it says where it comes from.

### Origin

The loader writes `origin = MEASURED` on every cell, as a literal. The method column of
sheets 3 and 7 is not read. That is issue #116, and
[03](03_ontology-and-schema.md) says what origin ought to mean.

### Idempotence

Cell identifiers are **derived from the source** — `d/` plus the month, the department
and the part for diesel, `x/` plus the month and the product for explosives. Rerunning
replaces rather than piling up: every insert carries `ON CONFLICT (id) DO UPDATE`, **on
all columns** — a reload that changes a dimension must change the dimension, and
omitting one would leave a new value under an old label.

This is an ad hoc method, and [03](03_ontology-and-schema.md) explains why the
target model replaces it with addition and a generation counter.

### The schema

**On a direct connection**, the loader calls `db.apply_schema` before writing. **In
`--sql` mode it does not**: the SQL emitted contains only the insert transaction. It
therefore assumes a schema already in place — which the store guarantees, applying it at
every start-up; see [03](03_ontology-and-schema.md). The schema being
idempotent, applying it twice changes nothing.

---

## Running it

```bash
python3 services/store/load_2025.py --dry-run               # counts and summarises, writes nothing
STORE_DSN=… python3 services/store/load_2025.py             # writes, over a direct connection

# to kubb's database: the SQL leaves over stdin, nothing is written on the target
python3 services/store/load_2025.py --sql \
  | ssh claude-ia@kubb docker exec -i guyana-db psql -U aurora -d aurora
```

The container, the user and the database are those of the descriptor
`deploy/inventory/hosts.d/kubb.env` — `DB_CONTAINER`, `DB_USER`, `DB_NAME`. The command
is written in no script: it is the usage the `--sql` option announces in its help text
and in its comment, made explicit here.

`--dry-run` is an explicit mode rather than a default: the help says why, *"the default
would be dangerous in the other direction"*.

**`--sql` mode is kubb's.** The database publishes no port there; the loader therefore
does not connect to it, it emits the SQL on stdout, and the SQL travels over ssh. A
single transaction, `BEGIN` … `COMMIT`: a half-applied load would leave a cube nobody
could call complete.

**The summary goes to standard error**, never to stdout, so as not to mix with the SQL
when that goes down a pipe. It speaks in quantities again — cubic metres of diesel,
tonnes of CO2e — because a flow in m³/s does not read back.

**Python dependencies**: `openpyxl` for the workbook, `psycopg` for the database. The
workbook must be present in `poc-data/`; its absence stops the script with a message
recalling why it is not in the repository.
