/* The living light behind every sidekickagent.app page — the app's stage (owner 2026-11-16).
 *
 * One ground colour and four very large, soft light blobs, folded like stirred paint, drawn by one
 * WebGL shader into a fixed canvas behind the page. Every number is the app's:
 *   apps/mobile/app/data/stageLight.js   tone (start hue 16 = orange, full colour wheel, 0.2°/s),
 *                                         saturation/lightness per scheme, blob paths and hue offsets
 *   apps/mobile/app/data/stageFlow.js    paint flow (strength, scale, 60 s turn, 1.14 breath, 3 octaves)
 *   apps/mobile/app/components/stageLight/LivingLight.js   the shader, ported line for line
 * The one web-only change: blob radius and flow are sized against min(width, 0.46 × height) instead of
 * the width, so a landscape window shows the same blobs a phone does rather than one wash.
 *
 * Like the app it draws 15 frames a second, stops while the tab is hidden, and with reduced motion
 * shows the t = 0 scene. Colour and clock are kept in localStorage while the page is visible, so the
 * next page (or the next visit) continues from the same colour instead of starting over.
 * Without WebGL nothing is drawn and the stylesheet's static ground (html background) shows. */
(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (document.querySelector('canvas.stage-light')) return;

  var TONE = { baseHue: 16, driftDegPerSec: 0.2 };
  var FLOW = { strength: 0.15, scale: 1.25, turnSec: 60, breathMax: 1.14, flowRadius: 0.35, periodFactor: 1.618 };
  var SATURATION = { light: 80, dark: 52 };
  // [ground, L1, L2, L3], as in the app.
  var LIGHTNESS = { light: [82, 90, 95, 76], dark: [13, 20, 25, 17] };
  var FRAME_MS = 1000 / 15;
  var RENDER_SCALE = 0.5; // the picture is all soft gradients; half resolution is indistinguishable
  var STORE_KEY = 'sidekick.stageLight.web.v1';
  var TAU = Math.PI * 2;

  var canvas = document.createElement('canvas');
  canvas.className = 'stage-light';
  canvas.setAttribute('aria-hidden', 'true');
  // Placed from here too, so a page whose policy allows no stylesheet (/login/) still gets it behind everything.
  var place = { position: 'fixed', top: '0', left: '0', width: '100%', height: '100%', zIndex: '-1', display: 'block', pointerEvents: 'none' };
  for (var key in place) canvas.style[key] = place[key];
  var gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  } catch (e) { gl = null; }
  if (!gl) return;

  var VERT = 'attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }';
  var FRAG = [
    'precision highp float;',
    'uniform vec2 uSize;',
    'uniform float uRef;',
    'uniform vec3 uBase;',
    'uniform vec3 uColor0; uniform vec3 uColor1; uniform vec3 uColor2; uniform vec3 uColor3;',
    'uniform vec3 uSpot0; uniform vec3 uSpot1; uniform vec3 uSpot2; uniform vec3 uSpot3;',
    'uniform vec4 uWarp;',
    'float glow(vec2 pos, vec3 spot) {',
    '  float radius = max(spot.z * uRef, 1.0);',
    '  float d = length(pos - spot.xy * uSize) / radius;',
    '  return 0.95 * (1.0 - smoothstep(0.0, 1.0, d));',
    '}',
    'float hash(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    'float fbm(vec2 p) {',
    '  float sum = 0.0; float amp = 0.5; float norm = 0.0;',
    '  for (int i = 0; i < 3; i++) { sum += amp * noise(p); norm += amp; p *= 2.0; amp *= 0.5; }',
    '  return sum / norm;',
    '}',
    'vec2 warp(vec2 pos) {',
    '  vec2 p = pos / uRef * uWarp.w + uWarp.xy;',
    '  return pos + uWarp.z * uRef * (vec2(fbm(p), fbm(p + vec2(5.2, 1.3))) - 0.5) * 2.0;',
    '}',
    'void main() {',
    '  vec2 pos = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);',
    '  vec3 col = uBase;',
    '  vec2 q = warp(pos);',
    '  col = mix(col, uColor0, glow(q, uSpot0));',
    '  col = mix(col, uColor1, glow(q, uSpot1));',
    '  col = mix(col, uColor2, glow(q, uSpot2));',
    '  col = mix(col, uColor3, glow(q, uSpot3));',
    '  float n = fract(52.9829189 * fract(dot(pos, vec2(0.06711056, 0.00583715)))) - 0.5;',
    '  col += n / 255.0;',
    '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
    '}'
  ].join('\n');

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }
  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  var program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  var buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  var u = {};
  ['uSize', 'uRef', 'uBase', 'uColor0', 'uColor1', 'uColor2', 'uColor3', 'uSpot0', 'uSpot1', 'uSpot2', 'uSpot3', 'uWarp']
    .forEach(function (name) { u[name] = gl.getUniformLocation(program, name); });

  function wrapHue(h) { return ((h % 360) + 360) % 360; }
  function hslToRgb01(h, s, l) {
    var sat = s / 100, light = l / 100;
    var chroma = (1 - Math.abs(2 * light - 1)) * sat;
    var sector = wrapHue(h) / 60;
    var x = chroma * (1 - Math.abs((sector % 2) - 1));
    var rgb = sector < 1 ? [chroma, x, 0] : sector < 2 ? [x, chroma, 0] : sector < 3 ? [0, chroma, x]
      : sector < 4 ? [0, x, chroma] : sector < 5 ? [x, 0, chroma] : [chroma, 0, x];
    var m = light - chroma / 2;
    return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
  }

  // The app's stageLightPlan: full-wheel band, so a hue is baseHue + travel (+ each blob's offset).
  function plan(travel, t, scheme) {
    var s = SATURATION[scheme], L = LIGHTNESS[scheme];
    function at(offset) { return wrapHue(TONE.baseHue + travel + offset); }
    return {
      base: [at(0), s, L[0]],
      blobs: [
        [0.25 + 0.18 * Math.sin(0.11 * t), 0.2 + 0.1 * Math.cos(0.09 * t), 0.8, at(18), s, L[1]],
        [0.82 + 0.12 * Math.cos(0.07 * t), 0.45 + 0.15 * Math.sin(0.1 * t), 0.75, at(-24), s, L[3]],
        [0.4 + 0.2 * Math.sin(0.06 * t + 2), 0.82 + 0.1 * Math.cos(0.08 * t), 0.85, at(8), s, L[2]],
        [0.6 + 0.15 * Math.cos(0.05 * t + 1), 0.08 + 0.08 * Math.sin(0.12 * t), 0.55, at(42), s, L[2]]
      ]
    };
  }
  // The app's stageFlowWarp.
  function flow(t) {
    var a = (TAU * t) / FLOW.turnSec;
    var b = (TAU * t) / (FLOW.turnSec * FLOW.periodFactor);
    var breath = (1 - Math.cos((TAU * t) / FLOW.turnSec)) / 2;
    return [FLOW.flowRadius * (Math.cos(a) + Math.cos(b)), FLOW.flowRadius * (Math.sin(a) + Math.sin(b)),
      FLOW.strength, FLOW.scale * (1 + (FLOW.breathMax - 1) * breath)];
  }

  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function scheme() { return darkQuery && darkQuery.matches ? 'dark' : 'light'; }
  function still() { return !!(motionQuery && motionQuery.matches); }

  // Colour (travel, degrees) and scene clock (seconds) advance only while a page is visible.
  var state = { travel: 0, clock: 0 };
  try {
    var saved = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
    if (saved && isFinite(saved.travel) && isFinite(saved.clock)) state = { travel: +saved.travel, clock: +saved.clock };
  } catch (e) { /* private mode or a bad value: start from the first colour */ }
  function save() {
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ travel: state.travel % 3600, clock: state.clock % 36000 })); } catch (e) {}
  }

  function resize() {
    var w = Math.max(1, Math.round(window.innerWidth * RENDER_SCALE));
    var h = Math.max(1, Math.round(window.innerHeight * RENDER_SCALE));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
  }

  function draw() {
    var w = canvas.width, h = canvas.height;
    var t = still() ? 0 : state.clock;
    var p = plan(state.travel, t, scheme());
    gl.uniform2f(u.uSize, w, h);
    gl.uniform1f(u.uRef, Math.min(w, 0.46 * h));
    gl.uniform3fv(u.uBase, hslToRgb01(p.base[0], p.base[1], p.base[2]));
    for (var i = 0; i < 4; i++) {
      var blob = p.blobs[i];
      gl.uniform3fv(u['uColor' + i], hslToRgb01(blob[3], blob[4], blob[5]));
      gl.uniform3f(u['uSpot' + i], blob[0], blob[1], blob[2]);
    }
    var f = flow(t);
    gl.uniform4f(u.uWarp, f[0], f[1], f[2], f[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  var last = 0, acc = 0, sinceSave = 0, raf = 0;
  function frame(now) {
    raf = 0;
    if (document.hidden) return;
    var dt = last ? Math.min(now - last, 100) : 0;
    last = now;
    acc += dt;
    if (!still()) {
      state.clock += dt / 1000;
      state.travel += (dt / 1000) * TONE.driftDegPerSec;
    }
    if (acc >= FRAME_MS) { acc = 0; draw(); }
    sinceSave += dt;
    if (sinceSave > 5000) { sinceSave = 0; save(); }
    if (!still()) raf = window.requestAnimationFrame(frame);
  }
  function start() {
    last = 0;
    resize();
    draw();
    if (!raf && !still()) raf = window.requestAnimationFrame(frame);
  }

  document.body.insertBefore(canvas, document.body.firstChild);
  document.documentElement.classList.add('has-stage-light');
  start();

  window.addEventListener('resize', function () { resize(); draw(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) save(); else start(); });
  window.addEventListener('pagehide', save);
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', draw);
  if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', start);
  // A lost GPU context leaves the static ground showing; it is not worth a reload.
  canvas.addEventListener('webglcontextlost', function () { if (raf) window.cancelAnimationFrame(raf); raf = 0; canvas.hidden = true; });
})();
