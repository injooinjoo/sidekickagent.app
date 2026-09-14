# Sidekick Landing V2 · ScrollCraft brief

Self-authored under explicit creative delegation. Injoo supplied a full written
brief (journey, emotional rhythm, hero copy, section copy, bans, technical
constraints). Every answer below is taken from that brief verbatim where it
existed; items marked *authored* are decisions the brief left open.

Source of truth for the product facts: `apps/site/` (V1) and the mobile app on
`origin/main@d6982930`. Nothing on this page claims a number, a store listing,
or a feature the app does not have. The scenario on the page is a demo and the
page says so on its face.

## Step 0 · the eight topics

1. **Vibe.** "Sidekick을 직접 써본 것 같은 웹사이트." Calm, product-first, no AI
   theatre. References given by Injoo: none named. *Authored:* the feel of the
   first five minutes with a good new employee: you say the thing, they say
   "알겠어요", and you go back to your own work.
2. **Scroll journey, in Injoo's words.**
   1. Sidekick을 발견한다. 2. 업무를 말한다. 3. 담당 AI 직원이 배정된다.
   4. AI 직원이 실제 작업을 시작한다. 5. 진행 상태를 확인한다.
   6. 필요한 순간에만 사용자의 승인을 요청한다. 7. 결과가 완성된다.
   8. 한 번의 업무가 반복 Routine으로 변한다. 9. AI 직원이 하나의 팀으로 확장된다.
   10. CTA.
3. **Energy curve, in Injoo's words.** Hero calm → Request focus → Worker
   assignment curiosity → Working high activity → Approval pause → Result
   release → Routine confidence → Team expansion → CTA calm.
4. **Feeling and the one moment.** Injoo: "Sidekick이 모든 것을 임의로 실행하는
   것이 아니라 중요한 행동 전에 나를 부르는구나." The moment to remember is the
   approval: after all the activity, the phone stops and asks.
5. **One thing no site does.** *Authored from the brief's approval rule:* nothing
   on this page gets "posted" until the visitor taps 승인하고 게시 themselves.
   Scrolling past the approval does not publish; the result screen says so, and
   the visitor's own tap is what flips it.
6. **Aesthetic range.** *Authored:* the V1 family, light and product-led, one
   brand red. Not premium-minimal dark. Injoo's ban list: no purple AI gradient,
   no orb, no neural network, no particles, no robot, no glassmorphism, no
   bento, no logo wall, no repeated fade-up, no stock AI people, no unrelated
   cinematic footage.
7. **One world or distinct scenes.** Distinct scenes, cut by the phone's own
   state. Not worldflight: the brief asks for sticky app UI with vertical flow
   and forbids hijacking native scroll on mobile.
8. **Assets already owned.** V1 wordmark and favicon (`/assets/`), V1 phone
   mock-up idiom (status bar, thread head, badges, bubbles) and the app's real
   colour tokens (`apps/mobile/app/theme/colors.js`). No footage. Higgsfield is
   the requested generator for scene plates; see `HIGGSFIELD_ASSET_PLAN.md`.

## Step 1 · journey answers

- **What is this, for whom.** 사이드킥: 한국의 부업·1인 사업자가 반복 업무를 말로
  맡기는 AI 직원 앱. Visitor: someone running a blog, store, channel on the side.
- **What the visitor must believe by the end (Injoo).** "Sidekick에게 할 일을
  말하면 AI 직원들이 알아서 진행하고, 내가 필요한 순간에만 확인하면 된다."
- **What they do next.** One action, one label from the brief: hero
  "Sidekick 시작하기", close "내 Sidekick 시작하기". Both go to `/membership/`,
  the same place V1 sends people. The shared header keeps V1's own label.
- **Kept from V1.** Header bar, footer and seller identity (site contract),
  wordmark, colour tokens, system Korean type, the phone idiom, the sample
  employee 현진 and the 캠핑용품 리뷰 blog scenario, the fail-closed stance on
  store links and numbers.
- **Changed from V2.** No feature cards, no plan cards, no FAQ, no "5개 AI 모델"
  claim (the app now lists providers from its own catalog). The three
  principles 바로 맡기기 · 한눈에 확인 · 확인 후 실행 are shown, not listed.

## Grammar

**Guided first session** (new grammar; the eight defined ones each lost, see
the report). Constraints it commits to:

- Nav: the site's shared header (contract) plus a *session log* rail that stamps
  each stage as the visitor passes it and jumps back on click. No other chrome.
- Sequence: one phone, whose state only ever advances, held sticky while short
  captions pass beside it. One caption per viewport. No display headline larger
  than the hero's anywhere in the middle.
- Ending: the sentence that opened the session comes back, over the completed
  log, with the CTA. The last screen holds.
- Bans: scrub clips of unrelated footage, feature or plan cards, logo walls,
  pinned crossfade type acts, counters (no verified figures exist), kinetic
  headline stacks, and any phone panel that is a picture rather than markup
  computing its state from the page's data.

## Feeling curve (written before the acts)

```
1  Calm        the headline, the phone already on its home screen, two cards drifting at different depths
2  Focus       the mic opens, the sentence transcribes itself under the hand, the bubble sends
3  Curiosity   Sidekick answers, 현진 takes the job, 예린 joins for research
4  Activity    (PEAK) search results pile up, the draft writes itself, images arrive, Naver connects
5  Pause       everything stops. 확인이 필요해요. Two real buttons and nothing else moving
6  Release     the result card. 게시 완료 only if you tapped it. Otherwise it says so, honestly
7  Confidence  the finished task lifts out and re-lays itself as a weekly routine, dates repeating
8  Expansion   the rail: one employee becomes a small team, each with their own tools
9  Calm        the log, the first sentence, one button
```

Adjacent feelings differ everywhere. Silence before the peak: act 3 is short and
quiet on purpose (one reply bubble, one card).

## The peak

Act 4 into act 5. The sentence a visitor would say: "the phone did the whole
blog post under my hand, piled up research, wrote the draft, got the images, and
then it just stopped and asked me before posting. Nothing went out until I
tapped it." It gets the longest span on the page and the only busy composition.

## Tell-someone sentence

"It's the site where the blog post only gets posted when *you* tap approve, and
the site remembers that you did."

## Signature move

**The approval that waits.** The approval card carries two real controls.
승인하고 게시 flips the page's session state, stamps the log (확인 · 승인함) and
carries the visitor to the result. 수정하기 offers two edits; picking one makes
현진 re-present the card with the change applied. If the visitor scrolls past
without tapping, the result screen reads 승인 대기 · 게시 전 with a button to
approve right there, and the close log records what actually happened.
Page-local JS reading the session progress; the engine is untouched.

## Authored silence

None. Every viewport has one caption or one phone state change. The approval act
is quiet by design but not empty: the card is on screen the whole span.

## Score table

| Beat | Device | Why |
|---|---|---|
| 1 Discover | `flow` + `parallax` planes | The page opens as a composition with depth, not a film. Two product cards overtake the phone at different rates |
| 2–6 Session | bespoke sticky stage over a tall `flow` act, publishing `data-sc-verify-state` | The phone must not cut between acts; one stage, five states |
| 7 Routine | `pin`, morph driven from `--sc-p` | The card becoming a routine is a change of state, and it has to happen under the hand |
| 8 Team | `pan` | Lateral travel reads as breadth: one person becoming a team |
| 9 Close | `pin` + `magnet`, hold cues | The page stops moving and starts responding |

Families: flow/parallax, bespoke sticky, pin, pan, pin+pointer. No family twice
in a row (the two pins are separated by the pan). No scrub. Total length about
13 viewport-heights, most of it in the session.
