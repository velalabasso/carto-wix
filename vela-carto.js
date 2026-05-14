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

    /* ===================== UI — tout créé en JS ===================== */

    // Slider wrapper avec flèches
    const sliderWrapper = document.createElement("div");
    Object.assign(sliderWrapper.style, {
      position: "fixed", bottom: "16px", left: "20px", right: "20px",
      zIndex: "2", display: "flex", alignItems: "center", gap: "10px"
    });

    // Bouton flèche gauche (reculer)
    const btnPrev = document.createElement("button");
    btnPrev.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
    Object.assign(btnPrev.style, {
      background: "rgba(95,125,149,0.55)", backdropFilter: "blur(6px)",
      border: "1px solid rgba(255,255,255,0.18)", borderRadius: "50%",
      width: "34px", height: "34px", cursor: "pointer", flexShrink: "0",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)", padding: "0",
      transition: "background .15s"
    });
    btnPrev.onmouseenter = () => btnPrev.style.background = "rgba(95,125,149,0.85)";
    btnPrev.onmouseleave = () => btnPrev.style.background = "rgba(95,125,149,0.55)";

    // Bouton flèche droite (avancer)
    const btnNext = document.createElement("button");
    btnNext.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
    Object.assign(btnNext.style, {
      background: "rgba(95,125,149,0.55)", backdropFilter: "blur(6px)",
      border: "1px solid rgba(255,255,255,0.18)", borderRadius: "50%",
      width: "34px", height: "34px", cursor: "pointer", flexShrink: "0",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)", padding: "0",
      transition: "background .15s"
    });
    btnNext.onmouseenter = () => btnNext.style.background = "rgba(95,125,149,0.85)";
    btnNext.onmouseleave = () => btnNext.style.background = "rgba(95,125,149,0.55)";

    const slider = document.createElement("input");
    slider.type  = "range"; slider.id = "time-slider";
    slider.min   = "0"; slider.step = "1"; slider.value = "0"; slider.max = "0";
    Object.assign(slider.style, {
      flex: "1", appearance: "none", WebkitAppearance: "none",
      height: "6px", borderRadius: "99px",
      background: "rgba(95,125,149,0.55)", backdropFilter: "blur(4px)",
      outline: "none", cursor: "pointer",
      border: "1px solid rgba(255,255,255,0.18)",
      boxShadow: "0 1px 6px rgba(0,0,0,0.3)", display: "block"
    });

    // Inject thumb CSS
    const sliderStyle = document.createElement("style");
    sliderStyle.textContent = `
      #time-slider::-webkit-slider-thumb {
        -webkit-appearance:none; appearance:none;
        width:22px; height:22px; border-radius:50%;
        background:#2563eb; border:3px solid white;
        box-shadow:0 0 8px rgba(37,99,235,0.7), 0 2px 6px rgba(0,0,0,0.4);
        cursor:pointer; transition:transform .15s;
      }
      #time-slider::-webkit-slider-thumb:hover { transform:scale(1.15); }
      #time-slider::-moz-range-thumb {
        width:22px; height:22px; border-radius:50%;
        background:#2563eb; border:3px solid white;
        box-shadow:0 0 8px rgba(37,99,235,0.7), 0 2px 6px rgba(0,0,0,0.4);
        cursor:pointer;
      }
    `;
    document.head.appendChild(sliderStyle);

    sliderWrapper.appendChild(btnPrev);
    sliderWrapper.appendChild(slider);
    sliderWrapper.appendChild(btnNext);
    document.getElementById("map").appendChild(sliderWrapper);

    // Éléments legacy attendus par le code (timeLabel, legend, variableName, pointerData)
    // On les crée masqués pour éviter les erreurs
    const timeLabel    = document.createElement("div"); timeLabel.style.display    = "none"; document.body.appendChild(timeLabel);
    const legend       = document.createElement("div"); legend.style.display       = "none"; document.body.appendChild(legend);
    const variableName = document.createElement("div"); variableName.style.display = "none"; document.body.appendChild(variableName);
    const pointerData  = document.createElement("div"); pointerData.style.display  = "none"; document.body.appendChild(pointerData);

    if (isMini) slider.style.display = "none";

    map.on("mousemove", e => {
      if (!pointerData) return;
      const v = windLayer.pickAt(e.lngLat.lng, e.lngLat.lat);
      pointerData.innerText = v ? `${(v.speedMetersPerSecond * 1.943844).toFixed(1)} kn` : "— kn";
    });
    map.on("mouseout", () => { if (pointerData) pointerData.innerText = "— kn"; });

    // Widget vent — créé entièrement en JS, indépendant du HTML
    let windWidget = null;
    if (!isMini) {
      windWidget = document.createElement("div");
      Object.assign(windWidget.style, {
        position: "absolute", top: "12px", left: "12px",
        display: "flex", flexDirection: "column",
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        borderRadius: "12px", padding: "6px 12px 8px 12px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.12)",
        minWidth: "70px", zIndex: "800", pointerEvents: "none"
      });
      windWidget.innerHTML = `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;
          color:#c8dcea;font-family:Helvetica Neue,Arial,sans-serif;
          font-weight:500;margin-bottom:2px;">Vent</div>
        <div id="vw-value" style="font-size:18px;font-weight:700;color:white;
          font-family:Helvetica Neue,Arial,sans-serif;letter-spacing:-.01em;
          line-height:1;text-shadow:0 1px 6px rgba(0,0,0,0.4);">— kn</div>`;
      document.getElementById("map").appendChild(windWidget);
    }

    map.on("mousemove", e => {
      const vwEl = document.getElementById("vw-value");
      if (!vwEl) return;
      const v = windLayer.pickAt(e.lngLat.lng, e.lngLat.lat);
      vwEl.innerText = v ? `${(v.speedMetersPerSecond * 1.943844).toFixed(1)} kn` : "— kn";
    });
    map.on("mouseout", () => {
      const vwEl = document.getElementById("vw-value");
      if (vwEl) vwEl.innerText = "— kn";
    });

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
        <div><span style="color:#c8dcea">Date</span>&nbsp;&nbsp;<strong id="vn-date">—</strong></div>
        <div><span style="color:#c8dcea">Vitesse</span>&nbsp;&nbsp;<strong id="vn-sog">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">kn</span></div>
        <div><span style="color:#c8dcea">Vent</span>&nbsp;&nbsp;<strong id="vn-tws">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">kn</span></div>
        <div><span style="color:#c8dcea">Allure</span>&nbsp;<strong id="vn-allure">—</strong></div>
        <div><span style="color:#c8dcea">Distance</span>&nbsp;<strong id="vn-miles">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">nm</span></div>`;
      bottomLeftContainer.appendChild(navPanel);
    }

    function updateNavPanel(p, miles) {
      if (!navPanel || !p) return;
      const d = new Date(p.time);
      const dateStr = d.toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC"
      }) + " UTC";
      document.getElementById("vn-date").textContent   = dateStr;
      document.getElementById("vn-sog").textContent    = isFinite(p.sog)    ? p.sog.toFixed(1)    : "—";
      document.getElementById("vn-tws").textContent    = isFinite(p.tws)    ? p.tws.toFixed(1)    : "—";
      document.getElementById("vn-allure").textContent = p.allure ? allureFr(p.allure) : "—";
      const milesEl = document.getElementById("vn-miles");
      if (milesEl) milesEl.textContent = (miles !== undefined && miles > 0) ? miles.toFixed(1) : "—";
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
          ? `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${row.color};margin-right:7px;flex-shrink:0;vertical-align:middle;border:1.5px solid rgba(255,255,255,0.35)"></span>`
          : `<span style="display:inline-block;width:16px;height:3px;background:${row.color};border-radius:2px;margin-right:7px;flex-shrink:0;vertical-align:middle;"></span>`;
        html += `
          <div style="display:flex;align-items:center;margin-bottom:6px;cursor:pointer;user-select:none;" data-ri="${ri}">
            <div class="vela-pill" data-active="true" style="
              width:30px;height:16px;border-radius:99px;flex-shrink:0;
              background:#2563eb;
              box-shadow:0 0 6px rgba(37,99,235,0.6);
              position:relative;margin-right:8px;
              transition:background .2s,box-shadow .2s;cursor:pointer;">
              <div class="vela-knob" style="
                position:absolute;top:2px;
                width:12px;height:12px;border-radius:50%;
                background:white;
                transform:translateX(14px);
                transition:transform .2s;
                box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
            </div>
            ${swatch}<span style="font-size:12px;">${row.label}</span>
          </div>`;
      });
      sciPanel.innerHTML = html;
      bottomLeftContainer.appendChild(sciPanel);

      // Listeners sur les toggles
      sciPanel.querySelectorAll("[data-ri]").forEach(row => {
        const pill = row.querySelector(".vela-pill");
        const knob = row.querySelector(".vela-knob");
        const ri   = Number(row.dataset.ri);
        row.addEventListener("click", () => {
          const active = pill.dataset.active !== "true";
          pill.dataset.active = active;
          pill.style.background = active ? "#2563eb" : "rgba(180,180,180,0.3)";
          pill.style.boxShadow  = active ? "0 0 6px rgba(37,99,235,0.6)" : "none";
          knob.style.transform  = active ? "translateX(14px)" : "translateX(1px)";
          sciRows[ri].keys.forEach(k => sciVis[k] = active);
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

      // Rotation du voilier — directement sur boatEl qui porte la transition CSS
      if (boatMarker && sliderIdx > 0 && window._velaComputeBearing) {
        const prev = hourlyPts[sliderIdx - 1];
        const bearing = window._velaComputeBearing(prev.lat, prev.lon, p.lat, p.lon);
        const boatEl = boatMarker.getElement().firstElementChild;
        if (boatEl) boatEl.style.transform = `rotate(${bearing}deg)`;
      }

      // Miles parcourus précis — distance cumulée sur tous les points jusqu'au slot
      const milesDone = milesAtTimestamp(p.timestampMs);

      updateNavPanel(p, milesDone);

      if (timeLabel) {
        const d = new Date(p.time);
        timeLabel.innerText = d.toLocaleString("fr-FR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit", timeZone: "UTC"
        }) + " UTC";
      }

      if (!centeredOnce) {
        const last = hourlyPts[hourlyPts.length - 1];
        map.setCenter([last.lon, last.lat]);
        centeredOnce = true;
      }
    }

    // Haversine en JS pour updateBoatUI (indépendant du scope Python)
    function haversine_nm_js(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const toR = d => d * Math.PI / 180;
      const dphi = toR(lat2 - lat1); const dlam = toR(lon2 - lon1);
      const a = Math.sin(dphi/2)**2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dlam/2)**2;
      return (2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))) / 1852;
    }

    /* ===================== REFRESH ===================== */

    let cumDist = []; // distances cumulées sur allPoints, précalculées

    function buildCumDist(pts) {
      const d = new Array(pts.length).fill(0);
      for (let i = 1; i < pts.length; i++) {
        const seg = haversine_nm_js(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
        d[i] = d[i-1] + (seg < 1 ? seg : 0); // filtre les sauts > 1 nm
      }
      return d;
    }

    function milesAtTimestamp(cutMs) {
      if (!allPoints.length || !cumDist.length) return 0;
      // Recherche binaire dans allPoints
      let lo = 0; let hi = allPoints.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (allPoints[mid].timestampMs <= cutMs) lo = mid; else hi = mid - 1;
      }
      return cumDist[lo];
    }

    async function refreshLiveTrack() {
      const { livePoints } = await loadAllTrackPoints();
      allPoints = livePoints;
      cumDist   = buildCumDist(allPoints);   // précalcul une seule fois
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

      /* ---- Marqueur bateau SVG — tracé fidèle de la photo drone ---- */
      const boatSize = isMini ? 44 : 70;

      // Photo : bateau orienté proue en bas-gauche, poupe en haut-droite
      // On dessine avec la proue vers le HAUT (nord=0°), la rotation JS fera le reste
      // viewBox centrée sur le mât (~centre de gravité visuel)
      const boatSVG = `<svg xmlns="http://www.w3.org/2000/svg"
        width="${boatSize}" height="${boatSize}"
        viewBox="-40 -40 80 80">

        <defs>
          <filter id="bsf" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.6)"/>
          </filter>
          <clipPath id="spiClip">
            <ellipse cx="20" cy="6" rx="18" ry="20"/>
          </clipPath>
        </defs>

        <!-- ======= SPINNAKER — côté tribord (droite), proche de la coque ======= -->
        <ellipse cx="20" cy="6" rx="18" ry="20"
          fill="#22c55e" filter="url(#bsf)" opacity="0.95"/>

        <g clip-path="url(#spiClip)">
          <polygon points="20,6  36,-14  40,-4"   fill="white" opacity="0.75"/>
          <polygon points="20,6  28,-14  38,-6"   fill="white" opacity="0.7"/>
          <polygon points="20,6  14,-14  22,-16"  fill="white" opacity="0.72"/>
          <polygon points="20,6   4,-10   6,4"    fill="white" opacity="0.7"/>
          <polygon points="20,6   2,8     4,20"   fill="white" opacity="0.72"/>
          <polygon points="20,6  10,26   20,28"   fill="white" opacity="0.7"/>
          <polygon points="20,6  30,26   38,18"   fill="white" opacity="0.72"/>
        </g>

        <ellipse cx="20" cy="6" rx="18" ry="20"
          fill="none" stroke="#16a34a" stroke-width="0.8" opacity="0.7"/>

        <!-- ======= DRISSES spi ======= -->
        <line x1="2" y1="-18" x2="4" y2="-12"
          stroke="rgba(255,255,255,0.55)" stroke-width="0.8"/>
        <line x1="2" y1="-18" x2="38" y2="14"
          stroke="rgba(255,255,255,0.4)" stroke-width="0.7"/>
        <line x1="2" y1="-18" x2="16" y2="26"
          stroke="rgba(255,255,255,0.4)" stroke-width="0.7"/>

        <!-- ======= COQUE ======= -->
        <path d="
          M 0,-22
          C 2,-18  8,-8  12,2
          C 16,10  16,18  14,24
          C 10,30  4,32   0,32
          C -4,32 -10,30 -14,24
          C -16,18 -14,8 -8,0
          C -4,-8  -1,-16  0,-22 Z"
          fill="white" stroke="#cccccc" stroke-width="0.8"
          filter="url(#bsf)"/>

        <!-- Grand-voile -->
        <polygon points="0,-20  -13,22  -2,22"
          fill="#1a1a2e" opacity="0.85"/>

        <!-- Bout-dehors -->
        <line x1="0" y1="-18" x2="2" y2="-23"
          stroke="white" stroke-width="1.2" stroke-linecap="round"/>

        <!-- Mât -->
        <circle cx="0" cy="-4" r="1.8" fill="#aabcca" stroke="white" stroke-width="0.6"/>

        <!-- Cockpit -->
        <ellipse cx="8" cy="20" rx="5" ry="4"
          fill="none" stroke="#aaaaaa" stroke-width="0.7" opacity="0.6"/>

      </svg>`;

      const boatEl = document.createElement("div");
      Object.assign(boatEl.style, {
        width: boatSize + "px",
        height: boatSize + "px",
        pointerEvents: "none",
        transformOrigin: "center center",
        transition: "transform 0.5s cubic-bezier(0.25, 0.8, 0.25, 1)"
      });
      boatEl.innerHTML = boatSVG;

      boatMarker = new maptilersdk.Marker({ element: boatEl, anchor: "center" })
        .setLngLat(fallbackCenter).addTo(map);

      function computeBearing(lat1, lon1, lat2, lon2) {
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const dLon  = toRad(lon2 - lon1);
        const y = Math.sin(dLon) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
                - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
      }
      window._velaComputeBearing = computeBearing;

      /* ---- Blog marker custom SVG ---- */
      const blogCoords = [9.10300, 43.75930];
      const blogProps  = {
        title  : "Déploiement & récupération flotteurs Argo BGC",
        date   : "10 février 2026",
        url    : "https://www.velalab.org/post/d%C3%A9ploiement-et-r%C3%A9cup%C3%A9ration-flotteurs-argo-bgc",
        image  : "https://static.wixstatic.com/media/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg/v1/fill/w_1480,h_826,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg",
        excerpt: "Quelques jours de navigation dans le Golfe de Gênes! Au programme, un déploiement de flotteur Argo en collaboration avec le laboratoire de Villefranche-sur-Mer."
      };

      // Marqueur blog — trois cercles concentriques bleu/blanc
      const blogDotEl = document.createElement("div");
      const bSize = isMini ? 18 : 24;
      blogDotEl.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${bSize}" height="${bSize}" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="13" fill="rgba(95,125,149,0.25)" stroke="rgba(95,125,149,0.5)" stroke-width="1"/>
          <circle cx="14" cy="14" r="9"  fill="rgba(95,125,149,0.65)" stroke="white" stroke-width="1.5"/>
          <circle cx="14" cy="14" r="3.5" fill="rgba(255,255,255,0.85)"/>
        </svg>`;
      Object.assign(blogDotEl.style, {
        width: bSize + "px", height: bSize + "px",
        cursor: "pointer", pointerEvents: "auto",
        filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.4))"
      });

      const blogMarker = new maptilersdk.Marker({ element: blogDotEl, anchor: "center" })
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
      blogDotEl.addEventListener("mouseenter", () => { popupDiv.style.display = "block"; popupVis = true; positionPopup(); });
      blogDotEl.addEventListener("mouseleave", () => { setTimeout(() => { if (!popupDiv.matches(":hover")) { popupDiv.style.display = "none"; popupVis = false; } }, 100); });
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

    // Flèches de navigation
    btnPrev.addEventListener("click", () => {
      if (!hourlyPts.length) return;
      sliderIdx = Math.max(0, sliderIdx - 1);
      slider.value = sliderIdx;
      renderAll();
      updateBoatUI();
    });
    btnNext.addEventListener("click", () => {
      if (!hourlyPts.length) return;
      sliderIdx = Math.min(hourlyPts.length - 1, sliderIdx + 1);
      slider.value = sliderIdx;
      renderAll();
      updateBoatUI();
    });
  }
};
