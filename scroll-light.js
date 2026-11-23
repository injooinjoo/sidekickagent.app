/* Scroll light — the landing's background (owner 2026-11-22: "배경색이 그 그라데이션 24개를 스크롤할 때마다
 * 은은하게 쭉 바뀌는", follow-up "밝은느낌중심으로 하자, 어두운류는 중간에 있을 순 있지만").
 *
 * A fixed layer behind the page: the palette's 3rd colour as the ground and its other four as very large,
 * soft radial lights (styles.css, .scroll-light). This script only writes CSS custom properties on that layer
 * (--sl-0 … --sl-4 as "r g b", --sl-dx/--sl-dy as a small drift), from one passive scroll listener and
 * requestAnimationFrame. No layout is read or written while scrolling except scrollY and the page height.
 *
 * Colours: the owner's 24 palettes, order and HEX exactly as apps/mobile/app/theme/stagePalettes.js
 * STAGE_CLOUD_PALETTE_LIST (test_landing_contract and test_scroll_light.mjs hold the two lists equal).
 * Nothing is invented; only how strongly each colour is drawn changes:
 *   light  each palette is mixed toward white in OKLab (L toward 1, a·b toward 0) by the least amount that
 *          keeps every colour's relative luminance ≥ MIST.floor and the palette's mean ≥ MIST.mean, never
 *          less than MIST.min — the app cloud's mist, so a dark palette shows as a pale wash of its colours.
 *   dark   the app cloud's dark tone (CLOUD_DARK_TONE in components/stageLight/cloudGradientShader.js):
 *          OKLab L' = lift + scale·L, a·b × chroma, no white mist.
 *
 * Order down the page (bright-centred): the 24 are ranked by the mean relative luminance of their five HEX
 * colours. Ranks 1, 3, 5 … 23 go down the first half and 24, 22 … 2 come back up, so the page opens on the
 * brightest (코튼 캔디) and ends on the second brightest (민트 크림), and the two darkest (말린 장미,
 * 미드나잇 로즈) meet in the middle. Each palette holds a share of the scroll from DWELL.dark (darkest) to
 * DWELL.bright (brightest), so the dark ones pass quickly.
 *
 * Between two palettes each colour is mixed in OKLab with a smoothstep, so a palette settles where it is
 * reached and the change never steps. The shown position follows the scroll with a FOLLOW_SEC time constant
 * (wheel ticks and jumps glide instead of snapping). With reduced motion the first palette is drawn and
 * nothing listens. A canvas of faint grain over the light keeps the long gradients from banding. */
(function () {
  'use strict';

  var PALETTES = [
    ['driedRose', '말린 장미', ['#54658E', '#66739A', '#797391', '#8A7285', '#956663']],
    ['apricotEvening', '살구빛 저녁', ['#576DA1', '#7682AE', '#9F97A8', '#B99889', '#C89268']],
    ['rosyMist', '장밋빛 안개', ['#8D85A4', '#A185A0', '#B88D9B', '#CB8A94', '#B57382']],
    ['sageMist', '세이지 안개', ['#7C9290', '#9DAFA2', '#C0BDAA', '#A7A4B4', '#7E8B9F']],
    ['dawnLake', '새벽 호수', ['#526F86', '#7396A5', '#9FB4B6', '#B6A6A8', '#8D8FA8']],
    ['lilacMilk', '라일락 밀크', ['#9A91B6', '#C0A9C7', '#D8B9C0', '#C5C5D5', '#9BAFBE']],
    ['peachCloud', '복숭아 구름', ['#D19B8C', '#E3B5A3', '#E6C7B5', '#C5B5BE', '#9FAEC4']],
    ['mintCream', '민트 크림', ['#80AFA9', '#A4C5B8', '#C8D1BA', '#B9C6D2', '#9EACBE']],
    ['rainyAfternoon', '비 오는 오후', ['#5D758C', '#7E8C9C', '#A2A7B0', '#B3A3A7', '#8F8D9C']],
    ['champagneSunset', '샴페인 노을', ['#A79B8F', '#C8B19C', '#E0C6A8', '#D5B6B3', '#A6A6BD']],
    ['blueberryCream', '블루베리 크림', ['#666F9D', '#8E8FB6', '#B4A4C1', '#C6B3B6', '#9FA9C2']],
    ['mossGarden', '모스 가든', ['#637F73', '#829E86', '#ADB9A0', '#C2B7A0', '#9A9CA2']],
    ['coralVeil', '코랄 베일', ['#B77D84', '#D69A94', '#E5B6A3', '#C6A5B6', '#9696B6']],
    ['arcticMist', '북극의 안개', ['#6B93A7', '#8DB7BE', '#B9CED0', '#B9B7CC', '#8B9DBB']],
    ['plumTea', '플럼 티', ['#6C607E', '#8B7895', '#AC93A5', '#C2A6A3', '#A28B8F']],
    ['pistachio', '피스타치오', ['#94A58B', '#B7C4A1', '#D1CCB0', '#B6B9BA', '#8FA8AD']],
    ['duskSea', '황혼의 바다', ['#465F83', '#687A9B', '#998FA8', '#BF9A9A', '#C3A17D']],
    ['cottonCandy', '코튼 캔디', ['#A5B8D4', '#C3B8D8', '#E0C1D0', '#E5C7B8', '#B8C7C8']],
    ['terracottaMist', '테라코타 안개', ['#9B7771', '#B99586', '#D2B5A0', '#B7B1AA', '#899D9D']],
    ['opalGlow', '오팔 글로우', ['#7FA4B3', '#A4BFC3', '#C8C4CF', '#D8B5C6', '#C2B4A5']],
    ['winterLavender', '겨울 라벤더', ['#7786A5', '#9B9EB9', '#BBB3C6', '#C9C5C8', '#A6B9C1']],
    ['honeySage', '허니 세이지', ['#889D83', '#ADB69A', '#D3C6A1', '#D7AD92', '#A89CA3']],
    ['midnightRose', '미드나잇 로즈', ['#414C71', '#686585', '#906E8C', '#A77B83', '#796D84']],
    ['auroraMist', '오로라 미스트', ['#678D9C', '#81B3AC', '#B4C4A8', '#C8AFC0', '#9C98BC']]
  ];
  var MIST = { min: 0.3, mean: 0.58, floor: 0.42 };
  var DARK_TONE = [0.255, 0.078, 0.6]; // [scale, lift, chroma], the app's CLOUD_DARK_TONE
  var DWELL = { dark: 0.35, bright: 1 };
  var DRIFT = 4; // % the lights wander across the whole page
  var FOLLOW_SEC = 0.22;
  var GRAIN = { tile: 192, alpha: 10 }; // alpha out of 255

  function srgbToLinear(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function linearToSrgb(v) {
    v = Math.min(1, Math.max(0, v));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }
  function hexToRgb(hex) { return [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16) / 255; }); }
  function luminance(rgb) {
    var c = rgb.map(srgbToLinear);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function toOklab(rgb) {
    var r = srgbToLinear(rgb[0]), g = srgbToLinear(rgb[1]), b = srgbToLinear(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    var m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    var s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function toRgb(lab) {
    var l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    var m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    var s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
    return [linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
  }
  function mist(lab, w) { return [lab[0] + (1 - lab[0]) * w, lab[1] * (1 - w), lab[2] * (1 - w)]; }
  function darkTone(lab) { return [DARK_TONE[1] + DARK_TONE[0] * lab[0], lab[1] * DARK_TONE[2], lab[2] * DARK_TONE[2]]; }
  function paletteLuminance(colours) {
    return colours.reduce(function (sum, hex) { return sum + luminance(hexToRgb(hex)); }, 0) / colours.length;
  }

  // The least white mix (to 1e-4) that keeps a palette bright; bisection, done once per palette.
  function mistAmount(labs) {
    function bright(w) {
      var lums = labs.map(function (lab) { return luminance(toRgb(mist(lab, w))); });
      var mean = lums.reduce(function (a, b) { return a + b; }, 0) / lums.length;
      return Math.min.apply(null, lums) >= MIST.floor && mean >= MIST.mean;
    }
    if (bright(MIST.min)) return MIST.min;
    var lo = MIST.min, hi = 1;
    while (hi - lo > 1e-4) { var mid = (lo + hi) / 2; if (bright(mid)) hi = mid; else lo = mid; }
    return hi;
  }

  // The site order and each stop's place on the page (0 … 1).
  function buildStops() {
    var rows = PALETTES.map(function (p, index) {
      var labs = p[2].map(function (hex) { return toOklab(hexToRgb(hex)); });
      return { key: p[0], name: p[1], index: index, lum: paletteLuminance(p[2]), labs: labs, mist: mistAmount(labs) };
    });
    var ranked = rows.slice().sort(function (a, b) { return b.lum - a.lum || a.index - b.index; });
    var order = [];
    for (var i = 0; i < ranked.length; i += 2) order.push(ranked[i]);
    for (var j = ranked.length - 1 - (ranked.length % 2 === 0 ? 0 : 1); j > 0; j -= 2) order.push(ranked[j]);
    var lo = ranked[ranked.length - 1].lum, hi = ranked[0].lum;
    var weights = order.map(function (row) { return DWELL.dark + (DWELL.bright - DWELL.dark) * (row.lum - lo) / ((hi - lo) || 1); });
    var at = [0];
    for (var k = 1; k < order.length; k++) at.push(at[k - 1] + (weights[k - 1] + weights[k]) / 2);
    var end = at[at.length - 1] || 1;
    return order.map(function (row, k) {
      return { key: row.key, name: row.name, lum: row.lum, mist: row.mist, at: at[k] / end, weight: weights[k],
        light: row.labs.map(function (lab) { return mist(lab, row.mist); }),
        dark: row.labs.map(darkTone) };
    });
  }
  var STOPS = buildStops();

  function smoothstep(t) { return t * t * (3 - 2 * t); }
  // The five colours (sRGB 0 … 1) at a page position, for 'light' or 'dark'.
  function sceneAt(progress, scheme) {
    var p = Math.min(1, Math.max(0, +progress || 0));
    var k = 0;
    while (k < STOPS.length - 2 && p > STOPS[k + 1].at) k++;
    var a = STOPS[k], b = STOPS[k + 1];
    var t = smoothstep(Math.min(1, Math.max(0, (p - a.at) / ((b.at - a.at) || 1))));
    var from = a[scheme === 'dark' ? 'dark' : 'light'], to = b[scheme === 'dark' ? 'dark' : 'light'];
    return from.map(function (lab, i) {
      return toRgb([lab[0] + (to[i][0] - lab[0]) * t, lab[1] + (to[i][1] - lab[1]) * t, lab[2] + (to[i][2] - lab[2]) * t]);
    });
  }
  function drift(progress) {
    var p = Math.min(1, Math.max(0, +progress || 0));
    return [DRIFT * Math.sin(Math.PI * 2 * p), DRIFT * Math.sin(Math.PI * 3 * p + 0.6) * 0.75];
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + Math.round(v * 255).toString(16)).slice(-2); }).join('').toUpperCase();
  }

  var api = { PALETTES: PALETTES, MIST: MIST, DARK_TONE: DARK_TONE, DWELL: DWELL, GRAIN: GRAIN, STOPS: STOPS,
    sceneAt: sceneAt, drift: drift, toHex: toHex, luminance: luminance, paletteLuminance: paletteLuminance };
  if (typeof module === 'object' && module && module.exports) { module.exports = api; return; }

  if (window.top !== window.self) return;
  if (document.querySelector('.scroll-light')) return;

  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function scheme() { return darkQuery && darkQuery.matches ? 'dark' : 'light'; }
  function still() { return !!(motionQuery && motionQuery.matches); }

  var layer = document.createElement('div');
  layer.className = 'scroll-light';
  layer.setAttribute('aria-hidden', 'true');
  var grain = document.createElement('canvas');
  grain.className = 'scroll-light-grain';
  layer.appendChild(grain);

  var written = {};
  function put(name, value) {
    if (written[name] === value) return;
    written[name] = value;
    layer.style.setProperty(name, value);
  }
  function triplet(rgb) { return rgb.map(function (v) { return Math.round(v * 255); }).join(' '); }
  function paint(progress) {
    var colours = sceneAt(progress, scheme());
    for (var i = 0; i < colours.length; i++) put('--sl-' + i, triplet(colours[i]));
    var d = drift(progress);
    put('--sl-dx', d[0].toFixed(2) + '%');
    put('--sl-dy', d[1].toFixed(2) + '%');
  }

  // Faint grain: one random tile, repeated over a viewport-sized canvas, drawn again only on resize.
  var tile = null;
  function drawGrain() {
    var ctx = grain.getContext && grain.getContext('2d');
    if (!ctx) return;
    var w = Math.max(1, Math.min(2560, window.innerWidth)), h = Math.max(1, Math.min(2560, window.innerHeight));
    if (grain.width !== w || grain.height !== h) { grain.width = w; grain.height = h; }
    if (!tile) {
      tile = document.createElement('canvas');
      tile.width = tile.height = GRAIN.tile;
      var tctx = tile.getContext('2d');
      var img = tctx.createImageData(GRAIN.tile, GRAIN.tile);
      for (var i = 0; i < img.data.length; i += 4) {
        var v = Math.random() * 255;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = GRAIN.alpha;
      }
      tctx.putImageData(img, 0, 0);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, w, h);
  }

  var shown = 0, target = 0, last = 0, raf = 0;
  function measure() {
    var room = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    target = room > 0 ? Math.min(1, Math.max(0, window.scrollY / room)) : 0;
  }
  function frame(now) {
    raf = 0;
    var dt = last ? Math.min(now - last, 100) / 1000 : 1 / 60;
    last = now;
    shown += (target - shown) * (1 - Math.exp(-dt / FOLLOW_SEC));
    if (Math.abs(target - shown) < 1e-4) shown = target;
    paint(shown);
    if (shown !== target) raf = window.requestAnimationFrame(frame);
    else last = 0;
  }
  function wake() {
    if (still()) return;
    measure();
    if (!raf && shown !== target) raf = window.requestAnimationFrame(frame);
  }
  function settle() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0; last = 0;
    if (still()) { shown = target = 0; } else { measure(); shown = target; }
    paint(shown);
  }

  document.body.insertBefore(layer, document.body.firstChild);
  document.documentElement.classList.add('has-scroll-light');
  settle();
  drawGrain();

  window.addEventListener('scroll', wake, { passive: true });
  window.addEventListener('resize', function () { drawGrain(); wake(); }, { passive: true });
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', function () { paint(shown); });
  if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', settle);
})();
