window.VelaCarto = {
  init: async function(options = {}) {
    const mode = options.mode || "full";
    const isMini = mode === "mini";

    maptilersdk.config.apiKey = "OGxkSige7vgEEaQoKmhu";

    /* ===================== CONFIG GITHUB ===================== */

    const repoOwner = "velalabasso";
    const repoName = "zopa";
    const branch = "main";

    const cacheBuster = `v=${Date.now()}`;

    const fallbackCenter = [7.3367184670459835, 43.589687317520685];

    const mainTrackPath = "track_velalab.csv";

    const fallbackNmeaCsvPaths = [
      "nmea_logs/nmea_2026-05-04_20-55-03/nmea_2026-05-04_20-55-03.csv"
    ];

    const githubTreeUrl =
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/${branch}?recursive=1&${cacheBuster}`;

    function githubRawUrl(path) {
      const encodedPath = path
        .split("/")
        .map(part => encodeURIComponent(part))
        .join("/");

      return `https://raw.githubusercontent.com/${repoOwner}/${repoName}/${branch}/${encodedPath}?${cacheBuster}`;
    }

    async function fetchText(url) {
      try {
        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) {
          console.warn("Impossible de charger :", url, response.status);
          return "";
        }

        return await response.text();

      } catch (error) {
        console.warn("Erreur chargement :", url, error);
        return "";
      }
    }

    /* ===================== OUTILS CSV ===================== */

    function splitCSVLine(line, delimiter) {
      const result = [];
      let current = "";
      let insideQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"' && nextChar === '"') {
          current += '"';
          i++;
          continue;
        }

        if (char === '"') {
          insideQuotes = !insideQuotes;
          continue;
        }

        if (char === delimiter && !insideQuotes) {
          result.push(current.trim());
          current = "";
          continue;
        }

        current += char;
      }

      result.push(current.trim());
      return result;
    }

    function detectDelimiter(lines) {
      const sample = lines.slice(0, 5).join("\n");
      const delimiters = [";", ",", "\t"];

      let bestDelimiter = ";";
      let bestCount = 0;

      delimiters.forEach(delimiter => {
        const count = sample.split(delimiter).length - 1;

        if (count > bestCount) {
          bestCount = count;
          bestDelimiter = delimiter;
        }
      });

      return bestDelimiter;
    }

    function normalizeHeaderName(value) {
      return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
    }

    function findColumnIndex(headers, candidates) {
      const normalizedHeaders = headers.map(normalizeHeaderName);
      const normalizedCandidates = candidates.map(normalizeHeaderName);

      return normalizedHeaders.findIndex(header =>
        normalizedCandidates.includes(header)
      );
    }

    function parseNumber(value) {
      if (value === undefined || value === null) return NaN;

      return parseFloat(
        String(value)
          .trim()
          .replace(/^"|"$/g, "")
          .replace(",", ".")
      );
    }

    function parseTimestamp(value) {
      if (!value) return null;

      let text = String(value)
        .trim()
        .replace(/^"|"$/g, "");

      if (!text) return null;

      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) {
        text = text.replace(" ", "T");
      }

      const hasTimezone =
        /z$/i.test(text) ||
        /[+-]\d{2}:?\d{2}$/.test(text);

      const isoCandidate = hasTimezone ? text : `${text}Z`;
      const date = new Date(isoCandidate);

      if (Number.isNaN(date.getTime())) return null;

      return {
        ms: date.getTime(),
        iso: date.toISOString()
      };
    }

    function parseTrackCSV(csvText, sourceName = "csv") {
      if (!csvText || !csvText.trim()) return [];

      const lines = csvText
        .replace(/^\uFEFF/, "")
        .trim()
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      if (!lines.length) return [];

      const delimiter = detectDelimiter(lines);
      const firstRow = splitCSVLine(lines[0], delimiter);

      const lonIndexFromHeader = findColumnIndex(firstRow, [
        "longitude",
        "lon",
        "lng",
        "long"
      ]);

      const latIndexFromHeader = findColumnIndex(firstRow, [
        "latitude",
        "lat"
      ]);

      const timeIndexFromHeader = findColumnIndex(firstRow, [
        "timestamp",
        "time",
        "datetime",
        "date"
      ]);

      let lonIndex = lonIndexFromHeader;
      let latIndex = latIndexFromHeader;
      let timeIndex = timeIndexFromHeader;
      let dataLines = lines;

      const hasCorrectHeader =
        lonIndex !== -1 &&
        latIndex !== -1 &&
        timeIndex !== -1;

      if (hasCorrectHeader) {
        dataLines = lines.slice(1);
      } else {
        // Sécurité pour un fichier sans header :
        // longitude ; latitude ; timestamp
        lonIndex = 0;
        latIndex = 1;
        timeIndex = 2;

        const testCells = splitCSVLine(lines[0], delimiter);
        const testLon = parseNumber(testCells[lonIndex]);
        const testLat = parseNumber(testCells[latIndex]);
        const testTime = parseTimestamp(testCells[timeIndex]);

        const looksLikeValidData =
          Number.isFinite(testLon) &&
          Number.isFinite(testLat) &&
          testTime;

        if (!looksLikeValidData) {
          console.warn("CSV ignoré car mauvais format :", sourceName);
          console.warn("Première ligne détectée :", lines[0]);
          return [];
        }
      }

      const points = dataLines
        .map(line => {
          const cells = splitCSVLine(line, delimiter);

          const lon = parseNumber(cells[lonIndex]);
          const lat = parseNumber(cells[latIndex]);
          const parsedTime = parseTimestamp(cells[timeIndex]);

          if (!parsedTime) return null;

          return {
            lon,
            lat,
            time: parsedTime.iso,
            timestampMs: parsedTime.ms,
            source: sourceName
          };
        })
        .filter(point =>
          point &&
          Number.isFinite(point.lon) &&
          Number.isFinite(point.lat) &&
          point.lon >= -180 &&
          point.lon <= 180 &&
          point.lat >= -90 &&
          point.lat <= 90
        )
        .sort((a, b) => a.timestampMs - b.timestampMs);

      console.log("CSV parsé :", sourceName, "=>", points.length, "points");

      return points;
    }

    function pointsToLineFeature(points, sourceName) {
      if (!points.length) return null;

      let coordinates = points.map(point => [point.lon, point.lat]);

      if (coordinates.length === 1) {
        coordinates = [coordinates[0], coordinates[0]];
      }

      return {
        type: "Feature",
        properties: {
          source: sourceName,
          timestamps: points.map(point => point.time)
        },
        geometry: {
          type: "LineString",
          coordinates: coordinates
        }
      };
    }

    async function getNmeaCsvInfos() {
      try {
        const response = await fetch(githubTreeUrl, { cache: "no-store" });

        if (!response.ok) {
          console.warn("Impossible de lire automatiquement nmea_logs. Utilisation du fichier de secours.");
          return fallbackNmeaCsvPaths.map(path => ({
            path,
            url: githubRawUrl(path)
          }));
        }

        const data = await response.json();

        const detectedPaths = data.tree
          .filter(item => {
            if (item.type !== "blob") return false;

            const path = item.path;
            const lowerPath = path.toLowerCase();
            const fileName = path.split("/").pop().toLowerCase();

            return (
              path.startsWith("nmea_logs/") &&
              lowerPath.endsWith(".csv") &&
              !lowerPath.endsWith(".csv.gz") &&
              !lowerPath.includes(".gz") &&
              !lowerPath.endsWith(".txt") &&
              !lowerPath.endsWith(".xlsx") &&
              !fileName.startsWith("~") &&
              !fileName.startsWith(".") &&
              !fileName.includes("~lock")
            );
          })
          .map(item => item.path);

        const allPaths = Array.from(new Set([
          ...detectedPaths,
          ...fallbackNmeaCsvPaths
        ]));

        return allPaths.map(path => ({
          path,
          url: githubRawUrl(path)
        }));

      } catch (error) {
        console.warn("Erreur GitHub API :", error);

        return fallbackNmeaCsvPaths.map(path => ({
          path,
          url: githubRawUrl(path)
        }));
      }
    }

    /* ===================== CHARGEMENT TRACK PRINCIPALE ===================== */

    const mainTrackUrl = githubRawUrl(mainTrackPath);
    const mainTrackText = await fetchText(mainTrackUrl);
    const mainTrackPoints = parseTrackCSV(mainTrackText, mainTrackPath);

    const mainTrackFeature = pointsToLineFeature(mainTrackPoints, mainTrackPath);

    const mainTrackGeoJSON = {
      type: "FeatureCollection",
      features: mainTrackFeature ? [mainTrackFeature] : []
    };

    /* ===================== CHARGEMENT NMEA LOGS CSV ===================== */

    const nmeaCsvInfos = await getNmeaCsvInfos();

    const nmeaTrackResults = await Promise.all(
      nmeaCsvInfos.map(async info => {
        const text = await fetchText(info.url);
        const points = parseTrackCSV(text, info.path);

        return {
          path: info.path,
          url: info.url,
          points
        };
      })
    );

    const nmeaFeatures = nmeaTrackResults
      .map(result => pointsToLineFeature(result.points, result.path))
      .filter(Boolean);

    const nmeaTrackGeoJSON = {
      type: "FeatureCollection",
      features: nmeaFeatures
    };

    const nmeaTrackPoints = nmeaTrackResults.flatMap(result => result.points);

    /* ===================== TIMELINE POUR LE MARQUEUR ===================== */

    const timelinePoints = [
      ...mainTrackPoints,
      ...nmeaTrackPoints
    ].sort((a, b) => a.timestampMs - b.timestampMs);

    const lastPoint = timelinePoints.length
      ? timelinePoints[timelinePoints.length - 1]
      : null;

    const lastCoord = lastPoint
      ? [lastPoint.lon, lastPoint.lat]
      : fallbackCenter;

    console.log("===== VELA CARTO DEBUG =====");
    console.log("URL track principale :", mainTrackUrl);
    console.log("Points track_velalab.csv :", mainTrackPoints.length);
    console.log("Fichiers CSV NMEA trouvés :", nmeaCsvInfos.map(info => info.path));
    console.table(
      nmeaTrackResults.map(result => ({
        fichier: result.path,
        points: result.points.length
      }))
    );
    console.log("Nombre de traces NMEA affichées :", nmeaFeatures.length);
    console.log("Points NMEA :", nmeaTrackPoints.length);
    console.log("Dernier point affiché :", lastCoord);
    console.log("Dernier timestamp :", lastPoint ? lastPoint.time : "Aucune donnée GPS");
    console.log("============================");

    /* ===================== MAP ===================== */

    const map = new maptilersdk.Map({
      container: "map",
      style: maptilersdk.MapStyle.BACKDROP,
      center: lastCoord,
      zoom: isMini ? 3.5 : 5
    });

    /* ===================== WIND LAYER ===================== */

    const customColoramp = new maptilerweather.ColorRamp({
      stops: [
        { value: 0, color: [98,113,183,255] },
        { value: 1, color: [57,97,159,255] },
        { value: 3, color: [74,148,169,255] },
        { value: 5, color: [77,141,123,255] },
        { value: 7, color: [83,165,83,255] },
        { value: 9, color: [53,159,53,255] },
        { value: 11, color: [167,157,81,255] },
        { value: 13, color: [159,127,58,255] },
        { value: 15, color: [161,108,92,255] },
        { value: 17, color: [129,58,78,255] },
        { value: 19, color: [175,80,136,255] },
        { value: 21, color: [117,74,147,255] },
        { value: 24, color: [109,97,163,255] },
        { value: 27, color: [68,105,141,255] },
        { value: 29, color: [92,144,152,255] },
        { value: 36, color: [125,68,165,255] },
        { value: 46, color: [231,215,215,255] },
        { value: 51, color: [219,212,135,255] },
        { value: 77, color: [205,202,112,255] },
        { value: 104, color: [128,128,128,255] }
      ]
    });

    const windLayer = new maptilerweather.WindLayer({
      colorramp: customColoramp
    });

    /* ===================== UI ===================== */

    const variableName = document.getElementById("variable-name");
    const pointerData = document.getElementById("pointer-data");
    const slider = document.getElementById("time-slider");
    const timeLabel = document.getElementById("time-label");
    const legend = document.getElementById("legend");

    if (slider) {
      slider.max = Math.max(timelinePoints.length - 1, 0);
    }

    if (isMini) {
      if (slider) slider.style.display = "none";
      if (timeLabel) timeLabel.style.display = "none";
      if (legend) legend.style.display = "none";

      if (variableName) variableName.style.fontSize = "14px";

      if (pointerData) {
        pointerData.style.fontSize = "14px";
        pointerData.style.top = "25px";
      }
    }

    function msToKnots(ms) {
      return ms * 1.943844;
    }

    map.on("mousemove", e => {
      if (!pointerData) return;

      const value = windLayer.pickAt(e.lngLat.lng, e.lngLat.lat);
      pointerData.innerText = value ? `${msToKnots(value.speedMetersPerSecond).toFixed(1)} kn` : "";
    });

    map.on("mouseout", () => {
      if (pointerData) pointerData.innerText = "";
    });

    let boatMarker = null;

    /* ===================== LOAD ===================== */

    map.on("load", async () => {
      try {
        if (map.getLayer("Water")) {
          map.setPaintProperty("Water", "fill-color", "rgba(0,0,0,0.2)");
          map.addLayer(windLayer, "Water");
        } else {
          map.addLayer(windLayer);
        }
      } catch (error) {
        console.warn("Impossible d'ajouter la couche vent :", error);
      }

      /* ===================== TRACE TRACK PRINCIPALE ===================== */

      map.addSource("main-track", {
        type: "geojson",
        data: mainTrackGeoJSON
      });

      map.addLayer({
        id: "main-track-line",
        type: "line",
        source: "main-track",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": isMini ? 2 : 3,
          "line-opacity": 1
        }
      });

      /* ===================== TRACE NMEA LOGS CSV ===================== */

      map.addSource("nmea-tracks", {
        type: "geojson",
        data: nmeaTrackGeoJSON
      });

      map.addLayer({
        id: "nmea-tracks-line",
        type: "line",
        source: "nmea-tracks",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": isMini ? 2 : 3,
          "line-opacity": 0.85
        }
      });

      /* ===================== MARQUEUR BATEAU HTML ===================== */

      const boatIcon = document.createElement("img");
      boatIcon.src = "https://static.wixstatic.com/media/7feff5_ab13f48be41c4214b141c562efbbb948~mv2.png";
      boatIcon.style.width = isMini ? "34px" : "46px";
      boatIcon.style.height = "auto";
      boatIcon.style.display = "block";
      boatIcon.style.pointerEvents = "none";

      boatMarker = new maptilersdk.Marker({
        element: boatIcon,
        anchor: "center"
      })
        .setLngLat(lastCoord)
        .addTo(map);

      /* ===================== BLOG MARKER FINAL ===================== */

      const blogFeature = {
        type: "Feature",
        properties: {
          title: "Déploiement & récupération flotteurs Argo BGC",
          date: "10 février 2026",
          url: "https://www.velalab.org/post/d%C3%A9ploiement-et-r%C3%A9cup%C3%A9ration-flotteurs-argo-bgc",
          image: "https://static.wixstatic.com/media/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg/v1/fill/w_1480,h_826,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg",
          excerpt: "Quelques jours de navigation dans le Golfe de Gênes! Au programme, un déploiement de flotteur Argo en collaboration avec le laboratoire de Villefranche-sur-Mer. "
        },
        geometry: {
          type: "Point",
          coordinates: [9.10300, 43.75930]
        }
      };

      const blogMarker = new maptilersdk.Marker({
        color: "#5F7D95",
        scale: isMini ? 0.6 : 0.8
      })
        .setLngLat(blogFeature.geometry.coordinates)
        .addTo(map);

      const popupDiv = document.createElement("div");
      popupDiv.style.position = "absolute";
      popupDiv.style.background = "white";
      popupDiv.style.padding = "8px";
      popupDiv.style.borderRadius = "10px";
      popupDiv.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
      popupDiv.style.maxWidth = isMini ? "190px" : "220px";
      popupDiv.style.minWidth = isMini ? "160px" : "180px";
      popupDiv.style.display = "none";
      popupDiv.style.zIndex = "9999";
      popupDiv.style.fontFamily = "Helvetica, Arial, sans-serif";
      popupDiv.style.color = "#333";
      document.body.appendChild(popupDiv);

      popupDiv.innerHTML = `
        <div style="text-align:left;">
          <h2 style="font-family:Helvetica, Arial; color:#5F7D95; margin:0 0 6px 0; font-size:${isMini ? "13px" : "16px"};">${blogFeature.properties.title}</h2>
          <div style="color:gray; font-size:12px; margin-bottom:10px;">${blogFeature.properties.date}</div>
          <img src="${blogFeature.properties.image}" style="width:100%; height:auto; border-radius:6px; margin-bottom:8px;">
          <p style="font-size:12px; line-height:1.4; margin-bottom:10px;">${blogFeature.properties.excerpt}</p>
          <a href="${blogFeature.properties.url}" target="_blank" style="
              display:inline-block;
              text-decoration:none;
              background:#5F7D95;
              color:white;
              padding:8px 14px;
              border-radius:20px;
              font-size:14px;
              text-align:center;">Lire l'article</a>
        </div>
      `;

      function updatePopupPosition() {
        const pixel = map.project(blogFeature.geometry.coordinates);
        const popupHeight = popupDiv.offsetHeight;
        const popupWidth = popupDiv.offsetWidth;

        const margin = 12;
        const extraOffsetTop = 25;
        const extraOffsetBottom = -5;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const fitsAbove = pixel.y - popupHeight - margin > 0;
        const fitsBelow = pixel.y + popupHeight + margin < vh;
        const fitsRight = pixel.x + popupWidth + margin < vw;
        const fitsLeft = pixel.x - popupWidth - margin > 0;

        if (fitsAbove) {
          popupDiv.style.top = pixel.y - popupHeight - margin - extraOffsetTop + "px";
          popupDiv.style.left = pixel.x - popupWidth / 2 + "px";
          return;
        }

        if (fitsBelow) {
          popupDiv.style.top = pixel.y - extraOffsetBottom + "px";
          popupDiv.style.left = pixel.x - popupWidth / 2 + "px";
          return;
        }

        if (fitsRight) {
          popupDiv.style.top = pixel.y - popupHeight / 2 + "px";
          popupDiv.style.left = pixel.x + margin + "px";
          return;
        }

        if (fitsLeft) {
          popupDiv.style.top = pixel.y - popupHeight / 2 + "px";
          popupDiv.style.left = pixel.x - popupWidth - margin + "px";
          return;
        }

        popupDiv.style.top = margin + "px";
        popupDiv.style.left = margin + "px";
      }

      let popupVisible = false;

      blogMarker.getElement().addEventListener("mouseenter", () => {
        popupDiv.style.display = "block";
        popupVisible = true;
        updatePopupPosition();
      });

      blogMarker.getElement().addEventListener("mouseleave", () => {
        setTimeout(() => {
          if (!popupDiv.matches(":hover")) {
            popupDiv.style.display = "none";
            popupVisible = false;
          }
        }, 100);
      });

      popupDiv.addEventListener("mouseenter", () => {
        popupDiv.style.display = "block";
      });

      popupDiv.addEventListener("mouseleave", () => {
        popupDiv.style.display = "none";
        popupVisible = false;
      });

      map.on("move", () => {
        if (popupVisible) updatePopupPosition();
      });

      /* ===================== TRACE ANNEXE ===================== */

      const extraTraceGeoJSON = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [7.329134737638213,43.585033001356976],
            [8.657799172621566,42.77632951286341],
            [8.307522409161805,42.299862929257756],
            [8.513473037729312,41.53343175463144],
            [7.7952165927658825,40.87667199422435],
            [8.024061230215835,39.98968061811033],
            [8.033602372020454,39.06508122106689],
            [8.946361973663016,38.4897881875103],
            [13.351851194007082,38.41307958339672],
            [15.030504575064668,38.39484925762733],
            [15.477007947186394,38.30022439574063],
            [15.919455684456949,37.201769818626204],
            [14.825142659366435,36.32362591043244],
            [11.978911802910176,37.696705067693216],
            [3.2066661868631456,39.09534081286651],
            [-2.030387890853632,36.27485691397],
            [-6.097071913998548,35.94482905527538],
            [-9.33003270561457,32.815527575300905],
            [-13.338855383669909,29.23885982779055],
            [-15.106053854239406,28.14348648516618],
            [-22.58869100509554,16.37352872021097],
            [-17.45163825620486,14.460440287821527],
            [-16.71964345844293,13.426946648259488],
            [-24.53258542184244,14.572063095902209],
            [-61.23018177575683,12.31166540947845],
            [-60.75258128216552,13.959924808563898],
            [-61.16506900477114,15.77131213200498],
            [-62.0645410043779,17.36841184865942],
            [-64.70143483161476,17.94023136074898],
            [-69.30483801896484,19.522070762366724],
            [-77.28243666698245,24.218244587247668],
            [-25.60540287081858,37.594620670395],
            [-16.896354409331423,32.71980573193002],
            [-6.064051514726884,35.98743815551846],
            [-5.268214670207783,36.03058227588072],
            [-2.021144987930171,36.46223740581938],
            [1.3107311462801192,39.16880208178074],
            [2.94502596439969,39.999852450571666],
            [5.862291078690532,42.98072176534109],
            [6.171643854171464,42.99986883032145],
            [6.617029299922223,43.12058120803994],
            [7.3367184670459835,43.589687317520685]
          ]
        }
      };

      map.addSource("extra-trace-line", {
        type: "geojson",
        data: extraTraceGeoJSON
      });

      map.addLayer({
        id: "extra-trace-line",
        type: "line",
        source: "extra-trace-line",
        layout: {
          "line-join": "round",
          "line-cap": "round"
        },
        paint: {
          "line-color": "#ffffff",
          "line-width": isMini ? 0.4 : 0.6,
          "line-opacity": 0.6,
          "line-dasharray": [4,6]
        }
      });

      if (slider) {
        slider.value = slider.max;
        slider.dispatchEvent(new Event("input"));
      }
    });

    /* ===================== SLIDER ===================== */

    if (slider) {
      slider.addEventListener("input", () => {
        if (!timelinePoints.length) return;

        const i = Number(slider.value);
        const point = timelinePoints[i];

        if (!point) return;

        const currentCoord = [point.lon, point.lat];

        if (timeLabel) {
          timeLabel.innerText = point.time || "";
        }

        if (boatMarker) {
          boatMarker.setLngLat(currentCoord);
        }
      });
    }
  }
};
