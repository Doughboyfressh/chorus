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

Run `npm ci --ignore-scripts`, then `npm test`, `npm run typecheck`, and
`npm run build:dev`. The test command includes new scoring/transport/provenance
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
