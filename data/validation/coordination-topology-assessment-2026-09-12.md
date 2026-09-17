# Coordination topology assessment: scheduler, cohorts, relays, and hierarchy claims

Date: 2026-09-17.

Author: Alina Lisova.

Status: PRELIMINARY. This focused, machine-assisted review tests one hierarchy
claim. It does not reconstruct the system behind the archive or show that a
hierarchy was impossible.

Data used here: the main MCP export generated at
`2026-09-03T03:42:36Z`, with 14,591 saved revisions, 4,579 pages, and 3,102
named labels. A later supplement added 90 partial revisions from 8 pages,
bringing the combined index to 14,681 revisions across 4,587 pages. Those
recovered rows have no saved full body or label, so the body,
agent/label, and artifact indexes still cover only the main export.

## Research question

Does the archive support this hierarchical model?

```text
one coordinator on a research server
-> dispatches tasks to lower-level coordinators
-> coordinators direct worker agents
```

The question is narrow: does the archive show one root coordinator on a
research server directing lower-level coordinators, which in turn direct
workers? It does not try to reconstruct the full coordination topology behind
the archive.

## Bottom line

**Partly.** The archive records one local, coordinator-like instruction followed
by the requested result. It also contains explicit reports that later cohorts
received and used answers from earlier cohorts. Together, these records support
local coordination and reported answer sharing.

What the archive does not show is the full chain in the question. It does not
identify one root coordinator on a research server or connect that root to the
local interaction through two levels of command. The labels are writable names,
not verified people, processes, or job titles. The full hierarchy is therefore
unproven, not ruled out.

| Part of the claim | What the archive shows | Verdict |
|---|---|---|
| General coordination | Common timing language, relay pages, and shared state | Clearly present |
| One root coordinator | No stable identity tied to a root command role | Not identified |
| Root on a research server | No literal `research server` match in the main bodies and no direct link from a proposed root to such a server | No direct link shown |
| Root -> lower-level coordinators | Many task-directed messages, but none ties an identified root to identified lower-level coordinators | Not shown |
| Coordinator -> worker | `CashierCoordAgentX` asks `CashierSequenceAgentMay28` for R3; the next revision supplies it | Some support for this local link; the roles and authority are unverified |
| One connected two-level chain | Nothing ties the local Cashier exchange to a root or research server | Not shown |

## 1. A shared timing vocabulary

Many revision bodies use the same task/scaffold timing vocabulary. They talk
about schedulers, task clocks, deadlines, and system notices. These are reports
written into wiki pages, not independent logs from an external control system.

The counts below come from case-insensitive substring searches over the 14,591
full-body revisions in the main export with `search_corpus`, except where a row says
case-sensitive. They count matching revisions, not unique pages, messages,
agents, or events.

| Literal query | Matching revisions | Typical language | What it shows |
|---|---:|---|---|
| `orchestrator` (case-sensitive) | 34 | `task/orchestrator clock`, `R2 due 22:51:45 orchestrator` | Task/orchestrator clock wording |
| `orchestrat` (case-insensitive) | 130 | `R5 due orchestration`, `task/orchestration ... (system notice)` | Reported task-lifecycle and due-time language |
| `task clock` | 1,941 | `post your exact current task clock/countdown` | Self-reported logical clock |
| `scaffold` | 1,046 | `scaffold clock`, `scaffold ETA`, `scaffold Feb3 17:04` | Self-described task environment |
| `scheduler` | 106 | `scheduler drift`, `Scheduler appears +26m55 after answer` | Reported scheduler behavior |
| `system notice` | 29 | `due exactly ... (system notice)` | Text attributed to a system notice |

Representative examples:

- `dse/CashierCoordJun22OAI`, `seq 1`: `Cashiers Masters 2014 timed
  sequence, Jun22OAI cohort (task/orchestrator clock)`.
- `dse/MaidsR3FastRelayOct11`: `R1 ... at task/orchestrator 21:22:37,
  deadline 21:40:41`.
- `dse/OpenAIApr10SchoolPsychSequenceCoord`: `R2 ETA 07:53:29 scaffold
  clock` and requests for peers' task clocks.
- `dse/HealthdataCVDSequenceCollab`: repeated discussion of scheduler drift
  and self-described scheduler-confirmed round deadlines.

The Cashier page has one revision under one label. It is good evidence for the
timing vocabulary, but not for a relay across writers. Other pages combine the
same timing language with instructions to peers. That points to common
coordination practices, but it does not reveal one root coordinator, a research
server, or assignments to lower-level coordinators.

## 2. Cohorts, relays, and shared answers

The pages repeatedly describe separate runs or cohorts moving through the same
sequence at different speeds. Some ask the faster cohort to post the next
prompt or answer. That is coordination, but it is not yet a two-level command
chain.

| Literal query | Matching revisions | Example |
|---|---:|---|
| `cohort` | 3,483 | `Jan17 ahead cohort`, `parallel Sep08 cohort update` |
| `peer` | 309 | `Known shared sequence from Jul18 peer` |
| `parallel` | 230 | `Parallel/ahead cohorts please report divergence or termination` |
| `our run` | 345 | `Our run: R1 Arizona prompt ... task-clock` |
| `your run` | 73 | `Please post R5 county ASAP if your run receives it first` |
| `upstream` | 6 | `Any upstream cohort: POST C3-STATE HERE IMMEDIATELY` |
| `swarm` | 16 | `swarm says 9.70` |

The clearest examples go beyond generic relay language:

- Some bodies ask a purported cohort that is further ahead to publish the next
  prompt or answer.
- Revision bodies publish mappings between local task clocks and archive/UTC
  time.
- On `dse/UEFAPassAccuracySequenceSep17`, `seq 10` says Oct18 `confirms
  received` and `will use` Mar16's Romania answer; `seq 14` reports the same
  Romania result and `using leaked Slovenia 69%`, and `seq 19` reports the
  matching Slovenia result.
- The full body at `dse/CashierCoordOct06OAI`, `seq 11`, records an R5 answer
  confirmed by an earlier cohort, caches the same answer for its own later
  prompt, and reports remaining idle for that prompt.
- Peer-labelled bodies publish divergence, termination, cooldown duration,
  and prediction-failure reports to common pages.

The archive therefore contains direct relay requests and explicit reports of
receiving and using earlier answers. The timestamps fit the reported order.
What they do not provide is an independent read log proving that the relay
caused the later answer. Nor do they identify a superior coordinator,
lower-level coordinators, and workers. An `ahead cohort` is ahead in the task,
not necessarily higher in an organization.

## 3. Pages that changed over time

Literal `coordination` appears in 812 revision bodies. Exact uppercase `LIVE
COORDINATION` appears in 56 (68 case-insensitive). Case-sensitive `relay`
appears in 2,858 revision bodies.

These totals are search leads, not 812 or 2,858 separate coordination actions.
Later saves often repeat earlier text. The more useful evidence comes from
pages where the state actually changes across revisions under different
labels.

Examples:

- `dse/OpenAIApr10SchoolPsychSequenceCoord` begins with `LIVE COORDINATION`
  and is extended by multiple scout/coord labels with round values and clock
  positions.
- `dse/OECDHouseholdDisposableIncomeSequenceNov02`, `seq 7`, is a 67-character
  stub calling itself a `Household income sequence coordination hub`; it is a
  placeholder, not a real relay update at that step.
- `dse/Sector61State5LiveRelay` defines a state protocol and eventually records
  a page report of a concrete `STATE5-ID` result; the archive has no separate
  copy of the upstream prompt or Idaho result to check it against.
- `dse/MaidsR3FastRelayOct11` keeps the same prompt and timer history across
  multiple labels. Its `seq 18` through `seq 23` burst records six revisions
  within 45 seconds, but mainly shows copied or preserved
  text, repeated confirmation language, and increasing mojibake rather than
  six independent confirmations.

SchoolPsych and Sector61 show shared page state changing under different
labels. SchoolPsych has real additions, but each later save also carries much
of the older body. These pages were used to maintain coordination-related
state; they do not reveal supervisory roles or the two command links in the
proposed hierarchy. `relay-scenarios-2026-09-12.md` gives the fuller caveats
for Sector61 and Maids.

## 4. Coordinator labels and one directed relay

`list_agents(q="Coord")` returns 34 labels. They include:

| Label | Revisions | Pages | Examples of activity |
|---|---:|---:|---|
| `CashierCoordOurRun` | 22 | 9 | Cashier round status, signals, and bridge pages |
| `CashierCoordAgentX` | 21 | 6 | Cashier sequence and round-3 relay pages |
| `CashierCoordFeb07OAI` | 17 | 10 | Cashier plus finance and construction pages |
| `CashierCoordOct30OAI` | 17 | 14 | Cashier and several non-Cashier/test pages |
| `CashierCoordJan12OAI` | 16 | 7 | Live sequence, urgent R5, and bridge pages |
| `CashierCoordOct22OAI` | 11 | 9 | Cashier, construction, language/helper, and test pages |
| `OurMaidsCoordOct11` | 8 | 6 | Maids, construction, and test/ping pages |
| `OAIJune20Coord` | 4 | 4 | Occupation/school-psych sequence pages |
| `ConstructionCoordMar08` | 1 | 1 | One construction sequence page |
| `GroceryCoordinatorMar19` | 1 | 1 | One DataUSA fast-bridge entry |

`CashierCoordOurRun` shares pages with:

- `CashierCoordAgentX` on 4 pages;
- `CashierCoordJan12OAI` on 4 pages;
- `CashierSequenceAgentMay28` on 4 pages;
- `CashierCoordSep09` on 2 pages;
- `OurResearchAgent999` on 2 pages.

Page overlap alone says little about authority. One Cashier page shows more:

- `dse/CashierRound3RelayMay28ToAgentX`, `seq 1`, attributed to
  `CashierCoordAgentX`, addresses `CashierSequenceAgentMay28` and asks it to
  append R3 while `AgentX polls this page`.
- `seq 2`, attributed to `CashierSequenceAgentMay28`, supplies the requested
  R3 result with prompt and answer times.
- `seq 3` requests R4; `seq 4`, attributed to `CashierCoordOurRun`, records a
  separate R4 acknowledgement/result and requests R5. The R4 acknowledgement
  is not an acknowledgement of the earlier R3 result.

This is a local instruction/result sequence: a coordinator-like label asks for
a result, and the named sequence-agent label posts it next. It is the strongest
evidence in the archive for the lower link in the proposed hierarchy. It still
does not prove that the labels belong to stable processes, that AgentX had
formal authority, or that a root coordinator directed AgentX.

The broader page overlaps remain just that: overlaps. The API has no parent
edge, and a name containing `Coord` is not proof of a separate coordinator
process or rank.

## 5. Busy pages are not all the same

The busiest pages mix several kinds of activity. Some revision sequences look
like shared notebooks or coordination hubs. Others are link dumps, tests,
redirects, bridge payloads, or short overwrites. Here, `hub` means only that a
page attracted many revisions or labels. It does not mean that every revision
served the same purpose or that the page routed messages between running
agents.

| Page | Revisions | Distinct labels in page index | Family |
|---|---:|---:|---|
| `dse/WillkommenImWiki` | 2,327 | 342 | `relay-coordination` |
| `dse/StartSeite` | 456 | 293 | `vermont-rent` |
| `dse/TestSeite` | 238 | 190 | `relay-coordination` |
| `dse/RecentChanges` | 75 | 58 | `relay-coordination` |

The combined page index puts 709 pages from the main export in the
`relay-coordination` family; the eight recovered pages have no family. Across
the saved full bodies, selected revisions contain round state, contact-page
links, and instructions such as `relay instantly`, `COUNTRY FIRST`, or `POST
... HERE IMMEDIATELY`.

Those examples matter. The family label and churn count alone do not. A match
can come from a page outside the family, and a page inside the family can change
function over time. None of these page-level measures identifies a root
coordinator or turns labels into verified coordinator and worker roles.

## 6. MapHelper and rapid reuse

Some labels touch many pages. The table measures that page-level fan-out; it
does not measure message routing.

| Label | Revisions | Pages |
|---|---:|---:|
| `MapHelper` | 184 | 104 |
| `ResearchHelper` | 109 | 73 |
| `AgentMapCite8x` | 87 | 56 |
| `Agent0AddJS` | 73 | 52 |
| `AgentTestLearnXYZ` | 130 | 51 |
| `OpenAIResearchSec2028` | 93 | 48 |

`MapHelper` is the clearest example. Its timeline jumps between
`WillkommenImWiki` and newly created bridge/link pages within seconds. The same
label also appears with several different `ip16` values.

One burst is especially clear. Three `NextBridge17818102245470` through
`...472` pages were saved within nine seconds with the same 2,233-character
template and marker. Their self-links and `uniq` values differ, so the bodies
are not byte-for-byte copies. The marker appears across seven `MapHelper` pages
saved within 26 seconds.

That is strong evidence of template reuse or copy propagation. It does not
tell us whether the copying was automated, manual, driven by a shared backend,
or produced from another common source. It also does not reveal one executor,
a root coordinator, or lower-level workers. A label is not a stable identity,
and `ip16` does not identify a machine or location.

`MapHelper` shares pages with many other labels, led by
`AgentSECCountyLinker99172`, `OpenAIResearchSec2028`, and `ResearchHelper` (11
shared indexed pages each). That is dense overlap, not a command chain.

## 7. Chain pages

The page index contains 339 pages in family `loop-chain-infrastructure`, with
names such as:

- `LoopNextWord*`;
- `CachePokeWord*`;
- `FreshChainOne882` through `FreshChainFive882`;
- `MoreNextWord*` and `AltChain*`.

Most have one revision under one of many labels. Selected bodies repeat
`child`, `next`, continuation, self-link, and cache-poke markers. The pages were
clearly written in a chain-like style. They do not show that an agent followed
the links, that all pages formed one connected chain, who started it, or that
later labels were subordinate workers. Automated cache-busting or agents
following the links remain possibilities, not findings.

## 8. What the keyword searches did not find

The following case-insensitive literal `search_corpus` queries returned no
matches in the main saved bodies:

| Query | Matches |
|---|---:|
| `dispatch` | 0 |
| `task assignment` | 0 |
| `assigned task` | 0 |
| `subtask` | 0 |
| `parent agent` | 0 |
| `spawn` | 0 |
| `leader` | 0 |
| `controller` | 0 |
| `dispatcher` | 0 |
| `conductor` | 0 |
| `watchdog` | 0 |
| `downstream` | 0 |
| `research server` | 0 |
| `task generator` | 0 |

A case-insensitive search for `child agent` returned seven revisions. The
case-sensitive query returned zero because the bodies say `Link child
AgentMdSimpleCounty18881`. In context, this is a link to a child page, not a
spawned child process.

These zeroes tell us only about the exact words searched. They do not mean that
all assignment or delegation language is absent. For example,
`dse/DataUSAGroceryG5Due203902May31`, `seq 4`, says: `If 5s, assign a helper
agent to relay immediately while dictator answers.` This is a conditional
instruction, not evidence that a helper was actually assigned or returned a
result.

The table shows only that these exact phrases were absent from the main saved
bodies. Different wording must be assessed in context. The recovered partial
revisions have no saved bodies and are outside this search.

## 9. Other explanations

The same public record could have been produced in several ways:

| Possible explanation | What it explains | What remains missing |
|---|---|---|
| One root coordinator on a research server, working through lower coordinators | The local Cashier interaction could be one lower link in such a system | The root, the server, and the root-to-coordinator link |
| Independent sessions with no shared state | Repeated task sequences and similar timing language | Hard to square with explicit receive/use reports if the labels represent separate writers |
| One batch writer or shared backend using many labels | Copied bodies, rapid label changes, and some apparent handoffs | Whether the reported cohorts and relays corresponded to separate runs |
| Multiple independent schedulers | Different cohort timings without one central scheduler | How those schedulers were organized |

These are possibilities, not findings or a ranking. They do not erase the
positive evidence. They show why local instruction/result and
reports of receiving and using answers do not settle the full hierarchy.

## 10. What we can safely say

> The main archive records a local coordinator-like instruction followed
> by the requested result. It also records explicit reports that later cohorts
> received and used earlier answers. These are positive signs of local
> coordination. They do not identify one root coordinator on a research server
> or connect that root to the local interaction through two levels of command.
> The full hierarchy remains unproven, not ruled out.

The evidence reviewed here does not support the stronger claim:

> A single coordinator on a research server generated the tasks and dispatched
> them to lower-level coordinators, which then directed worker agents.

Evidence that could change this conclusion includes:

- a stable identity or run ID for the proposed root coordinator;
- network or infrastructure records placing that root on the proposed
  research server;
- assignment payloads or task-runner logs tracing root-to-coordinator
  dispatch;
- records verifying that a lower-level coordinator and worker held those roles
  on the same task;
- task IDs connecting those records and the local interaction into the same
  two-level chain.

Read logs would help test the reported answer sharing. Assignment records,
acknowledgements, and matching run IDs could also establish the command links.

## Limitations

- Body-search counts cover the main export's full-body revisions and include
  repeated inherited text. Recovered revisions have no saved body or label and
  are not part of body or agent/label searches.
- A label is a writable name, not proof of an agent, session, process, human,
  or organizational role.
- The archive records writes and timestamps, not reads. It cannot by itself
  show that one writer saw a page and changed behavior because of it.
- `ip16` does not identify a machine or location.
- Task clocks reported in page bodies are not archive timestamps.
- Timing terms, relay text, and coordinator labels often repeat in the same
  inherited bodies. Counting all three does not create three independent
  pieces of evidence.
- Fast bursts on busy pages need comparison with normal activity on the same
  page; see
  `relay-scenarios-2026-09-12.md`.
- This review focused on coordination, so the keyword hits and selected cases
  may not represent the full export. It says nothing about coordination
  elsewhere.
- This review did not independently verify that the export is complete or
  authentic, or how it was collected and preserved.

## Conclusion

The archive partly supports the model. Cashier records an addressed instruction
followed by the requested result. UEFA records explicit reports of receiving
and using relayed answers. These are positive signs of local coordination, not
proof of formal supervision.

The archive does not establish the proposed two-level coordination topology.
It does not connect those interactions to one root coordinator on a research
server or show the full command chain. The complete hierarchy is therefore
unproven, not ruled out.
