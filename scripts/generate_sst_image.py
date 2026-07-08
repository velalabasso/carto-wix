#!/usr/bin/env python3
"""
Génère une image PNG de température de surface (SST) à partir de
Copernicus Marine Service (produit SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001,
dataset "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2", système OSTIA du UK Met
Office, variable analysed_sst en Kelvin).

Ce produit est L4 "gap-free" (interpolé, sans trous liés aux nuages),
résolution ~0.05° (~5-6 km), quotidien, quasi temps-réel.

Remplace l'ancien layer WMS NASA GIBS (GHRSST_L4_MUR_Sea_Surface_Temperature)
qui posait deux problèmes : GetFeatureInfo non supporté par GIBS (donc
aucune lecture de valeur possible), et impossibilité de récupérer le fichier
de légende officiel pour une colorbar exacte. En générant nous-mêmes
l'image, on contrôle la palette (donc colorbar garantie cohérente) et on
peut exporter une grille de valeurs consultable, exactement comme pour la
chlorophylle.

Sortie :
  sst/sst_latest.png   - image RGBA, fond transparent
  sst/sst_latest.json  - bornes géographiques réelles (west/east/south/north)
  sst/sst_latest_grid.json - grille de valeurs sous-échantillonnée (°C),
                             pour la lecture au survol côté vela-carto.js

Authentification Copernicus Marine via variables d'environnement
(GitHub Secrets, jamais committées) :
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
# CONFIG — cohérent avec la zone utilisée pour la chlorophylle
# =========================================================

DATASET_ID = "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2"
VARIABLE   = "analysed_sst"  # en Kelvin dans le fichier source

MIN_LON, MAX_LON = -180.0, 180.0
MIN_LAT, MAX_LAT = -85.0, 85.0

# Échelle linéaire (°C) — cohérente avec SST_VMIN/SST_VMAX dans vela-carto.js
VMIN, VMAX = 0.0, 30.0

# Palette bleu (froid) -> rouge (chaud), ColorBrewer "RdBu" (schéma standard,
# reconnu, pas une invention) — mêmes couleurs que la colorbar JS.
SST_COLORS = ["#08306b", "#2166ac", "#67a9cf", "#d1e5f0", "#fddbc7", "#ef8a62", "#b2182b"]

OUTPUT_DIR  = "sst"
OUTPUT_PNG  = os.path.join(OUTPUT_DIR, "sst_latest.png")
OUTPUT_META = os.path.join(OUTPUT_DIR, "sst_latest.json")
OUTPUT_GRID = os.path.join(OUTPUT_DIR, "sst_latest_grid.json")
TMP_NC      = "sst_subset.nc"


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

    da = ds[VARIABLE].isel(time=-1)
    used_time = str(ds["time"].isel(time=-1).values)
    print(f"  Pas de temps utilisé : {used_time}")

    lat_name = "latitude" if "latitude" in da.coords else "lat"
    lon_name = "longitude" if "longitude" in da.coords else "lon"

    # Ordre croissant forcé (voir note dans generate_chlorophyll_image.py) —
    # élimine toute ambiguïté d'orientation nord/sud.
    da = da.sortby(lat_name).sortby(lon_name)

    lats = da[lat_name].values
    lons = da[lon_name].values
    data_kelvin = np.asarray(da.values, dtype="float64")

    # Kelvin -> Celsius
    data = data_kelvin - 273.15
    print(f"  Lat : {lats.min():.3f} -> {lats.max():.3f} (croissant, {len(lats)} pts)")
    print(f"  Lon : {lons.min():.3f} -> {lons.max():.3f} (croissant, {len(lons)} pts)")
    print(f"  SST : {np.nanmin(data):.2f} -> {np.nanmax(data):.2f} °C")

    # Grille native (avant ré-échantillonnage Mercator) conservée pour
    # l'export "valeur au survol".
    data_native = data.copy()

    # =====================================================
    # RÉ-ÉCHANTILLONNAGE EN MERCATOR (voir generate_chlorophyll_image.py
    # pour l'explication complète du pourquoi)
    # =====================================================
    def lat_to_merc_y(lat_deg):
        lat_rad = np.radians(np.clip(lat_deg, -85.05112878, 85.05112878))
        return np.log(np.tan(np.pi / 4 + lat_rad / 2))

    merc_y_src     = lat_to_merc_y(lats)
    merc_y_uniform = np.linspace(merc_y_src[0], merc_y_src[-1], len(lats))

    data_merc = np.empty_like(data)
    for j in range(data.shape[1]):
        data_merc[:, j] = np.interp(
            merc_y_uniform, merc_y_src, data[:, j],
            left=np.nan, right=np.nan
        )
    data = data_merc

    norm = mcolors.Normalize(vmin=VMIN, vmax=VMAX, clip=True)  # linéaire, pas log
    cmap = mcolors.LinearSegmentedColormap.from_list("sst_rdbu", SST_COLORS)
    cmap.set_bad(alpha=0)

    height_px = data.shape[0]
    width_px  = data.shape[1]
    dpi = 100
    fig = plt.figure(figsize=(width_px / dpi, height_px / dpi), dpi=dpi)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_axis_off()
    ax.imshow(data, cmap=cmap, norm=norm, origin="lower", aspect="auto")
    fig.patch.set_alpha(0)
    fig.savefig(OUTPUT_PNG, transparent=True, dpi=dpi)
    plt.close(fig)

    # =====================================================
    # GRILLE DE VALEURS (lecture au survol)
    # =====================================================
    MAX_GRID_POINTS = 200
    stride_lat = max(1, len(lats) // MAX_GRID_POINTS)
    stride_lon = max(1, len(lons) // MAX_GRID_POINTS)
    grid_lats = lats[::stride_lat]
    grid_lons = lons[::stride_lon]
    grid_vals = data_native[::stride_lat, ::stride_lon]

    def round_or_null(v):
        return None if (v is None or np.isnan(v)) else round(float(v), 2)

    grid = {
        "lats": [round(float(v), 4) for v in grid_lats],
        "lons": [round(float(v), 4) for v in grid_lons],
        "values": [[round_or_null(v) for v in row] for row in grid_vals],
        "unit": "degC",
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
