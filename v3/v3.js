/* 사이드킥 V3 랜딩 — the page's own behaviour.
 *
 * The engine (scrollcraft.js) drives the acts and is never edited. Everything
 * here is this page only: the instruction log that is the signature move, the
 * rail's staggered settle, the pre-launch store buttons, and the waitlist.
 */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  ScrollCraft.mount(document.body);

  /* --------------------------------------------------------------------- */
  /* The instruction log.                                                    */
  /*                                                                         */
  /* One line per act, in the visitor's own voice, typed as they arrive and   */
  /* kept afterwards. By the close the strip holds a day's work and then      */
  /* clears, and the field it clears into is the waitlist. The strip is       */
  /* aria-hidden: every line it types is a heading the page already states.   */
  /* --------------------------------------------------------------------- */

  var log = document.querySelector("[data-log]");
  var past = document.querySelector("[data-log-past]");
  var now = document.querySelector("[data-log-now]");
  var acts = [].slice.call(document.querySelectorAll("[data-say]"));
  var join = document.querySelector("[data-last]");

  var said = [];          // lines already sent, oldest first
  var current = -1;       // index into acts
  var typer = null;

  function type(text) {
    if (typer) { cancelAnimationFrame(typer); typer = null; }
    if (reduce || !text) { now.textContent = text; return; }
    var start = null;
    var perChar = Math.min(34, 760 / text.length);
    (function step(t) {
      if (start === null) start = t;
      var n = Math.min(text.length, Math.round((t - start) / perChar));
      now.textContent = text.slice(0, n);
      if (n < text.length) typer = requestAnimationFrame(step);
      else typer = null;
    })(performance.now());
  }

  function remember(text) {
    said.push(text);
    // Two lines of history is the most that stays legible in a 62px strip.
    var keep = said.slice(-2);
    past.textContent = "";
    keep.forEach(function (line) {
      var el = document.createElement("span");
      el.textContent = line;
      past.appendChild(el);
    });
  }

  function readScroll() {
    var vh = window.innerHeight;
    var next = -1;
    for (var i = 0; i < acts.length; i++) {
      // An act is "current" once its top has passed the middle of the screen.
      if (acts[i].getBoundingClientRect().top < vh * 0.55) next = i;
    }

    if (next !== current) {
      // Moving forward: the line that was live becomes history first.
      if (next > current && current >= 0) {
        var prev = acts[current].getAttribute("data-say");
        if (prev) remember(prev);
      }
      // Moving back: drop the history that is no longer behind the visitor.
      if (next < current) {
        said = [];
        for (var j = 0; j < next; j++) {
          var s = acts[j].getAttribute("data-say");
          if (s) said.push(s);
        }
        var keep = said.slice(-2);
        past.textContent = "";
        keep.forEach(function (line) {
          var el = document.createElement("span");
          el.textContent = line;
          past.appendChild(el);
        });
      }
      current = next;
      type(next < 0 ? "" : acts[next].getAttribute("data-say") || "");
    }

    // The strip docks out as the close takes the screen, and the close's own
    // composer, which is the same object at the same width, takes over.
    if (join) {
      var top = join.getBoundingClientRect().top;
      log.classList.toggle("log--docked", top < vh * 0.62);
    }
  }

  if (log && acts.length) {
    var queued = false;
    var onScroll = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; readScroll(); });
    };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll, { passive: true });
    readScroll();
  }

  /* --------------------------------------------------------------------- */
  /* The model rail settles item by item as it travels.                      */
  /* Lateral travel alone reads as a slideshow; arriving in sequence reads   */
  /* as a drawer being pulled. The first item is exempt, because a pan act    */
  /* needs its opening content already present.                              */
  /* --------------------------------------------------------------------- */

  var models = [].slice.call(document.querySelectorAll(".model"));
  if (models.length) {
    if (reduce || !("IntersectionObserver" in window)) {
      models.forEach(function (m) { m.classList.add("is-in"); });
    } else {
      models[0].classList.add("is-in");
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      }, { threshold: 0.35 });
      models.slice(1).forEach(function (m) { io.observe(m); });
    }
  }

  /* --------------------------------------------------------------------- */
  /* Store buttons.                                                          */
  /*                                                                         */
  /* Pre-launch by default: there is no App Store or Play listing yet, and    */
  /* the repo's landing contract forbids claiming one. Put the real URL in    */
  /* each data-store-url and the button becomes a link, with no other edit.   */
  /* --------------------------------------------------------------------- */

  [].slice.call(document.querySelectorAll(".store")).forEach(function (el) {
    var url = (el.getAttribute("data-store-url") || "").trim();
    if (!url) return;
    var a = document.createElement("a");
    a.className = el.className;
    a.href = url;
    a.rel = "noopener";
    a.innerHTML = el.innerHTML;
    a.querySelector("small").textContent = "다운로드";
    el.replaceWith(a);
  });

  /* --------------------------------------------------------------------- */
  /* The waitlist.                                                           */
  /*                                                                         */
  /* data-endpoint is empty until there is somewhere to post to. Until then   */
  /* the form says so plainly and hands the visitor to the membership page    */
  /* rather than pretending to have taken their address. The email is never   */
  /* put in a URL.                                                            */
  /* --------------------------------------------------------------------- */

  var form = document.querySelector("[data-waitlist]");
  if (form) {
    var note = form.querySelector("[data-waitlist-note]");
    var input = form.querySelector(".compose__input");
    var go = form.querySelector(".compose__go");

    var say = function (text, state) {
      note.textContent = text;
      if (state) note.setAttribute("data-state", state);
      else note.removeAttribute("data-state");
    };

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = (input.value || "").trim();
      if (!input.checkValidity() || !email) {
        say("이메일 주소를 확인해 주세요.", "error");
        input.focus();
        return;
      }

      var endpoint = (form.getAttribute("data-endpoint") || "").trim();
      var mailto = (form.getAttribute("data-mailto") || "").trim();

      // No endpoint yet, so the address goes where a person reads it rather
      // than into a service nobody stood up. The visitor's own mail app sends
      // it, so nothing here stores or transmits it on their behalf.
      if (!endpoint && mailto) {
        var href = "mailto:" + mailto
          + "?subject=" + encodeURIComponent("사이드킥 대기 리스트 등록")
          + "&body=" + encodeURIComponent("대기 리스트에 등록해 주세요.\n\n이메일: " + email + "\n");
        say("메일 앱을 열었습니다. 그대로 보내주시면 등록됩니다.", "done");
        location.href = href;
        return;
      }
      if (!endpoint) {
        say("대기 리스트는 준비 중입니다. 멤버십에서 먼저 구성해 주세요.", null);
        setTimeout(function () { location.href = "/membership/"; }, 900);
        return;
      }

      go.disabled = true;
      say("등록하는 중…", null);
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, source: "v3-landing" })
      }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        form.reset();
        say("등록됐습니다. 출시되면 가장 먼저 알려드릴게요.", "done");
      }).catch(function () {
        say("지금은 등록이 어렵습니다. 잠시 후 다시 시도해 주세요.", "error");
      }).then(function () {
        go.disabled = false;
      });
    });
  }
})();
