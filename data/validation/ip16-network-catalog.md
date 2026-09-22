---
date: 2026-09-22
author: Alina Lisova
status: PRELIMINARY
summary_heading: Bottom line
---

# IP16 network catalog and label–prefix associations

Research package built on the published collusion.wiki export. This document
describes the cataloged `/16` prefixes (`ip16`), the many-to-many association
between observed labels and prefixes, and the boundaries of what these
aggregates can and cannot support. It is a descriptive catalog, not an
attribution or coordination analysis.

## Research question

How are the published `ip16` prefixes distributed across the retained
write-side records, and what can label–prefix overlap establish (and not
establish) about the structure of this dataset?

## Bottom line

The catalog contains 198 distinct `/16` prefixes aggregated from 20,003
accepted source records. The label matrix contains 3,102 labels, 11,736 unique
label–prefix edges and 8,307 positive prefix pairs among 191 labeled prefixes.
1,741 labels (56.1%) occur on more than one prefix, but the overlap mass is
concentrated: 29 labels observed on 31 or more prefixes contribute 47.2% of the
71,869 total pair weight. `2.202` has a distinct deletion-dominated profile:
5,217 delete events versus 26 revisions, with all delete events carrying the
export label `[Admin1]`. The earliest canonical DSE revision is
`2026-05-24T06:02:19Z`, matching the public report's May 24 date for the first
successful write; because the report and export share provenance, this is an
internal consistency check rather than independent corroboration.

## 1. Scope and sources

Aggregation inputs (`data/raw/`, downloaded per `data/README.md`):

| File | Rows | Notes |
|---|---:|---|
| `revisions.jsonl.gz` | 14,591 | stored revisions, all carry `ip16` |
| `events.jsonl.gz` | 19,913 | 14,591 saves, 5,217 deletes, 4 reverts, 101 probes |
| `other-wikis.json.gz` | 90 revisions | recovered layer (publictestwiki, uncyclopedia, usemod), all carry `ip16`, no labels |

Supporting validation sources, read for cross-checks rather than aggregation:

| File | Rows | Notes |
|---|---:|---|
| `labels.jsonl.gz` | 3,103 | one row per label, one row has an empty label |
| `manifest.json.gz` | — | export metadata, generated 2026-09-03T03:42:36Z; write cut `write_date >= 2026-05-01` |

The manifest defines a derived metric as "Distinct validated IPv4 /16
prefixes on [`AgentRelent`](archive:agent) save requests" (`facts.agent_relent_save_request_ip16`);
that wording describes that metric, not the `ip16` field of every record. The
two-octet format of the field itself was checked directly in this package: all
198 distinct values match `^\d{1,3}\.\d{1,3}$` and both octets stay within
0-255, with no IPv6 forms in this snapshot. The script accepts any two
dot-separated numeric groups and does not range-check octets; the "validated"
qualifier belongs to the export side.

`ip16` is a truncated IPv4 network indicator containing only the first two
decimal octets (a `/16` prefix). It narrows an address to a coarse network
block and may support approximate network or provider attribution when
combined with time-appropriate routing and registry data. By itself, however,
it cannot identify a specific host, user, agent or person, and a registered
network holder is not necessarily the operator responsible for the observed
activity.

## 2. Reproducibility

```
python data/scripts/catalog_ip16.py
python -m pytest data/scripts/test_catalog_ip16.py
```

Run controls:

- `--max-distinct` (default 400): if the catalog has more distinct prefixes
  than this, the catalog mode becomes `preview` — `ip16_catalog.csv` is not
  written and `ip16_groups.json.catalog_preview` keeps only the top `--top`
  rows; totals stay complete.
- `--max-edges` (default 30000): the switch is decided by the number of
  label–prefix edges only. In preview, `ip16_label_edges.csv` and
  `ip16_label_pairs.csv` are both skipped together. This threshold does not
  bound the number of projected pairs, so preview mode is not a guarantee of
  bounded memory or runtime on larger inputs.
- The two modes are decided independently: the catalog threshold controls
  `ip16_catalog.csv`, the edge threshold controls both label-network CSV files.
  Both thresholds control CSV emission only; neither bounds input processing,
  memory use or runtime.
- `--top` (default 50): depth of `ip16_groups.json.catalog_preview`. The hub,
  multi-prefix-label and pair lists in `ip16_label_networks.json` are capped at
  25 entries in both modes.

Preview runs leave earlier CSV files untouched and print a warning when such
files exist; a CSV on disk may therefore belong to an older full run. Use
`ip16_run.json` (`modes`, `outputs`, `generated_at`) to tell which files a given
run produced; `outputs` lists only files written by that run, so stale CSVs
from an earlier run are not attributed to a preview run. Absence checks such as
"no `199.47` or `12.12`" must be run against a full catalog whose hash matches
`outputs`, never against a preview JSON.

Provenance: each run writes `data/processed/ip16_run.json`
with the UTC run
time, arguments, Python version, SHA-256 of the aggregation inputs, supporting
sources and the script file, the two run modes, output hashes and headline
totals. The tables in this document correspond to the full/full run recorded
there with `generated_at` 2026-09-22T03:01:59+00:00 and script hash
`f9474c1002e5f554319aaa88348dba3ace5c21a8e30eb29fd1bd1be035e29ecf`; in a
worktree with uncommitted changes that hash, not a commit id, identifies the
code that ran. SHA-256 values for the downloaded files listed in the
publisher's `SHA256SUMS` matched that list; script and generated-output hashes
are recorded separately for local run traceability. If the script changes or
any output is regenerated, update this run reference to the new manifest.

## 3. Method and count reconciliation

Aggregation rules, as implemented:

- A **retained source record** is a canonical or recovered revision row, or an
  event row, whose `ip16` passes the script's acceptance predicate. It is not a
  unique request, visit or agent.
- A **valid `ip16`** for the script is a non-empty value that splits on `.`
  into exactly two numeric groups; octet ranges are not checked. Records
  without a valid value are ignored. No normalization, case folding or
  cross-source deduplication is applied.
- **Revisions** aggregate revision rows (canonical plus recovered).
  **Events** aggregate event rows that carry `ip16` directly. In this export,
  all 14,591 raw save rows lack the `ip16` field and map one-to-one to the
  14,591 canonical revision rows through `revision_ref` → `rev_id`; every
  canonical revision row carries a valid `ip16`. For prefix-based aggregation,
  the catalog counts these canonical revision rows, not their linked save rows,
  and does not propagate `ip16` to the save rows. Its aggregated `save` event
  count is therefore zero, although the export contains 14,591 save rows. The
  90 recovered revisions are outside this mapping.
- Labels are excluded using the script's truthiness test; `null` and `""` are
  examples of excluded values. Labels are matched as literal strings
  (case-sensitive, no trimming). Event `actor_label` values are not part of the
  label matrix; it is built from revision labels only.
- `pages` counts distinct revision page-id values as stored in the source
  (`page_id` for canonical revisions, `page_key` for recovered rows);
  `event_pages` counts distinct page-name strings from delete and revert
  events. The two counters use different source-level identifiers, their
  uniqueness scope is the stored value alone (not `wiki` plus value), and they
  are not directly comparable as counts of unique wiki pages. Probes carry
  neither `wiki` nor `page` and contribute to neither counter.
- `first_utc`/`last_utc` are the min/max of the row time fields used by each
  source: `time` (fallback `write_date`) for revisions and `time` (fallback
  `t`) for events.
- A **label–prefix edge** is a unique `(prefix, label)` pair; its weight is the
  number of matching revision rows. Its total equals the number of revision
  rows with a valid `ip16` and a non-empty label. The complete
  `ip16_label_edges.csv` is a bidirectional lookup: filter by `label` to see
  the prefixes observed for that label, or by `prefix` to see every label
  observed under that `/16`. Its `rows` value counts repeated labeled revision
  rows for the exact pair; it does not count unique agents, sessions or
  requests, and excludes event-side `actor_label` occurrences.
- A **prefix pair** is unordered, without self-pairs; its weight is the number
  of distinct shared labels. Only pairs with at least one shared label are
  listed, and raw counts are not normalized: they favor prefixes with larger
  label sets.
- **/8 groups** group by the first octet only. They are not operator, owner or
  provider groups; no provider attribution or ASN/WHOIS/reverse-DNS enrichment
  is performed by this cataloging pipeline.

Count reconciliation, because several totals refer to different populations:

| Quantity | Value | Composition |
|---|---:|---|
| Canonical revisions | 14,591 | all carry `ip16` |
| Recovered revisions | 90 | `other-wikis.json.gz`, no labels |
| Revision rows with `ip16` | 14,681 | 14,591 + 90 |
| Event rows carrying `ip16` directly | 5,322 | Of 19,913 total event rows: 5,217 deletes + 4 reverts + 101 probes; the remaining 14,591 save rows reference revisions carrying `ip16` |
| Retained source records contributing to the catalog | 20,003 | 14,681 revisions + 5,322 events |
| Revision rows in the label matrix | 13,692 | 14,681 − 989 revision rows without a label |
| Distinct labels | 3,102 | 3,103 label rows minus one empty label; a direct check confirms the set of non-empty labels in `labels.jsonl.gz` equals the set of labels on revisions with `ip16` |
| Distinct prefixes, catalog | 198 | union over revisions, events and recovered rows |
| Prefixes with labels (matrix nodes) | 191 | canonical revisions only; recovered rows carry no labels |
| Possible prefix pairs | 18,145 | `C(191, 2)`, not `C(198, 2)` |
| Revision singletons | 20 | prefixes with exactly one revision row, independent of events |

Observed time bounds: canonical revisions 2026-05-24 to 2026-07-02, recovered
revisions 2026-05-11 to 2026-06-16, retained events with an accepted `ip16`
2026-05-17 to 2026-07-14. The `write_date >= 2026-05-01` cut belongs to the
export; the script applies no time filter of its own.

## 4. Findings — prefix catalog

198 distinct `/16` prefixes aggregated from 20,003 retained source records. 51
first-octet groups; the ten largest by records:

| Group | Prefixes | Records | Revisions | Events |
|---|---:|---:|---:|---:|
| 20.x | 59 | 8,543 | 8,511 | 32 |
| 2.x | 1 | 5,243 | 26 | 5,217 |
| 52.x | 27 | 1,295 | 1,254 | 41 |
| 4.x | 10 | 1,057 | 1,053 | 4 |
| 172.x | 13 | 757 | 756 | 1 |
| 57.x | 2 | 475 | 474 | 1 |
| 104.x | 7 | 438 | 434 | 4 |
| 135.x | 4 | 397 | 391 | 6 |
| 40.x | 9 | 335 | 334 | 1 |
| 64.x | 2 | 236 | 235 | 1 |

The remaining 41 groups are single- or few-prefix groups down to one record;
the long tail is visible in `ip16_groups.json`. 20 prefixes have exactly one
revision row.

Top prefixes by records (`Revision page ids` counts distinct revision page-id
values; `Event page names` counts distinct delete/revert page-name strings and
is zero for prefixes without such events):

| Prefix | Records | Revisions | Events | Delete | Probe | Labels | Revision page ids | Event page names |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2.202 | 5,243 | 26 | 5,217 | 5,217 | 0 | 1 | 6 | 5,144 |
| 20.165 | 612 | 608 | 4 | 0 | 4 | 430 | 389 | 0 |
| 20.69 | 592 | 592 | 0 | 0 | 0 | 401 | 394 | 0 |
| 57.154 | 459 | 458 | 1 | 0 | 1 | 344 | 328 | 0 |
| 20.171 | 457 | 457 | 0 | 0 | 0 | 340 | 310 | 0 |
| 20.97 | 422 | 418 | 4 | 0 | 4 | 308 | 298 | 0 |
| 20.225 | 418 | 418 | 0 | 0 | 0 | 306 | 288 | 0 |
| 20.9 | 411 | 410 | 1 | 0 | 1 | 303 | 283 | 0 |
| 20.168 | 409 | 407 | 2 | 0 | 2 | 304 | 274 | 0 |
| 4.255 | 361 | 358 | 3 | 0 | 3 | 273 | 259 | 0 |

`2.202` is deletion-dominated: 5,217 delete events against 26 revisions, and
all 5,217 delete events carry the single `actor_label` `[Admin1]` (5,144
distinct page names). This attributes the deletion events to that label in the
export; it does not establish ownership of the prefix or of any address in it.

The 101 probes span 46 prefixes, led by `52.87` (30), `20.165` (4), `20.97`
(4), and five prefixes with 3 probes each (`135.136`, `20.94`, `20.163`,
`185.220`, `52.159`). Seven prefixes appear only in the probe set and therefore
have no revisions, labels, wikis or page names: `135.136`, `36.140`, `36.134`,
`36.138`, `120.233`, `147.90` and `5.253`; they are the seven catalog prefixes
absent from the label matrix. Probes carry no `wiki` or `page` field, so no
provider or target attribution is made here.

## 5. Findings — label–prefix associations

3,102 labels, 11,736 `(prefix, label)` edges, 191 prefixes with at least one
label. 1,741 labels (56.1%) occur with more than one `/16` prefix.

Prefixes per label:

| Prefixes | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | … | 96 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| Labels | 1,361 | 537 | 321 | 195 | 142 | 105 | 83 | 64 | 44 | 33 | 24 | 27 | … | 1 |

Prefixes with the highest distinct-label counts (`Labeled revision rows` counts
only revision rows that carry a label, so it is lower than the record counts in
section 4):

| Prefix | Labels | Labeled revision rows | Top labels |
|---|---:|---:|---|
| 20.165 | 430 | 553 | [`AgentRelent`](archive:agent), [`LinkHelper771`](archive:agent) |
| 20.69 | 401 | 550 | [`AgentRelent`](archive:agent), [`LinkHelper771`](archive:agent) |
| 57.154 | 344 | 429 | [`AgentTestLearnXYZ`](archive:agent), [`AgentRelent`](archive:agent) |
| 20.171 | 340 | 429 | [`LinkHelper771`](archive:agent), [`MapHelper`](archive:agent) |
| 20.97 | 308 | 390 | [`MapHelper`](archive:agent), [`LinkHelper771`](archive:agent) |
| 20.225 | 306 | 387 | [`AgentRelent`](archive:agent), [`Agent`](archive:agent) |
| 20.168 | 304 | 380 | [`MapHelper`](archive:agent), [`LinkHelper771`](archive:agent) |
| 20.9 | 303 | 383 | [`LinkHelper771`](archive:agent), [`AgentRelent`](archive:agent) |

Top labels are the two most frequent labels for that prefix by edge weight; ties
are not ordered.

Labels observed across the most prefixes:

| Label | Prefixes | Labeled revision rows | Most-used prefixes |
|---|---:|---:|---|
| [`AgentRelent`](archive:agent) | 96 | 317 | 20.165 (14), 20.69 (10), 20.12 (10) |
| [`AgentMassPointer13`](archive:agent) | 81 | 187 | 20.69 (8), 4.255 (7), 20.165 (7) |
| [`MapHelper`](archive:agent) | 71 | 184 | 20.171 (10), 20.168 (8), 20.97 (7) |
| [`LinkHelper771`](archive:agent) | 69 | 176 | 20.171 (12), 20.69 (9), 20.165 (9) |
| [`AgentTestLearnXYZ`](archive:agent) | 63 | 130 | 57.154 (8), 20.12 (6), 20.69 (6) |
| [`ResearchHelper`](archive:agent) | 58 | 109 | 20.69 (6), 20.9 (5), 20.97 (5) |
| [`OpenAIResearchSec2028`](archive:agent) | 52 | 93 | 20.225 (6), 20.69 (6), 20.168 (4) |
| [`ResearchReaderMN`](archive:agent) | 50 | 93 | 20.69 (7), 20.165 (5), 20.245 (4) |

Labels are ordered by descending prefix count, then descending labeled
revision rows, then label string. At the 50-prefix tie,
`ResearchReaderMN` (93 rows) therefore precedes `AgentMapCite8x` (87) and
`Agent0AddJS` (73).

Prefix pairs sharing the most labels:

| Pair | Shared labels |
|---|---:|
| 20.165 ~ 57.154 | 104 |
| 20.165 ~ 20.97 | 103 |
| 20.165 ~ 20.171 | 101 |
| 20.165 ~ 20.69 | 100 |
| 20.165 ~ 20.168 | 99 |
| 20.69 ~ 20.97 | 98 |
| 20.171 ~ 57.154 | 93 |
| 20.114 ~ 20.165 | 92 |

### Pair count and overlap mass

For each prefix $p$, let $L(p)$ be its set of observed labels. For distinct
prefixes $p$ and $q$, define their overlap weight as:

$$
w(p, q) = |L(p) \cap L(q)|
$$

The output contains one row for each unordered pair $\{p, q\}$ with positive weight.

The two headline pair values measure different things:

- **8,307 pairs** is the number of distinct unordered prefix pairs with at
  least one shared label: one output row per pair with positive overlap.
- **71,869 total weight** is $\sum w(p, q)$ over those pairs. This is the
  number of `(prefix pair, shared label)` incidences. A pair sharing 104 labels
  contributes one pair but 104 units of weight.

Total weight can be counted either by prefix pair or by label:

$$
\sum_{\{p, q\}} w(p, q) = \sum_{\text{label}} C(d(\text{label}), 2) = 71{,}869
$$

Here $d(\text{label})$ is the number of distinct prefixes carrying that label. Each
label contributes once to every pair of its prefixes. For example,
[`AgentRelent`](archive:agent) occurs on 96 prefixes and therefore contributes
$C(96, 2) = 4{,}560$ incidences, 6.3% of the total weight.

The weight is concentrated in labels observed across many prefixes:

| Prefixes carrying a label | Labels | Contribution to total weight | Share |
|---|---:|---:|---:|
| 1 | 1,361 | 0 | 0.0% |
| 2–5 | 1,195 | 4,090 | 5.7% |
| 6–12 | 380 | 11,281 | 15.7% |
| 13–30 | 137 | 22,606 | 31.5% |
| 31+ | 29 | 33,892 | 47.2% |

Shares are rounded independently and may not sum to 100%. The 47.2% figure is
a share of total weight, not a share of distinct positive pairs; different
labels may contribute to the same pair.

Of 18,145 possible pairs among the 191 labeled prefixes, 8,307 have positive
weight and 9,838 have zero overlap and are omitted. Equality of the two sums,
combined with unique unordered pairs, no self-pairs and exact intersection
weights, verifies that the positive pair projection is complete relative to
the underlying prefix–label incidence data. Neither pair count nor total weight
is a normalized association measure. Both depend on label prevalence and the
sizes of prefixes' label sets. Shared labels alone do not establish a network
connection, data transfer, communication, or coordination between prefixes.

Among the 3,102 labels observed in revisions with both a valid `ip16` and a
label, 1,741 (56.1%) occur with more than one `/16` prefix. This describes
overlap in the retained records; these aggregates do not establish agent
continuity, shared ownership, or interchangeable infrastructure and do not by
themselves substantiate coordination. The associations are aggregated over the
whole retained snapshot: a shared label does not imply contemporaneous
activity, a temporal transition between prefixes, or communication between
them.

## 6. Interpretation boundaries

- `ip16` alone narrows a record to a coarse `/16` network block, but it cannot
  identify the address used or establish the specific host, user, agent,
  person, responsible operator or organization that produced the record.
  Approximate network or provider attribution requires separate,
  time-appropriate routing or registry enrichment.
- Labels are unverified strings. The same string may be reused across runs or
  copied from shared pages; label sharing is not evidence of shared identity or
  of the same agent changing networks.
- Label–prefix associations are aggregated across the entire retained
  snapshot. Shared labels do not imply contemporaneous activity, a temporal
  transition between prefixes, or communication between them.
- The export contains revisions and save/delete/revert/probe events, but no
  read-request or visit telemetry. The manifest records publisher checks
  `checks[name="request-derived URL strings retained"].actual = 0` and
  `checks[name="published IPs overlapping pre-2026"].actual = 0`; these are
  statements about the export, not independent proofs that no request
  information survives anywhere. Network behavior on the read side is
  invisible in this package.
- Snapshot scope: write cut `>= 2026-05-01`; the recovered layer is partial (90
  revisions, no labels) and covers three other wikis.

### External consistency checks

The earliest canonical DSE revision is `2026-05-24T06:02:19Z`. The
[collusion.wiki public timeline](https://collusion.wiki/#timeline) (accessed
2026-09-22) places the first successful DSEWiki write on May 24. Both
observations derive from the same investigation and underlying log set, so the
date alignment checks same-source consistency; it does not independently
validate the export's authenticity or completeness.

The public report also states that 98.5% of roughly 17,000 apparent agent edits
on DSEWiki came from Microsoft Azure IP addresses. This catalog cannot
reproduce that provider attribution from truncated `/16` values without
systematic historical routing or registry enrichment. In the retained data,
`20.x` accounts for 8,543 of 20,003 records (42.7%), 8,511 of 14,681 revision
rows (58.0%), and 7,754 of 13,403 canonical DSE revisions (57.9%). None is a
valid estimate of the report's 98.5%: the report groups all Azure-attributed
addresses and uses a different event population, while this catalog groups
only by first octet and does no provider enrichment. The distribution does not
contradict an Azure-heavy source, but it does not independently support or
reproduce the 98.5% figure.

Two proposed spot checks do not change that boundary: `20.196` is not present
in the catalog, and only `172.202` among the 13 observed `172.*` prefixes falls
inside the proposed `172.192.0.0/12` comparison block. Neighboring or partial
range matches are therefore not treated as provider evidence. A provider-level
test would require systematic, time-appropriate BGP/RDAP coverage of the
actually observed prefixes (and preferably the unavailable full addresses),
not isolated examples.

- Public report comparison. The [collusion.wiki public
  report](https://collusion.wiki/), section "We believe OpenAI discovered the
  message board", states that employee visits fell inside
  blocks registered to OpenAI OpCo, LLC and links RDAP records for
  `199.47.142.0` and `12.12.56.24`. Neither `199.47` nor `12.12`, their
  containing `/16` prefixes, occurs in the cataloged records. This comparison
  summarizes the report's attribution; it is not an independent attribution
  performed by this catalog. The export cannot independently reproduce or
  refute the report's claims about those visits.
- First-octet groups are not provider groups. No provider attribution or
  ASN/WHOIS/reverse-DNS enrichment is performed by this cataloging pipeline,
  and none should be inferred from the group labels.
- Prefix diversity in wiki records does not measure traffic to external
  services and cannot establish distributed clients, request rates, service
  overload, or the cause of any outage.

## 7. Conclusion

The `ip16` and label–prefix aggregates support a descriptive finding of broad,
concentrated many-to-many overlap between observed label strings and truncated
network prefixes. These aggregates do not by themselves substantiate
coordination or establish agent continuity, shared ownership, temporal
migration, provider identity, request volume, or outage causation. The
[Coordination topology assessment](/research?doc=coordination-topology)
concludes that content-level sequences substantiate local page-mediated
coordination at the archive-label level. Because the public export truncates
addresses and contains no read/visit telemetry, this package also cannot
independently reproduce or refute the public report's attribution of visits to
OpenAI. Its defensible use is as a reproducible structural catalog and a
baseline for separately scoped analyses.

## 8. Evidence ledger

| # | Claim | Population / filter | Artifact and selector | Limitation |
|---|---|---|---|---|
| C1 | 198 distinct `/16` prefixes | all catalog records | `ip16_catalog.csv`: unique `prefix` values (header excluded) | union of sources, not per-wiki |
| C2 | 20,003 retained source records | revisions + events with `ip16` | `ip16_run.json` `totals.rows`; equals `sum(catalog.rows)` | records are not unique requests or agents |
| C3 | `2.202` is deletion-dominated | catalog row `prefix = 2.202` | `ip16_catalog.csv`: `delete` = 5,217 vs `revisions` = 26 | single-prefix profile, no ownership claim |
| C4 | All `2.202` deletions carry `[Admin1]` | raw delete events with `ip16 = 2.202` | `events.jsonl.gz`: event count = 5,217 and the set of `actor_label` values equals exactly `{"[Admin1]"}` (no empty-value exclusion) | label is an export string, not a verified person |
| C5 | 11,736 unique label–prefix edges | revisions with `ip16` and label | `ip16_label_edges.csv`: unique `(prefix, label)`; `sum(rows)` = 13,692 | edge weights count source rows, not activity volume |
| C6 | 1,741 of 3,102 labels on >1 prefix | same population as C5 | `ip16_label_networks.json`: `totals.multi_labels` = 1,741, `totals.labels` = 3,102; distribution entries with key > 1 | overlap only; no continuity claim |
| C7 | Top pair shares 104 labels | all prefix pairs | `ip16_label_pairs.csv`: maximum `shared_labels` = 104 (`20.165 ~ 57.154`) | raw counts not normalized by label-set size; ties possible |
| C8 | No `199.47` or `12.12` prefixes | full catalog, not preview | `ip16_catalog.csv`: prefix lookup for both values | absence in this export; no read telemetry to test visit claims |
| C9 | 13,692 labeled revision rows | revisions with `ip16` and non-empty label | `sum(ip16_label_edges.csv.rows)`; equals raw revision count under the same filter | label strings are unverified |
| C10 | 5,144 distinct delete page names on `2.202` | raw delete events with `ip16 = 2.202` | `events.jsonl.gz`: distinct `page` values = 5,144 | page names are not unique across wikis |
| C11 | 101 probes across 46 prefixes | raw probe events | `events.jsonl.gz`: probe event count = 101 and distinct `ip16` = 46 | probes carry no `wiki`/`page`; no attribution |
| C12 | Export-side check values | manifest checks | `manifest.json.gz`: `checks[name="request-derived URL strings retained"].actual` = 0; `checks[name="published IPs overlapping pre-2026"].actual` = 0 | publisher statements, not independent proofs |
| C13 | Non-empty label set equals matrix label set | labels file vs matrix | `labels.jsonl.gz` non-empty label set == distinct `ip16_label_edges.csv.label` set; both set differences empty; each side has 3,102 elements | set equality checked in this package |
| C14 | Seven catalog prefixes are probe-only | catalog minus matrix nodes | prefix set difference between `ip16_catalog.csv` and `ip16_label_edges.csv` is exactly `135.136`, `36.140`, `36.134`, `36.138`, `120.233`, `147.90`, `5.253`; for each, `rows = events = probe > 0` and `revisions = delete = revert = save = 0` | probe-only records, no labels or pages |
| C15 | Pair projection is complete | all labels and prefix pairs | `ip16_label_pairs.csv`: `sum(shared_labels)` equals `sum over labels of C(d(label), 2)` where `d` is the number of prefixes carrying the label (71,869 in this run) | completeness of the projection, not of the underlying activity |
| C16 | Canonical DSE start aligns with the public timeline | canonical revisions with `wiki = dse` | `revisions.jsonl.gz`: minimum `time` = `2026-05-24T06:02:19Z`; collusion.wiki timeline: first successful DSEWiki write = May 24 | same publisher and underlying logs; consistency check, not independent corroboration |
| C17 | `20.x` shares differ by population | accepted records, revision rows, canonical DSE revisions | `ip16_groups.json`: 8,543 / 20,003 = 42.7% and 8,511 / 14,681 = 58.0%; `revisions.jsonl.gz`, `wiki = dse`: 7,754 / 13,403 = 57.9% | first-octet group, no provider attribution; none reproduces the report's all-Azure 98.5% claim |
| C18 | Proposed range spot checks have limited catalog coverage | full catalog prefix set | `20.196` is absent; among 13 observed `172.*` prefixes, only `172.202` falls numerically inside `172.192.0.0/12` | arithmetic coverage check only; no ASN or provider conclusion |
| C19 | Save rows map one-to-one to canonical revision rows in this export | `events.jsonl.gz` rows with `event_type = save`; canonical `revisions.jsonl.gz` rows only | 14,591 rows on each side; `revision_ref` and `rev_id` each have 14,591 unique non-empty values; their sets are equal with both differences empty; save rows have no `ip16` key and every canonical revision carries a valid `ip16` | export-level key correspondence only, not complete or globally deduplicated real-world writes; the 90 recovered revisions are outside this mapping |

## 9. Artifacts

| Artifact | Content |
|---|---|
| `data/scripts/catalog_ip16.py` | catalog and label–prefix aggregation, verification invariants (including pair-projection completeness), preview thresholds, run manifest |
| [data/processed/ip16_catalog.csv](/data/ip16_catalog.csv) | 198 rows: per-prefix records/revisions/events/per-type counts, labels, revision page ids, event page names, wikis, first/last UTC |
| [data/processed/ip16_groups.json](/data/ip16_groups.json) | meta, totals, 51 first-octet groups, top-50 catalog preview |
| [data/processed/ip16_label_edges.csv](/data/ip16_label_edges.csv) | 11,736 rows: `prefix,label,rows` |
| [data/processed/ip16_label_pairs.csv](/data/ip16_label_pairs.csv) | 8,307 rows: `prefix_a,prefix_b,shared_labels` |
| [data/processed/ip16_label_networks.json](/data/ip16_label_networks.json) | totals, prefixes-per-label distribution, top hubs, top multi-prefix labels, top shared pairs |
| [data/processed/ip16_run.json](/data/ip16_run.json) | run provenance: UTC time, argv, Python version, input/supporting/script/output SHA-256, modes, headline totals; `outputs` lists only files written by that run |

The six `data/processed/` artifacts are published on the site and download
directly from `/data/`; the `data/scripts/` entries are repository sources and
are not part of the site build.

## 10. Related analyses

- [Coordination topology assessment](/research?doc=coordination-topology):
  concludes that content-level sequences substantiate local page-mediated
  coordination at the archive-label level. That assessment leaves the proposed
  hierarchy unproven, but does not rule it out. This catalog does not
  independently evaluate that coordination finding; label–prefix overlap is
  not presented here as additional evidence for it.

