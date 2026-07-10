#!/usr/bin/env python3
"""
Génère une image PNG de chlorophylle de surface à partir de Copernicus
Marine Service (produit OCEANCOLOUR_GLO_BGC_L4_NRT_009_102, dataset
"cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D", variable CHL).

Ce produit est du "L4 gap-free" : interpolé spatio-temporellement par
Copernicus pour combler les trous dus aux nuages — contrairement au L2 de
la NASA GIBS, qui est un passage satellite brut.

Sortie :
  chlorophyll/chlorophyll_latest.png   - image RGBA, fond transparent
  chlorophyll/chlorophyll_latest.json  - bornes géographiques réelles de
                                          l'image (west/east/south/north),
                                          utilisées par vela-carto.js pour
                                          positionner l'image sur la carte.

Authentification Copernicus Marine via variables d'environnement
(définies comme GitHub Secrets dans le workflow, jamais committées) :
  COPERNICUSMARINE_SERVICE_USERNAME
  COPERNICUSMARINE_SERVICE_PASSWORD
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np
import xarray as xr
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

import copernicusmarine

# =========================================================
# CONFIG — à ajuster selon la zone de navigation de ZOPA
# =========================================================

DATASET_ID = "cmems_obs-oc_glo_bgc-plankton_nrt_l4-gapfree-multi-4km_P1D"
VARIABLE   = "CHL"

# Zone géographique couverte par l'image (Méditerranée -> traversée
# Atlantique -> Caraïbes, cohérent avec le tracé pointillé annexe de la
# carte). À élargir/rétrécir si besoin — impacte la taille du fichier PNG.
MIN_LON, MAX_LON = -150.0, 150.0
MIN_LAT, MAX_LAT = -65.0, 65.0

# Échelle de couleur (mg/m3), log car la concentration varie sur plusieurs
# ordres de grandeur entre eaux oligotrophes et zones côtières riches.
VMIN, VMAX = 0.01, 10.0

# Palette "ocean color" NASA/SeaWiFS EXACTE (230 couleurs), extraite de la
# fonction chl_pal() du package R "palr" (AustralianAntarcticDivision/palr,
# R/palr.R), elle-même dérivée du fichier NASA original
# 'http://oceancolor.gsfc.nasa.gov/DOCS/palette_chl_etc.txt'.
# Couleurs uniformément espacées en échelle log sur [VMIN, VMAX] = [0.01, 10].
NASA_CHL_COLORS = [
    "#90006F", "#8D0072", "#8A0075", "#870078", "#84007B", "#81007E", "#7E0081", "#7B0084", "#780087", "#75008A",
    "#72008D", "#6F0090", "#6C0093", "#690096", "#660099", "#63009C", "#60009F", "#5D00A2", "#5A00A5", "#5700A8",
    "#5400AB", "#5100AE", "#4E00B1", "#4B00B4", "#4800B7", "#4500BA", "#4200BD", "#3F00C0", "#3C00C3", "#3900C6",
    "#3600C9", "#3300CC", "#3000CF", "#2D00D2", "#2A00D5", "#2700D8", "#2400DB", "#2100DE", "#1E00E1", "#1B00E4",
    "#1800E7", "#1500EA", "#1200ED", "#0F00F0", "#0C00F3", "#0900F6", "#0600F9", "#0000FC", "#0000FF", "#0005FF",
    "#000AFF", "#0010FF", "#0015FF", "#001AFF", "#0020FF", "#0025FF", "#002AFF", "#0030FF", "#0035FF", "#003AFF",
    "#0040FF", "#0045FF", "#004AFF", "#0050FF", "#0055FF", "#005AFF", "#0060FF", "#0065FF", "#006AFF", "#0070FF",
    "#0075FF", "#007AFF", "#0080FF", "#0085FF", "#008AFF", "#0090FF", "#0095FF", "#009AFF", "#00A0FF", "#00A5FF",
    "#00AAFF", "#00B0FF", "#00B5FF", "#00BAFF", "#00C0FF", "#00C5FF", "#00CAFF", "#00D0FF", "#00D5FF", "#00DAFF",
    "#00E0FF", "#00E5FF", "#00EAFF", "#00F0FF", "#00F5FF", "#00FAFF", "#00FFFF", "#00FFF7", "#00FFEF", "#00FFE7",
    "#00FFDF", "#00FFD7", "#00FFCF", "#00FFC7", "#00FFBF", "#00FFB7", "#00FFAF", "#00FFA7", "#00FF9F", "#00FF97",
    "#00FF8F", "#00FF87", "#00FF7F", "#00FF77", "#00FF6F", "#00FF67", "#00FF5F", "#00FF57", "#00FF4F", "#00FF47",
    "#00FF3F", "#00FF37", "#00FF2F", "#00FF27", "#00FF1F", "#00FF17", "#00FF0F", "#00FF00", "#08FF00", "#10FF00",
    "#18FF00", "#20FF00", "#28FF00", "#30FF00", "#38FF00", "#40FF00", "#48FF00", "#50FF00", "#58FF00", "#60FF00",
    "#68FF00", "#70FF00", "#78FF00", "#80FF00", "#88FF00", "#90FF00", "#98FF00", "#A0FF00", "#A8FF00", "#B0FF00",
    "#B8FF00", "#C0FF00", "#C8FF00", "#D0FF00", "#D8FF00", "#E0FF00", "#E8FF00", "#F0FF00", "#F8FF00", "#FFFF00",
    "#FFFB00", "#FFF700", "#FFF300", "#FFEF00", "#FFEB00", "#FFE700", "#FFE300", "#FFDF00", "#FFDB00", "#FFD700",
    "#FFD300", "#FFCF00", "#FFCB00", "#FFC700", "#FFC300", "#FFBF00", "#FFBB00", "#FFB700", "#FFB300", "#FFAF00",
    "#FFAB00", "#FFA700", "#FFA300", "#FF9F00", "#FF9B00", "#FF9700", "#FF9300", "#FF8F00", "#FF8B00", "#FF8700",
    "#FF8300", "#FF7F00", "#FF7B00", "#FF7700", "#FF7300", "#FF6F00", "#FF6B00", "#FF6700", "#FF6300", "#FF5F00",
    "#FF5B00", "#FF5700", "#FF5300", "#FF4F00", "#FF4B00", "#FF4700", "#FF4300", "#FF3F00", "#FF3B00", "#FF3700",
    "#FF3300", "#FF2F00", "#FF2B00", "#FF2700", "#FF2300", "#FF1F00", "#FF1B00", "#FF1700", "#FF1300", "#FF0F00",
    "#FF0B00", "#FF0700", "#FF0300", "#FF0000", "#FA0000", "#F50000", "#F00000", "#EB0000", "#E60000", "#E10000",
]


OUTPUT_DIR  = "chlorophyll"
OUTPUT_PNG  = os.path.join(OUTPUT_DIR, "chlorophyll_latest.png")
OUTPUT_META = os.path.join(OUTPUT_DIR, "chlorophyll_latest.json")
OUTPUT_GRID = os.path.join(OUTPUT_DIR, "chlorophyll_latest_grid.json")
TMP_NC      = "chl_subset.nc"


def main():
    username = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME")
    password = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD")
    if not username or not password:
        print("ERREUR : identifiants Copernicus Marine manquants "
              "(variables d'environnement COPERNICUSMARINE_SERVICE_USERNAME / "
              "COPERNICUSMARINE_SERVICE_PASSWORD).")
        sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    now = datetime.now(timezone.utc)
    # Fenêtre de quelques jours en arrière : le produit NRT a parfois un
    # léger délai de publication, on prend le dernier pas de temps
    # réellement disponible dans cette fenêtre plutôt que de viser "hier"
    # à l'aveugle.
    start = now - timedelta(days=5)

    print(f"Téléchargement Copernicus Marine : {DATASET_ID} / {VARIABLE}")
    print(f"  Fenêtre temporelle : {start.date()} -> {now.date()}")
    print(f"  Zone : lon [{MIN_LON}, {MAX_LON}]  lat [{MIN_LAT}, {MAX_LAT}]")

    if os.path.exists(TMP_NC):
        os.remove(TMP_NC)

    copernicusmarine.subset(
        dataset_id=DATASET_ID,
        variables=[VARIABLE],
        minimum_longitude=MIN_LON,
        maximum_longitude=MAX_LON,
        minimum_latitude=MIN_LAT,
        maximum_latitude=MAX_LAT,
        start_datetime=start.strftime("%Y-%m-%dT00:00:00"),
        end_datetime=now.strftime("%Y-%m-%dT23:59:59"),
        output_filename=TMP_NC,
        output_directory=".",
        username=username,
        password=password,
        overwrite=True,
    )

    if not os.path.exists(TMP_NC):
        print("ERREUR : le fichier NetCDF n'a pas été téléchargé.")
        sys.exit(1)

    ds = xr.open_dataset(TMP_NC)

    if "time" not in ds[VARIABLE].dims or ds.sizes.get("time", 0) == 0:
        print("ERREUR : aucun pas de temps disponible dans la fenêtre demandée.")
        sys.exit(1)

    # Dernier pas de temps disponible = donnée la plus récente publiée
    da = ds[VARIABLE].isel(time=-1)
    used_time = str(ds["time"].isel(time=-1).values)
    print(f"  Pas de temps utilisé : {used_time}")

    lat_name = "latitude" if "latitude" in da.coords else "lat"
    lon_name = "longitude" if "longitude" in da.coords else "lon"

    # On force l'ordre croissant (sud -> nord, ouest -> est) plutôt que de
    # deviner l'orientation native du fichier : ça élimine toute ambiguïté
    # de flip nord/sud à l'affichage, quelle que soit la convention du
    # dataset source.
    da = da.sortby(lat_name).sortby(lon_name)

    lats = da[lat_name].values
    lons = da[lon_name].values
    data = np.asarray(da.values, dtype="float64")
    print(f"  Lat : {lats.min():.3f} -> {lats.max():.3f} (croissant, {len(lats)} pts)")
    print(f"  Lon : {lons.min():.3f} -> {lons.max():.3f} (croissant, {len(lons)} pts)")

    # Écrase les valeurs <= 0 (invalides pour une échelle log) en NaN
    data = np.where(data > 0, data, np.nan)

    # Grille native (avant ré-échantillonnage Mercator) conservée pour
    # l'export "valeur au survol" — indexée en lat/lon réelles, pas en
    # espace Mercator (ce qui serait inutile pour retrouver une valeur à
    # une position GPS donnée).
    data_native = data.copy()

    # =====================================================
    # RÉ-ÉCHANTILLONNAGE EN MERCATOR
    # =====================================================
    # MapLibre ImageSource étire l'image entre 4 coins en projection Web
    # Mercator. Notre grille source est uniforme en degrés de latitude
    # ("plate carrée"), alors qu'en Mercator l'espacement vertical entre
    # deux mêmes degrés de latitude augmente avec la distance à l'équateur.
    # Sans correction, l'image se désaligne progressivement en s'éloignant
    # de l'équateur (nul à l'équateur, croissant vers les pôles) — c'est
    # exactement le décalage observé. On corrige en ré-échantillonnant
    # l'axe latitude pour qu'il soit uniforme en Y-Mercator plutôt qu'en
    # degrés, colonne par colonne (interpolation linéaire).
    def lat_to_merc_y(lat_deg):
        lat_rad = np.radians(np.clip(lat_deg, -85.05112878, 85.05112878))
        return np.log(np.tan(np.pi / 4 + lat_rad / 2))

    merc_y_src     = lat_to_merc_y(lats)                      # croissant (lats croissant)
    merc_y_uniform = np.linspace(merc_y_src[0], merc_y_src[-1], len(lats))

    data_merc = np.empty_like(data)
    for j in range(data.shape[1]):
        data_merc[:, j] = np.interp(
            merc_y_uniform, merc_y_src, data[:, j],
            left=np.nan, right=np.nan
        )
    data = data_merc

    norm = mcolors.LogNorm(vmin=VMIN, vmax=VMAX, clip=True)
    # Palette EXACTE "ocean color" NASA/SeaWiFS (230 couleurs), extraite de
    # la fonction chl_pal() du package R palr, elle-même dérivée du fichier
    # source NASA originel (oceancolor.gsfc.nasa.gov/DOCS/palette_chl_etc.txt).
    # Les couleurs sont déjà uniformément espacées en échelle log sur
    # [0.01, 10] mg/m3 — cohérent avec LogNorm(VMIN, VMAX) ci-dessus et avec
    # la colorbar affichée dans vela-carto.js.
    cmap = mcolors.ListedColormap(NASA_CHL_COLORS)
    cmap.set_bad(alpha=0)  # NaN (terre, pas de donnée) -> transparent

    height_px = data.shape[0]
    width_px  = data.shape[1]
    dpi = 100
    fig = plt.figure(figsize=(width_px / dpi, height_px / dpi), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    # origin="lower" : la ligne 0 du tableau (lat la plus petite, donc sud,
    # puisqu'on a trié en croissant juste au-dessus) est peinte en bas de
    # l'image — cohérent avec des coordonnées [west,north]/[east,south]
    # passées à MapLibre ImageSource.
    ax.imshow(
        data, cmap=cmap, norm=norm,
        origin="lower",
        aspect="auto",
    )
    fig.patch.set_alpha(0)
    fig.savefig(OUTPUT_PNG, transparent=True, dpi=dpi)
    plt.close(fig)

    # =====================================================
    # GRILLE DE VALEURS (pour affichage "valeur au survol" côté carte,
    # comme le widget du vent). Sous-échantillonnée pour rester légère —
    # une lecture approximative suffit pour ce type d'indicateur.
    # =====================================================
    MAX_GRID_POINTS = 200
    stride_lat = max(1, len(lats) // MAX_GRID_POINTS)
    stride_lon = max(1, len(lons) // MAX_GRID_POINTS)
    grid_lats = lats[::stride_lat]
    grid_lons = lons[::stride_lon]
    grid_vals = data_native[::stride_lat, ::stride_lon]

    def round_or_null(v):
        return None if (v is None or np.isnan(v)) else round(float(v), 3)

    grid = {
        "lats": [round(float(v), 4) for v in grid_lats],
        "lons": [round(float(v), 4) for v in grid_lons],
        # values[i][j] correspond à lats[i] / lons[j]
        "values": [[round_or_null(v) for v in row] for row in grid_vals],
        "unit": "mg/m3",
    }
    with open(OUTPUT_GRID, "w") as f:
        json.dump(grid, f)
    print(f"  Grille valeurs : {len(grid_lats)} x {len(grid_lons)} points -> {OUTPUT_GRID}")

    meta = {
        "west": float(lons.min()),
        "east": float(lons.max()),
        "south": float(lats.min()),
        "north": float(lats.max()),
        "generated_at": now.isoformat(),
        "data_time": used_time,
        "dataset_id": DATASET_ID,
    }
    with open(OUTPUT_META, "w") as f:
        json.dump(meta, f, indent=2)

    ds.close()
    if os.path.exists(TMP_NC):
        os.remove(TMP_NC)

    print("OK :", OUTPUT_PNG)
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
