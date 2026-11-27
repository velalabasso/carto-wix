window.VelaCarto = {
  init: async function(options = {}) {
    const mode   = options.mode || "full";
    const isMini = mode === "mini";

    // Détection mobile (viewport étroit) — utilisée pour masquer les
    // panneaux Navigation et Science sur téléphone, indépendamment du mode.
    const isMobile = window.matchMedia
      ? window.matchMedia("(max-width: 768px)").matches
      : window.innerWidth <= 768;

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

    const DEPARTURE_MS = new Date("2026-04-25T18:32:00Z").getTime();

    /* ===================== STYLE DE LA TRACE ===================== */
    // Trace blanche. Quand la CTD quille est ON, un trait bleu plus fin
    // est dessiné au milieu de la trace blanche.
    const TRACK_WIDTH     = isMini ? 2   : 3;    // trait blanc (trace)
    const CTD_KEEL_WIDTH  = isMini ? 0.8 : 1.2;  // trait bleu fin au milieu (CTD quille ON)

    // Rafraîchissement des fonds chlorophylle / température (données
    // quotidiennes : inutile de les recharger toutes les 2 min).
    const OVERLAY_REFRESH_MS = 3600000; // 1 h

    /* ===================== CHLOROPHYLLE (Copernicus Marine, via GitHub Actions) ===================== */
    // Image statique "gap-free" (interpolée, sans trous liés aux nuages),
    // générée quotidiennement par un workflow GitHub Actions à partir du
    // dataset Copernicus Marine "cmems_obs-oc_glo_bgc-plankton_nrt_l4-
    // gapfree-multi-4km_P1D" (voir scripts/generate_chlorophyll_image.py).
    // Contrairement au layer NASA GIBS L2 utilisé avant (passage satellite
    // brut, trous de nuages), ce produit est déjà lissé par Copernicus.
    // Les identifiants Copernicus ne transitent jamais côté client : ils
    // restent dans les GitHub Secrets du workflow, seule l'image PNG (et
    // ses bornes géographiques) finit sur le repo, exactement comme les CSV.
    //
    // NOTE : ces fichiers vivent dans le repo "carto-wix" (celui du site,
    // où se trouve déjà ce script et voilier.png) — PAS dans "zopa" (celui
    // des logs de nav). D'où l'URL builder dédié ci-dessous.
    const CARTO_REPO_OWNER = "velalabasso";
    const CARTO_REPO_NAME  = "carto-wix";
    const CARTO_BRANCH     = "main";
    const CHLORO_IMAGE_PATH = "chlorophyll/chlorophyll_latest.png";
    const CHLORO_META_PATH  = "chlorophyll/chlorophyll_latest.json";
    const CHLORO_GRID_PATH  = "chlorophyll/chlorophyll_latest_grid.json";
    // Nom affiché sous la colorbar — doit rester cohérent avec DATASET_ID
    // dans scripts/generate_chlorophyll_image.py.
    const CHLORO_PRODUCT_NAME = "OCEANCOLOUR_GLO_BGC_L4_NRT_009_102 (gap-free)";
    // Bornes de l'échelle de couleur — doivent rester cohérentes avec
    // VMIN/VMAX dans scripts/generate_chlorophyll_image.py.
    const CHLORO_VMIN = 0.01;
    const CHLORO_VMAX = 10.0;

    /* ===================== TEMPÉRATURE DE SURFACE (Copernicus Marine, via GitHub Actions) ===================== */
    // Même architecture que la chlorophylle : image statique "gap-free"
    // générée quotidiennement par GitHub Actions (produit Copernicus Marine
    // "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2", système OSTIA), au lieu du
    // layer WMS NASA GIBS utilisé avant. Raison du changement : GIBS ne
    // supporte pas GetFeatureInfo (lecture de valeur impossible) et son
    // fichier de légende officiel n'a pas pu être récupéré de façon fiable
    // pour garantir une colorbar exacte. En générant l'image nous-mêmes, on
    // contrôle la palette et on peut exporter une grille de valeurs.
    const SST_IMAGE_PATH = "sst/sst_latest.png";
    const SST_META_PATH  = "sst/sst_latest.json";
    const SST_GRID_PATH  = "sst/sst_latest_grid.json";
    // Bornes de l'échelle affichée (°C) — échelle LINÉAIRE (pas log, à la
    // différence de la chlorophylle). Doivent rester cohérentes avec
    // VMIN/VMAX dans scripts/generate_sst_image.py.
    const SST_VMIN = 0;
    const SST_VMAX = 30;
    const SST_PRODUCT_NAME = "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2 (OSTIA, gap-free)";

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

    const SCIENCE_PT = {
      hypernet     : { label: "Station hyperspectrale",    color: "#f59e0b" },
      net          : { label: "Station biologie",   color: "#10b981" },
      ctd_profile  : { label: "Station CTD température-salinité",        color: "#a855f7" },
      ctd_intercomp: { label: "Station CTD température-salinité",        color: "#a855f7" }
    };
    const SCIENCE_CT = {
      inline   : { label: "Pompage CO2-chlorophylle (en continu)",   color: "#ef4444" },
      ctd_keel : { label: "CTD sur la quille (en continu)", color: "#3b82f6" }
    };

    const ALL_SCIENCE = [...Object.keys(SCIENCE_PT), ...Object.keys(SCIENCE_CT)];

    // Colonne supplémentaire lue dans le CSV, en plus de ALL_SCIENCE :
    // état brut des stations HYP (ON/OFF), utilisé uniquement comme repli
    // d'affichage pour les points Hypernet — ne génère pas de layer propre.
    // station_bio : état STATION BIO ON/OFF — c'est lui qui place les points
    // "Station biologie" (qu'il y ait eu un filet, une filtration ou un bucket).
    const EXTRA_COLS = ["station_hyp", "station_bio"];

    const sciVis = {};
    ALL_SCIENCE.forEach(k => sciVis[k] = true);

    /* ===================== COULEURS BORDURES ===================== */
    function lightenColor(hex, amount = 0.45) {
      const r = parseInt(hex.slice(1,3), 16);
      const g = parseInt(hex.slice(3,5), 16);
      const b = parseInt(hex.slice(5,7), 16);
      const lr = Math.round(r + (255 - r) * amount);
      const lg = Math.round(g + (255 - g) * amount);
      const lb = Math.round(b + (255 - b) * amount);
      return `#${lr.toString(16).padStart(2,'0')}${lg.toString(16).padStart(2,'0')}${lb.toString(16).padStart(2,'0')}`;
    }

    const STROKE_COLORS = {
      hypernet    : lightenColor(SCIENCE_PT.hypernet.color),
      net         : lightenColor(SCIENCE_PT.net.color),
      ctd_profile : lightenColor(SCIENCE_PT.ctd_profile.color),
    };

    /* ===================== URL HELPERS ===================== */

    function cacheBuster() { return `v=${Date.now()}`; }

    // Pas de cache-buster ici : on utilise l'ETag (requête conditionnelle).
    // Si rien n'a changé, GitHub répond 304 (rapide, et ne consomme pas
    // le quota de 60 requêtes/heure de l'API).
    function githubTreeUrl() {
      return `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/${branch}?recursive=1`;
    }

    // URL "versionnée" par le sha du fichier : tant que le fichier ne
    // change pas sur GitHub, l'URL reste la même et peut être mise en cache
    // par le navigateur (même d'une visite à l'autre).
    function githubRawUrlVersioned(path, sha) {
      return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/`
        + path.split("/").map(encodeURIComponent).join("/")
        + `?sha=${sha}`;
    }

    function githubRawUrl(path) {
      return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/`
        + path.split("/").map(encodeURIComponent).join("/")
        + `?${cacheBuster()}`;
    }

    // Même principe que githubRawUrl, mais pour le repo "carto-wix" (site),
    // où vit la chlorophylle générée par GitHub Actions.
    function cartoRawUrl(path) {
      return `https://raw.githubusercontent.com/${CARTO_REPO_OWNER}/${CARTO_REPO_NAME}/${CARTO_BRANCH}/`
        + path.split("/").map(encodeURIComponent).join("/")
        + `?${cacheBuster()}`;
    }

    /* ---- Chlorophylle : charge/rafraîchit l'image + ses bornes géo ---- */
    // Formate une date ISO en DD/MM/YYYY (fuseau UTC, cohérent avec le
    // reste de la carto qui affiche tout en UTC).
    function formatDateFR(isoString) {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return "—";
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const yyyy = d.getUTCFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }

    async function loadChlorophyllImage() {
      const meta = await fetchJSON(cartoRawUrl(CHLORO_META_PATH));
      if (!meta || !isFinite(meta.west) || !isFinite(meta.east)
          || !isFinite(meta.south) || !isFinite(meta.north)) {
        console.warn("Chlorophylle : bornes géographiques indisponibles.");
        return false;
      }
      const coordinates = [
        [meta.west, meta.north], [meta.east, meta.north],
        [meta.east, meta.south], [meta.west, meta.south]
      ];
      const imageUrl = cartoRawUrl(CHLORO_IMAGE_PATH);

      const productEl = document.getElementById("chloro-product");
      if (productEl) {
        const dateStr = formatDateFR(meta.generated_at);
        productEl.innerText = `${dateStr} — ${CHLORO_PRODUCT_NAME}`;
      }

      const src = map.getSource("chlorophyll-source");
      if (src) {
        src.updateImage({ url: imageUrl, coordinates });
      } else {
        map.addSource("chlorophyll-source", { type: "image", url: imageUrl, coordinates });
        // Inséré SOUS la trace (et les points science), même s'il est
        // chargé après elle.
        const beforeId = map.getLayer("vela-live-track-line") ? "vela-live-track-line" : undefined;
        map.addLayer({
          id: "chlorophyll-layer", type: "raster", source: "chlorophyll-source",
          paint: { "raster-opacity": 0.75 },
          layout: { visibility: activeBaseLayer === "chloro" ? "visible" : "none" }
        }, beforeId);
      }
      return true;
    }

    async function loadSstImage() {
      const meta = await fetchJSON(cartoRawUrl(SST_META_PATH));
      if (!meta || !isFinite(meta.west) || !isFinite(meta.east)
          || !isFinite(meta.south) || !isFinite(meta.north)) {
        console.warn("Température : bornes géographiques indisponibles.");
        return false;
      }
      const coordinates = [
        [meta.west, meta.north], [meta.east, meta.north],
        [meta.east, meta.south], [meta.west, meta.south]
      ];
      const imageUrl = cartoRawUrl(SST_IMAGE_PATH);

      const productEl = document.getElementById("sst-product");
      if (productEl) {
        const dateStr = formatDateFR(meta.generated_at);
        productEl.innerText = `${dateStr} — ${SST_PRODUCT_NAME}`;
      }

      const src = map.getSource("sst-source");
      if (src) {
        src.updateImage({ url: imageUrl, coordinates });
      } else {
        map.addSource("sst-source", { type: "image", url: imageUrl, coordinates });
        // Inséré SOUS la trace (et les points science), même s'il est
        // chargé après elle.
        const beforeId = map.getLayer("vela-live-track-line") ? "vela-live-track-line" : undefined;
        map.addLayer({
          id: "sst-layer", type: "raster", source: "sst-source",
          paint: { "raster-opacity": 0.75 },
          layout: { visibility: activeBaseLayer === "sst" ? "visible" : "none" }
        }, beforeId);
      }
      return true;
    }

    /* ---- Grille de valeurs chlorophylle (lecture au survol) ---- */
    let chloroGrid = null; // { lats:[...] croissant, lons:[...] croissant, values:[[...]], unit }

    async function loadChlorophyllGrid() {
      const grid = await fetchJSON(cartoRawUrl(CHLORO_GRID_PATH));
      if (!grid || !Array.isArray(grid.lats) || !Array.isArray(grid.lons) || !Array.isArray(grid.values)) {
        console.warn("Chlorophylle : grille de valeurs indisponible.");
        return;
      }
      chloroGrid = grid;
    }

    // Recherche l'indice du plus proche voisin dans un tableau croissant.
    function nearestIdx(arr, v) {
      let lo = 0, hi = arr.length - 1;
      if (v <= arr[0]) return 0;
      if (v >= arr[hi]) return hi;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] < v) lo = mid + 1; else hi = mid;
      }
      const i = lo;
      if (i > 0 && Math.abs(arr[i - 1] - v) <= Math.abs(arr[i] - v)) return i - 1;
      return i;
    }

    function chlorophyllValueAt(lng, lat) {
      if (!chloroGrid) return null;
      const iLat = nearestIdx(chloroGrid.lats, lat);
      const iLon = nearestIdx(chloroGrid.lons, lng);
      const row = chloroGrid.values[iLat];
      if (!row) return null;
      const v = row[iLon];
      return (v === null || v === undefined) ? null : v;
    }

    /* ---- Grille de valeurs SST (lecture au survol) ---- */
    let sstGrid = null; // { lats:[...] croissant, lons:[...] croissant, values:[[...]], unit }

    async function loadSstGrid() {
      const grid = await fetchJSON(cartoRawUrl(SST_GRID_PATH));
      if (!grid || !Array.isArray(grid.lats) || !Array.isArray(grid.lons) || !Array.isArray(grid.values)) {
        console.warn("Température : grille de valeurs indisponible.");
        return;
      }
      sstGrid = grid;
    }

    function sstValueAt(lng, lat) {
      if (!sstGrid) return null;
      const iLat = nearestIdx(sstGrid.lats, lat);
      const iLon = nearestIdx(sstGrid.lons, lng);
      const row = sstGrid.values[iLat];
      if (!row) return null;
      const v = row[iLon];
      return (v === null || v === undefined) ? null : v;
    }

    /* ---- Chargement à la demande des fonds chlorophylle / température ---- */
    // Rien n'est téléchargé tant que l'utilisateur n'a pas choisi ce fond :
    // la carte (vent + trace) s'affiche beaucoup plus vite au démarrage.
    const overlayState = { chloro: null, sst: null }; // promesse en cours / terminée

    function ensureOverlay(kind, force = false) {
      if (kind !== "chloro" && kind !== "sst") return Promise.resolve();
      if (overlayState[kind] && !force) return overlayState[kind];
      const p = (async () => {
        try {
          const ok = kind === "chloro" ? await loadChlorophyllImage() : await loadSstImage();
          if (!ok) { overlayState[kind] = null; return; } // réessai au prochain clic
          if (kind === "chloro") await loadChlorophyllGrid(); else await loadSstGrid();
        } catch(e) {
          console.warn(`Fond ${kind} :`, e);
          overlayState[kind] = null;
        }
      })();
      overlayState[kind] = p;
      return p;
    }

    /* ---- Cache persistant des CSV (Cache Storage du navigateur) ---- */
    // Les CSV déjà téléchargés sont gardés d'une visite à l'autre : seuls
    // les fichiers modifiés sur GitHub (sha différent) sont re-téléchargés.
    const CSV_CACHE_NAME = "velacarto-csv-v1";

    // sha Git d'un fichier ("blob <taille>\0<contenu>" en SHA-1) : permet de
    // vérifier qu'on a bien reçu la bonne version avant de la mettre en cache.
    async function gitBlobSha(buf) {
      if (!window.crypto || !crypto.subtle) return null;
      const header = new TextEncoder().encode(`blob ${buf.byteLength}\0`);
      const all = new Uint8Array(header.length + buf.byteLength);
      all.set(header, 0);
      all.set(new Uint8Array(buf), header.length);
      const h = await crypto.subtle.digest("SHA-1", all);
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // Retourne { text, verified } — verified = contenu conforme au sha attendu.
    async function fetchTextCached(url, sha) {
      let cache = null;
      try { if ("caches" in window) cache = await caches.open(CSV_CACHE_NAME); } catch(e) { cache = null; }

      if (cache) {
        try {
          const hit = await cache.match(url);
          if (hit) return { text: await hit.text(), verified: true };
        } catch(e) { /* cache illisible : on passe au réseau */ }
      }

      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) { console.warn("Impossible de charger :", url, r.status); return { text: "", verified: false }; }
        const buf  = await r.arrayBuffer();
        const text = new TextDecoder("utf-8").decode(buf);
        let verified = false;
        try { verified = (await gitBlobSha(buf)) === sha; } catch(e) { verified = false; }
        if (verified && cache) {
          try {
            await cache.put(url, new Response(buf, { headers: { "Content-Type": "text/csv; charset=utf-8" } }));
          } catch(e) { /* quota / mode privé : tant pis */ }
        }
        return { text, verified };
      } catch(e) {
        console.warn("Erreur chargement :", url, e);
        return { text: "", verified: false };
      }
    }

    // Supprime du cache les anciennes versions des CSV.
    async function pruneCsvCache(validUrls) {
      try {
        if (!("caches" in window)) return;
        const cache = await caches.open(CSV_CACHE_NAME);
        const valid = new Set(validUrls.map(u => new Request(u).url));
        for (const req of await cache.keys()) {
          if (!valid.has(req.url)) await cache.delete(req);
        }
      } catch(e) { /* sans importance */ }
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
      const iExtra  = {};
      EXTRA_COLS.forEach(k => { iExtra[k] = colIdx(hdr, [k]); });

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
        EXTRA_COLS.forEach(k => {
          if (iExtra[k] !== -1) p[k] = String(c[iExtra[k]] || "").trim().toUpperCase();
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

    /* ===================== HAVERSINE ===================== */

    function haversine_nm_js(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const toR = d => d * Math.PI / 180;
      const dphi = toR(lat2 - lat1); const dlam = toR(lon2 - lon1);
      const a = Math.sin(dphi/2)**2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dlam/2)**2;
      return (2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))) / 1852;
    }

    /* ===================== HYPERNET : repli station_hyp ===================== */

    /*
     * Priorité aux vrais événements "hypernet on/off".
     * Si, sur une fenêtre contiguë où station_hyp === "ON" (station HYP active),
     * aucun point n'a hypernet === "ON" (cas où "hypernet on" a été oublié à bord),
     * alors on considère l'hypernet comme actif sur toute cette fenêtre, bornée par
     * station_hyp ON / OFF (ou par un éventuel "hypernet off" réel s'il existe
     * malgré tout à l'intérieur de la fenêtre — il prime alors comme borne de fin).
     */
    function computeEffectiveHypernetFlags(slice) {
      const n = slice.length;
      const flags = new Array(n);
      for (let i = 0; i < n; i++) flags[i] = slice[i].hypernet === "ON";

      let segStart = -1;
      for (let i = 0; i <= n; i++) {
        const stationOn = i < n && slice[i].station_hyp === "ON";
        if (stationOn && segStart === -1) segStart = i;
        if (!stationOn && segStart !== -1) {
          const segEnd = i - 1;

          let hasRealOn = false;
          for (let j = segStart; j <= segEnd; j++) {
            if (slice[j].hypernet === "ON") { hasRealOn = true; break; }
          }
          // Aucun "hypernet on" réel dans cette station → repli sur toute
          // la fenêtre station_hyp ON...OFF (borne de fin = fin de station).
          if (!hasRealOn) {
            for (let j = segStart; j <= segEnd; j++) flags[j] = true;
          }
          segStart = -1;
        }
      }
      return flags;
    }

    function buildHypernetGeoJSON(slice) {
      const features = [];
      const INTERVAL_NM = 1.0;
      let inSegment = false;
      let distSinceLast = 0;
      let lastPt = null;

      const flags = computeEffectiveHypernetFlags(slice);

      slice.forEach((p, idx) => {
        const on = flags[idx];
        if (on) {
          if (!inSegment) {
            features.push({ type: "Feature", properties: {},
              geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
            distSinceLast = 0;
            lastPt = p;
            inSegment = true;
          } else {
            const d = haversine_nm_js(lastPt.lat, lastPt.lon, p.lat, p.lon);
            distSinceLast += d;
            if (distSinceLast >= INTERVAL_NM) {
              features.push({ type: "Feature", properties: {},
                geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
              distSinceLast = 0;
            }
            lastPt = p;
          }
        } else {
          inSegment = false;
          lastPt = null;
          distSinceLast = 0;
        }
      });

      return { type: "FeatureCollection", features };
    }

    const EMPTY_FC = { type: "FeatureCollection", features: [] };

    /* ===================== GITHUB : LISTE DES FICHIERS DE TRACE ===================== */

    const TREE_LS_KEY = `velacarto:tree:${repoOwner}/${repoName}/${branch}`;
    let treeEtag  = null;
    let treeFiles = null; // [{ path, sha }]

    function isTrackFile(path) {
      if (path === mainTrackPath) return true;
      const lp = path.toLowerCase();
      const fn = path.split("/").pop().toLowerCase();
      return path.startsWith(nmeaRootPath) && lp.endsWith(".csv") && !lp.includes(".gz")
        && !fn.startsWith("~") && !fn.startsWith(".") && !fn.includes("~lock");
    }

    function readStoredTree() {
      try {
        const s = JSON.parse(localStorage.getItem(TREE_LS_KEY) || "null");
        if (s && Array.isArray(s.files)) return s;
      } catch(e) {}
      return null;
    }
    function storeTree(etag, files) {
      try { localStorage.setItem(TREE_LS_KEY, JSON.stringify({ etag, files })); } catch(e) {}
    }

    // Retourne { files, failed }. Requête conditionnelle (ETag) : si rien
    // n'a changé sur GitHub, réponse 304 quasi instantanée.
    async function fetchTrackFileList() {
      if (!treeFiles) {
        const s = readStoredTree();
        if (s) { treeFiles = s.files; treeEtag = s.etag || null; }
      }
      const headers = { "Accept": "application/vnd.github+json" };
      if (treeEtag && treeFiles) headers["If-None-Match"] = treeEtag;

      try {
        const r = await fetch(githubTreeUrl(), { cache: "no-store", headers });
        if (r.status === 304 && treeFiles) return { files: treeFiles, failed: false };
        if (!r.ok) {
          console.warn("Liste GitHub indisponible :", r.status, "— dernière liste connue utilisée.");
          return { files: treeFiles || [], failed: true };
        }
        const data = await r.json();
        if (!data || !Array.isArray(data.tree)) return { files: treeFiles || [], failed: true };
        if (data.truncated) console.warn("Réponse GitHub tronquée — certains CSV peuvent manquer.");

        const files = data.tree
          .filter(item => item.type === "blob" && isTrackFile(item.path || ""))
          .map(item => ({ path: item.path, sha: item.sha }))
          .sort((a, b) => a.path.localeCompare(b.path));

        treeEtag  = r.headers.get("ETag");
        treeFiles = files;
        storeTree(treeEtag, files);
        return { files, failed: false };
      } catch(e) {
        console.warn("Erreur liste GitHub :", e);
        return { files: treeFiles || [], failed: true };
      }
    }

    async function mapLimit(items, limit, fn) {
      const results = []; let ni = 0;
      async function worker() { while (ni < items.length) { const i = ni++; results[i] = await fn(items[i], i); } }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
      return results;
    }

    /* ===================== CHARGEMENT INCRÉMENTAL DES POINTS ===================== */

    const csvCache = new Map(); // path -> { sha, points } (en mémoire)
    let lastSignature = "";

    // ANCIEN MODE (repli si track_all.csv n'existe pas encore) : un CSV par leg.
    // Retourne { livePoints }, ou null si rien n'a changé depuis le dernier appel.
    async function loadLegacyTrackPoints() {
      const { files, failed } = await fetchTrackFileList();

      let list = files;
      if (!list.length) list = [{ path: mainTrackPath, sha: null }]; // repli : trace principale seule

      const signature = list.map(f => `${f.path}@${f.sha}`).join("|");
      if (signature === lastSignature && csvCache.size) return null; // rien de nouveau

      // Ne télécharger QUE les fichiers nouveaux ou modifiés
      const toFetch = list.filter(f => {
        const c = csvCache.get(f.path);
        return !f.sha || !c || c.sha !== f.sha;
      });

      let allOk = true;
      await mapLimit(toFetch, 8, async f => {
        let text, verified;
        if (f.sha) {
          ({ text, verified } = await fetchTextCached(githubRawUrlVersioned(f.path, f.sha), f.sha));
        } else {
          text = await fetchText(githubRawUrl(f.path)); verified = false;
        }
        if (!text) { allOk = false; return; } // échec réseau : on réessaiera
        if (!verified) allOk = false;          // version pas sûre : on la retéléchargera
        csvCache.set(f.path, {
          sha: verified ? f.sha : "unverified",
          points: parseTrackCSV(text, f.path)
        });
      });

      // Oublier les fichiers qui n'existent plus sur GitHub
      const keep = new Set(list.map(f => f.path));
      for (const p of Array.from(csvCache.keys())) if (!keep.has(p)) csvCache.delete(p);

      if (!failed) {
        pruneCsvCache(list.filter(f => f.sha).map(f => githubRawUrlVersioned(f.path, f.sha)));
      }
      lastSignature = (!failed && allOk) ? signature : "";

      const livePoints = dedupeSort(Array.from(csvCache.values()).flatMap(c => c.points));

      console.log("===== VELA CARTO DEBUG =====");
      console.log(`Fichiers de trace : ${list.length} — téléchargés : ${toFetch.length}`);
      console.table(Array.from(csvCache.entries()).map(([p, c]) => ({ fichier: p, points: c.points.length })));
      console.log("Points live :", livePoints.length);
      if (livePoints.length) console.log("Dernier point :", livePoints[livePoints.length - 1].time, [livePoints[livePoints.length - 1].lon, livePoints[livePoints.length - 1].lat]);
      console.log("============================");

      return { livePoints };
    }

    /* ===================== TRACE UNIQUE (track_all.csv) ===================== */
    // Fichier fabriqué par nmea_process.py qui regroupe tous les legs.
    // Lu via l'API GitHub "contents" en version brute, avec ETag : si le
    // fichier n'a pas changé, GitHub répond 304 (rapide, et ne compte pas
    // dans la limite de 60 requêtes/heure). Le contenu est gardé dans le
    // navigateur d'une visite à l'autre.
    const TRACK_ALL_PATH  = nmeaRootPath + "track_all.csv";
    const FILE_CACHE_NAME = "velacarto-files-v1";
    const memFiles = new Map(); // path -> { etag, points }

    function apiContentsUrl(path) {
      return `https://api.github.com/repos/${repoOwner}/${repoName}/contents/`
        + path.split("/").map(encodeURIComponent).join("/")
        + `?ref=${branch}`;
    }

    async function openFileCache() {
      try { if ("caches" in window) return await caches.open(FILE_CACHE_NAME); } catch(e) {}
      return null;
    }

    async function fileCacheGet(path) {
      const cache = await openFileCache();
      if (!cache) return null;
      try {
        const hit = await cache.match(apiContentsUrl(path));
        if (!hit) return null;
        return { text: await hit.text(), etag: hit.headers.get("X-Vela-Etag") };
      } catch(e) { return null; }
    }

    async function fileCachePut(path, text, etag) {
      const cache = await openFileCache();
      if (!cache) return;
      try {
        await cache.put(apiContentsUrl(path), new Response(text, {
          headers: { "Content-Type": "text/csv; charset=utf-8", "X-Vela-Etag": etag || "" }
        }));
      } catch(e) { /* quota / mode privé : tant pis */ }
    }

    async function fileCacheDelete(path) {
      const cache = await openFileCache();
      if (cache) { try { await cache.delete(apiContentsUrl(path)); } catch(e) {} }
    }

    // Retourne { status: "same" | "new" | "missing" | "error", text, etag }
    async function fetchRepoFile(path) {
      const prev = memFiles.get(path);
      const headers = { "Accept": "application/vnd.github.raw" };
      if (prev && prev.etag) headers["If-None-Match"] = prev.etag;
      try {
        const r = await fetch(apiContentsUrl(path), { cache: "no-store", headers });
        if (r.status === 304) return { status: "same" };
        if (r.status === 404) return { status: "missing" };
        if (r.ok) return { status: "new", text: await r.text(), etag: r.headers.get("ETag") };
        console.warn("API GitHub :", path, r.status, "— repli sur raw.githubusercontent");
      } catch(e) {
        console.warn("API GitHub :", path, e, "— repli sur raw.githubusercontent");
      }
      // Repli (API indisponible / limite atteinte) : lien brut classique
      const text = await fetchText(githubRawUrl(path));
      return text ? { status: "new", text, etag: null } : { status: "error" };
    }

    function mergedPoints() {
      return dedupeSort(Array.from(memFiles.values()).flatMap(f => f.points));
    }

    // 1) Affichage immédiat : ce que le navigateur a gardé de la dernière visite
    async function loadTrackFromBrowserCache() {
      for (const path of [TRACK_ALL_PATH, mainTrackPath]) {
        const c = await fileCacheGet(path);
        if (c && c.text) memFiles.set(path, { etag: c.etag || null, points: parseTrackCSV(c.text, path) });
      }
      if (!memFiles.has(TRACK_ALL_PATH)) { memFiles.clear(); return null; }
      return { livePoints: mergedPoints() };
    }

    // 2) Vérification GitHub. Retourne { livePoints }, ou null si rien n'a changé.
    let useLegacy = false;
    const missingPaths = new Set(); // fichiers absents : plus redemandés avant le prochain chargement de page

    async function loadAllTrackPoints() {
      if (useLegacy) return loadLegacyTrackPoints();

      const paths = [TRACK_ALL_PATH, mainTrackPath].filter(p => !missingPaths.has(p));
      const results = await Promise.all(paths.map(fetchRepoFile));

      if (paths[0] === TRACK_ALL_PATH && results[0].status === "missing") {
        // track_all.csv pas encore généré : ancien mode, un CSV par leg
        console.warn("track_all.csv absent — chargement leg par leg (ancien mode).");
        useLegacy = true;
        memFiles.clear();
        return loadLegacyTrackPoints();
      }

      let changed = false;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i], res = results[i];
        if (res.status === "new") {
          memFiles.set(path, { etag: res.etag, points: parseTrackCSV(res.text, path) });
          if (res.etag) fileCachePut(path, res.text, res.etag); else fileCacheDelete(path);
          changed = true;
        } else if (res.status === "missing") {
          missingPaths.add(path);
          if (memFiles.has(path)) { memFiles.delete(path); fileCacheDelete(path); changed = true; }
        }
        // "same" : rien à faire ; "error" : on garde ce qu'on a
      }
      if (!changed) return null;

      const livePoints = mergedPoints();
      console.log("===== VELA CARTO DEBUG =====");
      console.table(Array.from(memFiles.entries()).map(([p, f]) => ({ fichier: p, points: f.points.length })));
      console.log("Points live :", livePoints.length);
      if (livePoints.length) console.log("Dernier point :", livePoints[livePoints.length - 1].time);
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
      id: "wind-layer",
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

    /* ===================== UI ===================== */

    const sliderWrapper = document.createElement("div");
    Object.assign(sliderWrapper.style, {
      position: "fixed", bottom: "16px", left: "20px", right: "20px",
      zIndex: "2", display: "flex", alignItems: "center", gap: "10px"
    });

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

    const timeLabel    = document.createElement("div"); timeLabel.style.display    = "none"; document.body.appendChild(timeLabel);
    const legend       = document.createElement("div"); legend.style.display       = "none"; document.body.appendChild(legend);
    const variableName = document.createElement("div"); variableName.style.display = "none"; document.body.appendChild(variableName);
    const pointerData  = document.createElement("div"); pointerData.style.display  = "none"; document.body.appendChild(pointerData);

    if (isMini) slider.style.display = "none";


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

    /* ---- Widget Chlorophylle (même coin que le vent, un seul visible à la fois) ---- */
    let chloroWidget = null;
    if (!isMini) {
      chloroWidget = document.createElement("div");
      Object.assign(chloroWidget.style, {
        position: "absolute", top: "12px", left: "12px",
        display: "none", flexDirection: "column",
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        borderRadius: "12px", padding: "6px 12px 8px 12px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.12)",
        minWidth: "70px", zIndex: "800", pointerEvents: "none"
      });
      chloroWidget.innerHTML = `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;
          color:#c8dcea;font-family:Helvetica Neue,Arial,sans-serif;
          font-weight:500;margin-bottom:2px;">Chlorophylle</div>
        <div id="chloro-value" style="font-size:16px;font-weight:700;color:white;
          font-family:Helvetica Neue,Arial,sans-serif;letter-spacing:-.01em;
          line-height:1.2;text-shadow:0 1px 6px rgba(0,0,0,0.4);">— mg/m³</div>`;
      document.getElementById("map").appendChild(chloroWidget);
    }

    /* ---- Widget Température (même coin, un seul visible à la fois) ---- */
    // Valeur lue localement dans la grille sst-grid (même mécanisme que
    // la chlorophylle) — plus de requête réseau au survol.
    let sstWidget = null;
    if (!isMini) {
      sstWidget = document.createElement("div");
      Object.assign(sstWidget.style, {
        position: "absolute", top: "12px", left: "12px",
        display: "none", flexDirection: "column",
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        borderRadius: "12px", padding: "6px 12px 8px 12px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.12)",
        minWidth: "70px", zIndex: "800", pointerEvents: "none"
      });
      sstWidget.innerHTML = `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;
          color:#c8dcea;font-family:Helvetica Neue,Arial,sans-serif;
          font-weight:500;margin-bottom:2px;">Température</div>
        <div id="sst-value" style="font-size:16px;font-weight:700;color:white;
          font-family:Helvetica Neue,Arial,sans-serif;letter-spacing:-.01em;
          line-height:1.2;text-shadow:0 1px 6px rgba(0,0,0,0.4);">— °C</div>`;
      document.getElementById("map").appendChild(sstWidget);
    }

    /* ---- Sélecteur de fond de carte : Vent / Chlorophylle / Température (exclusif) ---- */
    let baseLayerControl  = null;
    let chloroColorbar    = null;
    let sstColorbar       = null;
    let activeBaseLayer   = "wind"; // "wind" | "chloro" | "sst" | "sat"
    let blcCollapsed      = false; // état replié du sélecteur "Fond de carte"

    // Affiche/masque widgets + colorbars selon la couche active ET l'état
    // (replié ou non) du sélecteur — repli du sélecteur = colorbar masquée,
    // même si une couche non-vent est active.
    function applyLayerVisuals(layer) {
      const showExtras = !blcCollapsed;
      if (windWidget)     windWidget.style.display     = layer === "wind"   ? "flex"  : "none";
      if (chloroWidget)   chloroWidget.style.display    = layer === "chloro" ? "flex"  : "none";
      if (chloroColorbar) chloroColorbar.style.display  = (layer === "chloro" && showExtras) ? "block" : "none";
      if (sstWidget)       sstWidget.style.display       = layer === "sst"    ? "flex"  : "none";
      if (sstColorbar)     sstColorbar.style.display     = (layer === "sst" && showExtras) ? "block" : "none";

      if (baseLayerControl) {
        baseLayerControl.querySelectorAll("[data-layer]").forEach(btn => {
          const isActive = btn.dataset.layer === layer;
          btn.style.background   = isActive ? "#2563eb" : "transparent";
          btn.style.color        = isActive ? "white" : "#dde6f0";
          btn.style.boxShadow    = isActive ? "0 0 6px rgba(37,99,235,0.6)" : "none";
          btn.style.borderColor  = isActive ? "#2563eb" : "rgba(255,255,255,0.35)";
        });
      }
    }

    /* ---- Fond satellite (MapTiler) ---- */
    // Ajouté seulement au 1er clic sur "Satellite" (aucune tuile téléchargée
    // avant). Placé sous les noms de lieux du fond de carte s'il y en a, et
    // toujours sous la trace et les points science.
    const SATELLITE_TILEJSON = () =>
      `https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=${maptilersdk.config.apiKey}`;

    function ensureSatelliteLayer() {
      if (map.getLayer("satellite-layer")) return;
      if (!map.getSource("satellite-source")) {
        map.addSource("satellite-source", { type: "raster", url: SATELLITE_TILEJSON(), tileSize: 512 });
      }
      let beforeId;
      try {
        const styleLayers = (map.getStyle() && map.getStyle().layers) || [];
        const firstLabel  = styleLayers.find(l => l.type === "symbol");
        beforeId = firstLabel ? firstLabel.id
                 : (map.getLayer("vela-live-track-line") ? "vela-live-track-line" : undefined);
      } catch(e) {
        beforeId = map.getLayer("vela-live-track-line") ? "vela-live-track-line" : undefined;
      }
      map.addLayer({
        id: "satellite-layer", type: "raster", source: "satellite-source",
        layout: { visibility: "visible" }
      }, beforeId);
    }

    function setBaseLayer(layer) {
      activeBaseLayer = layer;
      try {
        if (map.getLayer("wind-layer")) {
          map.setLayoutProperty("wind-layer", "visibility", layer === "wind" ? "visible" : "none");
        }
      } catch(e) { /* layer pas encore prête */ }
      try {
        if (map.getLayer("chlorophyll-layer")) {
          map.setLayoutProperty("chlorophyll-layer", "visibility", layer === "chloro" ? "visible" : "none");
        }
      } catch(e) { /* layer pas encore prête */ }
      try {
        if (map.getLayer("sst-layer")) {
          map.setLayoutProperty("sst-layer", "visibility", layer === "sst" ? "visible" : "none");
        }
      } catch(e) { /* layer pas encore prête */ }
      try {
        if (layer === "sat") ensureSatelliteLayer();
        if (map.getLayer("satellite-layer")) {
          map.setLayoutProperty("satellite-layer", "visibility", layer === "sat" ? "visible" : "none");
        }
      } catch(e) { /* carte pas encore prête */ }

      applyLayerVisuals(layer);
      resetHoverWidgets();
      ensureOverlay(layer); // télécharge le fond la 1re fois qu'il est choisi
    }

    if (!isMini) {
      baseLayerControl = document.createElement("div");
      Object.assign(baseLayerControl.style, {
        position: "absolute", bottom: "64px", right: "12px", width: isMobile ? "200px" : "360px",
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        borderRadius: "10px", padding: "4px 6px 6px 6px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.12)",
        zIndex: "800", fontFamily: "Helvetica Neue, Arial, sans-serif", fontSize: "12px"
      });
      baseLayerControl.innerHTML = `
        <div id="blc-header" style="display:flex;align-items:center;justify-content:space-between;
          gap:10px;cursor:pointer;user-select:none;padding:4px 4px 6px 4px;">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;">Fond de carte</span>
          <svg id="blc-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c8dcea"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
            style="transition:transform .2s;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div id="blc-body" style="display:grid;grid-template-columns:repeat(${isMobile ? 2 : 4},1fr);gap:4px;">
          <button data-layer="wind" style="flex:1;min-width:0;border:1px solid rgba(255,255,255,0.35);border-radius:7px;padding:6px 2px;
            cursor:pointer;font:inherit;color:#dde6f0;background:transparent;text-align:center;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            transition:background .15s,color .15s,box-shadow .15s,border-color .15s;">Vent</button>
          <button data-layer="chloro" style="flex:1;min-width:0;border:1px solid rgba(255,255,255,0.35);border-radius:7px;padding:6px 2px;
            cursor:pointer;font:inherit;color:#dde6f0;background:transparent;text-align:center;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            transition:background .15s,color .15s,box-shadow .15s,border-color .15s;">Chlorophylle</button>
          <button data-layer="sst" style="flex:1;min-width:0;border:1px solid rgba(255,255,255,0.35);border-radius:7px;padding:6px 2px;
            cursor:pointer;font:inherit;color:#dde6f0;background:transparent;text-align:center;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            transition:background .15s,color .15s,box-shadow .15s,border-color .15s;">Température</button>
          <button data-layer="sat" style="flex:1;min-width:0;border:1px solid rgba(255,255,255,0.35);border-radius:7px;padding:6px 2px;
            cursor:pointer;font:inherit;color:#dde6f0;background:transparent;text-align:center;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            transition:background .15s,color .15s,box-shadow .15s,border-color .15s;">Satellite</button>
        </div>
      `;
      document.getElementById("map").appendChild(baseLayerControl);

      const blcHeader = baseLayerControl.querySelector("#blc-header");
      const blcBody   = baseLayerControl.querySelector("#blc-body");
      const blcIcon   = baseLayerControl.querySelector("#blc-toggle-icon");
      // Sur mobile, replié par défaut — repliable dans tous les cas (clic sur l'en-tête).
      if (isMobile) {
        blcBody.style.display  = "none";
        blcIcon.style.transform = "rotate(-90deg)";
        blcCollapsed = true;
      }
      blcHeader.addEventListener("click", () => {
        const collapsed = blcBody.style.display === "none";
        blcBody.style.display  = collapsed ? "grid" : "none";
        blcIcon.style.transform = collapsed ? "rotate(0deg)" : "rotate(-90deg)";
        blcCollapsed = !collapsed;
        applyLayerVisuals(activeBaseLayer); // masque/réaffiche la colorbar en conséquence
      });

      baseLayerControl.querySelectorAll("[data-layer]").forEach(btn => {
        btn.addEventListener("click", () => setBaseLayer(btn.dataset.layer));
      });
    }

    /* ---- Colorbar Chlorophylle (bas de carte, centrée, échelle log) ---- */
    if (!isMini) {
      // Position en % le long du dégradé pour une valeur donnée (échelle log)
      const chloroPct = v => {
        const lo = Math.log10(CHLORO_VMIN), hi = Math.log10(CHLORO_VMAX);
        return Math.max(0, Math.min(100, (Math.log10(v) - lo) / (hi - lo) * 100));
      };
      const ticks = [0.01, 0.03, 0.1, 0.3, 1, 3, 10].filter(v => v >= CHLORO_VMIN && v <= CHLORO_VMAX);

      chloroColorbar = document.createElement("div");
      Object.assign(chloroColorbar.style, {
        position: "absolute", bottom: "64px", left: "50%", transform: "translateX(-50%)",
        display: "none",
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        borderRadius: "10px", padding: "8px 14px 6px 14px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.12)",
        zIndex: "800", width: "320px",
        fontFamily: "Helvetica Neue, Arial, sans-serif", color: "#dde6f0"
      });

      // Reconstruction de la palette "ocean color" NASA/SeaWiFS (violet
      // foncé -> bleu -> cyan -> vert -> jaune -> orange -> rouge),
      // approximative (pas extraite pixel-perfect du XML officiel).
      // 12 stops échantillonnés uniformément dans la palette NASA/SeaWiFS
      // exacte à 230 couleurs (même source que NASA_CHL_COLORS dans
      // generate_chlorophyll_image.py) — cohérent avec l'image affichée.
      const gradientCss = "linear-gradient(to right, #90006F, #5100AE, #1200ED, #004AFF, #00BAFF, #00FFBF, #00FF17, #98FF00, #FFDF00, #FF8F00, #FF3B00, #E10000)";
      const ticksHtml = ticks.map((v, i) => {
        const pct = chloroPct(v);
        const tx  = i === 0 ? "0%" : (i === ticks.length - 1 ? "-100%" : "-50%");
        return `<span style="position:absolute;left:${pct}%;transform:translateX(${tx});white-space:nowrap;">${v}</span>`;
      }).join("");

      chloroColorbar.innerHTML = `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;margin-bottom:6px;text-align:center;">
          Chlorophylle-a (mg/m&sup3;)
        </div>
        <div style="height:10px;border-radius:4px;background:${gradientCss};margin-bottom:4px;"></div>
        <div style="position:relative;height:14px;font-size:10px;">${ticksHtml}</div>
        <div id="chloro-product" style="margin-top:8px;font-size:8.5px;color:#c8dcea;text-align:center;
          opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          — mise à jour — ${CHLORO_PRODUCT_NAME}
        </div>
      `;
      document.getElementById("map").appendChild(chloroColorbar);
    }

    /* ---- Colorbar Température (bas de carte, centrée, échelle linéaire) ---- */
    if (!isMini) {
      // Position en % le long du dégradé (échelle LINÉAIRE, contrairement
      // à la chlorophylle qui est en log)
      const sstPct = v => {
        return Math.max(0, Math.min(100, (v - SST_VMIN) / (SST_VMAX - SST_VMIN) * 100));
      };
      const sstTicks = [0, 10, 20, 30].filter(v => v >= SST_VMIN && v <= SST_VMAX);

      sstColorbar = document.createElement("div");
      Object.assign(sstColorbar.style, {
        position: "absolute", bottom: "64px", left: "50%", transform: "translateX(-50%)",
        display: "none",
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        borderRadius: "10px", padding: "8px 14px 6px 14px",
        boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.12)",
        zIndex: "800", width: "320px",
        fontFamily: "Helvetica Neue, Arial, sans-serif", color: "#dde6f0"
      });

      // Palette ColorBrewer "RdBu" (bleu froid -> rouge chaud), schéma
      // standard reconnu. Générée par nous (via Copernicus Marine, voir
      // generate_sst_image.py), donc garantie cohérente avec l'image
      // affichée — plus de risque de décalage avec une source externe.
      const sstGradientCss = "linear-gradient(to right, #08306b, #2166ac, #67a9cf, #d1e5f0, #fddbc7, #ef8a62, #b2182b)";
      const sstTicksHtml = sstTicks.map((v, i) => {
        const pct = sstPct(v);
        const tx  = i === 0 ? "0%" : (i === sstTicks.length - 1 ? "-100%" : "-50%");
        return `<span style="position:absolute;left:${pct}%;transform:translateX(${tx});white-space:nowrap;">${v}</span>`;
      }).join("");

      sstColorbar.innerHTML = `
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;margin-bottom:6px;text-align:center;">
          Température de surface (°C)
        </div>
        <div style="height:10px;border-radius:4px;background:${sstGradientCss};margin-bottom:4px;"></div>
        <div style="position:relative;height:14px;font-size:10px;">${sstTicksHtml}</div>
        <div id="sst-product" style="margin-top:8px;font-size:8.5px;color:#c8dcea;text-align:center;
          opacity:0.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          — mise à jour — ${SST_PRODUCT_NAME}
        </div>
      `;
      document.getElementById("map").appendChild(sstColorbar);
    }

    /* ---- Valeur au survol (vent / chlorophylle / température) ---- */
    // Un seul gestionnaire, limité à 1 calcul par image affichée, et
    // uniquement pour le fond actif (avant : 4 gestionnaires à chaque
    // mouvement de souris, dont 2 lectures du vent).
    let hoverLngLat = null;
    let hoverRaf    = null;

    function resetHoverWidgets() {
      const vwEl = document.getElementById("vw-value");     if (vwEl) vwEl.innerText = "— kn";
      const cvEl = document.getElementById("chloro-value"); if (cvEl) cvEl.innerText = "— mg/m³";
      const svEl = document.getElementById("sst-value");    if (svEl) svEl.innerText = "— °C";
    }

    function updateHoverWidgets() {
      hoverRaf = null;
      if (!hoverLngLat) return;
      const { lng, lat } = hoverLngLat;
      if (activeBaseLayer === "wind") {
        const el = document.getElementById("vw-value");
        if (!el) return;
        const v = windLayer.pickAt(lng, lat);
        el.innerText = v ? `${(v.speedMetersPerSecond * 1.943844).toFixed(1)} kn` : "— kn";
      } else if (activeBaseLayer === "chloro") {
        const el = document.getElementById("chloro-value");
        if (!el) return;
        const v = chlorophyllValueAt(lng, lat);
        el.innerText = (v === null) ? "— mg/m³" : `${v.toFixed(3)} mg/m³`;
      } else if (activeBaseLayer === "sst") {
        const el = document.getElementById("sst-value");
        if (!el) return;
        const v = sstValueAt(lng, lat);
        el.innerText = (v === null) ? "— °C" : `${v.toFixed(1)} °C`;
      }
    }

    if (!isMini) {
      map.on("mousemove", e => {
        hoverLngLat = e.lngLat;
        if (!hoverRaf) hoverRaf = requestAnimationFrame(updateHoverWidgets);
      });
      map.on("mouseout", () => { hoverLngLat = null; resetHoverWidgets(); });
    }

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

    /* ===================== PANNEAU NAV ===================== */

    let departureMs = DEPARTURE_MS;

    let navPanel = null;
    if (!isMini) {
      navPanel = document.createElement("div");
      Object.assign(navPanel.style, {
        background: "rgba(95,125,149,0.45)", backdropFilter: "blur(8px)",
        color: "#dde6f0", fontFamily: "Helvetica Neue, Arial, sans-serif",
        fontSize: "13px", lineHeight: "1.8", padding: "10px 16px",
        borderRadius: "10px", boxShadow: "0 2px 14px rgba(0,0,0,0.3)",
        minWidth: "148px", pointerEvents: "auto", display: "none"
      });
      navPanel.innerHTML = `
        <div id="vn-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;user-select:none;margin-bottom:5px;">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;">Navigation</span>
          <svg id="vn-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c8dcea" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .2s;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div id="vn-body">
        <div><span id="vn-date-label" style="color:#c8dcea">Dernière position</span>&nbsp;&nbsp;<strong id="vn-date">—</strong></div>
        <div id="vn-ago" style="color:#c8dcea;font-size:11px;line-height:1.3;margin:-2px 0 2px 0;">—</div>
        <div><span style="color:#c8dcea">Temps</span>&nbsp;<strong id="vn-elapsed">—</strong></div>
        <div><span style="color:#c8dcea">Distance</span>&nbsp;<strong id="vn-miles">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">nm</span></div>
        <div><span style="color:#c8dcea">Vitesse</span>&nbsp;&nbsp;<strong id="vn-sog">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">kn</span></div>
        <div><span style="color:#c8dcea">Vent</span>&nbsp;&nbsp;<strong id="vn-tws">—</strong>&nbsp;<span style="color:#c8dcea;font-size:11px">kn</span></div>
        </div>
        `;
      bottomLeftContainer.appendChild(navPanel);

      const vnHeader = navPanel.querySelector("#vn-header");
      const vnBody   = navPanel.querySelector("#vn-body");
      const vnIcon   = navPanel.querySelector("#vn-toggle-icon");
      // Sur mobile, le panneau démarre replié (seul le titre est visible).
      if (isMobile) {
        vnBody.style.display   = "none";
        vnIcon.style.transform = "rotate(-90deg)";
      }
      vnHeader.addEventListener("click", () => {
        const collapsed = vnBody.style.display === "none";
        vnBody.style.display   = collapsed ? "" : "none";
        vnIcon.style.transform = collapsed ? "rotate(0deg)" : "rotate(-90deg)";
      });
    }

    function formatElapsed(ms) {
      if (!ms || ms < 0) return "—";
      const totalMin = Math.floor(ms / 60000);
      const days  = Math.floor(totalMin / 1440);
      const hours = Math.floor((totalMin % 1440) / 60);
      const mins  = totalMin % 60;
      if (days > 0) return `${days}j ${String(hours).padStart(2,"0")}h${String(mins).padStart(2,"0")}m`;
      return `${String(hours).padStart(2,"0")}h${String(mins).padStart(2,"0")}m`;
    }

    const DISTANCE_OFFSET_NM = 150;

    // "il y a 12 min", "il y a 3 h", "il y a 2 j"
    function formatAgo(ms) {
      if (!isFinite(ms)) return "—";
      if (ms < 0) ms = 0;
      const min = Math.floor(ms / 60000);
      if (min < 1)   return "à l'instant";
      if (min < 60)  return `il y a ${min} min`;
      const h = Math.floor(min / 60);
      if (h < 48)    return `il y a ${h} h`;
      return `il y a ${Math.floor(h / 24)} j`;
    }

    // Ligne "il y a …" : seulement quand le curseur est sur la dernière position
    let navLastPointMs = null;
    function updateNavAgo() {
      const agoEl = document.getElementById("vn-ago");
      if (!agoEl) return;
      if (navLastPointMs === null) { agoEl.style.display = "none"; return; }
      agoEl.style.display = "";
      agoEl.textContent = formatAgo(Date.now() - navLastPointMs);
    }
    setInterval(updateNavAgo, 60000); // se met à jour toute seule chaque minute

    function updateNavPanel(p, miles, isLast = true) {
      if (!navPanel || !p) return;
      const d = new Date(p.time);
      const dateStr = d.toLocaleString("fr-FR", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC"
      }) + " UTC";
      document.getElementById("vn-date").textContent    = dateStr;
      const dateLbl = document.getElementById("vn-date-label");
      if (dateLbl) dateLbl.textContent = isLast ? "Dernière position" : "Date";
      navLastPointMs = isLast ? p.timestampMs : null;
      updateNavAgo();
      document.getElementById("vn-sog").textContent     = isFinite(p.sog)    ? p.sog.toFixed(1)    : "—";
      document.getElementById("vn-tws").textContent     = isFinite(p.tws)    ? p.tws.toFixed(1)    : "—";

      const elapsedEl = document.getElementById("vn-elapsed");
      if (elapsedEl) {
        const elapsed = p.timestampMs - DEPARTURE_MS;
        elapsedEl.textContent = formatElapsed(elapsed);
      }

      const milesEl = document.getElementById("vn-miles");
      if (milesEl) {
        if (miles !== undefined && miles > 0) {
          milesEl.textContent = (miles + DISTANCE_OFFSET_NM).toFixed(1);
        } else {
          milesEl.textContent = "—";
        }
      }

      navPanel.style.display = "block";
    }

    /* ===================== PANNEAU SCIENCE ===================== */

    const sciRows = [
  { keys: ["hypernet"],                   label: "Station hyperspectrale",            color: SCIENCE_PT.hypernet.color,    type: "dot"  },
  { keys: ["net"],                         label: "Station biologie",                  color: SCIENCE_PT.net.color,         type: "dot"  },
  { keys: ["ctd_profile","ctd_intercomp"], label: "Station CTD température-salinité",  color: SCIENCE_PT.ctd_profile.color, type: "dot"  },
  { keys: ["inline"],                      label: "Pompage CO2-chlorophylle (en continu)", color: SCIENCE_CT.inline.color,   type: "line" },
  { keys: ["ctd_keel"],                    label: "CTD sur la quille (en continu)",    color: SCIENCE_CT.ctd_keel.color,    type: "line" }
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

      let html = `
        <div id="sci-header" style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;user-select:none;margin-bottom:8px;">
          <span style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#c8dcea;">Science</span>
          <svg id="sci-toggle-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#c8dcea" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition:transform .2s;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div id="sci-body">`;
      sciRows.forEach((row, ri) => {
        let swatch;
        if (row.type === "dot") {
          const strokeColor = lightenColor(row.color, 0.45);
          swatch = `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;
            background:${row.color};margin-right:7px;flex-shrink:0;vertical-align:middle;
            border:1.5px solid ${strokeColor}"></span>`;
        } else if (row.keys.includes("ctd_keel")) {
          // trait blanc avec un fin trait bleu au milieu (comme sur la carte)
          swatch = `<span style="display:inline-block;width:16px;height:4px;background:#ffffff;
            border-radius:2px;margin-right:7px;flex-shrink:0;vertical-align:middle;
            position:relative;"><span style="position:absolute;left:0;right:0;top:1.25px;height:1.5px;
            background:${row.color};"></span></span>`;
        } else {
          swatch = `<span style="display:inline-block;width:16px;height:3px;background:${row.color};
            border-radius:2px;margin-right:7px;flex-shrink:0;vertical-align:middle;"></span>`;
        }
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
      html += `</div>`;
      sciPanel.innerHTML = html;
      bottomLeftContainer.appendChild(sciPanel);

      const sciHeader = sciPanel.querySelector("#sci-header");
      const sciBody   = sciPanel.querySelector("#sci-body");
      const sciIcon   = sciPanel.querySelector("#sci-toggle-icon");
      // Sur mobile, le panneau démarre replié (seul le titre est visible).
      if (isMobile) {
        sciBody.style.display  = "none";
        sciIcon.style.transform = "rotate(-90deg)";
      }
      sciHeader.addEventListener("click", () => {
        const collapsed = sciBody.style.display === "none";
        sciBody.style.display  = collapsed ? "" : "none";
        sciIcon.style.transform = collapsed ? "rotate(0deg)" : "rotate(-90deg)";
      });

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

      Object.keys(SCIENCE_CT).forEach(k => {
        const src = map.getSource(`sci-ct-${k}`);
        if (src) src.setData(sciVis[k] ? buildContGeoJSON(slice, k) : EMPTY_FC);
      });

      // Hypernet : points espacés d'1 mille nautique, avec repli sur
      // station_hyp quand "hypernet on/off" n'a pas été loggé.
      const srcH = map.getSource("sci-pt-hypernet");
      if (srcH) srcH.setData(sciVis.hypernet ? buildHypernetGeoJSON(slice) : EMPTY_FC);

      const srcN = map.getSource("sci-pt-net");
      // Station biologie : 1 point à chaque "station bio on"
      if (srcN) srcN.setData(sciVis.net ? buildPtGeoJSON(slice, ["station_bio"]) : EMPTY_FC);

      const srcC = map.getSource("sci-pt-ctd");
      if (srcC) srcC.setData(sciVis.ctd_profile ? buildPtGeoJSON(slice, ["ctd_profile","ctd_intercomp"]) : EMPTY_FC);
    }

    function renderAll() { renderTrack(); renderScience(); }

    function updateBoatUI() {
      if (!hourlyPts.length) return;
      const p = hourlyPts[sliderIdx];
      if (boatMarker) boatMarker.setLngLat([p.lon, p.lat]);

      if (boatMarker && window._velaComputeBearing) {
        let bearing = 90;
        if (sliderIdx > 0) {
          const prev = hourlyPts[sliderIdx - 1];
          bearing = window._velaComputeBearing(prev.lat, prev.lon, p.lat, p.lon);
        }
        const boatEl = boatMarker.getElement().firstElementChild;
        if (boatEl) boatEl.style.transform = `rotate(${bearing}deg)`;
      }

      const milesDone = milesAtTimestamp(p.timestampMs);
      updateNavPanel(p, milesDone, sliderIdx >= hourlyPts.length - 1);

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

    /* ===================== DISTANCES ===================== */

    let cumDist = [];

    function buildCumDist(pts) {
      const d = new Array(pts.length).fill(0);
      for (let i = 1; i < pts.length; i++) {
        const seg = haversine_nm_js(pts[i-1].lat, pts[i-1].lon, pts[i].lat, pts[i].lon);
        d[i] = d[i-1] + seg;
      }
      return d;
    }

    function milesAtTimestamp(cutMs) {
      if (!allPoints.length || !cumDist.length) return 0;
      let lo = 0; let hi = allPoints.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (allPoints[mid].timestampMs <= cutMs) lo = mid; else hi = mid - 1;
      }
      return cumDist[lo];
    }

    /* ===================== COORDS AT TIMESTAMP ===================== */

    function coordsAtTimestamp(tsIsoOrMs) {
      if (!allPoints.length) return null;
      const ms = typeof tsIsoOrMs === "number" ? tsIsoOrMs : new Date(tsIsoOrMs).getTime();
      let lo = 0, hi = allPoints.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (allPoints[mid].timestampMs <= ms) lo = mid; else hi = mid - 1;
      }
      if (lo < allPoints.length - 1) {
        const dLo = Math.abs(allPoints[lo].timestampMs - ms);
        const dHi = Math.abs(allPoints[lo + 1].timestampMs - ms);
        if (dHi < dLo) lo = lo + 1;
      }
      return [allPoints[lo].lon, allPoints[lo].lat];
    }
    window._velaCoordsAtTimestamp = coordsAtTimestamp;

    /* ===================== REFRESH ===================== */

    let refreshing = false;

    // Affiche un nouveau jeu de points (trace, science, bateau, panneau nav)
    function applyPoints(res) {
        // Garder la position du curseur si l'utilisateur remonte le temps
        const wasAtEnd = !hourlyPts.length || sliderIdx >= hourlyPts.length - 1;
        const prevMs   = hourlyPts.length ? hourlyPts[sliderIdx].timestampMs : null;

        allPoints = res.livePoints;
        cumDist   = buildCumDist(allPoints);
        hourlyPts = buildHourly(allPoints);

        if (wasAtEnd || prevMs === null) {
          sliderIdx = Math.max(hourlyPts.length - 1, 0);
        } else {
          let i = 0;
          while (i < hourlyPts.length - 1 && hourlyPts[i + 1].timestampMs <= prevMs) i++;
          sliderIdx = i;
        }

        if (slider) { slider.max = Math.max(hourlyPts.length - 1, 0); slider.value = sliderIdx; }

        renderAll();
        updateBoatUI();

        window.dispatchEvent(new Event("velacarto:pointsready"));
    }

    async function refreshLiveTrack() {
      if (refreshing) return;          // évite 2 rafraîchissements en parallèle
      refreshing = true;
      try {
        const res = await loadAllTrackPoints();
        if (res) applyPoints(res);     // null = rien n'a changé sur GitHub
      } catch(e) {
        console.warn("Refresh trace :", e);
      } finally {
        refreshing = false;
      }
    }

    /* ===================== MAP LOAD ===================== */

    map.on("load", async () => {

      // Chlorophylle / température : chargées à la demande (au 1er clic sur
      // le bouton du fond), et insérées sous la trace — voir ensureOverlay().
      // Vent : ajouté APRÈS la trace (voir plus bas), c'est la couche la plus lourde.

      function addWindLayer() {
        try {
          if (map.getLayer("wind-layer")) return;
          if (map.getLayer("Water")) {
            map.setPaintProperty("Water", "fill-color", "rgba(0,0,0,0.2)");
            map.addLayer(windLayer, "Water");
          } else {
            map.addLayer(windLayer);
          }
        } catch(e) { console.warn("Couche vent :", e); }
        setBaseLayer(activeBaseLayer); // applique la visibilité du fond choisi
      }

      // Synchronise l'état visuel du sélecteur avec les couches (Vent actif par défaut)
      setBaseLayer(activeBaseLayer);

      /* ---- Tracé principal ---- */
      map.addSource("vela-live-track", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "vela-live-track-line", type: "line", source: "vela-live-track",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": TRACK_WIDTH, "line-opacity": 1 }
      });

      /* ---- Layers science continues ---- */
      Object.entries(SCIENCE_CT).forEach(([k, cfg]) => {
        map.addSource(`sci-ct-${k}`, { type: "geojson", data: EMPTY_FC });
        map.addLayer({
          id: `sci-ct-${k}-line`, type: "line", source: `sci-ct-${k}`,
          layout: { "line-join": "round", "line-cap": "round" },
          // CTD quille : trait bleu FIN au milieu de la trace blanche.
          // Pompage inline : trait épais (inchangé). La CTD est ajoutée après
          // l'inline, donc son trait bleu reste visible par-dessus.
          paint: k === "ctd_keel"
            ? { "line-color": cfg.color, "line-width": CTD_KEEL_WIDTH, "line-opacity": 1 }
            : { "line-color": cfg.color, "line-width": isMini ? 3 : 5, "line-opacity": 0.9 }
        });
      });

      /* ---- Hypernet : clustering natif MapTiler/MapLibre ---- */
      // Au dézoom : 1 point représentatif par groupe (cluster)
      // Au zoom élevé (> clusterMaxZoom) : tous les points individuels
      map.addSource("sci-pt-hypernet", {
        type: "geojson",
        data: EMPTY_FC,
        cluster: true,
        clusterMaxZoom: 5,   // au-dessus du zoom 5 → points individuels
        clusterRadius: 20    // rayon serré : ~1 point par jour visible au zoom initial
      });

      // Cercle cluster (dézoom) — représente un groupe de points
      map.addLayer({
        id: "sci-pt-hypernet-cluster", type: "circle", source: "sci-pt-hypernet",
        filter: ["has", "point_count"],
        paint: {
          "circle-radius"        : isMini ? 3 : 4,
          "circle-color"         : SCIENCE_PT.hypernet.color,
          "circle-stroke-width"  : 1.5,
          "circle-stroke-color"  : STROKE_COLORS.hypernet
        }
      });

      // Points individuels : visibles à TOUS les zooms. Au dézoom, un point
      // isolé (qui n'appartient à aucun groupe) n'est pas un cluster : il
      // doit donc être dessiné ici, sinon il disparaît (ancien bug :
      // minzoom 6 + opacité 0 au zoom 6, alors que la carte démarre au zoom 5).
      map.addLayer({
        id: "sci-pt-hypernet-circle", type: "circle", source: "sci-pt-hypernet",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius"        : isMini ? 3 : 4,
          "circle-color"         : SCIENCE_PT.hypernet.color,
          "circle-stroke-width"  : 1.5,
          "circle-stroke-color"  : STROKE_COLORS.hypernet
        }
      });

      /* ---- Station Biologie — pas de cluster, toujours visible ---- */
      map.addSource("sci-pt-net", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "sci-pt-net-circle", type: "circle", source: "sci-pt-net",
        paint: {
          "circle-radius"        : isMini ? 3 : 4,
          "circle-color"         : SCIENCE_PT.net.color,
          "circle-stroke-width"  : 1.5,
          "circle-stroke-color"  : STROKE_COLORS.net
        }
      });

      /* ---- Station CTD ---- */
      map.addSource("sci-pt-ctd", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "sci-pt-ctd-circle", type: "circle", source: "sci-pt-ctd",
        paint: {
          "circle-radius"        : isMini ? 3 : 4,
          "circle-color"         : SCIENCE_PT.ctd_profile.color,
          "circle-stroke-width"  : 1.5,
          "circle-stroke-color"  : STROKE_COLORS.ctd_profile
        }
      });
      /* ===================== MARQUEUR BATEAU ===================== */

      const boatSize = isMini ? 30 : 45;

      const boatEl = document.createElement("div");
      Object.assign(boatEl.style, {
        width          : boatSize + "px",
        height         : boatSize + "px",
        pointerEvents  : "none",
        transformOrigin: "center center",
        transition     : "transform 0.5s cubic-bezier(0.25, 0.8, 0.25, 1)"
      });

      const boatImg = document.createElement("img");
      boatImg.src = "https://raw.githubusercontent.com/velalabasso/carto-wix/main/voilier.png?v=" + Date.now();
      boatImg.alt = "voilier";
      Object.assign(boatImg.style, {
        width     : "100%",
        height    : "100%",
        objectFit : "contain",
        display   : "block",
        filter    : "drop-shadow(0 2px 4px rgba(0,0,0,0.5))"
      });
      boatImg.onerror = () => console.error("❌ voilier.png non chargé :", boatImg.src);
      boatImg.onload  = () => console.log("✅ voilier.png chargé :", boatImg.src);
      boatEl.appendChild(boatImg);

      boatEl.style.transform = "rotate(90deg)";

      boatMarker = new maptilersdk.Marker({ element: boatEl, anchor: "center" })
        .setLngLat(fallbackCenter).addTo(map);

      function computeBearing(lat1, lon1, lat2, lon2) {
        const toRad = d => d * Math.PI / 180;
        const toDeg = r => r * 180 / Math.PI;
        const dLon  = toRad(lon2 - lon1);
        const y = Math.sin(dLon) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
                - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
        return (toDeg(Math.atan2(y, x)) + 360 + 90) % 360;
      }
      window._velaComputeBearing = computeBearing;

      /* ---- Blog markers ---- */
      if (window.VelaBlog && window.VelaBlog.init) {
        window.VelaBlog.init(map, isMini);
      } else {
        window.addEventListener("velablog:ready", () => window.VelaBlog.init(map, isMini), { once: true });
      }

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
      // 1) Affichage immédiat de la trace gardée par le navigateur (visite précédente)
      try {
        const cached = await loadTrackFromBrowserCache();
        if (cached && cached.livePoints.length) applyPoints(cached);
      } catch(e) { console.warn("Cache navigateur :", e); }

      // 2) Vérification GitHub en arrière-plan ; le vent démarre dès que la
      //    trace est là (ou au bout de 1,5 s au plus tard)
      const firstRefresh = refreshLiveTrack();
      await Promise.race([firstRefresh, new Promise(r => setTimeout(r, 1500))]);
      addWindLayer();
      await firstRefresh;

      if (enableAutoRefresh && refreshMs > 0) window.setInterval(refreshLiveTrack, refreshMs);

      // Fonds chlorophylle / température : données quotidiennes, on ne les
      // recharge que toutes les heures, et seulement s'ils ont déjà été ouverts.
      if (enableAutoRefresh) {
        window.setInterval(() => {
          ["chloro", "sst"].forEach(k => { if (overlayState[k]) ensureOverlay(k, true); });
        }, OVERLAY_REFRESH_MS);
      }
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