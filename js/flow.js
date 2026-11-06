// The animated year: every bird-year of the archive drawn as a slow comet on
// one calendar year that loops. A canvas over the map, redrawn each frame.
//
// Fast path: positions are projected with our own Web Mercator maths (the map
// has no pitch or bearing), tails are batched into one stroke per age, and
// the camera moves a few times a second, not every frame.
(function () {
  "use strict";

  var TAIL = 10;            // days of tail behind each comet
  var TAIL_FOLLOW = 40;     // days of tail for the bird being followed
  var SPEED = 4.5;          // days per second away from today
  var SLOW = 1.2;           // days per second near today
  var NEAR = 4;             // days around today where the loop slows down
  var HOLD = 5000;          // ms the loop rests on today
  var FADE = 900;           // ms to fade out and in when the loop restarts
  var LABEL_EVERY = 14;     // one named comet in fourteen carries its name
  var DRIFT = 0.06;         // camera easing per camera step toward the flock
  var DRIFT_MS = 100;       // ms between camera steps
  var DRIFT_REST = 12000;   // ms of calm after the user touches the map
  var COLOR = "242, 200, 121";
  var YEAR = 366;

  var map, canvas, ctx, data, tracks = [], t = 0, last = 0, today = 0, dpr = 1;
  var onTick = null, onToday = null, running = false, names = [], labelled = [];
  var userTouched = 0, drifting = true, lastCamera = 0, holdUntil = 0, fadeAt = Infinity, fadeUntil = 0;
  var u = 0, start = 0;      // days since the loop started, and the loop's first day
  var restMs = DRIFT_REST;   // how long the camera stays still after the user moves it

  function restUntilMs() { return restMs; }
  var following = -1, placed = [], onFollow = null;
  var W = 0, H = 0, worldSize = 0, cx = 0, cy = 0; // projection state for the frame

  function dayOfYear(d) {
    var start = Date.UTC(2024, 0, 1);
    var cur = Date.UTC(2024, d.getMonth(), d.getDate());
    return Math.round((cur - start) / 86400000);
  }

  function resize() {
    var c = map.getContainer();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = c.clientWidth;
    H = c.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
  }

  // Mercator in [0, 1]. Precomputed once per point.
  function mx(lon) { return (lon + 180) / 360; }
  function my(lat) {
    var s = Math.sin(lat * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }

  function prepare() {
    tracks.forEach(function (tr) {
      tr.m = tr.p.map(function (p) { return p ? [mx(p[0]), my(p[1])] : null; });
    });
  }

  function frameProjection() {
    var c = map.getCenter();
    worldSize = 512 * Math.pow(2, map.getZoom());
    cx = mx(c.lng) * worldSize - W / 2;
    cy = my(c.lat) * worldSize - H / 2;
  }

  // Screen position of a track on a fractional day, interpolated between fixes.
  function screenAt(tr, day, out) {
    var i = day - tr.s;
    if (i < 0 || i >= tr.m.length) return false;
    var k = Math.floor(i), f = i - k;
    var a = tr.m[k], b = tr.m[k + 1];
    if (!a) return false;
    var x, y;
    if (!b || f === 0) { x = a[0]; y = a[1]; } else { x = a[0] + (b[0] - a[0]) * f; y = a[1] + (b[1] - a[1]) * f; }
    out.x = x * worldSize - cx;
    out.y = y * worldSize - cy;
    return true;
  }

  function season() {
    // 1 at midsummer, -1 at midwinter.
    return Math.cos((t - 172) / YEAR * Math.PI * 2);
  }

  function drawSeason() {
    // A breath of season on the land: cold from the north in winter, warm from
    // the south in summer. Screen space, very faint.
    var s = season();
    var winter = (1 - s) / 2, summer = (1 + s) / 2;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "rgba(120, 160, 220, " + (0.10 * winter).toFixed(3) + ")");
    g.addColorStop(0.5, "rgba(0, 0, 0, 0)");
    g.addColorStop(1, "rgba(242, 180, 100, " + (0.07 * summer).toFixed(3) + ")");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  var heads = [], pt = { x: 0, y: 0 }, q = { x: 0, y: 0 };

  function draw() {
    if (!running) return;
    var now = performance.now();
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    // Time: the loop runs the last twelve months and ends on today. u counts
    // days since the loop started; near the end it slows, rests, fades, restarts.
    var left = YEAR - 1 - u;
    if (now < holdUntil) {
      dt = 0;
    } else if (fadeUntil > now) {
      dt = 0;
      if (now >= fadeAt) { u = 0; fadeAt = Infinity; }
    } else {
      var speed = left < NEAR ? SLOW + (SPEED - SLOW) * (left / NEAR) : SPEED;
      u += dt * speed;
      if (u >= YEAR - 1) {
        u = YEAR - 1;
        holdUntil = now + HOLD;
        fadeAt = now + HOLD + FADE;
        fadeUntil = now + HOLD + FADE * 2;
        if (onToday) onToday();
      }
    }
    t = (start + u) % YEAR;
    var alpha = 1;
    if (now < fadeUntil && now >= holdUntil) alpha = now < fadeAt ? 1 - (now - holdUntil) / FADE : (now - fadeAt) / FADE;

    frameProjection();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = alpha;
    drawSeason();

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    var flying = 0, sumX = 0, sumY = 0, dim = following >= 0 ? 0.3 : 1;
    heads.length = 0;
    var labels = [];
    var tailDays = following >= 0 ? TAIL_FOLLOW : TAIL;

    // Tails, one path per day of age so a frame costs ten strokes, not thousands.
    for (var k = 1; k <= tailDays; k++) {
      var a = 0.5 * (1 - k / (TAIL + 1));
      if (k > TAIL) a = 0.25 * (1 - (k - TAIL) / (TAIL_FOLLOW - TAIL + 1));
      ctx.lineWidth = Math.max(0.3, 1.4 * (1 - k / (TAIL + 2)) + 0.3);
      ctx.strokeStyle = "rgba(" + COLOR + "," + (a * dim).toFixed(3) + ")";
      ctx.beginPath();
      var any = false;
      for (var n = 0; n < tracks.length; n++) {
        if (k > TAIL && n !== following) continue;
        var tr = tracks[n];
        if (!screenAt(tr, t - k + 1, pt) || !screenAt(tr, t - k, q)) continue;
        if (pt.x < -50 && q.x < -50 || pt.x > W + 50 && q.x > W + 50 || pt.y < -50 && q.y < -50 || pt.y > H + 50 && q.y > H + 50) continue;
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(q.x, q.y);
        any = true;
      }
      if (any) ctx.stroke();
      if (following >= 0 && k > TAIL) {
        // The followed bird's long tail, drawn alone and bright.
        ctx.strokeStyle = "rgba(" + COLOR + "," + a.toFixed(3) + ")";
        if (screenAt(tracks[following], t - k + 1, pt) && screenAt(tracks[following], t - k, q)) {
          ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
      }
    }

    // Heads: halos in one path, dots in another.
    ctx.fillStyle = "rgba(" + COLOR + "," + (0.10 * dim).toFixed(3) + ")";
    ctx.beginPath();
    for (var n2 = 0; n2 < tracks.length; n2++) {
      if (!screenAt(tracks[n2], t, pt)) continue;
      flying++;
      sumX += pt.x; sumY += pt.y;
      if (pt.x < -20 || pt.x > W + 20 || pt.y < -20 || pt.y > H + 20) continue;
      heads.push(n2, pt.x, pt.y);
      ctx.moveTo(pt.x + 5, pt.y);
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      if (labelled[n2] || n2 === following) labels.push([pt.x, pt.y, names[tracks[n2].b], n2]);
    }
    ctx.fill();
    ctx.fillStyle = "rgba(" + COLOR + "," + (0.95 * dim).toFixed(3) + ")";
    ctx.beginPath();
    for (var h = 0; h < heads.length; h += 3) {
      ctx.moveTo(heads[h + 1] + 1.6, heads[h + 2]);
      ctx.arc(heads[h + 1], heads[h + 2], 1.6, 0, Math.PI * 2);
    }
    ctx.fill();
    if (following >= 0 && screenAt(tracks[following], t, pt)) {
      ctx.fillStyle = "rgba(" + COLOR + ",0.25)";
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255, 245, 225, 1)";
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 2.4, 0, Math.PI * 2); ctx.fill();
    }

    // Names, outlined rather than blurred, skipping neighbours.
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "12px " + serif;
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(11, 15, 20, 0.85)";
    placed = [];
    for (var l = 0; l < labels.length; l++) {
      var x = labels[l][0], y = labels[l][1], free = labels[l][3] === following;
      if (!free) {
        free = true;
        for (var m = 0; m < placed.length; m++) {
          if (Math.abs(placed[m].x - x) < 70 && Math.abs(placed[m].y - y) < 14) { free = false; break; }
        }
      }
      if (!free) continue;
      placed.push({ x: x, y: y, n: labels[l][3], w: ctx.measureText(labels[l][2]).width });
      ctx.fillStyle = labels[l][3] === following ? "rgba(255, 245, 225, 1)" : "rgba(232, 227, 216, 0.72)";
      ctx.strokeText(labels[l][2], x + 7, y);
      ctx.fillText(labels[l][2], x + 7, y);
    }

    // The camera: toward the followed bird, or the flock's centre, a few times a second.
    if (drifting && now - lastCamera > DRIFT_MS && now - userTouched > restUntilMs(now) && !map.isMoving()) {
      lastCamera = now;
      var tx = -1, ty = -1;
      if (following >= 0) { if (screenAt(tracks[following], t, pt)) { tx = pt.x; ty = pt.y; } }
      else if (flying) { tx = sumX / flying; ty = sumY / flying; }
      if (tx >= 0) {
        var dx = (tx - W / 2) * DRIFT, dy = (ty - H / 2) * DRIFT;
        if (Math.abs(dx) + Math.abs(dy) > 0.3) map.panBy([dx, dy], { duration: 0 });
      }
    }

    ctx.globalAlpha = 1;
    if (onTick) onTick(t, flying, following >= 0 ? tracks[following] : null, u / (YEAR - 1));
    requestAnimationFrame(draw);
  }

  var serif = "serif";

  function hash(s) {
    var h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return h;
  }

  function hitLabel(x, y) {
    for (var i = 0; i < placed.length; i++) {
      var p = placed[i];
      if (x >= p.x - 6 && x <= p.x + 10 + p.w && y >= p.y - 9 && y <= p.y + 9) return p.n;
    }
    return -1;
  }

  window.Flow = {
    init: function (m, yearData, opts) {
      map = m;
      data = yearData;
      tracks = data.tracks;
      prepare();
      today = dayOfYear(new Date());
      start = (today + 1) % YEAR;
      u = (opts && typeof opts.start === "number") ? ((opts.start - start) % YEAR + YEAR) % YEAR : 0;
      t = (start + u) % YEAR;
      onTick = opts && opts.onTick;
      onToday = opts && opts.onToday;
      onFollow = opts && opts.onFollow;
      names = (opts && opts.names) || [];
      labelled = tracks.map(function (tr) {
        var nm = names[tr.b];
        return !!nm && hash(nm + tr.y) % LABEL_EVERY === 0;
      });
      drifting = !(opts && opts.drift === false);
      serif = getComputedStyle(document.body).getPropertyValue("--serif") || "serif";
      var container = map.getContainer();
      ["mousedown", "touchstart", "wheel"].forEach(function (ev) {
        container.addEventListener(ev, function () { userTouched = performance.now(); restMs = DRIFT_REST; }, { passive: true });
      });
      // Gestures MapLibre turns into camera moves (drag, pinch, scroll zoom) pause the drift too.
      ["dragstart", "zoomstart"].forEach(function (ev) {
        map.on(ev, function (e) { if (e && e.originalEvent) { userTouched = performance.now(); restMs = DRIFT_REST; } });
      });
      container.addEventListener("click", function (e) {
        var r = container.getBoundingClientRect();
        var n = hitLabel(e.clientX - r.left, e.clientY - r.top);
        if (n >= 0) Flow.follow(n);
        else if (following >= 0) Flow.follow(-1);
      });
      canvas = document.createElement("canvas");
      canvas.className = "flow";
      container.appendChild(canvas);
      ctx = canvas.getContext("2d");
      resize();
      map.on("resize", resize);
      running = true;
      last = performance.now();
      requestAnimationFrame(draw);
    },
    // Keep the camera still for a while: a card click, or forever with Infinity.
    rest: function (ms) { userTouched = performance.now(); restMs = ms; },
    resumeDrift: function () { userTouched = 0; restMs = DRIFT_REST; },
    follow: function (n) {
      following = n;
      userTouched = 0;
      if (onFollow) onFollow(n >= 0 ? tracks[n] : null, n >= 0 ? names[tracks[n].b] : null);
    },
    day: function () { return t; },
    today: function () { return today; },
    seek: function (d) { u = Math.min(YEAR - 1.01, ((d - start) % YEAR + YEAR) % YEAR); holdUntil = 0; fadeUntil = 0; fadeAt = Infinity; },
    progress: function () { return u / (YEAR - 1); },
    pause: function () { running = false; },
    resume: function () { if (!running) { running = true; last = performance.now(); requestAnimationFrame(draw); } }
  };
})();
