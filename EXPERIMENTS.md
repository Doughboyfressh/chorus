# Saved experiments and controlled Prompt comparisons

Open **Experiments** in Chorus. This release implements saved experiment storage,
full future findings retention, and a small operator-controlled Prompt A/B pilot.
It does not implement private holdouts, a six-lab scheduler, autonomous workers,
user-account authentication for vaults, model training, or certified improvement.

## Save before running

Create a private experiment vault, download its recovery key, and create a saved
experiment. The recovery key is a 256-bit bearer credential; the database stores
only its SHA-256 digest. Keep the recovery file private. It is not an API key.
Requests send it in an Authorization header, never a URL. The browser remembers
it locally until **Lock this browser**. Restore the same key on another device.
A lost key cannot be recovered by the app. This is capability-based access, not
user-account login; possession gives access to this vault.

**Save current MCP sitting** attaches the actual existing sitting. The database
atomically checkpoints future confirmed sitting writes. Pinned sittings are
exempt from temporary 14-day and 500-sitting cleanup. Checkpoints remain even
when a live sitting is explicitly reset or removed. Creating a child sitting
never clears a previous sitting. The new child has its own MCP connection URL.
**Resume sitting** adopts that URL in the browser; copy it to the MCP host when
changing between separate children. Existing MCP URL access rules still apply.
A saved browser snapshot is labeled client-supplied, not server-run evidence.

Saved experiments and checkpoints have no automatic expiry. The application
limits each vault to 100 experiments, each experiment to 2,000 checkpoints and
50 comparisons, and individual snapshots to 2 MB. Export and start a child when
limits are reached. A complete export fetches checkpoint and receipt records
individually to avoid serverless response-size limits. Pause active work for a
stable export. Per-checkpoint and plan hashes detect content changes, but hashes
alone are not signatures or proof of independent execution. The full export is
private and contains linked sitting capabilities. Explicitly confirmed deletion
removes a leaf experiment and its saved data; it does not reset its live sittings.
Experiments with children or unresolved active calls cannot be deleted.

Complete new submitted findings replace the old 500-character evidence preview.
Previously truncated records are preserved as-is, not invented or backfilled.
Legacy sitting state remains a working snapshot, not an immutable event log;
saved checkpoints and controlled trial records provide the separate history.

## Operator configuration for paid execution

Saving does not require a model provider. Controlled execution is OFF by default
and never falls back to an unrelated application key. Set these server-only
variables in Vercel project settings; do not prefix them with VITE_ or commit them:

```
CHORUS_RUNNER_ENABLED=true
CHORUS_RUNNER_API_KEY=<operator's OpenAI API key>
CHORUS_RUNNER_ACCESS_KEY=<at least 32 random characters>
CHORUS_RUNNER_MODEL=<compatible pinned Chat Completions model ID>
CHORUS_RUNNER_INPUT_USD_PER_MILLION=<current input price>
CHORUS_RUNNER_OUTPUT_USD_PER_MILLION=<current output price>
CHORUS_RUNNER_DAILY_USD=<positive daily reservation cap>
```

Provision a provider-side project budget/limit too. Prices are operator-supplied,
not hardcoded quotations. Dollar reservations use a deliberately conservative
UTF-8-byte estimate plus overhead and the output cap; they are not a guarantee
of the provider's final invoice. Usage-derived cost is reported separately.
Reservations are not released after failed/unknown calls. If observed estimated
cost exceeds its reservation, the comparison stops for review. Prices/settings
are frozen with each plan; changing them requires a new comparison.

The operator execution key is entered only in the Experiments UI, kept in React
memory for this tab, and required by the server before paid operations. Never
paste the provider API key into that field. Neither key is stored in artifacts
or request receipts. The runner calls only the fixed OpenAI HTTPS endpoint; a
caller cannot choose a URL, redirect target, model, result or usage record.

## What the pilot establishes

Eight public, repository-owned cases cover demonstrated XSS, SQL injection and
code execution, matching clean controls, non-executed SQL text and missing code
context. Every case is PUBLIC, including its reference labels. A frozen harness
protocol accompanies the exact baseline/candidate prompts and is included in the
plan hash. The provider is called with fresh, isolated messages for each trial;
there are no tool calls, previous outputs, or filesystem execution.

Choose 1–3 repetitions and a spending limit (at most $25 per comparison). The
same cases and fixed provider parameters are used on both sides, alternating
order. There are 16–48 scheduled calls, at most 1,200 completion tokens per call,
a 40-second provider timeout and a 30-minute UI default wall-clock budget. No
model call happens when a plan is saved. Starting execution is a separate
explicitly confirmed operation. Each HTTP request dispatches at most one call.
Closing the page stops new dispatch; a call already sent may finish. Reopen the
vault, inspect receipts and resume to continue. This is not a background worker.

A database transaction claims one trial and reserves per-comparison/global
budgets before dispatch. Repeated client requests include their expected ordinal;
a replay cannot advance a later trial. Concurrent requests cannot claim the same
trial. A 2-minute abandoned lease becomes **unknown** when execution is resumed;
it is never automatically re-executed. Invalid output, refusals, provider errors
and ambiguous outcomes stop for review. Fork a new experiment rather than hide a
failed trial by retrying until success. Pause does not refund spent calls or reset
the wall-clock deadline. Late results cannot overwrite a terminal receipt.

Receipts retain the exact semantic request (canonical JSON SHA-256), full bounded
provider response, output SHA-256, returned model/response ID, usage, latency,
assessment and errors. Oversize provider bodies are rejected, not silently
shortened and scored. This establishes what the server observed from the provider
under the trusted server/operator boundary, not provider-independent attestation.

The metric is category/exact-evidence agreement plus missing-context acknowledgment,
not semantic proof of each natural-language explanation. The report separates
false-positive labels, missed labels, invalid outputs, matched wins/losses/ties,
tokens, latency and estimated cost. Trial counts are not artifact generations.
A completed plan may show poor performance. This eight-case public calibration
set cannot establish unseen-case generalization or clinical/security certification.
There is no automatic winner promotion and clean DPO/SFT remains disabled.

## Tests and deployment

Migration `0005_experiments.sql` adds new tables/functions and a checkpoint trigger;
it does not alter historical ledgers or delete data. Apply through the existing
migration runner. Production requires durable PostgreSQL and should allow at least
60 seconds per function request for the bounded provider call and persistence.

```
node --experimental-strip-types --test src/lib/chorus/*.test.ts
node --experimental-strip-types --test tests/experiments-storage.test.ts
npm run test:integrity:db
npm run test:fixtures
npm run build:dev
npm run typecheck
```

Automated tests inject synthetic provider transport; those fixtures are never
represented as real model evaluations. Deployment smoke tests use only disposable
vaults/sittings and never the user's existing data or provider budget.

### Storage and provider consistency limits

Saved checkpoints are capped at 2,000 and 64 MiB per experiment, with a 256 MiB
global checkpoint budget for this personal-workspace release. Reaching a quota
rejects the new write; it never prunes existing saved work. Export and explicitly
delete unneeded saved experiments to release space. These limits concern
checkpoints; paid comparison receipts also have per-response, per-plan and
operator spending limits. A provider-reported model change during a frozen
comparison stops it for review instead of mixing those trials as matched results.
