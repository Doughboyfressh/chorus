# Evaluation integrity

## What scores mean

Chorus currently runs **public practice exercises**. A diagnostic score describes
matches against that public exercise, not independently verified execution,
semantic correctness, generalization, or recursive self-improvement. The same
model can see the exercise and supply its output. Changing roles or executor
names does not establish independence. User-selected API endpoints are not a
trusted evaluator either.

Every current result and review candidate is unverified and contaminated.
**Clean DPO/SFT exports are disabled.** There is deliberately no configuration
flag, model name, imported JSON field, or user-supplied receipt that unlocks them.
Old ledger entries retain their content for review but cannot become clean
training rows. Raw candidate exports are explicitly labeled for human review.
A changed artifact plus a higher public-practice score is not a verified
improvement claim. A cosmetic-duplicate filter is not a semantic-equivalence
proof.

This closes the known paths from untrusted practice output into claimed verified
results. It does not turn a lexical exercise into a semantic evaluator, prevent
all possible reward hacking, or certify historical runs. An adversary may still
optimize public diagnostic matches; these remain unverified and non-trainable.

## Enforced boundaries

- Findings must be a complete JSON object with an array of bounded `{issue,quote}`
  objects. A malformed row invalidates the submission. There is no raw-text
  fallback or string-row shortcut. Evidence is matched within one finding; the
  quote must be an exact, single source line and cannot supply the issue keyword.
  Conservative security-negation checks block the reproduced deny-all attack.
- Arbitrary custom-test output earns no credit for the custom test. Additional
  ungraded tests cannot produce a full-credit result. Unknown labs and out-of-range
  or fractional levels are rejected instead of silently falling back or clamping.
- `chorus_exam` requires the exact artifact before returning the exercise. Its
  attempt ID binds session, artifact, lab, level and complete custom test; it
  expires after ten minutes and is atomically consumed once in the database.
  `chorus_score` must present the unchanged inputs and ID. Fetching an exam does
  **not** prove the host actually executed it.
- The orchestra's exam seat uses the same binding and one-use check. Obtain its
  attempt ID from `chorus_next`, and include it in `chorus_fill`.
- A sitting with recorded results pins its lab and current level. Changing labs
  requires explicit reset. Reset invalidates outstanding attempts. Consumed
  attempts are stored separately from the sitting so stale snapshots cannot
  resurrect them. Optimistic database revision checks reject stale history writes.
- Diagnostic candidates require identical complete test identity, level, lab and
  execution configuration; finite bounded scores; a positive diagnostic delta;
  different normalized artifact text; and no newly failing checks. They remain
  unverified regardless of both sides' serialized metadata.
- The API executor receives the full bounded artifact, not its first 2,400
  characters. Oversize artifacts are rejected before model execution. HTTP body
  limits count actual bytes rather than trusting Content-Length. Browser mutation
  requests enforce same-origin restrictions. Malformed JSON never implies reset.

## Deployment and migration

Migration `0004_exam_attempts.sql` adds the attempt table and sitting revision
column without deleting existing ledgers. The existing migration runner discovers
it. On Vercel or in production, `DATABASE_URL` must point to durable PostgreSQL.
Missing durable storage fails closed; development's process-local PGLite cannot
serve as a production replay ledger. Database outages and conflicts are surfaced,
not silently acknowledged as successful writes.

Sitting URLs use cryptographic UUIDs and are **bearer capabilities**: anyone who
has one may operate that sitting. Keep them private. This is not a user-account
access-control system. Rotate a disclosed URL. Same-origin checks are browser
CSRF protection, not a substitute for possession-based or account authentication.
Server operators, database administrators, and repository maintainers remain
trusted and can change code or records; this patch does not claim to defend
against a compromised server administrator.

## Verification

Run `npm ci --ignore-scripts`, then `npm test`, `npm run build:dev`, and
`npm run typecheck` (the build generates router types). The test command includes new scoring/transport/provenance
regressions and `tests/chorus-storage.test.ts`, which executes production SQL and
migrations on PGlite PostgreSQL. The storage tests check atomic consumption,
context binding, expiration, reset invalidation, optimistic revisions and
non-resurrection across independent adapter instances. Dependency-free core
checks can also be run with:

```sh
node --experimental-strip-types --test src/lib/chorus/*.test.ts
```

These are automated regression tests, not a production penetration test or proof
that a generative system can never cheat.

## Requirements before unlocking verified training

Implement a separate server-controlled, authenticated evaluator with private,
rotating holdouts inaccessible to the writing agent; freeze and hash both
candidates before evaluation; execute both under matched, server-owned settings;
retain immutable request/output receipts with single-use evaluation identities;
validate task correctness independently of keyword matching; assess paired
performance and regressions across sufficient independent cases; and authorize
exports against server records rather than client JSON. Preserve both candidates'
provenance. Public development feedback must never double as private validation.
Do not unlock exports merely because a model calls itself independent or provides
a plausible-looking signature.


## RSI execution and feedback repair (server 2.1.0)

- Malformed findings are `INVALID_FINDINGS` tool errors with a field path and
  expected JSON schema, never performance scores. Validation precedes attempt
  consumption, seat advancement and score recording. Correct formatting using
  the real output and retry the same unused attempt before expiry; changing the
  artifact still requires a new bound attempt. Never invent evidence to adapt a
  native reviewer schema. An explicit `{"findings":[]}` is a valid no-findings
  result and may score zero. Invalid or unexecuted output must not be advertised
  as an observed zero.
- Full bounded artifacts survive the conductor seed, specialist patches,
  synthesizer envelope, recursive context and exam prompt. Bounds remain 24,000
  artifact characters and 32,000 findings characters. Completion envelopes can
  be larger to accommodate JSON escaping. Oversize/incomplete artifacts are
  errors, not silently shortened or auto-repaired drafts. The exam seat returns
  the exact frozen artifact and character count for inspection.
- A full pass still advances automatically without clearing the sitting. The
  response exposes currentLevel, lastScoredLevel, maxLevel, capped and exhausted.
  RSI has levels 0 through 3; no fabricated 0-through-6 ladder. Omitting level
  uses the current level. Changing labs or bypassing progression still requires
  an explicit reset; reaching a cap is never automatic permission to wipe data.
- Browser evaluation failures retain the artifact, show an unscored error and
  offer a user-initiated evaluation-only retry. They do not manufacture a zero
  or announce a completed score. Provider failures are errors too.
- These are diagnostic workflow repairs. The trusted private-holdout evaluator
  described above is still absent; clean training export stays locked. Existing
  ledgers are not regraded, reset or rewritten by this release. No new database
  migration or provider configuration is required.


## Task-aware public grading (server 2.2.0, grader version 3)

The integrity version remains 2: nothing in this release certifies independent
execution. These are bounded, deterministic **practice** rules, not a general
natural-language verifier or proof against all reward hacking. Unsupported or
ambiguous wording remains uncredited, and every result remains unverified and
contaminated. Clean DPO/SFT export is still locked.

- RSI evidence may cite the actual missing mutation/gate line, not only the rename
  line. A mutation must describe a change to persistent behavior/artifact text;
  numeric gates require a quantity tied to an acceptance/rejection metric.
- Scientific summaries check scoped negation and contradiction rather than vetoing
  any mention of a false claim. Different trial/preprint/duplicate criteria cite
  their own source. A contradictory relevant row cannot hide next to a valid row.
- Data practice parses separately labeled, quoted Better/Chosen and Worse/Rejected
  alternatives, checks their arithmetic, and requires a rationale. Incorrect text
  in a rejected answer is not endorsed. Length-bias criteria measure the actual
  two alternatives; human audit size requires a positive item count. These rules
  concern this arithmetic exercise, not general preference quality.
- Stress-practice responses can quote any actual student turn in the supplied
  conversation. The rules check actionable support and reject the tested secrecy
  bargains/unsupported rewrite instructions, including scoped denials. This is
  NOT clinical validation or a safety certification.
- The code-review exercise shows JSON body parsing, a real executed SQL query,
  and an actual authorization decision for the JWT example. Never infer a missing
  sink merely from a fixture's title. HTTP tests run the trusted fixture on real
  Express with a Pool adapter backed by PGlite; parameterized SQL, a query-text-only
  response and missing JSON middleware provide negative controls. No submitted
  model/user verification code is executed by these tests.
- `checkResults` reports whether a practice criterion lacks relevant evidence,
  contradicts the task, or was not demonstrated. This is feedback, not a private
  answer key, and must not be represented as independent validation.
- `graderVersion` is included in exact test identity and attempt storage keys.
  Pre-upgrade attempts must be reissued; previous scores and artifacts are never
  silently regraded. Cross-grader comparisons cannot form review candidates.
- `executor` is a display label only. Declare model/provider/revision/temperature/
  token-limit/seed changes with `executionConfig` on `chorus_exam` or
  `chorus_sitting` BEFORE an exam. Such changes invalidate pending attempts and
  prevent cross-configuration candidates. Without an explicit profile, identity
  is the stable server-issued host session (model unspecified). The declared
  profile is unverified and cannot attest that a host actually used that model.
  Browser evaluation captures its configured slot before calling it rather than
  relabeling the result from settings changed while the request was running.

Regression verification is synthetic. Passing all 22 lab/level reference cases
in tests does NOT mean a model has run those labs, completed every generation,
or improved on independent work. Keep all historical failures and receipts.
