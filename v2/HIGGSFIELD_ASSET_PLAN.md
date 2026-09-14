# Higgsfield asset plan · Sidekick Landing V2

## Third cut (2026-09-14, later): the film is the page

Injoo's direction after seeing the first two cuts: the video must be the main
thing, not a background behind HTML animations, and the work itself (making a
video, writing the Naver blog post, the Instagram carousel, the WordPress
schedule) must happen inside the footage as the visitor scrolls.

So the page now runs eight ten-second scenes of one working morning, one
person, one desk, shot in the same documentary grade, each scrubbed by the
scene's own scroll progress. The only interface left on the page is the
approval card (a real control, because scrolling must never publish) and a
few words in the lower-left corner naming what the film is doing.

| ID | Scene | What happens in the footage |
|---|---|---|
| s1 | 말하기 | She speaks into the phone; the recording circle pulses, a message bubble slides up |
| s2 | 직원 배정 · 조사 | The browser scrolls through camping chairs, she writes a note |
| s3 | 영상 제작 | Phone on a tripod films the chair under a ring light; the edit timeline advances on the laptop |
| s4 | 네이버 블로그 | Text fills the blog editor under a green header; a second photo drops into the article |
| s5 | 인스타그램 | Her thumb swipes the square carousel; the caption scrolls |
| s6 | 워드프레스 | The cursor drags the article card onto a calendar day; a confirmation badge appears |
| s7 | 확인 | The phone held still, thumb hovering over two buttons, waiting |
| s8 | 게시 완료 | A notification slides down, the article scrolls on the laptop, she lifts the mug |

Generation: Nano Banana Pro stills (16:9 and 9:16, 2k) with the first-cut desk
still as an image reference for continuity, then Kling 2.6 ten-second
image-to-video from each still, no sound. Encoded for scrolling at 1600px
(keyframe every 8 frames) and 720px portrait (every 4), first-frame posters,
under `apps/site/assets/landing-v2/film/sN{,-m}.mp4` and `sN-poster{,-m}.jpg`.
The first-cut plates (hg-01..06) were removed.

The earlier plan below is kept as history.

---

## 1. Role split (from the brief, §11)

Higgsfield plates carry **space, situation, atmosphere, the sense that work is
happening**. Everything the visitor reads or presses is HTML: buttons, text,
approval, events, progress, employee status. No UI is baked into any plate.

One style preamble, pasted verbatim at the top of every prompt:

> Documentary photography of a small Korean home office in the morning,
> available light from one window camera-left, handheld 35mm, shallow depth of
> field. Natural skin tones, honest surfaces, a slight softness in the frame.
> Muted realistic grade with warm white highlights and cool grey shadows, no
> colour cast, fine visible grain. Hands and objects, never a face. Nothing
> futuristic, no holograms, no glowing screens, no neon, no CGI, no 3D render,
> no illustration, no text or UI on any screen. The phone screen, when visible,
> is a plain pale grey blank.

The negative list is what keeps the set on-grade. Do not paraphrase it.

## 2. The slots

Every clip: one continuous move, one direction, nothing enters or leaves,
subject in frame throughout, slower than feels right. Duration 5 s, scrubbed
by scroll (`scroll progress → video progress`), so the poster is the clip's own
first frame pulled with ffmpeg, never a separate still.

| ID | Section | Purpose | Scene | Start frame | End frame | Camera | Duration | Desktop / Mobile | Loop | Scrub |
|---|---|---|---|---|---|---|---|---|---|---|
| HG-01 | Hero back plane | The first moment of using Sidekick | A phone lying on a light wooden desk beside a mug and a notebook, morning window light camera-left, large empty softly lit space across the upper right two thirds of the frame | Phone slightly out of focus, desk in focus | Phone sharp, desk falling soft | Slow push-in with a very slight downward tilt | 5 s | 16:9 and 9:16 | No | Yes |
| HG-02 | Session · request | Work arrives, several things begin | The same desk from a higher angle, a hand resting near the phone, a packing box and a folded camping chair leg visible at the edge of frame, empty space upper left | Hand still | Hand lifts an inch toward the phone | Slow drift left | 5 s | 16:9 and 9:16 | No | Yes |
| HG-03 | Session · work (peak) | Research is happening | A laptop half-open on the same desk, browser reflected faintly on a glass of water, papers with printed camping-gear photos fanned out, empty space top | Papers flat | The nearest paper slides slightly into frame | Slow lateral dolly right | 5 s | 16:9 and 9:16 | No | Yes |
| HG-04 | Session · work (peak) | Content is being made | Close on the notebook page with a pen, three small printed photos laid in a row, the phone's edge in the corner, empty space right | Pen resting | Pen rolls a few degrees | Macro push-in | 5 s | 16:9 and 9:16 | No | Yes |
| HG-05 | Session · approve | The pause: the person is asked | The phone face-up in the centre of the desk, everything else at rest, hand entering from the bottom edge and stopping short of the screen, empty space top | Hand at bottom edge | Hand stopped, one finger extended, not touching | Static camera, almost no move | 5 s | 16:9 and 9:16 | No | Yes |
| HG-06 | Session · result | The post is out | The same desk, the phone now beside the closed laptop, window light warmer, the chair at the edge of frame pushed back as if the person left, empty space upper right | Frame settled | Frame settled with a slow breath of light | Slow pull-back | 5 s | 16:9 and 9:16 | No | Yes |

Stills for posters: not generated separately. Pull each poster from its clip.

## 3. Where they mount

`apps/site/v2/index.html` has one `<figure class="scene" data-hg="HG-0N">` per
slot. Put the encoded files at:

```
apps/site/assets/landing-v2/higgsfield/hg-01.mp4        desktop, dense GOP
apps/site/assets/landing-v2/higgsfield/hg-01-m.mp4      mobile 720p, portrait crop
apps/site/assets/landing-v2/higgsfield/hg-01-poster.jpg first frame of hg-01.mp4
```

and set the figure's `data-hg-ready="1"`. `v2.js` then attaches the poster and
drives the clip's `currentTime` from the scene's scroll progress (the hero slot
uses the hero act's progress). Until then the figure keeps its CSS ground.

## 4. Commands (after `higgsfield auth login`)

```bash
cd apps/site/assets/landing-v2/higgsfield
# pick the image-to-video model the account exposes; list with:
higgsfield model list --video
# one still per slot from the preamble + scene, then a 5 s move from it:
higgsfield generate create <image-model> --prompt "<preamble>\n\n<HG-01 scene>" --json
higgsfield generate create <video-model> --prompt "<HG-01 camera move>" --image <upload_id> --json
higgsfield generate wait <job_id>
# encode for scrubbing (dense GOP, no audio), desktop + mobile, and the poster:
bash "<scroll-craft skill>/scripts/encode.sh" raw/hg-01.mp4 hg-01.mp4
ffmpeg -y -i raw/hg-01.mp4 -vf "crop=ih*9/16:ih,scale=720:-2" -c:v libx264 -crf 20 -g 4 -pix_fmt yuv420p -an -movflags +faststart hg-01-m.mp4
ffmpeg -y -i hg-01.mp4 -frames:v 1 -q:v 3 hg-01-poster.jpg
```

Look at every frame set before mounting it. Reroll anything with a face, text,
a glowing screen, or a second light source.

## 5. Performance rules the mounts already follow

- Clips load only when their scene is within three viewports (fetch on warm).
- `preload="none"`, `muted`, `playsinline`; posters are the frame-holder.
- Mobile gets the portrait encode via `data-src-mobile`; below 860px the hero
  slot only mounts the poster.
- `prefers-reduced-motion: reduce` never fetches a clip; the poster holds.
- Budget: six clips at roughly 3 MB desktop / 1.5 MB mobile. Nothing on the
  first screen waits on a clip.
