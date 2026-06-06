/* =============================================================
   velacarto_blog.js — Markers blog pour VelaCarto
   Déposer dans le même répertoire GitHub que velacarto.js

   Pour ajouter un marker :
   - dupliquer un objet dans BLOG_MARKERS
   - coords fixes  → renseigner coords: [lon, lat], laisser timestamp: null
   - position GPS  → laisser coords: null, renseigner timestamp: "YYYY-MM-DDTHH:MM:SSZ"
     (la position est résolue depuis les CSV une fois les données chargées)
   ============================================================= */

window.VelaBlog = (function () {

  /* ===================== DONNÉES ===================== */

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
      timestamp: "2026-04-25T18:32:00Z",
      title    : "Derniers tests et préparatifs",
      date     : "25 avril 2026",
      url      : "https://www.velalab.org/post/derniers-tests-et-pr%C3%A9paratifs",
      image    : "https://static.wixstatic.com/media/7feff5_189527ebedfb4892a159d8eeb8ea310d~mv2.jpg/v1/fill/w_305,h_229,fp_0.50_0.50,q_90,enc_avif,quality_auto/7feff5_189527ebedfb4892a159d8eeb8ea310d~mv2.jpg",
      excerpt  : "Derniers préparatifs avant le grand départ, tests des équipements scientifiques et mise en route de l'expédition."
    },
    {
      coords   : null,
      timestamp: "2026-05-18T14:06:00Z",
      title    : "Premiers milles, premières galères",
      date     : "18 mai 2026",
      url      : "https://www.velalab.org/post/premiers-milles-premi%C3%A8res-gal%C3%A8res",
      image    : "https://static.wixstatic.com/media/7feff5_76cd0830c1274586875d5e664d388d2b~mv2.jpeg",
      excerpt  : "Derniers adieux sur le quai, les amarres sont larguées, notre nouvelle trinquette bretonne et la grand-voile sont hissées."
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
        ${props.image
          ? `<img src="${props.image}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;margin-bottom:8px;">`
          : ""}
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

  /* ===================== API PUBLIQUE ===================== */

  // map et isMini sont stockés à l'appel de init(),
  // puis utilisés dès que les points GPS sont disponibles.
  let _map    = null;
  let _isMini = false;

  function placeFixed() {
    BLOG_MARKERS
      .filter(m => m.coords)
      .forEach(m => createBlogMarker(_map, _isMini, m.coords, m));
  }

  function placeTimestamped() {
    BLOG_MARKERS
      .filter(m => !m.coords && m.timestamp)
      .forEach(m => {
        const coords = window._velaCoordsAtTimestamp
          ? window._velaCoordsAtTimestamp(m.timestamp)
          : null;
        if (coords) {
          createBlogMarker(_map, _isMini, coords, m);
        } else {
          console.warn("[VelaBlog] Aucun point GPS trouvé pour le timestamp :", m.timestamp);
        }
      });
  }

  function init(map, isMini) {
    _map    = map;
    _isMini = isMini || false;

    // Markers à coords fixes : placés immédiatement
    placeFixed();

    // Markers avec timestamp : placés dès que les CSV sont chargés.
    // On écoute toujours l'événement — il est émis par refreshLiveTrack()
    // après chaque chargement, donc on { once: true } pour n'agir qu'une fois.
    window.addEventListener("velacarto:pointsready", placeTimestamped, { once: true });
  }

  // Signale que ce script est prêt (pour velacarto.js s'il est chargé avant)
  window.dispatchEvent(new Event("velablog:ready"));

  return { init };
})();
