/* 사이드킥 V3 랜딩 — the page's own behaviour.
 *
 * The engine (scrollcraft.js) drives the acts and is never edited. Everything
 * here is this page only: the instruction log that is the signature move, the
 * ambient footage, the rail's staggered settle, the pre-launch store buttons, and 사전등록.
 */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  ScrollCraft.mount(document.body);

  /* --------------------------------------------------------------------- */
  /* The instruction log.                                                    */
  /*                                                                         */
  /* One line per act, in the visitor's own voice, typed as they arrive and   */
  /* kept afterwards. By the close the strip holds a day's work, and then it  */
  /* docks away so the last ask is the page's. The strip is aria-hidden:      */
  /* every line it types is a heading the page already states.                */
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

    // The strip docks out as the close takes the screen: six acts of telling
    // the page what to do, and then the one thing it asks back.
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
  /* Ambient footage.                                                        */
  /*                                                                         */
  /* Each clip is a poster until it is near the screen, plays while it is on  */
  /* it, and pauses when it leaves, so six videos never decode at once. Under */
  /* reduced motion, or when the visitor asked to save data, nothing loads    */
  /* and the posters carry the page.                                          */
  /* --------------------------------------------------------------------- */

  var clips = [].slice.call(document.querySelectorAll("video[data-ambient]"));
  var saveData = navigator.connection && navigator.connection.saveData;
  if (clips.length && !reduce && !saveData && "IntersectionObserver" in window) {
    var small = window.matchMedia("(max-width: 700px)").matches;
    var watch = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var v = e.target;
        if (e.isIntersecting) {
          if (!v.getAttribute("src")) {
            v.src = (small && v.getAttribute("data-src-mobile")) || v.getAttribute("data-src");
          }
          // "once" holds on its last frame; replaying the sunrise every time
          // the close scrolls back in would turn a payoff into a screensaver.
          if (v.getAttribute("data-ambient") === "once" && v.ended) return;
          var played = v.play();
          if (played && played.catch) played.catch(function () { /* autoplay refused: the poster stays */ });
        } else if (v.getAttribute("data-ambient") !== "once") {
          v.pause();
        }
      });
    }, { rootMargin: "25% 0px", threshold: 0.01 });
    clips.forEach(function (v) { watch.observe(v); });
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
  /* 사전등록.                                                                */
  /*                                                                         */
  /* Having an account is the registration, so this asks for no address of    */
  /* its own. It opens the same four doors /membership/ opens, under the same */
  /* sessionStorage key, so a person signing in here lands on the account     */
  /* they already have instead of minting a second one.                       */
  /* --------------------------------------------------------------------- */

  var API_ORIGIN = "https://api.sidekickagent.app";
  // Google and Apple are Supabase logins in the app and the backend takes a
  // Supabase JWT as a bearer, so the web uses the same door rather than a
  // second one: a redirect, and a token read back out of the URL fragment.
  var SUPABASE_ORIGIN = "https://wdjlokfsehsnvcipkods.supabase.co";
  var SUPABASE_PROVIDERS = { google: "Google", apple: "Apple" };
  var RETURN_URL = "https://sidekickagent.app/v3/";
  var TOKEN_KEY = "sidekick_web_access_token";

  var OTP_METHODS = {
    email: { label: "이메일", type: "email", autocomplete: "email", placeholder: "" },
    phone: { label: "휴대폰", type: "tel", autocomplete: "tel", placeholder: "010-1234-5678" }
  };

  var $ = function (id) { return document.getElementById(id); };
  var sheet = $("signin-sheet");
  var prereg = document.querySelector("[data-prereg]");
  var preregDone = document.querySelector("[data-prereg-done]");
  var preregGo = document.querySelector("[data-prereg-go]");

  if (sheet && prereg) {
    var auth = { token: "", method: "email", challengeId: null, busy: false };
    try { auth.token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (e) { auth.token = ""; }

    var keep = function (token) {
      auth.token = token || "";
      try {
        if (token) sessionStorage.setItem(TOKEN_KEY, token);
        else sessionStorage.removeItem(TOKEN_KEY);
      } catch (e) { /* private mode: the session simply does not outlive the tab */ }
    };

    var api = function (path, options) {
      options = options || {};
      var headers = { "Content-Type": "application/json" };
      if (auth.token) headers.Authorization = "Bearer " + auth.token;
      return fetch(API_ORIGIN + path, {
        method: options.method || "GET",
        headers: headers,
        body: options.body
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) {
            var err = new Error("request_failed");
            err.status = r.status;
            throw err;
          }
          return data;
        });
      });
    };

    var status = function (node, message, isError) {
      if (!node) return;
      node.hidden = !message;
      node.textContent = message || "";
      node.classList.toggle("is-error", Boolean(isError));
    };
    var authSay = function (m, e) { status($("auth-status"), m, e); };
    var socialSay = function (m, e) { status($("social-status"), m, e); };

    /* --- the two states of the close ---------------------------------- */

    var showRegistered = function () {
      prereg.hidden = true;
      preregDone.hidden = false;
    };

    var closeSheet = function () {
      sheet.classList.remove("is-open");
      document.body.style.overflow = "";
      var done = function () { sheet.hidden = true; sheet.removeEventListener("transitionend", done); };
      sheet.addEventListener("transitionend", done);
      // Transitions can be off or cut short; the sheet must not stay half-drawn.
      setTimeout(done, 400);
    };

    var openSheet = function () {
      sheet.hidden = false;
      // Two frames: adding the class in the same frame as unhiding skips the
      // transition entirely, because the start state was never painted.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { sheet.classList.add("is-open"); });
      });
      document.body.style.overflow = "hidden";
      var first = sheet.querySelector(".door");
      if (first) first.focus({ preventScroll: true });
    };

    var afterSignIn = function () {
      closeSheet();
      showRegistered();
      preregDone.setAttribute("tabindex", "-1");
      preregDone.focus({ preventScroll: true });
    };

    /* --- who is here -------------------------------------------------- */

    // The backend is the authority on who this is; a provider only proved the
    // person holds the account.
    var confirmSession = function () {
      if (!auth.token) return Promise.resolve(false);
      return api("/auth/session").then(function () { return true; }).catch(function () {
        keep("");
        return false;
      });
    };

    // Supabase's implicit flow returns the session in the fragment. Reading it
    // and clearing it immediately keeps the token out of history.
    var adoptRedirect = function () {
      var hash = location.hash || "";
      if (hash.indexOf("access_token=") === -1) {
        if (hash.indexOf("error=") !== -1) {
          var failed = new URLSearchParams(hash.slice(1));
          socialSay(failed.get("error_description") || "로그인이 완료되지 않았어요.", true);
          history.replaceState(null, "", location.pathname + location.search);
        }
        return Promise.resolve(false);
      }
      var token = String(new URLSearchParams(hash.slice(1)).get("access_token") || "").trim();
      history.replaceState(null, "", location.pathname + location.search);
      if (!token) return Promise.resolve(false);
      keep(token);
      return api("/auth/session").then(function () { return true; }).catch(function () {
        keep("");
        socialSay("로그인은 됐지만 계정을 확인하지 못했어요. 다시 시도해 주세요.", true);
        return false;
      });
    };

    adoptRedirect().then(function (adopted) {
      if (adopted) { showRegistered(); return; }
      // An existing session is an existing account, and an account is the
      // registration, so a returning visitor is already done.
      return confirmSession().then(function (ok) { if (ok) showRegistered(); });
    });

    /* --- the doors ----------------------------------------------------- */

    preregGo.addEventListener("click", function (e) {
      e.preventDefault();
      openSheet();
    });
    $("close-signin").addEventListener("click", closeSheet);
    sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !sheet.hidden) closeSheet();
    });

    var startSupabase = function (provider) {
      if (!SUPABASE_PROVIDERS[provider]) return;
      socialSay(SUPABASE_PROVIDERS[provider] + "으로 이동하고 있어요.", false);
      var url = new URL(SUPABASE_ORIGIN + "/auth/v1/authorize");
      url.searchParams.set("provider", provider);
      url.searchParams.set("redirect_to", RETURN_URL);
      location.assign(url.toString());
    };
    $("google-button").addEventListener("click", function () { startSupabase("google"); });
    $("apple-button").addEventListener("click", function () { startSupabase("apple"); });

    // ChatGPT is a device code, not a redirect: the backend starts it, the
    // person approves in a new tab, and this page polls until it lands.
    $("chatgpt-button").addEventListener("click", function () {
      if (auth.busy) return;
      auth.busy = true;
      socialSay("ChatGPT 승인 창을 여는 중이에요.", false);
      api("/auth/oauth/chatgpt/start", { method: "POST", body: JSON.stringify({}) })
        .then(function (started) {
          var approval = started.verification_uri_complete || started.verification_uri || started.url;
          if (!approval) throw new Error("no approval url");
          window.open(approval, "_blank", "noopener");
          socialSay("새 창에서 승인하면 이어서 등록돼요.", false);
          var deadline = Date.now() + 5 * 60 * 1000;
          var poll = function () {
            if (Date.now() > deadline) {
              socialSay("승인이 확인되지 않았어요. 다시 시도해 주세요.", true);
              return;
            }
            return new Promise(function (r) { setTimeout(r, 3000); })
              .then(function () {
                return api("/auth/oauth/chatgpt/poll", {
                  method: "POST",
                  body: JSON.stringify({ challenge_id: started.challenge_id || started.id })
                });
              })
              .then(function (polled) {
                if (!polled.access_token) return poll();
                keep(polled.access_token);
                socialSay("", false);
                afterSignIn();
              });
          };
          return poll();
        })
        .catch(function () { socialSay("ChatGPT 로그인을 시작하지 못했어요.", true); })
        .then(function () { auth.busy = false; });
    });

    /* --- the one-time code --------------------------------------------- */

    $("otp-toggle").addEventListener("click", function () {
      var block = $("otp-block");
      block.hidden = !block.hidden;
      if (!block.hidden) $("signin-value").focus();
    });

    var applyMethod = function (method) {
      var chosen = OTP_METHODS[method] ? method : "email";
      auth.method = chosen;
      auth.challengeId = null;
      var config = OTP_METHODS[chosen];
      var input = $("signin-value");
      [].slice.call(sheet.querySelectorAll("[data-method]")).forEach(function (tab) {
        var on = tab.getAttribute("data-method") === chosen;
        tab.classList.toggle("is-selected", on);
        tab.setAttribute("aria-selected", String(on));
      });
      input.type = config.type;
      input.autocomplete = config.autocomplete;
      input.placeholder = config.placeholder;
      input.value = "";
      $("value-label").textContent = config.label;
      // Switching method abandons any code already sent, so the second form
      // must not stay open offering to verify the other identity.
      $("code-form").hidden = true;
      $("signin-code").value = "";
      authSay("", false);
      input.focus();
    };
    [].slice.call(sheet.querySelectorAll("[data-method]")).forEach(function (tab) {
      tab.addEventListener("click", function () { applyMethod(tab.getAttribute("data-method")); });
    });

    $("email-form").addEventListener("submit", function (e) {
      e.preventDefault();
      authSay("인증번호를 보내고 있어요.", false);
      api("/auth/start", {
        method: "POST",
        body: JSON.stringify({ method: auth.method, value: $("signin-value").value.trim() })
      }).then(function (result) {
        auth.challengeId = result.challenge_id;
        $("code-form").hidden = false;
        $("signin-code").focus();
        authSay((result.value_masked || "입력한 " + OTP_METHODS[auth.method].label) + "로 인증번호를 보냈어요.", false);
      }).catch(function () {
        authSay("인증번호를 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.", true);
      });
    });

    $("code-form").addEventListener("submit", function (e) {
      e.preventDefault();
      if (!auth.challengeId) return;
      authSay("인증번호를 확인하고 있어요.", false);
      api("/auth/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_id: auth.challengeId, code: $("signin-code").value.trim() })
      }).then(function (result) {
        if (!result.access_token) throw new Error("no token");
        keep(result.access_token);
        authSay("", false);
        afterSignIn();
      }).catch(function () {
        authSay("인증번호가 맞지 않아요. 다시 확인해 주세요.", true);
      });
    });
  }

})();
