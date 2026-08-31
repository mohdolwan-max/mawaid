# Engineering standards

Working rules for every project in this folder. Each one is here because
breaking it cost real time or shipped a real defect — the failure is named so
the rule can be argued with rather than obeyed blindly.

Copy this file into a new project and reference it from its `CLAUDE.md`.

---

## 1. Data honesty

**A missing value must never render as a number.** "Not set" and "zero" are
different facts and must stay different all the way to the screen. Return
`null` and print "—".
*A sales-per-man-hour target of 0 meant "unset", but a required-hours figure
of 0 would have read as "this branch needs no staff". A branch with no
recorded hours has no productivity — printing 0 beside a target of 80 reads
as catastrophe rather than as missing data.*

**Never swallow an error into empty data.** `const { data } = await q()` then
`data ?? []` turns a failed query into "there is nothing here".
*An unapplied migration made the ingredients page say "0 من 0" for a full
catalogue. Nothing was broken except the reporting of the break.*

**Never write back a value you did not read.** A form renders defaults from
what it loaded; any field it did not load is saved as its fallback on the
next save.
*A settings form loaded seven of its columns and rendered the rest as 0. Every
save silently reset the org's SPMH target. The save succeeded, no warning
appeared, and the number just became 0 somewhere else in the app.*

**One number, one source.** If two screens show the same figure, they call the
same function and a test asserts they agree.
*The staffing floor was priced two ways — shifts × contracted hours on one
page, people × trading hours on another. 32 and 36 for the same thing, and
the cheaper one was wrong.*

**Bound the query, not just the loop.** Know your database's row cap and
paginate deliberately; a silently truncated result looks exactly like a small
dataset.

---

## 2. Change safety

**Propose, then apply.** Anything that rewrites more than one row shows its
full result first. Nothing is written on the click that generates it.
*A generated month for a whole team is not something to discover after the
fact.*

**Never silently overwrite human input.** Add alongside it, or ask. If a
computed figure and a typed one disagree, show both.
*Maintenance costs from tickets are ADDED to the typed maintenance figure,
because service contracts never pass through a ticket and overwriting would
have deleted them with nothing on screen to say why.*

**Preserve what you did not author.** Generated data steps around approved
leave, manual notes and anything else a person put there deliberately.
*A generated roster that overwrote approved leave would cancel someone's
holiday silently — they would find out by turning up to work.*

**A deploy and its migration are two manual steps, in either order.** Writes
touching a new column degrade instead of failing; reads tolerate its absence.
*One unknown column made PostgREST reject an entire settings update, so the
whole form stopped saving with a raw driver error under the button.*

**Make the destructive case obvious and reversible.** Confirm before replacing
work on screen, and say plainly what is and is not persisted yet.

---

## 3. Domain modelling

**Name the measure exactly.** Hours present, hours paid, and hours on the
floor are three different numbers. So are gross and net, contracted and
actual, planned and confirmed.
*An unpaid break made presence and on-floor hours differ by one hour a shift.
Conflating them understated the staffing requirement by a whole person.*

**Derive targets from policy; do not guess them.** If two settings imply a
third, compute it.
*Labour % = cost per hour ÷ sales per man hour. A guessed SPMH target of 120
implied an 8% labour cost that nobody had agreed to, and made every
requirement figure look worse than it was.*

**Surface the constraint the tool cannot solve.** If no arrangement of the
inputs fixes the problem, say so and quantify what would.
*"No schedule closes this gap; here is the sales figure that does" is the
useful answer. Smoothing it into a slightly-off number is not.*

**Ratios follow the domain's rule, not convenience.** Write the rule once, at
the top of the module, and make every caller obey it.

---

## 4. Verification

**Measure the claim.** Never report "faster", "fixed" or "fits" without a
before/after number taken the same way.
*A performance fix was measuring the loading skeleton, not the page. The
number looked excellent and meant nothing.*

**Put the arithmetic in `lib/`, free of React and the database, and test it
directly.** UI is how you see it; the function is what has to be right.

**Test the degenerate inputs.** Empty, zero, negative, NaN, missing. Every
returned number stays finite.

**Run the loop before saying done:** typecheck → lint → build → the pure-function
tests. The lint baseline is a *number*; any increase is yours to fix.

**Verify against the real artefact.** Read the shipped stylesheet, run the real
query, render the actual markup. Do not verify a paraphrase of your change.

---

## 5. Working together

**Correct an earlier statement the moment it would change a decision** —
plainly, once, then continue. Do not re-litigate what was already right.

**Ask only when the answer changes the work.** Otherwise choose the sensible
option, say which and why, and keep going.

**Answer the question that was asked**, then flag what you noticed. A concern
does not replace the deliverable.

**Say what you did not do.** Scope left out, checks skipped, assumptions made —
stated explicitly, not implied by silence.

---

## 6. Code and repo hygiene

**Comments record WHY, and the failure that motivated the code.** Quote the
report that caused it. A rule with its reason attached can be revisited; a
bare rule gets deleted by the next person who finds it inconvenient.

**Match the surrounding code** — its naming, its comment density, its idioms —
over any external style preference.

**No third-party identity or operational data in the repo.** Not in demo data,
not in comments, not in commit messages. Describe the constraint without
naming whose it is.

**Accessibility is computed, not eyeballed.** Contrast ratios are arithmetic;
check every theme the app ships, because a palette override changes
foreground and background independently and only one of them gets tested.
