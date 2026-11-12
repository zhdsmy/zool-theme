# Changelog

## 1.0.0+zhdsmy.15 — 2026-11-12

- Detail page on foldable inner screens and portrait tablets (768–1023px): the five stats share one row with full-width instruments; system, network and billing sit in three columns, and long values wrap instead of ending in "…"; charts go three to a row with compact axes and shorter plots; smaller header. At 856px the page is about 1.4 screens tall.
- Cards: the spec line aligns with the readings instead of indenting under the name; titles keep two lines of height when cards are side by side, so readings line up across a row; narrow cards below 1024px drop the network sparkline and give the rates the full width.
- Overview: the sub line wraps to two lines on tablets instead of ending in "…".

## 1.0.0+zhdsmy.14 — 2026-11-12

- Card names wrap to two lines instead of sliding; past two lines they end in "…", with the full name as the tooltip.
- Every narrow card (under 320px, including four-up desktop) shows the region tag on the spec line, giving the name the full width. At 856px and 1280px only one of 23 names is still shortened.

## 1.0.0+zhdsmy.13 — 2026-11-12

- Card titles that do not fit slide back and forth instead of ending in "…"; names that fit stay still, and reduced motion keeps the ellipsis.

## 1.0.0+zhdsmy.12 — 2026-11-12

- Cards go three to a row from 800px instead of 880px: the iPhone Duo inner screen is about 856px wide and still showed two. 768px tablets keep two.
- Narrow cards: tighter reading gap, side padding and word spacing, so memory "used / total" fits (truncated at 856px: 13 → 1 of 23).

## 1.0.0+zhdsmy.11 — 2026-11-12

`v1.0.0+zhdsmy.10` was tagged but never deployed; this release carries its changes plus:

- Three-up cards on foldable inner screens: the region tag moves to the spec line so the node name gets the whole first row, and page margins drop to 32px. At 910px, truncated names fall from 22 to 13 of 23 and truncated memory figures from 13 to 1.

## 1.0.0+zhdsmy.10 — 2026-11-12

- Foldable inner screens and portrait tablets (768–1023px): cards three to a row from 880px, using the compact phone card (about 270px tall instead of about 450px); the overview fits on one row; less top spacing.
- Detail page in the same range: tighter header, no empty stat cell, system and billing stacked beside the network list.
- Rotated inner screen (640–767px): detail charts two to a row.
- Narrow cards keep rate units and the traffic label inside the card.

## 1.0.0+zhdsmy.9 — 2026-11-05

- Fix Nezha latency charts: read the current `monitor_id` / `monitor_name` fields (older `service_*` still accepted), so each probe target keeps its own name and line instead of merging into one unnamed series. Stop showing a made-up 0% loss where Nezha reports none.
- Phone card view: about 259px per online card (from about 400px), with the rates beside the spark and traffic and quota on one line; every reading kept.
- Detail page on phones: CPU, memory and disk instruments stretch to the full cell width, swap blocks included.
- Sparks show only a quiet baseline until two samples exist, instead of a flat rule with stray end dots.
- Raise the fork's bundle budget to 136 KiB gzip per target.

## 1.0.0+zhdsmy.8 — 2026-11-05

`v1.0.0+zhdsmy.7` was tagged with the same changes but exceeded the 128 KiB Nezha bundle budget and was never deployed; this release draws the phone info-list divider in CSS to stay within it.

- Redesign the palette: cool mineral paper / deep navy slate with a single cobalt accent, distinct good / warn / danger signals with tinted status chips, and four separable chart colours; all text and instrument pairs meet WCAG contrast in light, dark and high-contrast modes. Favicon and `theme-color` follow the new tokens.
- Raise phone information density: a 53px header with an untruncated title and a visible sign-in icon, a two-tier overview card, compact toolbar and region chips, and 66px ledger rows (about 12 nodes per iPhone screen, up from 7).
- Tighten the node page on phones by about 48%: a 3 + 2 instrument grid, two-column info sections, shorter charts with matching skeletons, and a compact footer. Desktop layouts are unchanged.

## 1.0.0+zhdsmy.6 — 2026-11-04

- Unify billing labels as plan fees and actual costs across the overview, card footer, node details and unavailable state in all four languages.

## 1.0.0+zhdsmy.5 — 2026-11-04

- Group listed and actual card expenses in the bottom footer, with compact labels, accessible uptime/expiry icons and wrapping that keeps both amounts visible.
- Convert all billing displays to CNY for Simplified Chinese and USD for other locales, sharing one daily reference-rate state across overview, list, cards and node details. Keep original billing periods and hide amounts when conversion is unavailable.


## 1.0.0+zhdsmy.4 — 2026-11-04

- Read optional actual expenses from Nezha private-note JSON after authentication; empty values inherit public billing prices and explicit zero remains zero.
- Show the actual online monthly total for signed-in users and add actual expense lines to VPS cards and node details. Guest views and public WebSocket metadata retain displayed prices.
- Keep private amounts out of browser storage and discard them on refresh; a protected API failure does not silently fall back to a displayed-price total.


## 1.0.0+zhdsmy.3 — 2026-11-04

- Read Nezha traffic quotas with billing periods, including `100TB/Month` and `100GB/Month`, and distinguish unknown quotas from unlimited plans.
- Show plan bandwidth, IP support, network routes and extra notes on node pages. Period quotas show their capacity without comparing them to lifetime traffic or raising false quota alerts; cycle usage is explicitly unavailable until the backend supplies it.
- Preserve the permanent expiry marker and show pay-as-you-go billing separately from free service, across all four languages.

## 1.0.0+zhdsmy.2 — 2026-11-04

- Sum the monthly cost of online recurring paid nodes after currency conversion; annual bills are divided by 12.
- Use CNY for Simplified Chinese and USD for the other languages, with daily reference rates, a dated cache fallback and an explicit unavailable state.
- Standardize currency formatting and add regression coverage for billing amounts, amortization and exchange rates.

## 1.0.0+zhdsmy.1 — 2026-09-21

Based on upstream ZOOL 1.0.0, including upstream main through `5d7ffd5`.

- Nezha sign-in now lists the configured OAuth providers, requests the selected provider's authorization URL and redirects to it.
- Pending OAuth requests disable repeated attempts; failures show an error and allow retry. Password login and Komari OAuth remain supported.
- Add 13 OAuth regression cases covering provider discovery, redirects, failures, unsafe URLs and existing login modes.

## 1.0.0 — 2026-09-17

The theme is now called ZOOL, and a machine that is not reporting says why.

- **Name.** The theme shows as ZOOL in the Komari theme list and the footer. Release files are
  `zool-komari-v1.0.0.zip` and `zool-nezha-v1.0.0.zip`; they still install into `zool-theme/`
  and `zool-dist/`, so existing installs upgrade in place and keep their settings.
- **Honest states.** A node that is not live keeps its card or row whole and states its
  condition instead of a bare "Offline":
  - *Offline · last report 3 min ago*, in amber for the first ten minutes and red after, with
    the last readings kept and dimmed. A Komari node that drops during a visit no longer stays
    "online" until reload. Komari does not send readings for nodes that were already down when
    the page opened, so those show "Offline" with placeholders.
  - *Reported 7 min ago* — listed as online but silent for over five minutes; readings dim.
  - *No reports yet* — a node that has never reported shows placeholders, not zeros.
  - Expired billing is written next to the condition; a used-up quota stays on the traffic line.
  - Figures the backend cannot mean (negative or not a number) read as zero, and CPU is capped
    at 100%.
- **Install with an AI agent.** `skills/zool-install` walks a coding agent through detecting
  the panel, downloading and checksumming the release, backing up, installing, verifying and
  rolling back. It asks before anything destructive.
- **README** rewritten in English and Chinese, with install first.
- **Size gate.** `pnpm check:size` fails the build when the entry script passes 128 KB gzipped;
  CI runs it.
- Demo data covers every node condition (`pnpm dev:demo`).

## Before 1.0

0.1.0 – 0.9.0 were released on 2026-09-16 as zool-theme.

- **0.9** — Waiting is not offline: skeletons in the page's real shape until the first frame, a
  refresh button that keeps scroll and filters, readings that dim instead of vanishing while the
  connection recovers.
- **0.8** — Up and down side by side; a two-line phone ledger with fixed columns; a "Show by
  group" switch; touch-sized segmented controls.
- **0.7** — Green, amber and red cells (CPU 50/85, memory 70/90, disk 80/92) that sweep as they
  change; larger live rates; brand-coloured system icons from one cached sprite.
- **0.6** — One flat list until groups are picked; filters in the address; region flags shipped
  with the theme; four cards across a laptop.
- **0.5** — An overview band of figures replaces the headline; twelve equal cells per card
  reading; readings judged on the figure shown.
- **0.4** — Cards rebuilt around three equal readings with the number leading.
- **0.3** — Cards return next to the ledger (`defaultView`).
- **0.2** — The ledger: ticks, blocks, spark, reporting run and notches, each with one meaning.
- **0.1** — First release: Komari and Nezha from one codebase, node pages with charts, search,
  sign-in, light and dark, four languages.
