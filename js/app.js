(function () {
  "use strict";

  var DATA_URL = "data/storks.json";
  var STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
  var TRACK_DAYS = 60;
  // The stage: Iberia and the Strait. Birds elsewhere keep their card and their dot.
  var IBERIA = [[-10.5, 35.0], [5.0, 44.5]];
  var HIDDEN_LAYERS = ["place_state", "place_suburb", "place_other", "highway_name_other", "highway_name_motorway", "water_name"];

  var MEMORY_URL = "data/memory/";
  var BIRDS_URL = "data/birds.json";
  var MEMORY_LINES = 6;

  var lang = pickLang();
  var map, data, markers = {}, activeId = null;
  var memory = null, bios = {}, memoryMarkers = [], activeMemory = null;

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

  function fmtNumber(n) {
    return new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-GB", { maximumFractionDigits: 0 }).format(n);
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
    if (memory) renderMemory();
  }

  // Coarse, honest regions for past positions. Boxes, not guesses at a town.
  function region(lon, lat) {
    if (lat >= 35.6 && lat <= 36.6 && lon >= -6.6 && lon <= -4.8) return "region_strait";
    if (lat >= 35.8 && lat <= 44.5 && lon >= -10 && lon <= 4.5) return "region_iberia";
    if (lat >= 27.5 && lat < 35.8 && lon >= -13.5 && lon <= -1) return "region_morocco";
    if (lat >= 18 && lat < 27.5 && lon >= -17 && lon <= 30) return "region_sahara";
    if (lat >= 9 && lat < 18 && lon >= -18 && lon <= 40) return "region_sahel";
    if (lat >= 44 && lon >= -10 && lon <= 40) return "region_europe";
    if (lat >= 28 && lat < 44 && lon >= 30 && lon <= 48) return "region_levant";
    if (lat < 28 && lon >= -18 && lon <= 52) return "region_africa";
    return "region_elsewhere";
  }

  function dayKey(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  function memoryGeoJSON(entries) {
    var features = [];
    entries.forEach(function (e) {
      if (e.trail.length < 2) return;
      features.push({
        type: "Feature",
        properties: { id: e.id + ":" + e.year },
        geometry: { type: "LineString", coordinates: e.trail.concat([e.pos]) }
      });
    });
    return { type: "FeatureCollection", features: features };
  }

  function addMemoryToMap() {
    map.addSource("memory", { type: "geojson", data: memoryGeoJSON(memory) });
    map.addLayer({
      id: "memory-trails",
      type: "line",
      source: "memory",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#a9a398", "line-width": 0.8, "line-opacity": 0.22 }
    }, "track-" + (data.birds[0] ? data.birds[0].id : undefined));
    memory.forEach(function (e) {
      var el = document.createElement("div");
      el.className = "memory-marker";
      el.addEventListener("click", function () { focusMemory(e); });
      var mk = new maplibregl.Marker({ element: el }).setLngLat(e.pos).addTo(map);
      memoryMarkers.push({ entry: e, el: el, marker: mk });
    });
  }

  function focusMemory(e) {
    activeMemory = e;
    memoryMarkers.forEach(function (m) { m.el.classList.toggle("active", m.entry === e); });
    document.querySelectorAll(".memory-list li").forEach(function (li) { li.classList.toggle("active", li.dataset.key === e.id + ":" + e.year); });
    map.fitBounds(bounds(e.trail.concat([e.pos])), { padding: 100, maxZoom: 8, duration: 1800 });
  }

  function memoryLabel(e) {
    var b = bios[e.id];
    return b && b.name ? b.name : e.id.split(":").pop();
  }

  function renderMemory() {
    var host = document.getElementById("memory");
    if (!memory || !memory.length) { host.hidden = true; return; }
    host.hidden = false;
    var f = new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "long" });
    document.getElementById("memory-title").textContent = t("memory_title", { date: f.format(new Date()) });
    document.getElementById("memory-count").textContent = t("memory_count", { n: fmtNumber(memory.length) });
    var ul = document.getElementById("memory-list");
    ul.innerHTML = "";
    // Named birds first, nearest to Iberia first, a different handful each day.
    // Real names only: sponsor labels carry digits or several words.
    var picks = memory.slice().filter(function (e) {
      var b = bios[e.id];
      return b && b.name && !/\d/.test(b.name) && b.name.split(" ").length <= 2;
    });
    var seed = new Date().getDate() * 7 + new Date().getMonth();
    function shuffleKey(e) {
      var h = seed;
      var s = e.id + e.year;
      for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) % 100003;
      return h;
    }
    picks.sort(function (a, b) {
      var ra = region(a.pos[0], a.pos[1]) === "region_elsewhere" ? 1 : 0;
      var rb = region(b.pos[0], b.pos[1]) === "region_elsewhere" ? 1 : 0;
      if (ra !== rb) return ra - rb;
      return shuffleKey(a) - shuffleKey(b);
    });
    var seen = {};
    picks = picks.filter(function (e) { if (seen[e.id]) return false; seen[e.id] = true; return true; });
    picks.slice(0, MEMORY_LINES).forEach(function (e) {
      var li = document.createElement("li");
      li.dataset.key = e.id + ":" + e.year;
      var where = t(region(e.pos[0], e.pos[1]));
      li.innerHTML = "";
      li.appendChild(document.createTextNode(memoryLabel(e) + " "));
      var y = document.createElement("span");
      y.className = "y";
      y.textContent = String(e.year);
      li.appendChild(y);
      li.appendChild(document.createTextNode(" " + where));
      li.addEventListener("click", function () { focusMemory(e); });
      ul.appendChild(li);
    });
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
    var f = new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
    var b = bounds(bird.track);
    map.fitBounds(b, { padding: 80, maxZoom: 11, duration: 1800 });
  }

  function bounds(points) {
    var b = new maplibregl.LngLatBounds();
    points.forEach(function (p) { b.extend([p[0], p[1]]); });
    return b;
  }

  function trackGeoJSON(bird) {
    // One feature per segment, with its age in days, so the line fades into the past.
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

  function calmBasemap() {
    // Fewer labels, Latin names only, so the birds are the only thing that glows.
    map.getStyle().layers.forEach(function (layer) {
      if (HIDDEN_LAYERS.indexOf(layer.id) >= 0) {
        map.setLayoutProperty(layer.id, "visibility", "none");
      } else if (layer.type === "symbol" && layer.id.indexOf("place_") === 0) {
        map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:latin"], ["get", "name"]]);
        map.setPaintProperty(layer.id, "text-color", "#6c675f");
      }
    });
  }

  function loadMemory() {
    var key = dayKey(new Date());
    Promise.all([
      fetch(BIRDS_URL).then(function (r) { return r.ok ? r.json() : []; }),
      fetch(MEMORY_URL + key + ".json").then(function (r) { return r.ok ? r.json() : []; })
    ]).then(function (res) {
      res[0].forEach(function (b) { bios[b.id] = b; });
      memory = res[1];
      if (memory.length) addMemoryToMap();
      renderMemory();
    }).catch(function () { memory = []; });
  }

  function start() {
    applyStatic();
    map = new maplibregl.Map({
      container: "map",
      style: STYLE_URL,
      center: [-3.7, 40.4],
      zoom: 4.2,
      attributionControl: false,
      cooperativeGestures: false
    });
    map.on("load", function () {
      calmBasemap();
      map.fitBounds(IBERIA, { padding: { top: 100, bottom: 200, left: 40, right: 40 }, duration: 0 });
      fetch(DATA_URL, { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (d) {
        data = d;
        var live = d.birds.filter(function (b) { return !b.dead && b.track.length > 1; });
        live.forEach(addBirdToMap);
        renderCards();
        renderCredits();
        renderStamp();
        loadMemory();
      });
    });

    document.getElementById("lang").addEventListener("click", function () {
      lang = lang === "es" ? "en" : "es";
      try { localStorage.setItem("lang", lang); } catch (e) { /* private mode */ }
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
