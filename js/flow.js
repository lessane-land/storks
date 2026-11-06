// The animated year: every bird-year of the archive drawn as a slow comet on
// one calendar year that loops. A canvas over the map, redrawn each frame.
(function () {
  "use strict";

  var TAIL = 10;            // days of tail behind each comet
  var SPEED = 4.5;          // days per second away from today
  var SLOW = 1.2;           // days per second near today
  var NEAR = 4;             // days around today where the loop slows down
  var COLOR = "242, 200, 121";
  var YEAR = 366;

  var LABEL_EVERY = 14;     // one named comet in fourteen carries its name
  var DRIFT = 0.012;        // camera easing per frame toward the flock
  var DRIFT_REST = 12000;   // ms of calm after the user touches the map

  var map, canvas, ctx, data, tracks = [], t = 0, last = 0, today = 0, dpr = 1;
  var onTick = null, running = false, names = [], labelled = [], userTouched = 0, drifting = true;

  function dayOfYear(d) {
    var start = Date.UTC(2024, 0, 1);
    var cur = Date.UTC(2024, d.getMonth(), d.getDate());
    return Math.round((cur - start) / 86400000);
  }

  function resize() {
    var c = map.getContainer();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = c.clientWidth * dpr;
    canvas.height = c.clientHeight * dpr;
    canvas.style.width = c.clientWidth + "px";
    canvas.style.height = c.clientHeight + "px";
  }

  function posAt(track, day) {
    // Position of a track on a fractional day, interpolated between fixes.
    var i = day - track.s;
    if (i < 0 || i >= track.p.length) return null;
    var k = Math.floor(i), f = i - k;
    var a = track.p[k], b = track.p[k + 1];
    if (!a) return null;
    if (!b || f === 0) return a;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  function draw() {
    if (!running) return;
    var now = performance.now();
    var dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    var dist = Math.min(Math.abs(t - today), YEAR - Math.abs(t - today));
    var speed = dist < NEAR ? SLOW + (SPEED - SLOW) * (dist / NEAR) : SPEED;
    t = (t + dt * speed) % YEAR;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    var flying = 0, sumLon = 0, sumLat = 0;
    var labels = [];
    for (var n = 0; n < tracks.length; n++) {
      var tr = tracks[n];
      var head = posAt(tr, t);
      if (!head) continue;
      flying++;
      sumLon += head[0];
      sumLat += head[1];
      var hp = map.project(head);
      if (labelled[n]) labels.push([hp, names[tr.b]]);

      // Tail: one segment per day, fading into the past.
      var prev = hp;
      for (var k = 1; k <= TAIL; k++) {
        var q = posAt(tr, t - k);
        if (!q) break;
        var qp = map.project(q);
        var a = 0.5 * (1 - k / (TAIL + 1));
        ctx.strokeStyle = "rgba(" + COLOR + "," + a.toFixed(3) + ")";
        ctx.lineWidth = 1.4 * (1 - k / (TAIL + 2)) + 0.3;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(qp.x, qp.y);
        ctx.stroke();
        prev = qp;
      }

      ctx.fillStyle = "rgba(" + COLOR + ",0.10)";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(" + COLOR + ",0.95)";
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Names, drawn last so they sit above the light.
    ctx.globalCompositeOperation = "source-over";
    ctx.font = "12px " + getComputedStyle(document.body).getPropertyValue("--serif");
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(232, 227, 216, 0.72)";
    ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
    ctx.shadowBlur = 4;
    var placed = [];
    for (var l = 0; l < labels.length; l++) {
      var p = labels[l][0], free = true;
      for (var m = 0; m < placed.length; m++) {
        if (Math.abs(placed[m].x - p.x) < 70 && Math.abs(placed[m].y - p.y) < 14) { free = false; break; }
      }
      if (!free) continue;
      placed.push(p);
      ctx.fillText(labels[l][1], p.x + 7, p.y);
    }
    ctx.shadowBlur = 0;

    // The camera follows the flock, slowly, unless the user is looking around.
    if (drifting && flying && now - userTouched > DRIFT_REST) {
      var c = map.getCenter();
      var target = [sumLon / flying, sumLat / flying];
      map.jumpTo({ center: [c.lng + (target[0] - c.lng) * DRIFT, c.lat + (target[1] - c.lat) * DRIFT] });
    }

    if (onTick) onTick(t, flying);
    requestAnimationFrame(draw);
  }

  function hash(s) {
    var h = 7;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return h;
  }

  window.Flow = {
    init: function (m, yearData, opts) {
      map = m;
      data = yearData;
      tracks = data.tracks;
      today = dayOfYear(new Date());
      t = (opts && typeof opts.start === "number") ? opts.start : (today + YEAR - 20) % YEAR;
      onTick = opts && opts.onTick;
      names = (opts && opts.names) || [];
      labelled = tracks.map(function (tr) {
        var nm = names[tr.b];
        return !!nm && hash(nm + tr.y) % LABEL_EVERY === 0;
      });
      drifting = !(opts && opts.drift === false);
      ["mousedown", "touchstart", "wheel"].forEach(function (ev) {
        map.getContainer().addEventListener(ev, function () { userTouched = performance.now(); }, { passive: true });
      });
      canvas = document.createElement("canvas");
      canvas.className = "flow";
      map.getContainer().appendChild(canvas);
      ctx = canvas.getContext("2d");
      resize();
      map.on("resize", resize);
      running = true;
      last = performance.now();
      requestAnimationFrame(draw);
    },
    day: function () { return t; },
    today: function () { return today; },
    seek: function (d) { t = ((d % YEAR) + YEAR) % YEAR; },
    pause: function () { running = false; },
    resume: function () { if (!running) { running = true; last = performance.now(); requestAnimationFrame(draw); } }
  };
})();
