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

  var map, canvas, ctx, data, tracks = [], t = 0, last = 0, today = 0, dpr = 1;
  var onTick = null, running = false;

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

    var flying = 0;
    for (var n = 0; n < tracks.length; n++) {
      var tr = tracks[n];
      var head = posAt(tr, t);
      if (!head) continue;
      flying++;
      var hp = map.project(head);

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
    if (onTick) onTick(t, flying);
    requestAnimationFrame(draw);
  }

  window.Flow = {
    init: function (m, yearData, opts) {
      map = m;
      data = yearData;
      tracks = data.tracks;
      today = dayOfYear(new Date());
      t = (opts && typeof opts.start === "number") ? opts.start : (today + YEAR - 20) % YEAR;
      onTick = opts && opts.onTick;
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
