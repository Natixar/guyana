---
name: site-process-analysis
description: Build a preliminary process model and an ingestion configuration for an industrial site from a client's data (workbooks, databases, streams), the maintainer's indications and public sources, so that the user corrects a first version instead of starting from a blank page in the editor. Use when asked what a client's data says, which activities happen where, how to map data onto a process model, how to configure ingestion, or which questions are worth asking the client.
---

# Site process analysis

## Objective

The platform's user configures a process model and an ingestion pipeline in an editor. Starting there from a blank page is slow, and every omission becomes a silent gap in the results. This skill produces **a credible first version of both**, from the evidence available, so that the user **corrects instead of inventing**.

## Outputs

1. **A preliminary process model, as data** — stocks, processes, edges, zones. Every element carries its evidence tag (ground rule 1), so the user sees what to confirm first. The skill fixes the content, not the serialisation: the format belongs to the editor.
2. **An ingestion configuration** — the recognised template if any, the chosen ingestion type and its adapter parameters, and for every source column the answers to the six ingestion questions (Step 8).
3. **An analysis note**, untracked — how the evidence was read, the astonishment report, the questions worth asking, and the precision given to each model.

## Ground rules

These rules bind every step.

1. **Tag every statement.**
   - **[F]** fact, with its source and section;
   - **[H]** hypothesis, yours, open to challenge;
   - **[Q]** question for the client;
   - **[M]** indication from the maintainer.

   A hypothesis never becomes data. A missing value comes from an **explicit model** — named, parameterised, sourced, marked `ESTIMATED` — never from an unmarked guess. When a calculation stacks hypotheses, present the result as an order of magnitude.

2. **Two filters, never one.**
   - **Bias** decides whether to ask. For each open point, state a plausible range of answers and compute the largest effect that range can have on the result. Ask only if the result can move; otherwise record the question as dropped, with the reason.
   - **Variance** decides how precise a model must be. Item *i* contributes (*sᵢ·uᵢ*)² to the variance of the total, where *sᵢ* is its share and *uᵢ* its relative uncertainty. There is **no per-item threshold**: the **target precision is global**, fixed by the client's KPIs, and every item gets the least costly model that keeps the total within it — an estimated constant, an approximate metric times a factor, or another catalogued model.

   **Independence is a hypothesis to justify.** Two hundred items at 0.5 % each, each at ± 100 %, give about ± 7 % on the total if their errors are independent — and a ruined total if they share a model, a default factor or the same estimator, because correlated errors add linearly. Items sharing a model or a factor count as **one systematic item**. Rank items by their variance contribution: that list says where to spend the next effort.

3. **Keep client data where it belongs.** Client names, places, volumes and departments go into **untracked local files** only. Anything public — issues, PRs, tracked files, this skill — carries percentages and generic wording. Before publishing, run a **whole-word, case-sensitive** search for the client's names: substring searches report generic words as false positives.

4. **A design document is a plan at a date.** Feasibility studies and impact assessments say what was intended. Cite them with their date and section, never as the current state of the site.

5. **Verify your own numbers.** Run every calculation in a script; watch for unit slips (a factor of a thousand between kg and t is the usual one); grep the source text to confirm every section number you cite.

## Workflow

### Step 1 — Recognise the template

Before analysing anything, fingerprint the source: sheet names, header cells, named ranges, drop-down lists, presence of macros. Compare with the library of known templates — in particular the **standard data-collection workbooks of the Association Bilan Carbone** and their client derivatives, which are the rule rather than the exception.

- **A recognised template has a known ingestion configuration.** Produce only the **diff**: added sheets, renamed columns, client-specific rows. Do not re-analyse what is known.
- These workbooks already carry, line by line, a **source**, an **uncertainty level** with its percentage, and a **justification**. Take them as they are: they are the inputs of the variance budget. Their list sheets hold controlled vocabularies — taxonomies to align with the model's.

### Step 2 — Choose the ingestion type

Pick the adapter — tabular file, database connection, or push stream — and record what it can declare: batch identity, scope, native keys, time semantics. The choice follows from the source; the internal interface does not change with it (see *Internal interface*).

### Step 3 — Inventory the source

For each table, establish **what it really is**, which is not always what its title says.

- Read headers, comments and "how measured" columns: they state the method behind each value.
- Exclude template and example rows.
- Look for tells. A column where every row holds the same status, with no asset data filled in, is not an asset register but a list of whatever drew a resource.
- Note which tables existing code reads, and which it ignores.

### Step 4 — Build the gazetteer

Collect every place name with its source — from cost-centre and department names, equipment assignments, the maintainer's indications, public sources. Record name → zone → coordinates → source. Compute distances in a script. When one source gives two figures for the same thing, keep both and say so.

### Step 5 — Research public sources

Technical reports (NI 43-101, JORC, S-K 1300), environmental and social impact assessments, lender disclosures, permit registers, trade press, regional airline route lists.

**Download large PDFs and work locally** — `curl`, `pdftotext -layout`, `grep`; fetch tools fail above about 10 MB. To find the section heading of a cited line:

```sh
awk -v L=<line> 'NR<=L && /^ ?[0-9]{1,2}(\.[0-9]+)* +[A-Z]/ {h=NR": "$0} NR==L {print h; exit}' report.txt
```

### Step 6 — Assign a role to every unit

Triangulate each organisational unit from its name, cost centre, equipment classes and descriptions, share of consumption, and location. Give it exactly one role:

| Role | Crossed by | Where its impacts go |
|---|---|---|
| **transformation** | the product | the product |
| **utility** — power, water | nothing; its output is an input | the consumers of its output |
| **input logistics** — port, road, crossing, warehouse, fuel distribution | the inputs | the input carried, then its consumers |
| **support** — camp, HSSE, IT, exploration, capital projects | nothing product-bound | unallocated, until an explicit rule says otherwise |

**Flag intermediaries.** Fuel issued to a tanker, a fuel truck or a day tank is not burned there: large volumes against a few light vehicles are the signature of an issuing point.

### Step 7 — Flows, balances and the preliminary process model

**Close the balances the data allow**: mass (extracted minus processed gives a stock change), energy (fuel burned gives kWh, to compare with demand), internal consistency (metal = throughput × grade × recovery). A balance that fails is a finding; one that closes lets you drop a question.

**Processes** are **continuous**, **batch**, or **unit**.

- A **batch** operation is not reducible to unit operations when process impacts are allocated. Part of a batch's impact is fixed — heating a furnace, driving a truck, a ferry crossing — so a per-unit figure is valid only at that fill rate, and one more unit may cost a whole batch: marginal and average differ.
- For each process, define what one instance is (a shift, a trip, a pour), which units are capable of it, and its constraints: availability, batch bounds (maximum, sometimes minimum), a **cycle** for batches (load, run, unload, return — the empty return belongs to the loaded trip), a latency matrix for continuous processes. A block-diagonalisable matrix describes several processes, not one.

**Stocks** sit wherever quantisation or rhythm changes between processes; a stock is at least one downstream batch in size.

- **Rule**: FIFO, LIFO, identity-preserved lots, or **imposed weighted average** for mixing stocks. A mixing stock carries its mass and, per **impact-context class**, the quantity that entered in that class: (*M*, *q₁ … q_k*). An outflow *m* takes *q_c·m/M* in each class. No age profile is needed.
- **Keep inventory, never impact.** Impacts are characterised late, with versioned factors, so they can be re-evaluated. What must be kept is the context that decides the impact: none for long-lived, well-mixed gases; place and time for water withdrawals or short-lived forcers. Keep the ledger at (point, period); the class is a view folded from it.
- **Residence time** τ = mass / outflow tells where the rule matters: nowhere when τ is days, a great deal when τ is months.
- **Non-storable flows** (electricity) go through a zero-capacity stock.
- **A mixing stock must declare its fill measurement** — sensor or periodic inventory — and its period. Otherwise it is marked unverified, and its outflows carry an uncertainty that grows with time since the last measurement.
- **Book minus measured is a residual, not a loss.** It mixes real losses, unrecorded flows, stock-measurement error, flow-meter drift and period cut-off. Attribute it to a flow when you can (`ESTIMATED`); absorb it into the remaining stock up to the loss the stock's model expects; write off the excess as unallocated, on a visible line.
- **Without a sensor you only get bounds**: a negative book, a book above physical capacity, a flow above the installation's rate, a contradicting proxy. They prove a problem without measuring it, and two opposite errors stay invisible. **An unrecorded addition is the dangerous case**: it adds mass without impact and silently lowers the intensity of everything downstream.

Draw the graph — stocks as nodes, processes as edges — and state plainly that it is a model, not a verified description.

### Step 8 — The ingestion configuration

For every source column, answer six questions, in this order:

| Question | What to record |
|---|---|
| **understood?** | quantity, unit, quantum, extensive or intensive |
| **located?** | period and its semantics; the point or unit concerned |
| **obtained how?** | measured, derived, or modelled — and which model; for a measurement, the instrument (range, precision, sampling rate, bandwidth and filtering, manual transcription) |
| **useful?** | its target in the process model; mandatory or optional |
| **redundant?** | a second path to the same number, if one exists |
| **checked?** | the residual of that cross-check, and its threshold, derived from the instruments' precision |

**Redundancy is a feature.** A cross-check yields a residual, hence a permanent control. A column with no second path is not less useful, but it can never be checked: say so.

### Step 9 — Astonishment report

List what contradicts the sources or expectations: a source giving two figures for one thing, a list that is not what its title says, a volume that fits no plausible fleet, a classification in existing code that the evidence contradicts. For each: what was expected, what was found, what it changes.

### Step 10 — Questions and model precision

Apply both filters and produce:

1. **first rank** — questions whose plausible answers move the result beyond the target precision, with the range and the maximum effect;
2. **second rank** — questions whose effects are local (per lot, per period) and cancel over the year;
3. **dropped** — each with its reason: no effect, display only, or covered by a coarse model;
4. **the variance ranking** — items sorted by (*s·u*)², systematic groups counted once.

Separate client questions from **decisions that belong to the maintainer**, such as scope.

## Internal interface

Ingestion is modular: adapters differ, the interface between them and the rest does not.

### Revisions reach you three ways, from any source

- **silent overwrite** — a re-deposited file, an updated database row;
- **explicit revision events** — a correction published as such, typically on a stream;
- **collision** — a new assertion whose key and valid time match a known fact with a different value.

An append-only transport does not make facts append-only: a push stream can revise, explicitly or by collision. All three converge on one mechanism: **a key collision is a revision**.

### The observation record

| Field | Meaning |
|---|---|
| `source`, `batch` | the adapter and its connection; a batch with a stable identity — a file digest, a snapshot id, an offset range |
| `key` | the natural key of the fact: entity, quantity, valid period or instant, context class. **It decides what "the same fact" means.** |
| `value`, `unit`, `quantum` | the number as stated |
| `method` | measured, derived, estimated, or modelled — and which model |
| `valid_for` | the period the value describes |
| `asserted_at` | when the source asserted it |
| `provenance` | sheet, row and column, or offset — enough to reach the original cell |
| `digest` | the digest of the normalised record |

### Rules

1. **Never overwrite.** A correction is a new assertion with a later `asserted_at`; the current view is the latest assertion per key. The correction history stays, and it explains why two published figures differ.
2. **Idempotence.** A record whose digest is already known is ignored: loading the same file twice changes nothing.
3. **Revision.** Same key, different value — whether by overwrite, by explicit event or by collision — produces a revision event, surfaced and never applied silently. It carries both values and triggers the choice between a forward correction and a restatement of published figures.
4. **Absence means nothing by default.** A row missing from a new file is a deletion only if its batch **declares its scope**: "this batch exhaustively covers these keys over this period".
5. **Late arrival.** An old `valid_for` with a recent `asserted_at` is allowed and flagged: it touches published periods.
6. **Order.** A stream gives a total order per partition; files give none, so order by `asserted_at`, then by ingestion order.

### Three layers

| Layer | Knows | Ignores | Produces |
|---|---|---|---|
| **adapter** | the source's format and how revisions reach it | what columns mean | raw cells with their coordinates, in identified batches |
| **normalisation** — the ingestion configuration | the six questions per column | where the bytes come from | observation records |
| **resolution** | the join from labels to a standard nomenclature, then to a factor or an impact model | the format | an impact cause, linked and versioned |

This skill covers the first two layers. **Resolution is a separate process**: it treats values that are themselves data — machine, vehicle and department names, free-text purchase labels — by semantic join.

### Adapter contract

- `describe()` — kind of source; how revisions reach it; whether it can declare a scope; native keys; time semantics;
- `batches()` — batches with a stable identity;
- `cells(batch)` — raw cells and their coordinates.

Write the interface for all three adapter kinds; deliver only the one the case needs.

## Output: the analysis note

Written in the language the project uses for analyses, untracked:

1. the template recognised, or why none was;
2. how any existing classification was made, and what the evidence says of it;
3. geography: zones, what happens where, who does what;
4. flows, balances and orders of magnitude;
5. the preliminary process model: graph, stock table, process table;
6. the ingestion configuration, column by column;
7. the astonishment report;
8. questions (first rank, second rank, dropped) and the variance ranking;
9. consequences for open issues, and issues to open — public wording only;
10. sources, with URLs and sections.

End the report to the maintainer with an explicit list of what you need from them.

## Pitfalls

- Classifying units from their names alone.
- Taking a list of resource issues for an asset register.
- Treating the fuel issued to a unit as the fuel it burns.
- Asking a question without computing what its answer could change.
- Setting a per-item threshold instead of a global precision budget.
- Assuming errors are independent because the items are many.
- Presenting a chain of hypotheses as a value.
- Calling a stock residual a loss.
- Believing an append-only stream cannot revise.
- Comparing an intensity (per unit of product) with a total.
- Citing a section number without grepping for it.
- Writing client names or volumes into anything public.
