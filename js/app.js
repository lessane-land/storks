(function () {
  "use strict";

  var DATA_URL = "data/storks.json";
  var STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
  var TRACK_DAYS = 60;

  var lang = pickLang();
  var map, data, markers = {}, activeId = null;

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
      fetch(DATA_URL, { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (d) {
        data = d;
        var live = d.birds.filter(function (b) { return !b.dead && b.track.length > 1; });
        live.forEach(addBirdToMap);
        renderCards();
        renderCredits();
        renderStamp();
        if (live.length) {
          var all = [];
          live.forEach(function (b) { all.push([b.last.lon, b.last.lat]); });
          map.fitBounds(bounds(all), { padding: { top: 120, bottom: 220, left: 60, right: 60 }, maxZoom: 6, duration: 0 });
        }
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
