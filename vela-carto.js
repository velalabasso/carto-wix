window.VelaCarto = {
  init: async function(options = {}) {
    const mode   = options.mode || "full";
    const isMini = mode === "mini";

    maptilersdk.config.apiKey = "OGxkSige7vgEEaQoKmhu";

    /* ===================== CONFIG ===================== */

    const repoOwner      = "velalabasso";
    const repoName       = "zopa";
    const branch         = "main";
    const fallbackCenter = [7.3367184670459835, 43.589687317520685];
    const mainTrackPath  = "track_velalab.csv";
    const nmeaRootPath   = "nmea_logs/";
    const refreshMs         = Number(options.refreshMs || 120000);
    const enableAutoRefresh = options.enableAutoRefresh !== false;

    /* ===================== ALLURE FR ===================== */

    const ALLURE_FR = {
      "close-hauled" : "Près",
      "close reach"  : "Près bon plein",
      "beam reach"   : "Travers",
      "broad reach"  : "Largue",
      "run"          : "Vent arrière",
      "-"            : "—"
    };
    function allureFr(raw) {
      return ALLURE_FR[String(raw || "").trim()] || String(raw || "—");
    }

    /* ===================== SCIENCE CONFIG ===================== */

    // Ponctuelles : marqueur rond à chaque début de station
    const SCIENCE_PT = {
      hypernet     : { label: "Station Hypernet",   color: "#f59e0b" },
      net          : { label: "Station Biologie",   color: "#10b981" },
      ctd_profile  : { label: "Station CTD",        color: "#a855f7" },
      ctd_intercomp: { label: "Station CTD",        color: "#a855f7" }
    };
    // Continues : colorent le tracé en surimpression
    const SCIENCE_CT = {
      inline   : { label: "Inline (continu)",   color: "#ef4444" },
      ctd_keel : { label: "CTD Keel (continu)", color: "#3b82f6" }
    };

    const ALL_SCIENCE = [...Object.keys(SCIENCE_PT), ...Object.keys(SCIENCE_CT)];

    // État des checkboxes (toutes actives par défaut)
    const sciVis = {};
    ALL_SCIENCE.forEach(k => sciVis[k] = true);

    /* ===================== URL HELPERS ===================== */

    function cacheBuster() { return `v=${Date.now()}`; }

    function githubTreeUrl() {
      return `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/${branch}?recursive=1&${cacheBuster()}`;
    }

    function githubRawUrl(path) {
      return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/`
        + path.split("/").map(encodeURIComponent).join("/")
        + `?${cacheBuster()}`;
    }

    async function fetchText(url) {
      try {
        const r = await fetch(url, { cache: "no-store", headers: { "Accept": "text/plain,*/*" } });
        if (!r.ok) { console.warn("Impossible de charger :", url, r.status); return ""; }
        return await r.text();
      } catch(e) { console.warn("Erreur chargement :", url, e); return ""; }
    }

    async function fetchJSON(url) {
      try {
        const r = await fetch(url, { cache: "no-store", headers: { "Accept": "application/vnd.github+json" } });
        if (!r.ok) { console.warn("Impossible de charger JSON :", url, r.status); return null; }
        return await r.json();
      } catch(e) { console.warn("Erreur chargement JSON :", url, e); return null; }
    }

    /* ===================== CSV PARSING ===================== */

    function splitCSVLine(line, delimiter) {
      const result = []; let current = ""; let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]; const nc = line[i + 1];
        if (c === '"' && nc === '"') { current += '"'; i++; continue; }
        if (c === '"') { inQ = !inQ; continue; }
        if (c === delimiter && !inQ) { result.push(current.trim()); current = ""; continue; }
        current += c;
      }
      result.push(current.trim()); return result;
    }

    function detectDelimiter(lines) {
      const sample = lines.slice(0, 5).join("\n");
      let best = ";"; let bestN = 0;
      [";", ",", "\t"].forEach(d => { const n = sample.split(d).length - 1; if (n > bestN) { bestN = n; best = d; } });
      return best;
    }

    function normalizeHeader(v) {
      return String(v || "").replace(/^\uFEFF/, "").trim().toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
    }

    function colIdx(headers, candidates) {
      const nh = headers.map(normalizeHeader);
      const nc = candidates.map(normalizeHeader);
      return nh.findIndex(h => nc.includes(h));
    }

    function parseNum(v) {
      if (v == null) return NaN;
      return parseFloat(String(v).trim().replace(/^"|"$/g, "").replace(",", "."));
    }

    function parseTs(v) {
      if (!v) return null;
      let t = String(v).trim().replace(/^"|"$/g, "");
      if (!t) return null;
      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(t)) t = t.replace(" ", "T");
      const hasZ = /z$/i.test(t) || /[+-]\d{2}:?\d{2}$/.test(t);
      const d = new Date(hasZ ? t : t + "Z");
      if (isNaN(d.getTime())) return null;
      return { ms: d.getTime(), iso: d.toISOString() };
    }

    function parseTrackCSV(csvText, sourceName = "csv") {
      if (!csvText || !csvText.trim()) return [];
      const lines = csvText.replace(/^\uFEFF/, "").trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (!lines.length) return [];

      const delim   = detectDelimiter(lines);
      const hdr     = splitCSVLine(lines[0], delim);
      const iLon    = colIdx(hdr, ["longitude","lon","lng","long"]);
      const iLat    = colIdx(hdr, ["latitude","lat"]);
      const iTime   = colIdx(hdr, ["timestamp","time","datetime","date"]);
      const iSog    = colIdx(hdr, ["sog"]);
      const iTws    = colIdx(hdr, ["tws"]);
      const iAllure = colIdx(hdr, ["allure"]);
      const iSci    = {};
      ALL_SCIENCE.forEach(k => { iSci[k] = colIdx(hdr, [k]); });

      const hasHdr    = iLon !== -1 && iLat !== -1 && iTime !== -1;
      const dataLines = hasHdr ? lines.slice(1) : lines;
      const li        = hasHdr ? { lon: iLon, lat: iLat, time: iTime } : { lon: 0, lat: 1, time: 2 };

      if (!hasHdr) {
        const t = splitCSVLine(lines[0], delim);
        if (!isFinite(parseNum(t[0])) || !isFinite(parseNum(t[1])) || !parseTs(t[2])) {
          console.warn("CSV ignoré :", sourceName); return [];
        }
      }

      return dataLines.map(line => {
        const c   = splitCSVLine(line, delim);
        const lon = parseNum(c[li.lon]);
        const lat = parseNum(c[li.lat]);
        const pt  = parseTs(c[li.time]);
        if (!pt || !isFinite(lon) || !isFinite(lat)) return null;
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;

        const p = { lon, lat, time: pt.iso, timestampMs: pt.ms, source: sourceName };
        if (iSog    !== -1) p.sog    = parseNum(c[iSog]);
        if (iTws    !== -1) p.tws    = parseNum(c[iTws]);
        if (iAllure !== -1) p.allure = c[iAllure];
        ALL_SCIENCE.forEach(k => {
          if (iSci[k] !== -1) p[k] = String(c[iSci[k]] || "").trim().toUpperCase();
        });
        return p;
      }).filter(Boolean).sort((a, b) => a.timestampMs - b.timestampMs);
    }

    function dedupeSort(points) {
      const m = new Map();
      points.forEach(p => {
        if (!p) return;
        const k = `${p.timestampMs}|${p.lon.toFixed(6)}|${p.lat.toFixed(6)}`;
        if (!m.has(k)) m.set(k, p);
      });
      return Array.from(m.values()).sort((a, b) => a.timestampMs - b.timestampMs);
    }

    /* ===================== HOURLY TIMELINE ===================== */

    function buildHourly(points) {
      if (!points.length) return [];
      const H = 3600000;
      const result = [];
      let nextMs = Math.floor(points[0].timestampMs / H) * H;
      points.forEach(p => {
        if (p.timestampMs >= nextMs) {
          result.push(p);
          nextMs = Math.floor(p.timestampMs / H) * H + H;
        }
      });
      // Toujours inclure le dernier point
      const last = points[points.length - 1];
      if (!result.length || result[result.length - 1].timestampMs < last.timestampMs) {
        result.push(last);
      }
      return result;
    }

    /* ===================== GEOJSON HELPERS ===================== */

    function toLineGeoJSON(points) {
      if (!points.length) return { type: "FeatureCollection", features: [] };
      let coords = points.map(p => [p.lon, p.lat]);
      if (coords.length === 1) coords = [coords[0], coords[0]];
      return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }]
      };
    }

    // Segments colorés pour les stations continues (inline, ctd_keel)
    function buildContGeoJSON(slice, key) {
      const features = []; let seg = null;
      slice.forEach(p => {
        if (p[key] === "ON") {
          if (!seg) seg = [];
          seg.push([p.lon, p.lat]);
        } else {
          if (seg && seg.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: seg } });
          seg = null;
        }
      });
      if (seg && seg.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: seg } });
      return { type: "FeatureCollection", features };
    }

    // Marqueurs ponctuels : 1 point à chaque transition OFF→ON pour une liste de clés
    function buildPtGeoJSON(slice, keys) {
      const features = []; const wasOn = {};
      keys.forEach(k => wasOn[k] = false);
      slice.forEach(p => {
        keys.forEach(k => {
          const on = p[k] === "ON";
          if (on && !wasOn[k]) {
            features.push({ type: "Feature", properties: { key: k }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
          }
          wasOn[k] = on;
        });
      });
      return { type: "FeatureCollection", features };
    }

    const EMPTY_FC = { type: "FeatureCollection", features: [] };

    /* ===================== GITHUB NMEA LIST ===================== */

    async function getNmeaCsvInfos() {
      const data = await fetchJSON(githubTreeUrl());
      if (!data || !Array.isArray(data.tree)) { console.warn("Impossible de lire nmea_logs sur GitHub."); return []; }
      if (data.truncated) console.warn("Réponse GitHub tronquée — certains CSV peuvent manquer.");

      const paths = Array.from(new Set(
        data.tree.filter(item => {
          if (item.type !== "blob") return false;
          const p  = item.path || "";
          const lp = p.toLowerCase();
          const fn = p.split("/").pop().toLowerCase();
          return p.startsWith(nmeaRootPath) && lp.endsWith(".csv") && !lp.includes(".gz")
            && !fn.startsWith("~") && !fn.startsWith(".") && !fn.includes("~lock");
        }).map(item => item.path).sort()
      ));
      return paths.map(path => ({ path, url: githubRawUrl(path) }));
    }

    async function mapLimit(items, limit, fn) {
      const results = []; let ni = 0;
      async function worker() { while (ni < items.length) { const i = ni++; results[i] = await fn(items[i], i); } }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
      return results;
    }

    async function loadAllTrackPoints() {
      const mainText   = await fetchText(githubRawUrl(mainTrackPath));
      const mainPoints = parseTrackCSV(mainText, mainTrackPath);

      const nmeaInfos   = await getNmeaCsvInfos();
      const nmeaResults = await mapLimit(nmeaInfos, 6, async info => ({
        path: info.path,
        points: parseTrackCSV(await fetchText(info.url), info.path)
      }));

      const nmeaPoints = nmeaResults.flatMap(r => r.points);
      const livePoints = dedupeSort([...mainPoints, ...nmeaPoints]);

      console.log("===== VELA CARTO DEBUG =====");
      console.log("Points track_velalab.csv :", mainPoints.length);
      console.table(nmeaResults.map(r => ({ fichier: r.path, points: r.points.length })));
      console.log("Points live :", livePoints.length);
      if (livePoints.length) console.log("Dernier point :", livePoints[livePoints.length - 1].time, [livePoints[livePoints.length - 1].lon, livePoints[livePoints.length - 1].lat]);
      console.log("============================");

      return { livePoints };
    }

    /* ===================== MAP ===================== */

    const map = new maptilersdk.Map({
      container: "map",
      style: maptilersdk.MapStyle.BACKDROP,
      center: fallbackCenter,
      zoom: isMini ? 3.5 : 5
    });

    /* ===================== WIND LAYER ===================== */

    const windLayer = new maptilerweather.WindLayer({
      colorramp: new maptilerweather.ColorRamp({ stops: [
        { value: 0,   color: [98,113,183,255]  }, { value: 1,   color: [57,97,159,255]   },
        { value: 3,   color: [74,148,169,255]  }, { value: 5,   color: [77,141,123,255]  },
        { value: 7,   color: [83,165,83,255]   }, { value: 9,   color: [53,159,53,255]   },
        { value: 11,  color: [167,157,81,255]  }, { value: 13,  color: [159,127,58,255]  },
        { value: 15,  color: [161,108,92,255]  }, { value: 17,  color: [129,58,78,255]   },
        { value: 19,  color: [175,80,136,255]  }, { value: 21,  color: [117,74,147,255]  },
        { value: 24,  color: [109,97,163,255]  }, { value: 27,  color: [68,105,141,255]  },
        { value: 29,  color: [92,144,152,255]  }, { value: 36,  color: [125,68,165,255]  },
        { value: 46,  color: [231,215,215,255] }, { value: 51,  color: [219,212,135,255] },
        { value: 77,  color: [205,202,112,255] }, { value: 104, color: [128,128,128,255] }
      ]})
    });

    /* ===================== UI EXISTANTE ===================== */

    const variableName = document.getElementById("variable-name");
    const pointerData  = document.getElementById("pointer-data");
    const slider       = document.getElementById("time-slider");
    const timeLabel    = document.getElementById("time-label");
    const legend       = document.getElementById("legend");

    if (slider) { slider.max = 0; slider.value = 0; }

    if (isMini) {
      [slider, timeLabel, legend].forEach(el => { if (el) el.style.display = "none"; });
      if (variableName) variableName.style.fontSize = "14px";
      if (pointerData)  { pointerData.style.fontSize = "14px"; pointerData.style.top = "25px"; }
    }

    map.on("mousemove", e => {
      if (!pointerData) return;
      const v = windLayer.pickAt(e.lngLat.lng, e.lngLat.lat);
      pointerData.innerText = v ? `${(v.speedMetersPerSecond * 1.943844).toFixed(1)} kn` : "";
    });
    map.on("mouseout", () => { if (pointerData) pointerData.innerText = ""; });

    // Conteneur bas-gauche qui regroupe nav + science empilés
    let bottomLeftContainer = null;
    if (!isMini) {
      bottomLeftContainer = document.createElement("div");
      Object.assign(bottomLeftContainer.style, {
        position: "absolute", bottom: "52px", left: "12px",
        display: "flex", flexDirection: "column", gap: "8px",
        zIndex: "800"
      });
      document.getElementById("map").appendChild(bottomLeftContainer);
    }

    /* ===================== PANNEAU NAV (bas gauche) ===================== */

    let navPanel = null;
    if (!isMini) {
      navPanel = document.createElement("div");
      Object.assign(navPanel.style, {
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        color: "#dde6f0", fontFamily: "Helvetica Neue, Arial, sans-serif",
        fontSize: "13px", lineHeight: "1.8", padding: "10px 16px",
        borderRadius: "10px", boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        minWidth: "148px", pointerEvents: "none", display: "none"
      });
      navPanel.innerHTML = `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;margin-bottom:5px;">Navigation</div>
        <div><span style="color:#c8dcea">Vitesse</span>&nbsp;&nbsp;<strong id="vn-sog">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">kn</span></div>
        <div><span style="color:#c8dcea">Vent</span>&nbsp;&nbsp;<strong id="vn-tws">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">kn</span></div>
        <div><span style="color:#c8dcea">Allure</span>&nbsp;<strong id="vn-allure">—</strong></div>`;
      bottomLeftContainer.appendChild(navPanel);
    }

    function updateNavPanel(p) {
      if (!navPanel || !p) return;
      document.getElementById("vn-sog").textContent    = isFinite(p.sog)    ? p.sog.toFixed(1)    : "—";
      document.getElementById("vn-tws").textContent    = isFinite(p.tws)    ? p.tws.toFixed(1)    : "—";
      document.getElementById("vn-allure").textContent = p.allure ? allureFr(p.allure) : "—";
      navPanel.style.display = "block";
    }

    /* ===================== PANNEAU SCIENCE (haut droite) ===================== */

    // Rangées de la légende — ctd_profile et ctd_intercomp partagent une seule ligne
    const sciRows = [
      { keys: ["hypernet"],                   label: "Station Hypernet",   color: SCIENCE_PT.hypernet.color,    type: "dot"  },
      { keys: ["net"],                         label: "Station Biologie",   color: SCIENCE_PT.net.color,         type: "dot"  },
      { keys: ["ctd_profile","ctd_intercomp"], label: "Station CTD",        color: SCIENCE_PT.ctd_profile.color, type: "dot"  },
      { keys: ["inline"],                      label: "Inline (continu)",   color: SCIENCE_CT.inline.color,      type: "line" },
      { keys: ["ctd_keel"],                    label: "CTD Keel (continu)", color: SCIENCE_CT.ctd_keel.color,    type: "line" }
    ];

    let sciPanel = null;
    if (!isMini) {
      sciPanel = document.createElement("div");
      Object.assign(sciPanel.style, {
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        color: "#dde6f0", fontFamily: "Helvetica Neue, Arial, sans-serif",
        fontSize: "12px", lineHeight: "1.9", padding: "10px 16px",
        borderRadius: "10px", boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        minWidth: "218px"
      });

      let html = `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;margin-bottom:8px;">Science</div>`;
      sciRows.forEach((row, ri) => {
        const swatch = row.type === "dot"
          ? `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${row.color};
               margin-right:7px;flex-shrink:0;vertical-align:middle;border:1.5px solid rgba(255,255,255,0.35)"></span>`
          : `<span style="display:inline-block;width:20px;height:3px;background:${row.color};border-radius:2px;
               margin-right:7px;flex-shrink:0;vertical-align:middle;"></span>`;
        html += `
          <label style="display:flex;align-items:center;cursor:pointer;user-select:none;margin-bottom:3px;">
            <input type="checkbox" data-ri="${ri}" checked
              style="margin-right:6px;accent-color:${row.color};cursor:pointer;width:13px;height:13px;">
            ${swatch}<span>${row.label}</span>
          </label>`;
      });
      sciPanel.innerHTML = html;
      bottomLeftContainer.appendChild(sciPanel);

      sciPanel.querySelectorAll("input[type=checkbox]").forEach(cb => {
        cb.addEventListener("change", () => {
          sciRows[Number(cb.dataset.ri)].keys.forEach(k => sciVis[k] = cb.checked);
          renderScience();
        });
      });
    }

    /* ===================== STATE ===================== */

    let allPoints    = [];
    let hourlyPts    = [];
    let sliderIdx    = 0;
    let boatMarker   = null;
    let centeredOnce = false;

    /* ===================== SLICE ===================== */

    function getSlice() {
      if (!hourlyPts.length) return allPoints;
      const cutMs = hourlyPts[sliderIdx].timestampMs;
      // Filtre en O(log n) grâce au tableau trié
      let lo = 0; let hi = allPoints.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (allPoints[mid].timestampMs <= cutMs) lo = mid + 1; else hi = mid; }
      return allPoints.slice(0, lo);
    }

    /* ===================== RENDER ===================== */

    function renderTrack() {
      const src = map.getSource("vela-live-track");
      if (src) src.setData(toLineGeoJSON(getSlice()));
    }

    function renderScience() {
      const slice = getSlice();

      // Continues
      Object.keys(SCIENCE_CT).forEach(k => {
        const src = map.getSource(`sci-ct-${k}`);
        if (src) src.setData(sciVis[k] ? buildContGeoJSON(slice, k) : EMPTY_FC);
      });

      // Ponctuelles — hypernet
      const srcH = map.getSource("sci-pt-hypernet");
      if (srcH) srcH.setData(sciVis.hypernet ? buildPtGeoJSON(slice, ["hypernet"]) : EMPTY_FC);

      // Ponctuelles — net
      const srcN = map.getSource("sci-pt-net");
      if (srcN) srcN.setData(sciVis.net ? buildPtGeoJSON(slice, ["net"]) : EMPTY_FC);

      // Ponctuelles — CTD (profile + intercomp fusionnés sous une checkbox)
      const srcC = map.getSource("sci-pt-ctd");
      if (srcC) srcC.setData(sciVis.ctd_profile ? buildPtGeoJSON(slice, ["ctd_profile","ctd_intercomp"]) : EMPTY_FC);
    }

    function renderAll() { renderTrack(); renderScience(); }

    function updateBoatUI() {
      if (!hourlyPts.length) return;
      const p = hourlyPts[sliderIdx];
      if (boatMarker) boatMarker.setLngLat([p.lon, p.lat]);

      if (timeLabel) {
        const d = new Date(p.time);
        timeLabel.innerText = d.toLocaleString("fr-FR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit", timeZone: "UTC"
        }) + " UTC";
      }

      updateNavPanel(p);

      if (!centeredOnce) {
        const last = hourlyPts[hourlyPts.length - 1];
        map.setCenter([last.lon, last.lat]);
        centeredOnce = true;
      }
    }

    /* ===================== REFRESH ===================== */

    async function refreshLiveTrack() {
      const { livePoints } = await loadAllTrackPoints();
      allPoints = livePoints;
      hourlyPts = buildHourly(allPoints);
      sliderIdx = Math.max(hourlyPts.length - 1, 0);

      if (slider) { slider.max = sliderIdx; slider.value = sliderIdx; }

      renderAll();
      updateBoatUI();
    }

    /* ===================== MAP LOAD ===================== */

    map.on("load", async () => {

      // Vent
      try {
        if (map.getLayer("Water")) {
          map.setPaintProperty("Water", "fill-color", "rgba(0,0,0,0.2)");
          map.addLayer(windLayer, "Water");
        } else {
          map.addLayer(windLayer);
        }
      } catch(e) { console.warn("Couche vent :", e); }

      /* ---- Tracé principal ---- */
      map.addSource("vela-live-track", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "vela-live-track-line", type: "line", source: "vela-live-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": isMini ? 2 : 3, "line-opacity": 1 }
      });

      /* ---- Layers science continues ---- */
      Object.entries(SCIENCE_CT).forEach(([k, cfg]) => {
        map.addSource(`sci-ct-${k}`, { type: "geojson", data: EMPTY_FC });
        map.addLayer({
          id: `sci-ct-${k}-line`, type: "line", source: `sci-ct-${k}`,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": cfg.color, "line-width": isMini ? 3 : 5, "line-opacity": 0.9 }
        });
      });

      /* ---- Layers science ponctuelles ---- */
      function addPtLayer(srcId, layerId, color) {
        map.addSource(srcId, { type: "geojson", data: EMPTY_FC });
        map.addLayer({
          id: layerId, type: "circle", source: srcId,
          paint: {
            "circle-radius": isMini ? 5 : 8,
            "circle-color": color,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff"
          }
        });
      }
      addPtLayer("sci-pt-hypernet", "sci-pt-hypernet-circle", SCIENCE_PT.hypernet.color);
      addPtLayer("sci-pt-net",      "sci-pt-net-circle",      SCIENCE_PT.net.color);
      addPtLayer("sci-pt-ctd",      "sci-pt-ctd-circle",      SCIENCE_PT.ctd_profile.color);

      /* ---- Marqueur bateau ---- */
      const boatIcon = document.createElement("img");
      boatIcon.src = "https://static.wixstatic.com/media/7feff5_ab13f48be41c4214b141c562efbbb948~mv2.png";
      boatIcon.style.cssText = `width:${isMini ? "34px" : "46px"};height:auto;display:block;pointer-events:none;`;
      boatMarker = new maptilersdk.Marker({ element: boatIcon, anchor: "center" })
        .setLngLat(fallbackCenter).addTo(map);

      /* ---- Blog marker ---- */
      const blogCoords = [9.10300, 43.75930];
      const blogProps  = {
        title  : "Déploiement & récupération flotteurs Argo BGC",
        date   : "10 février 2026",
        url    : "https://www.velalab.org/post/d%C3%A9ploiement-et-r%C3%A9cup%C3%A9ration-flotteurs-argo-bgc",
        image  : "https://static.wixstatic.com/media/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg/v1/fill/w_1480,h_826,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg",
        excerpt: "Quelques jours de navigation dans le Golfe de Gênes! Au programme, un déploiement de flotteur Argo en collaboration avec le laboratoire de Villefranche-sur-Mer."
      };

      const blogMarker = new maptilersdk.Marker({ color: "#5F7D95", scale: isMini ? 0.6 : 0.8 })
        .setLngLat(blogCoords).addTo(map);

      const popupDiv = document.createElement("div");
      Object.assign(popupDiv.style, {
        position: "absolute", background: "white", padding: "8px", borderRadius: "10px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        maxWidth: isMini ? "190px" : "220px", minWidth: isMini ? "160px" : "180px",
        display: "none", zIndex: "9999", fontFamily: "Helvetica, Arial, sans-serif", color: "#333"
      });
      popupDiv.innerHTML = `
        <div style="text-align:left;">
          <h2 style="font-family:Helvetica,Arial;color:#5F7D95;margin:0 0 6px 0;font-size:${isMini ? "13px" : "16px"};">${blogProps.title}</h2>
          <div style="color:gray;font-size:12px;margin-bottom:10px;">${blogProps.date}</div>
          <img src="${blogProps.image}" style="width:100%;height:auto;border-radius:6px;margin-bottom:8px;">
          <p style="font-size:12px;line-height:1.4;margin-bottom:10px;">${blogProps.excerpt}</p>
          <a href="${blogProps.url}" target="_blank"
            style="display:inline-block;text-decoration:none;background:#5F7D95;color:white;padding:8px 14px;border-radius:20px;font-size:14px;">
            Lire l'article</a>
        </div>`;
      document.body.appendChild(popupDiv);

      function positionPopup() {
        const px = map.project(blogCoords);
        const h  = popupDiv.offsetHeight; const w = popupDiv.offsetWidth; const m = 12;
        const vw = window.innerWidth;     const vh = window.innerHeight;
        if (px.y - h - m > 0)      { popupDiv.style.top = px.y-h-m-25+"px"; popupDiv.style.left = px.x-w/2+"px"; return; }
        if (px.y + h + m < vh)      { popupDiv.style.top = px.y+5+"px";      popupDiv.style.left = px.x-w/2+"px"; return; }
        if (px.x + w + m < vw)      { popupDiv.style.top = px.y-h/2+"px";    popupDiv.style.left = px.x+m+"px";   return; }
        if (px.x - w - m > 0)       { popupDiv.style.top = px.y-h/2+"px";    popupDiv.style.left = px.x-w-m+"px"; return; }
        popupDiv.style.top = m+"px"; popupDiv.style.left = m+"px";
      }

      let popupVis = false;
      blogMarker.getElement().addEventListener("mouseenter", () => { popupDiv.style.display = "block"; popupVis = true; positionPopup(); });
      blogMarker.getElement().addEventListener("mouseleave", () => { setTimeout(() => { if (!popupDiv.matches(":hover")) { popupDiv.style.display = "none"; popupVis = false; } }, 100); });
      popupDiv.addEventListener("mouseenter", () => { popupDiv.style.display = "block"; });
      popupDiv.addEventListener("mouseleave", () => { popupDiv.style.display = "none"; popupVis = false; });
      map.on("move", () => { if (popupVis) positionPopup(); });

      /* ---- Tracé annexe pointillé ---- */
      map.addSource("extra-trace-line", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [
        [7.329134737638213,43.585033001356976], [8.657799172621566,42.77632951286341],
        [8.307522409161805,42.299862929257756], [8.513473037729312,41.53343175463144],
        [7.7952165927658825,40.87667199422435], [8.024061230215835,39.98968061811033],
        [8.033602372020454,39.06508122106689],  [8.946361973663016,38.4897881875103],
        [13.351851194007082,38.41307958339672], [15.030504575064668,38.39484925762733],
        [15.477007947186394,38.30022439574063], [15.919455684456949,37.201769818626204],
        [14.825142659366435,36.32362591043244], [11.978911802910176,37.696705067693216],
        [3.2066661868631456,39.09534081286651], [-2.030387890853632,36.27485691397],
        [-6.097071913998548,35.94482905527538], [-9.33003270561457,32.815527575300905],
        [-13.338855383669909,29.23885982779055],[-15.106053854239406,28.14348648516618],
        [-22.58869100509554,16.37352872021097], [-17.45163825620486,14.460440287821527],
        [-16.71964345844293,13.426946648259488],[-24.53258542184244,14.572063095902209],
        [-61.23018177575683,12.31166540947845], [-60.75258128216552,13.959924808563898],
        [-61.16506900477114,15.77131213200498], [-62.0645410043779,17.36841184865942],
        [-64.70143483161476,17.94023136074898], [-69.30483801896484,19.522070762366724],
        [-77.28243666698245,24.218244587247668],[-25.60540287081858,37.594620670395],
        [-16.896354409331423,32.71980573193002],[-6.064051514726884,35.98743815551846],
        [-5.268214670207783,36.03058227588072], [-2.021144987930171,36.46223740581938],
        [1.3107311462801192,39.16880208178074],  [2.94502596439969,39.999852450571666],
        [5.862291078690532,42.98072176534109],   [6.171643854171464,42.99986883032145],
        [6.617029299922223,43.12058120803994],   [7.3367184670459835,43.589687317520685]
      ]}}});
      map.addLayer({
        id: "extra-trace-line", type: "line", source: "extra-trace-line",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": isMini ? 0.4 : 0.6, "line-opacity": 0.6, "line-dasharray": [4, 6] }
      });

      /* ---- Premier chargement + auto-refresh ---- */
      await refreshLiveTrack();
      if (enableAutoRefresh && refreshMs > 0) window.setInterval(refreshLiveTrack, refreshMs);
    });

    /* ===================== SLIDER ===================== */

    if (slider) {
      slider.addEventListener("input", () => {
        if (!hourlyPts.length) return;
        sliderIdx = Number(slider.value);
        renderAll();
        updateBoatUI();
      });
    }
  }
};
