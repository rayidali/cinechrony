# Phase D — reposition, redesign, launch

> **Started 2026-08-07.** Supersedes `LAUNCH.md`'s phase map for everything
> after Phase C. `LAUNCH.md` was last updated 2026-06-08 and is now history.
>
> **Design references: `../design-refs-2026-08/`** — 10 screens plus an index
> that says what each one shows. They are outside the repo on purpose (public
> repo, unreleased designs), same convention as the v3 package. Read that index
> before touching anything here.
>
> **Owner's sequence:** UI/UX changes → website → launch.

---

## 1. The reframe

The owner's words, which drive every item below:

> "cinechrony shouldn't be a social media app forefront because then the issue
> of cold start problem will be there. keep the forefront of rodeo in terms of
> bridging the gap between social media and keeping track of your movies/tv
> shows, and then there's of course the thing of shared/collaborative
> watchlists. don't kill the feed but strategically move it out of the main
> focus."

**The value ladder this implies — and the test it passes:**

| rung | works with 0 friends? | works with 0 films? |
|---|---|---|
| 1. the grab (share a reel → keep the film) | ✔ | ✔ |
| 2. unfiled → a list | ✔ | after one grab |
| 3. shared / collaborative lists | needs 1 person | ✔ |
| 4. movie night | needs 1 person | ✔ |
| 5. the feed | **needs a follow graph** | ✔ |

Today's home leads with rung 5 and rung 5's scaffolding: `for you · friends`
tabs, then `dig in` / `top watchers` / `featured` / `community lists` rails,
then the activity feed (`src/app/home/page.tsx`). **A brand-new user's home is
a follow-graph product with nothing in it.** That is the cold start problem
stated precisely — not a vague worry, a specific screen.

The redesign inverts the ladder. Nothing here deletes the feed; it moves below
the things that work on day one.

---

## 2. The structural finding

**The grab currently cannot complete without a filing decision.**
`POST /api/v1/extractions/[jobId]/save` requires `target: { ownerId, listId }`
per film (`extraction-server.ts`), with `createdLists` as the escape hatch. So
a first-time user who shares a reel — the single moment of first value, the
entire pitch — is stopped and asked to name a list before they can keep
anything.

`unfiled` (SS20) is not a nice-to-have inbox. **It is the removal of that
stop.** That is why it appears in three of the five home mockups, and it is why
it sequences before the home redesign rather than after.

---

## 3. What the designs add, against what exists

| # | thing | status today | cost |
|---|---|---|---|
| 1 | **unfiled** holding pen | does not exist; save demands a list | data model + save flow + screen |
| 2 | **the clip that did it** | exists but wrong: `Block title="the clip"` at the very bottom of `movie-drawer.tsx`, full-width embed + full-width button | visual, mostly |
| 3 | **needs you** strip | scattered across the movie-night card and `/notifications` | aggregation endpoint + strip |
| 4 | **your week** calendar strip | does not exist | component; movie-night data already there |
| 5 | **tonight hero** + `that's the one` / `another` | does not exist | component + a pick endpoint |
| 6 | **sunday wrapped** card | does not exist | read-computed card |
| 7 | **notification policy** (5 pings, quiet hours) | 8+ push types, no quiet hours, no per-type policy | policy layer + settings screen + **user timezone** |
| 8 | **onboarding** 4 promises + permission primer | 18 components, account-last, letterboxd-import heavy | rewrite of the front half |
| 9 | home recomposition | rails + feed | depends on 1, 3, 4, 5 |

**Bottom nav needs no change** — already `home · lists · you` with
Home/Bookmark/UserRound, exactly the mockups.

**Both themes are already supported** (`next-themes`); every screen is
specified light + dark, so nothing here is a light-only shortcut.

---

## 4. Two data gaps found while reading the code

**(a) The creator handle and caption for the clip card.**
- `socialThumbnail` — **stored** on the movie doc. ✔
- `caption` — **extracted** by `video-acquire-server.ts` (sliced to 2000 chars)
  and then **discarded** after analysis. Not persisted to the movie. Needs one
  field carried through the save path.
- creator handle (`@filmsthatgone`) — **not extracted at all.** It sits in the
  Apify `raw` payload for some providers and is parsed for none.

So D1 splits: the *visual* fix (the owner's actual complaint) ships without
either, and the pull-quote is a follow-on that must degrade when absent —
plenty of clips will have no handle.

**(b) User timezone is not stored.** Nothing on the user doc holds it
(`types.ts`, `profiles-server.ts`). Movie nights carry their own
`tzOffsetMinutes` per night, which is why reminders work. **Quiet hours
(10pm–9am) has no timezone to reason about** and cannot be built until the user
doc carries one. Cheap to add on first launch after auth, but it is a
prerequisite, not a detail.

---

## 5. Sequencing

Each item lists what it unblocks. **D0, D1 and D5 are independent of everything
and can go first or in parallel.**

**Scope is the whole phase** (owner, 2026-08-07): D1–D7 all ship before App
Store submission. That makes §4b (user timezone) a **hard prerequisite rather
than a maybe**, which is why it is now D0 — a late discovery there would block
D6 with the launch already queued behind it.

### D0 — store the user's timezone *(tiny, do it first)*
`users/{uid}.tzOffsetMinutes`, written on first launch after auth and refreshed
when it changes (travel, DST). **Unblocks D6 entirely.** Same convention movie
nights already use (minutes to ADD to UTC, `-new Date().getTimezoneOffset()`),
so quiet hours can reuse the arithmetic in `movie-nights-server.ts` rather than
inventing a second timezone model. Half a session; it exists purely so it is
not the thing standing between a finished redesign and a submission.

### D1 — the clip that did it *(small, isolated)*
The owner's most concrete complaint: "the social media link thing is all the
way at the bottom and is too big and huge, doesn't look aesthetic."
- Move the block **up**, under the synopsis and above the list actions.
- Square thumbnail with a play badge, not a full-width embed.
- Two *small pill* actions: `play here`, `open in <provider>`.
- Eyebrow `THE CLIP THAT DID IT`; `saved from a clip · <date>` chip on the hero.
- Files: `src/components/movie-drawer.tsx` (~L889 today), `video-embed.tsx`.
- **Follow-on (separate):** persist `caption`, parse the creator handle, render
  the pull-quote. Must degrade to thumbnail-only.

### D2 — unfiled *(the linchpin)*
Removes the filing stop from the grab. **Unblocks D3's unfiled card, D9's
unfiled row, and notification 03.**
- **Recommended implementation: a real list carrying a reserved flag**
  (`isUnfiled`), auto-provisioned, hidden from the lists grid, rendered by a
  bespoke screen. Reuses the whole `lists/{id}/movies` surface — rules, movie
  docs, notes, `socialLink`, the movie cell — and makes "file" a document move
  rather than a new subsystem. A separate top-level collection would duplicate
  every one of those.
- Save flow: `target` becomes optional; absent → unfiled.
- Screen: rows with `file`, `file all to…`, `clear`, swipe-to-file.
- **Exists only while non-empty** — the deck is explicit that there is no
  permanent empty bucket nagging from the tab bar.

### D3 — home recomposition *(the big one; needs D2)*
**ONE screen, conditional blocks** (owner, 2026-08-07). Each block renders only
when it has something to say — the deck's own rule for unfiled, applied to the
whole screen:

```
tonight-hero        only if a night is tonight  →  else YOUR WEEK strip
NEEDS YOU · n       only if something is pending
UNFILED · n         only if non-empty
YOUR LISTS          always
THE FEED            always, and always last
```

The three mockups are three states of this, not three destinations. Building
them as separate screens is the expensive mistake this decision avoids.

**Also in D3: the discovery rails move behind search/explore** (owner). `dig
in`, `top watchers`, `featured`, `community lists` come off home but keep
working. They are NOT deleted, and the reason matters: unlike the feed they are
global, not follow-graph, so they are the only thing with real content for a
user who has grabbed nothing yet. They just stop competing with the grab for
the front door. Files: `src/app/home/page.tsx` sheds them; the search overlay
or a new explore surface gains them.

### D4 — tonight hero + `that's the one` / `another` *(needs D3)*
A shuffle across films on your lists. **Cold-start trap: a new user has zero
films**, so the empty state has to become the grab prompt rather than an
embarrassed blank. Same rule as every other block — if there is nothing to
shuffle, the block does not render and the week strip stands in.

### D3.2 / D4.3 — HOME, REDESIGNED AGAIN *(supersedes the hero; not yet built)*

Owner review 2026-08-08, with two new references:
`../design-refs-2026-08/screens/11-home-v2-calendar.png` and `12-*.png`.

**WHY THE HERO IS BEING REPLACED, not adjusted.** The owner's words: *"i don't
understand the point of the hero, the fact that i have to manually press
another one instead of it being a slideshow type, and i have to press that's
the one to know that it is a movie night thing. sure it looks good but doesn't
really make sense."* Three distinct faults, and they are not styling:

1. **`another` is a button where it should be a gesture.** A shuffle you have
   to keep pressing is a slot machine. It should advance on its own or on a
   swipe — the user should never work to see the next thing.
2. **`that's the one` does not say what it does.** It opens the movie-night
   create sheet, which the label gives no hint of. A CTA whose outcome is a
   surprise is a mislabelled button, and no amount of art direction fixes it.
3. **The hero is decorative, not functional.** It looks expensive and does
   almost nothing — one film, one action, a screenful of space. That is the
   real charge, and it applies to the whole block regardless of the image.

**THE NEW SHAPE.** Home stops being a headline and becomes a *diary*:

```
[avatar + @handle chip]                    (search)  (bell·)

┌─ august '26                        ‹  › ─┐
│  m  t  w  t  f  s  s                     │   a REAL month grid.
│           …                              │   days with activity render a
│  days with films = poster-tinted tiles   │   poster-tinted tile instead of
│  today = filled red circle               │   a number. today is red.
│  "eight films. eleven hours.             │
│   your best august yet."            08   │
└──────────────────────────────────────────┘

IDENTIFIED · 6 THIS WEEK              ⇄ shuffle
fresh from the feed
[ clip card ][ clip card ][ … ]  ● ○ ○ ○ ○   ← horizontal, paged
   tiktok badge · title · 2024 · 1h 40m
   @creator · 2h ago

[ TONIGHT      ] [ view all        23 › ]
[ past lives   ] [ your saves           ]

                                    (+)  ← yellow FAB
```

**Why this is better, stated so it is not lost.** The calendar is the reason to
come back: it accrues. Every film watched makes it denser, and *"your best
august yet"* is a reward the current home has no equivalent of. "fresh from the
feed" makes the grab loop VISIBLE — the app's whole pitch, rendered as
something you swipe. And nothing on the screen requires a friend.

**THE SOCIAL FEED MOVES OFF HOME ENTIRELY.** Owner: *"have a way to integrate
the existing feed like in a different tab or something."* It is not on either
reference. Options to decide at build time: a fourth nav tab, or folded into
the profile/you tab. It must not return to home — D3 demoted it for the
cold-start reason and this goes further.

**Owner granted creative liberty to add or remove features here.** The calendar
needs a day→films read that does not exist yet (the watch log is per-user and
already indexed by `watchedAt`, so it is the natural source); "identified this
week" comes from extraction jobs; "your saves" is the existing bookmarks
surface. None of it needs new infrastructure, but the calendar read needs
designing against the free-tier budget before it is written.

### D5 — onboarding *(independent; can run parallel with D1–D4)*
Four screens, one promise and one picture each, ending in the permission
primer that shows two real notifications *before* the system dialog and whose
subtitle repeats the promise word for word.
- The existing flow is 18 components and account-last, heavy on letterboxd
  import. **Decide what survives** — the letterboxd import is real value and
  should not be deleted, only moved out of the first four screens.

### D6 — notification policy + settings *(needs D0 and D5's promise)*
Five ping types, quiet hours 10pm–9am except the night-of reminder, max one a
day. **Blocked on D0** — that is the whole reason D0 exists. Note the reminder
work of 2026-08-06 already respects a 9am floor for the `morning` preset, so
that path is consistent with the policy before the policy is written.
The primer in D5 promises exactly two things; **the policy has to keep that
promise or the primer becomes a lie the App Store reviewer can see.**

### D7 — sunday wrapped
**Keep it read-computed, a card in the feed, never a push** — the deck says so
and the deck is right for a reason it may not know: the GH Actions cron drops
~90% of scheduled runs (see CLAUDE.md 2026-08-06), so anything that *must* fire
Sunday evening would be unreliable. Computed on read, it cannot miss.

### E — website
Separate repo (`../cinechrony website/`). Its own session. The app's new
positioning has to land here too or the site sells a different product.

### F — launch
Owner-gated items are already enumerated in `APP-STORE-SUBMISSION.md` and
CLAUDE.md: privacy nutrition labels, EU trader status, `app.cinechrony.com`
DNS, Blaze before ~150 users. Unchanged by this phase.

---

## 6. Decisions taken

All three settled by the owner on **2026-08-07**, before any build:

| # | question | decision |
|---|---|---|
| 1 | home: one screen or three? | **One screen, conditional blocks.** Each block renders only when it has something to say. See D3 for the order. |
| 2 | the discovery rails? | **Move behind search/explore.** Not deleted — they are global rather than follow-graph, so they are the only day-one content for a user who has grabbed nothing. |
| 3 | launch scope | **Everything D1–D7 before submitting.** Which promotes user-timezone storage from a footnote to **D0**. |

Consequences worth restating, since they are easy to lose:
- Scope being the whole phase means **D6 is on the critical path**, and D6
  cannot start without D0. D0 is half a session and exists only so it is never
  the thing blocking a finished redesign from being submitted.
- Website (E) can start once **D3** is done — that is the point at which the
  product the site describes actually exists.

## 6b. Still open

- **What survives from the current onboarding (D5).** 18 components today,
  account-last, heavy on letterboxd import. The import is real value and should
  move, not die — but where it lands is undecided.
- **Whether `unfiled` gets a push at all** beyond notification 03's "once,
  after 7 days, max 1 a week". Decide with D6, not before.

---

## 7. Risks worth naming now

- **This is not "a few UI/UX changes."** It is a repositioning with a data-model
  addition (D2), a policy layer (D6), and a rewrite of the front half of
  onboarding (D5). Said plainly so the launch date is set against the real
  shape. D1 alone is small; the rest is not.
- **The redesign touches the surfaces the App Store screenshots show.**
  Screenshots in ASC are of the *current* home. They get retaken after D3, not
  before, or the listing shows a product that no longer exists.
- **Every native-visible change needs a build.** Server work goes live on push;
  the app ships a frozen `out/`. And per 2026-08-03: never run `npm run dev`
  beside `npm run build:static`, and `stat out/` before every `cap sync`.
- **The interaction harness and the audit suite are the gate.** 637 tests and
  43 harness steps currently green. A home recomposition will break harness
  steps that navigate by text; budget for updating the gate, and remember the
  standing rule that a red gate is usually the gate's fault first.
- **D2 changes the save path**, which is the hero feature's last mile. It
  deserves its own tests before the UI lands.
