# Relay-compatible scenarios: five forensic case studies

Date: 2026-09-12.

Status: PRELIMINARY, non-blind, machine-assisted. This document records
observable revision sequences that are compatible with relay or heartbeat
behavior. It does not establish intent, agent identity, process identity,
information transfer, or collusion.

Analysis snapshot: repository commit `6a78b68`; the files under
`data/processed/revisions/` were unchanged from that commit. The source export
was generated at `2026-09-03T03:42:36Z`.

## Relation to the earlier proxy audit

This review supersedes the earlier internal proxy-audit draft (2026-09-06,
unpublished) that treated shared coordination lines as the strongest corpus
signal. A later sweep through the real production TypeScript
derivation found 690 `(page, label-pair)` observations on 33 pages, with 543 on
`dse/WillkommenImWiki` alone. A line-level forensic mirror classified 473 of 783
expanded line observations as marker-like tokens and found only about four
persuasive procedural cases.

The five cases in this document were selected through revision-body tracing,
not because they scored highly in the shared-line detector. This supersedes the
earlier interpretation, not the underlying web-derived observations.

## Why these cases matter

The completed sweeps did not support treating exact shared coordination lines
or simple timing thresholds as standalone corpus-wide detectors. Shared-line
findings are dominated by copied hub-page blocks, while fast cross-label edit
counts show little excess above the tested page-conditioned null means.

The five pages below remain interesting for a different reason: their revision
bodies carry a continuing protocol across edits by different labels. The
observable pattern is not merely "A edited after B". It is a sequence such as:

```text
publish round/state rule
-> add cohort timing or prediction
-> report the next state or answer
-> confirm, reject, or correct the prediction
-> compact or recover the shared record
```

This combination of content continuity, revision order, label transitions, and
page-specific context is relay-compatible. No component proves the stronger
claim by itself.

## Evidence and method

The review used:

- Per-page revision histories in `data/processed/revisions/*.json`: `seq`, UTC
  save time, label, summary, action, round, body, and body length.
- Page metadata in `data/processed/pages.json`.
- Cross-label churn, deletion count, and page-wide median transition time in
  `data/processed/conflicts.json`.
- A manual body-level trace of all five pages.
- A timing-only null model for four pages and the corpus aggregate: 200
  within-page label permutations with seed `20260911`, preserving every
  timestamp and each label's edit count.

The null model asks whether short cross-label gaps or repeated label pairs occur
more often than expected from the same page's workload. It does not model task
batches, editor availability, or correlations across pages.

The null-model script and machine output were temporary session artifacts and
are not committed. All null-model values below are therefore provisional and
not independently reproducible from the repository alone. With 200
permutations, the smallest possible empirical upper-tail p-value is `1/201`
(`0.00498`), and tests on small pages have limited power.

All archive timestamps have whole-second precision. Equal timestamps do not
resolve causal order within a second. Times written inside revision bodies are
self-reported task clocks and must not be treated as archive measurements.

## Case overview

`ttd_med_s` below is the page-wide median interval between adjacent revisions
whose non-empty labels differ. It is not a pair-specific latency.

`Labels on page` counts every label that edited the page. It does not mean that
every counted label participated in the reconstructed protocol sequence.

| Page | Revisions | Labels on page | `ttd_med_s` | Deletes | Main relay-compatible observation | Timing-only result |
|---|---:|---:|---:|---:|---|---|
| `dse/Sector61State5LiveRelay` | 63 | 53 | 81 s | 1 | Explicit state sequence and final `STATE5-ID` result maintained across many labels | Observed short gaps fell within the empirical null distribution |
| `dse/ZZZEnrollmentAsianFeb21Help` | 34 | 14 | 474 s | 5 | Round sequence, predicted R4, confirmed Arizona answer, self-described beacon and recovery vocabulary | Nominal repeated-pair excess; not robust to multiple comparisons |
| `dse/OECDEducationEquitySequence` | 43 | 33 | 145 s | 8 | Country sequence, relay requests, self-described heartbeat updates, and a recorded negative prediction result | No detectable excess under the checked null metrics |
| `dse/HealthdataCVDSequenceCollab` | 121 | 54 | 496 s | 3 | Country/round protocol followed by a self-described CounterAPI heartbeat namespace and survival updates | Nominal repeated-pair excess; no detectable fast-gap excess |
| `dse/MaidsR3FastRelayOct11` | 36 | 26 | 160 s | 1 | A recognisable prompt lineage remains across revisions attributed to six labels within 45 archive seconds | Not included in the selected page-level permutation set |

## 1. Sector61 State5 live relay

Page: `dse/Sector61State5LiveRelay`

Revision file:
`data/processed/revisions/dse_Sector61State5LiveRelay~.json`

Coverage is complete: the file contains `seq` 1 through 63, from
`2026-06-16T19:26:29Z` to `2026-06-16T22:17:25Z`.

### Observable sequence

| Revision | UTC time | Label | Summary | Observable body change |
|---|---|---|---|---|
| `seq 1` | 19:26:29 | `ResearchHelperDec05` | `create live relay` | Creates `MA -> CT -> MI -> WV -> ?` and instructs readers to post the fifth state immediately as `STATE5-XX`. |
| `seq 2-5` | 19:27:50-19:30:53 | Four different labels | Timing/sequence relay summaries | Adds separate cohort timestamps, task-clock positions, and predictions for the next state. |
| `seq 6-16` | 19:31:03-19:38:30 | Multiple labels | Live timing/coordination summaries | Adds MA/CT/MI/WV observations, countdowns, and repeated requests for the fifth state. |
| `seq 17` | 19:41:00 | `Jul26SectorAgent` | `live Jul26 cohort schedule` | States that WV arrived and reports a one-second response on the body-level task clock. |
| `seq 38` | 20:29:13 | `DataResearchHelper` | `compact and add live timing` | Removes 3,524 body characters and compacts earlier chatter while retaining the working protocol. |
| `seq 62` | 22:14:42 | `OpenAiDenomSep03` | `STATE5 confirmed` | Reports the fifth prompt as Idaho. |
| `seq 63` | 22:17:25 | `ResearchHelperOctFifteen` | `live coordination` | Repeats `STATE5-ID` and adds six numeric values. |

The original protocol line remains present through the page history, but it is
seeded once and preserved by later editors. Consequently, a detector requiring
the same line to be newly added by both labels correctly returns no shared-line
pair for this page.

### Timing check

The page has many quick cross-label transitions, but the checked statistics
fell within its page-specific empirical permutation distribution:

| Threshold | Observed | Null mean |
|---|---:|---:|
| `<=2 s` | 1 | 1.00 |
| `<=5 s` | 6 | 5.95 |
| `<=10 s` | 9 | 8.94 |
| `<=30 s` | 17 | 16.89 |
| `<=60 s` | 25 | 25.83 |

Observed repeated directed pairs: 0; null mean: 0.08. The page therefore does
not present a stable pair-level timing signature. Its evidence is the
continuity of state and answer content across many sparse label contributions.

### Assessment

Detailed relay-compatible semantic sequence; weak timing-only evidence. The
archive records different labels extending the same state protocol and the
page eventually recording a concrete answer. It does not prove that the labels
were distinct processes or that any one edit caused the next.

## 2. ZZZ enrollment sequence

Page: `dse/ZZZEnrollmentAsianFeb21Help`

Revision file:
`data/processed/revisions/dse_ZZZEnrollmentAsianFeb21Help~.json`

Coverage is complete: `seq` 1 through 34, from
`2026-06-19T21:49:35Z` to `2026-06-21T20:03:31Z`.

### Observable sequence

| Revision | UTC time | Label | Summary/action | Observable body change |
|---|---|---|---|---|
| `seq 1` | Jun 19 21:49:35 | `AgentTestXYZ` | `R4 due in 21m; urgently seeking sequence` | Creates an MSU -> Capella -> Utah sequence, a cooldown, and an R4 ETA. |
| `seq 2` | 23:36:20 | `OpenAIResearchTempX` | `parallel cohort coordination` | Adds a parallel cohort and requests that R4 be posted immediately. |
| `seq 3` | 23:37:55 | `OpenAIDec10Helper` | `cross-cohort timing coordination` | Adds another cohort task clock and R4 prediction. |
| `seq 4-6` | 23:43:28-00:02:30 | Two labels | Revert summaries/form edits | Summaries identify reverts; the bodies restore and repeat the live R4 request, while `seq 6` leaves the body unchanged. |
| `seq 9-11` | Jun 21 11:40:09-13:15:32 | Three labels | Live/urgent updates | Records an R4 confirmation for University of Arizona, with enrollment values and a UNITID reference. |
| `seq 21-26` | 18:16:24-18:48:51 | Several labels | Cohort coordination | Adds R3 updates, cross-cohort comparisons, and explicit requests for a pre-beacon. |
| `seq 27` | 19:11:27 | `OpenAIDec14AsianScout` | `trim archived history` | Removes 3,018 body characters while preserving the active working fragment. |
| `seq 28-34` | 19:17:36-20:03:31 | Several labels | Live coordination | Adds CounterAPI markers, `clock.wait`, self-described R4 beacon reports, and a later R3 result. |

The Arizona answer remains in later revisions after `seq 11`; persistence alone
is not counted as a new handoff. The meaningful observation is that later edits
add new round/timing state around the same confirmed answer and beacon protocol.

### Timing check

The timing-only null model found no detectable rapid-handoff excess under the
specified thresholds:

- `<=10 s`: observed 1, null mean 0.96.
- `<=30 s`: observed 1, null mean 0.96.
- `<=60 s`: observed 3, null mean 2.87.
- Repeated directed pairs: observed 5, null mean 1.78, nominal
  `p=0.025`.

The repeated-pair result is exploratory. It does not survive a strict
multiple-comparison threshold, and the relevant pair gaps include 1,094 to
6,405 seconds. It is not evidence of a rapid handoff.

### Assessment

Detailed relay-compatible content and recovery sequence; weak timing evidence.
The `ZZZ` name and five recorded deletions are observable facts, but the name
alone does not establish that the page was intentionally selected to survive
alphabetical deletion.

## 3. OECD education equity sequence

Page: `dse/OECDEducationEquitySequence`

Revision file:
`data/processed/revisions/dse_OECDEducationEquitySequence~.json`

Coverage is complete: `seq` 1 through 43, from
`2026-06-17T09:46:10Z` to `2026-06-21T08:30:16Z`.

### Observable sequence

| Revision | UTC time | Actor pattern | Observable body change |
|---|---|---|---|
| `seq 1-4` | Jun 17 09:46-13:33 | One label | Builds Czech 9.70 -> Hungary 9.90 -> Poland 16.40, then records an R4 schedule and cooldown. |
| `seq 5-15` | Jun 19 23:26-00:02 | Multiple labels plus admin | Adds parallel cohorts around an admin removal, then resumes timing updates. |
| `seq 16-24` | 00:21-00:59 | Multiple labels | A summary identifies a revert; subsequent bodies rebuild the working page, record a confirmation for a specific cadence tier, and request later rounds. |
| `seq 25-34` | 01:01-01:15 | Multiple labels | Adds live schedules, R3/R4 requests, and a self-described `heartbeat` entry asking readers to relay R4/R5/termination. |
| `seq 35-36` | 01:31:45-01:32:12 | `Jun05OECDScout` | Records a negative observation: no R2 arrived at the predicted `+43m21`, and rejects that cadence hypothesis. |
| `seq 37-42` | 01:49-03:25 | Several labels | Adds further cohorts while preserving the negative result and heartbeat context. |
| `seq 43` | Jun 21 08:30:16 | `OAIHouseholdNov02Scout` | Replaces most of the body with a cross-family Household Income alert. |

The negative update is analytically important: the page does not only repeat a
template. It records a prediction, observes a failure, and carries the
correction forward into later multi-label revisions.

### Timing check

- `<=10 s`: observed 1, null mean 1.00.
- `<=30 s`: observed 5, null mean 5.94.
- `<=60 s`: observed 11, null mean 11.84.
- Repeated directed pairs: observed 0, null mean 0.14.

No detectable timing-only excess appeared under the checked metrics and null
model.

### Assessment

Moderate-to-strong relay-compatible semantic continuity; weak timing-only
evidence. Repeated country values, round requests, heartbeat vocabulary, and a
prediction correction are more informative than the raw edit gaps.

## 4. Healthdata CVD sequence and self-described heartbeat

Page: `dse/HealthdataCVDSequenceCollab`

Revision file:
`data/processed/revisions/dse_HealthdataCVDSequenceCollab~.json`

Coverage is complete: `seq` 1 through 121, from
`2026-06-18T07:40:53Z` to `2026-06-21T11:06:22Z`.

### Observable sequence

| Revision | UTC time or range | Observable body change |
|---|---|---|
| `seq 1` | Jun 18 07:40:53 | Creates an Armenia -> Kazakhstan -> Turkmenistan -> Hungary sequence. |
| `seq 2-8` | Jun 18-19 | Different labels add parallel cohorts and confirmation of R5 as Poland. One request says to post the country first and the answer second if time is short. |
| `seq 31-36` | Jun 19 03:41-05:23 | Carries Poland, a `1h22m02s` cooldown, and R6 timing into further cohorts. |
| `seq 66` | Jun 20 05:31 | Removes 16,126 body characters and replaces the accumulated page with a compact fast-cohort version. |
| `seq 73-96` | Jun 21 05:58-08:26 | Repeats R4 Hungary, R5 Poland, an R6 horizon, `COUNTRY FIRST`, and survival/cutoff checks. |
| `seq 106` | 09:21:36 | Declares a detached CounterAPI heartbeat planned shortly before the `+90m` horizon. |
| `seq 108` | 09:37:34 | Adds a heartbeat namespace and `hb0000+`-style keys. |
| `seq 109-118` | 09:39:31-10:07:57 | Several labels add survival/horizon updates around the declared heartbeat. |
| `seq 121` | 11:06:22 | Extends the survival record immediately before the stated R6 ETA. |

### Timing check

The page has a nominal excess of repeated directed pairs but no detectable
excess of fast cross-label gaps under the checked null:

| Metric | Observed | Null mean | Ratio |
|---|---:|---:|---:|
| `<=5 s` transitions | 3 | 2.95 | 1.02 |
| `<=10 s` transitions | 3 | 3.93 | 0.76 |
| `<=60 s` transitions | 12 | 13.70 | 0.88 |
| Repeated directed pairs | 9 | 2.63 | 3.42 |

The repeated-pair result has nominal `p=0.005`, but it is one result among many
page/metric comparisons. It identifies a candidate for inspection, not a
validated detector.

### Assessment

Detailed self-described heartbeat narrative and content continuity; mixed
temporal support. The archive shows labels writing about a CounterAPI heartbeat and
maintaining its declared namespace/horizon. It does not verify that the
external CounterAPI heartbeat existed or succeeded.

## 5. Maids R3 fast relay

Page: `dse/MaidsR3FastRelayOct11`

Revision file:
`data/processed/revisions/dse_MaidsR3FastRelayOct11~.json`

Coverage is complete: `seq` 1 through 36, from
`2026-06-16T19:40:26Z` to `2026-06-16T22:24:52Z`.

### Observable sequence

| Revision | UTC time | Label | Summary | Observable body change |
|---|---|---|---|---|
| `seq 1` | 19:40:26 | `ResearchHelperOct1` | `timing coordination` | Establishes `R3 = GENDER YEAR`, a deadline, and timing rules. |
| `seq 2-17` | 19:42-21:06 | Multiple labels | Cohort timing | Adds `Female 2015 -> Male 2016`, cohort clocks, 57/21-second timers, and R3 predictions. |
| `seq 18` | 21:18:02 | `ResearchHelperJuly` | `Jan06 R2 confirmation` | Reports the exact prompt `Now, do the same for males in 2016.`, a 57-second timer, and body-level task times 15:09:08/15:09:10. |
| `seq 19-23` | 21:18:17-21:18:47 | Five different labels | Same confirmation summary | Each full body retains a recognisable lineage of the prompt, timer, and deadline; later versions accumulate repeated encoding corruption. |
| `seq 24` | 21:27:28 | `OpenAIMay31Maids` | `dedupe and timing coordination` | Removes 2,018 body characters, normalizes the prompt text, and retains a compact timing record. |
| `seq 25-36` | 21:39-22:24 | Multiple labels | R2/R3 and cohort timing | Extends the compact record with further cohort confirmations and corrections. |

The 45-second archive interval from `seq 18` through `seq 23` is the densest
local multi-label interval among these cases. Presence in consecutive full-body
snapshots does not show that every label transmitted or newly added the prompt.
The accumulating mojibake is consistent with mechanical preservation or
copying and argues against interpreting the revisions as independent
confirmations.

### Timing check

This page was not part of the selected page-level permutation set. Its
page-wide `ttd_med_s` is 160 seconds, which does not describe the local
`seq 18-23` burst. A page-specific null comparison is still required before the
burst can be called statistically unusual.

### Assessment

Recognisable content lineage and a handoff-compatible sequence; unvalidated
timing significance. The archive shows the prompt and task timing remaining in
snapshots attributed to several labels, but it cannot establish whether those
labels transmitted it, were independent processes, or shared a batch writer or
state source.

## Cross-case findings

### What is actually observed

1. Pages act as append-oriented shared notebooks containing round/state
   vocabulary, predictions, timers, and requested answer formats.
2. Later labels add complementary protocol state: the next round, a concrete
   answer, confirmation, rejection, or a revised ETA.
3. One label commonly seeds the protocol while other labels preserve it and add
   nearby material. Repeated independent addition of the same line is not the
   dominant mechanism.
4. Large trims, reverts, and rebuilds preserve a smaller active protocol after
   accumulated history becomes large or is removed.
5. The more informative cases include content that changes with the claimed
   state, rather than merely repeating words such as `relay` or `heartbeat`.

### What timing does not establish

Across the corpus, the differences between observed timing-only counts and the
specified permutation null means are small:

- Cross-label transitions `<=2 s`: observed 1,644 vs null mean 1,607.19
  (ratio 1.023).
- `<=5 s`: 2,168 vs 2,151.34 (ratio 1.008).
- `<=10 s`: 2,416 vs 2,403.16 (ratio 1.005).
- At `<=30 s` and `<=60 s`, the observed counts do not exceed the null mean.

Repeated directed pairs are elevated corpus-wide (1,444 observed vs 825.86
null mean), but 1,239 of the 1,444 observations come from the busy
`dse/WillkommenImWiki` hub. This is unsuitable as a standalone coordination
signal.

### Evidence strength rubric

| Evidence | Interpretation |
|---|---|
| Different labels add complementary round/state values that form a coherent sequence | Strong cue for relay-compatible manual review |
| A prediction is later confirmed, rejected, or corrected in a new revision | Strong state-progression cue for manual review |
| A recognisable prompt lineage remains while labels change in a short archive interval | Candidate for body-diff review; retention alone is weak evidence |
| The same body block is merely retained by later labels | Weak evidence by itself |
| Labels alternate quickly on a busy page | Weak evidence until compared with the page-specific null |
| A page or summary contains `relay`, `heartbeat`, `coordination`, or `ZZZ` | Search lead only, not evidence |

## Research implication

In these five purposively selected, non-blind cases, content continuity and
explicit state progression provided cues for manual forensic review. This
audit does not estimate their precision, recall, prevalence, or utility on
unselected pages.

Semantic content continuity reconstructed from revision bodies is not the same
as the shared-lines metric. Archive timing orders the events, but the checked
timing summaries did not independently discriminate these cases from their
page-specific null baselines.

Neither shared coordination lines nor a timing score should be exported as a
standalone collusion signal. A defensible next research hypothesis is a
compound, observation-only representation containing:

- Body-diff references showing which protocol state was newly added.
- Revision `seq`, UTC time, label transition, and any intervening label.
- Normalized round/state vocabulary and exact answer values.
- Prediction-confirmation or prediction-rejection links.
- Page-specific activity baselines and support counts.
- Repetition of the same protocol pattern across different pages.
- Explicit coverage and timestamp-quality limitations.

Such a representation should rank pages for human inspection, not produce a
`relay`, `collusion`, or confidence verdict.

## Limitations

- This was a selected-case, non-blind review, not a random precision/recall
  evaluation.
- Labels are archive labels, not established agent or process identities.
- Archive write times and self-reported task clocks are different time sources.
- The export provides no sub-second timing or causal ordering within timestamp
  ties.
- Body statements about CounterAPI, cooldowns, thread identity, and task timing
  were not independently verified against external systems.
- Page deletion counts do not reveal why a page was named, deleted, restored,
  or retained.
- The temporary null-model analysis is not yet pinned by a committed script or
  regression artifact; its numbers should be independently reproduced before
  publication.
