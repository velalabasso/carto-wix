/* =============================================================
   velacarto_blog.js — Markers blog pour VelaCarto
   Déposer dans le même répertoire GitHub que velacarto.js
   Charger AVANT ou APRÈS velacarto.js (l'ordre n'importe pas).

   Pour ajouter un marker :
   - dupliquer un objet dans le tableau BLOG_MARKERS ci-dessous
   - renseigner coords OU timestamp (pas besoin des deux)
   - si timestamp est renseigné, les coords sont calculées
     automatiquement depuis les données GPS du bateau
   ============================================================= */

window.VelaBlog = (function () {

  /* ===================== DONNÉES ===================== */
  // coords   : [longitude, latitude] — fixe, ou null si on utilise timestamp
  // timestamp: ISO UTC — la position sera résolue depuis les CSV du bateau
  // image    : URL de l'image de couverture ("" pour aucune image)

  const BLOG_MARKERS = [
    {
      coords   : [9.10300, 43.75930],
      timestamp: null,
      title    : "Déploiement & récupération flotteurs Argo BGC",
      date     : "10 février 2026",
      url      : "https://www.velalab.org/post/d%C3%A9ploiement-et-r%C3%A9cup%C3%A9ration-flotteurs-argo-bgc",
      image    : "https://static.wixstatic.com/media/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg/v1/fill/w_1480,h_826,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/7feff5_c18dc3b52408486f8352495eec46247f~mv2.jpg",
      excerpt  : "Quelques jours de navigation dans le Golfe de Gênes! Au programme, un déploiement de flotteur Argo en collaboration avec le laboratoire de Villefranche-sur-Mer."
    },
    {
      coords   : null,
      timestamp: "2026-04-25T18:32:00Z",   // position calculée depuis les CSV
      title    : "Derniers tests et préparatifs",
      date     : "25 avril 2026",
      url      : "https://www.velalab.org/post/derniers-tests-et-pr%C3%A9paratifs",
      image    : "https://static.wixstatic.com/media/7feff5_189527ebedfb4892a159d8eeb8ea310d~mv2.jpg/v1/fill/w_305,h_229,fp_0.50_0.50,q_90,enc_avif,quality_auto/7feff5_189527ebedfb4892a159d8eeb8ea310d~mv2.jpg",
      excerpt  : "Derniers préparatifs avant le grand départ — tests des équipements scientifiques et mise en route de l'expédition."
    }
  ];

  /* ===================== CRÉATION D'UN MARKER ===================== */

  function createBlogMarker(map, isMini, coords, props) {
    const bSize = isMini ? 14 : 20;

    const dotEl = document.createElement("div");
    dotEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${bSize}" height="${Math.round(bSize * 1.35)}" viewBox="0 0 20 27">
        <path d="M10,1 C5.5,1 2,4.5 2,9 C2,15 10,26 10,26 C10,26 18,15 18,9 C18,4.5 14.5,1 10,1 Z"
          fill="rgba(95,125,149,0.85)" stroke="white" stroke-width="1.2"/>
        <circle cx="10" cy="9" r="3.5" fill="rgba(255,255,255,0.9)"/>
      </svg>`;
    Object.assign(dotEl.style, {
      width         : bSize + "px",
      height        : Math.round(bSize * 1.35) + "px",
      cursor        : "pointer",
      pointerEvents : "auto",
      filter        : "drop-shadow(0 2px 3px rgba(0,0,0,0.4))"
    });

    new maptilersdk.Marker({ element: dotEl, anchor: "bottom" })
      .setLngLat(coords)
      .addTo(map);

    const popup = document.createElement("div");
    Object.assign(popup.style, {
      position     : "absolute",
      background   : "white",
      padding      : "8px",
      borderRadius : "10px",
      boxShadow    : "0 4px 12px rgba(0,0,0,0.3)",
      maxWidth     : isMini ? "190px" : "220px",
      minWidth     : isMini ? "160px" : "180px",
      display      : "none",
      zIndex       : "9999",
      fontFamily   : "Helvetica, Arial, sans-serif",
      color        : "#333"
    });
    popup.innerHTML = `
      <div style="text-align:left;">
        <h2 style="font-family:Helvetica,Arial;color:#5F7D95;margin:0 0 6px 0;font-size:${isMini ? "13px" : "16px"};">${props.title}</h2>
        <div style="color:gray;font-size:12px;margin-bottom:10px;">${props.date}</div>
        ${props.image ? `<img src="${props.image}" style="width:100%;height:auto;border-radius:6px;margin-bottom:8px;">` : ""}
        <p style="font-size:12px;line-height:1.4;margin-bottom:10px;">${props.excerpt}</p>
        <a href="${props.url}" target="_blank"
          style="display:inline-block;text-decoration:none;background:#5F7D95;color:white;padding:8px 14px;border-radius:20px;font-size:14px;">
          Lire l'article</a>
      </div>`;
    document.body.appendChild(popup);

    function positionPopup() {
      const px = map.project(coords);
      const h = popup.offsetHeight, w = popup.offsetWidth, m = 12;
      const vw = window.innerWidth, vh = window.innerHeight;
      if (px.y - h - m > 0)   { popup.style.top = (px.y - h - m - 25) + "px"; popup.style.left = (px.x - w / 2) + "px"; return; }
      if (px.y + h + m < vh)  { popup.style.top = (px.y + 5) + "px";           popup.style.left = (px.x - w / 2) + "px"; return; }
      if (px.x + w + m < vw)  { popup.style.top = (px.y - h / 2) + "px";       popup.style.left = (px.x + m) + "px";     return; }
      if (px.x - w - m > 0)   { popup.style.top = (px.y - h / 2) + "px";       popup.style.left = (px.x - w - m) + "px"; return; }
      popup.style.top = m + "px"; popup.style.left = m + "px";
    }

    let vis = false;
    dotEl.addEventListener("mouseenter", () => { popup.style.display = "block"; vis = true; positionPopup(); });
    dotEl.addEventListener("mouseleave", () => { setTimeout(() => { if (!popup.matches(":hover")) { popup.style.display = "none"; vis = false; } }, 100); });
    popup.addEventListener("mouseenter", () => { popup.style.display = "block"; });
    popup.addEventListener("mouseleave", () => { popup.style.display = "none"; vis = false; });
    map.on("move", () => { if (vis) positionPopup(); });
  }

  /* ===================== RÉSOLUTION DES TIMESTAMPS ===================== */

  // Sépare les markers en deux groupes :
  // - ceux avec coords fixes → placés immédiatement au init()
  // - ceux avec timestamp   → placés après réception de "velacarto:pointsready"

  function placeAll(map, isMini, markers) {
    markers.forEach(m => {
      const coords = m.coords || (window._velaCoordsAtTimestamp && window._velaCoordsAtTimestamp(m.timestamp));
      if (coords) {
        createBlogMarker(map, isMini, coords, m);
      } else {
        console.warn("[VelaBlog] Coordonnées introuvables pour :", m.title);
      }
    });
  }

  /* ===================== API PUBLIQUE ===================== */

  function init(map, isMini = false) {
    const fixed      = BLOG_MARKERS.filter(m => m.coords);
    const withTs     = BLOG_MARKERS.filter(m => !m.coords && m.timestamp);

    // Markers à coords fixes : placés immédiatement
    placeAll(map, isMini, fixed);

    // Markers avec timestamp : attendre que les points GPS soient chargés
    if (withTs.length) {
      if (window._velaCoordsAtTimestamp) {
        // Les points sont déjà disponibles (velacarto_blog.js chargé après)
        placeAll(map, isMini, withTs);
      } else {
        // Attendre l'événement émis par refreshLiveTrack()
        window.addEventListener("velacarto:pointsready", () => {
          placeAll(map, isMini, withTs);
        }, { once: true });
      }
    }
  }

  // Signale que le script est prêt
  window.dispatchEvent(new Event("velablog:ready"));

  return { init };
})();
