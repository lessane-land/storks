(function () {
  "use strict";

  var DATA_URL = "data/storks.json";
  var YEAR_URL = "data/year.json";
  var BIRDS_URL = "data/birds.json";
  var STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
  var TRACK_DAYS = 60;
  // The stage: from the German nests to the Sahel.
  var STAGE = [[-19, 9], [26, 54]];
  var STAGE_NARROW = [[-13, 10], [14, 52]];

  var lang = pickLang();
  var map, data, markers = {}, activeId = null, yearData = null, bios = {};

  function pickLang() {
    try {
      var saved = localStorage.getItem("lang");
      if (saved === "es" || saved === "en") return saved;
    } catch (e) { /* private mode */ }
    return (navigator.language || "es").slice(0, 2) === "en" ? "en" : "es";
  }

  function t(key, vars) {
    var s = (window.STRINGS[lang] && window.STRINGS[lang][key]) || window.STRINGS.es[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }

  function locale() { return lang === "es" ? "es-ES" : "en-GB"; }

  function fmtNumber(n) {
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(n);
  }

  function ago(ts) {
    var s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 120) return t("just_now");
    if (s < 3600) return t("minutes_ago", { n: Math.round(s / 60) });
    if (s < 86400) return t("hours_ago", { n: Math.round(s / 3600) });
    var d = Math.round(s / 86400);
    return d === 1 ? t("one_day_ago") : t("days_ago", { n: d });
  }

  function km(track) {
    var total = 0;
    for (var i = 1; i < track.length; i++) total += haversine(track[i - 1], track[i]);
    return total;
  }

  function haversine(a, b) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function applyStatic() {
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.getElementById("lang").textContent = t("lang_switch");
    if (data) {
      renderCards();
      renderCredits();
      renderStamp();
    }
  }

  function whereLine(bird) {
    var w = bird.where && bird.where[lang];
    if (!w) return null;
    var inner = w.region ? t("in_place_region", { place: w.place, region: w.region }) : t("in_place", { place: w.place });
    return bird.name + " " + inner + ".";
  }

  function renderCards() {
    var host = document.getElementById("birds");
    host.innerHTML = "";
    var live = data.birds.filter(function (b) { return !b.dead; });
    if (!live.length) {
      var p = document.createElement("p");
      p.className = "bird";
      p.textContent = t("empty");
      host.appendChild(p);
      return;
    }
    var tpl = document.getElementById("bird-card");
    live.sort(function (a, b) { return b.last.t - a.last.t; }).forEach(function (bird) {
      var node = tpl.content.cloneNode(true);
      var card = node.querySelector(".bird");
      card.dataset.id = bird.id;
      if (bird.id === activeId) card.classList.add("active");
      node.querySelector(".name").textContent = bird.name;
      var where = whereLine(bird);
      var whereEl = node.querySelector(".where");
      if (where) whereEl.textContent = where; else whereEl.remove();
      var days = Math.min(TRACK_DAYS, Math.max(1, Math.round((bird.last.t - bird.track[0][2]) / 86400)));
      node.querySelector(".meta").textContent =
        t("last_signal", { ago: ago(bird.last.t) }) + " · " + t("walked", { km: fmtNumber(km(bird.track)), days: days });
      card.addEventListener("click", function () { focusBird(bird); });
      host.appendChild(node);
    });
  }

  function renderStamp() {
    var d = new Date(data.generated);
    var f = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    document.getElementById("stamp").textContent = t("stamp", { date: f.format(d) });
  }

  function renderCredits() {
    var ul = document.getElementById("credits-studies");
    ul.innerHTML = "";
    data.studies.forEach(function (s) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "https://www.movebank.org/cms/webapp?gwt_fragment=page=studies,path=study" + s.id;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = s.name;
      li.appendChild(a);
      li.appendChild(document.createTextNode(" · " + (s.live ? t("study_live", { n: s.live }) : t("study_none"))));
      ul.appendChild(li);
    });
  }

  function focusBird(bird) {
    activeId = bird.id;
    document.querySelectorAll(".bird").forEach(function (el) { el.classList.toggle("active", el.dataset.id === bird.id); });
    map.fitBounds(bounds(bird.track), { padding: 80, maxZoom: 11, duration: 1800 });
  }

  function bounds(points) {
    var b = new maplibregl.LngLatBounds();
    points.forEach(function (p) { b.extend([p[0], p[1]]); });
    return b;
  }

  function trackGeoJSON(bird) {
    var features = [];
    var now = Date.now() / 1000;
    for (var i = 1; i < bird.track.length; i++) {
      var a = bird.track[i - 1], b = bird.track[i];
      features.push({
        type: "Feature",
        properties: { age: (now - b[2]) / 86400 },
        geometry: { type: "LineString", coordinates: [[a[0], a[1]], [b[0], b[1]]] }
      });
    }
    return { type: "FeatureCollection", features: features };
  }

  function addBirdToMap(bird) {
    var src = "track-" + bird.id;
    map.addSource(src, { type: "geojson", data: trackGeoJSON(bird) });
    map.addLayer({
      id: src,
      type: "line",
      source: src,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#f2c879",
        "line-width": 1.6,
        "line-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.9, TRACK_DAYS, 0.12]
      }
    });
    var el = document.createElement("div");
    el.className = "marker";
    el.innerHTML = '<span class="halo"></span><span class="dot"></span>';
    el.title = bird.name;
    el.addEventListener("click", function () { focusBird(bird); });
    markers[bird.id] = new maplibregl.Marker({ element: el }).setLngLat([bird.last.lon, bird.last.lat]).addTo(map);
  }

  // Coastlines and a breath of land. No labels, no roads: the birds are the light.
  function nightBasemap() {
    map.getStyle().layers.forEach(function (layer) {
      var sl = layer["source-layer"] || "";
      if (layer.type === "symbol" || /transportation|building|aeroway|landuse|park|poi|housenumber/.test(sl)) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      } else if (sl === "boundary") {
        map.setPaintProperty(layer.id, "line-opacity", 0.18);
      }
    });
  }

  // The year bar and the date, driven by the flow each frame.
  var lastDay = -1;
  function onTick(day, flying) {
    var d = Math.floor(day);
    document.getElementById("year-head").style.left = (day / 366 * 100) + "%";
    if (d === lastDay) return;
    lastDay = d;
    var date = new Date(Date.UTC(2024, 0, 1 + d));
    var f = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", timeZone: "UTC" });
    document.getElementById("year-date").textContent = f.format(date);
    document.getElementById("year-sub").textContent = t("year_sub", { n: fmtNumber(flying) });
  }

  function startFlow() {
    var q = new URLSearchParams(location.search);
    var start = q.has("day") ? parseInt(q.get("day"), 10) : undefined;
    Flow.init(map, yearData, { start: start, onTick: onTick });
    document.getElementById("year-today").style.left = (Flow.today() / 366 * 100) + "%";
    var bar = document.getElementById("year-bar");
    bar.addEventListener("click", function (e) {
      var r = bar.getBoundingClientRect();
      Flow.seek((e.clientX - r.left) / r.width * 366);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) Flow.pause(); else Flow.resume();
    });
  }

  function start() {
    applyStatic();
    var narrow = window.innerWidth < 720;
    map = new maplibregl.Map({
      container: "map",
      style: STYLE_URL,
      bounds: narrow ? STAGE_NARROW : STAGE,
      fitBoundsOptions: { padding: narrow ? { top: 90, bottom: 240, left: 10, right: 10 } : { top: 60, bottom: 120, left: 60, right: 60 } },
      attributionControl: false,
      cooperativeGestures: false
    });
    map.on("load", function () {
      nightBasemap();
      Promise.all([
        fetch(DATA_URL, { cache: "no-cache" }).then(function (r) { return r.json(); }),
        fetch(YEAR_URL).then(function (r) { return r.ok ? r.json() : null; }),
        fetch(BIRDS_URL).then(function (r) { return r.ok ? r.json() : []; })
      ]).then(function (res) {
        data = res[0];
        yearData = res[1];
        res[2].forEach(function (b) { bios[b.id] = b; });
        data.birds.filter(function (b) { return !b.dead && b.track.length > 1; }).forEach(addBirdToMap);
        renderCards();
        renderCredits();
        renderStamp();
        if (yearData) startFlow();
      });
    });

    document.getElementById("lang").addEventListener("click", function () {
      lang = lang === "es" ? "en" : "es";
      try { localStorage.setItem("lang", lang); } catch (e) { /* private mode */ }
      lastDay = -1;
      applyStatic();
    });
    document.getElementById("credits-open").addEventListener("click", function () {
      document.getElementById("credits").hidden = false;
    });
    document.getElementById("credits-close").addEventListener("click", function () {
      document.getElementById("credits").hidden = true;
    });
    document.getElementById("credits").addEventListener("click", function (e) {
      if (e.target === e.currentTarget) e.currentTarget.hidden = true;
    });
  }

  start();
})();
