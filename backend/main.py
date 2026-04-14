"""
Backend FastAPI - Deteksi Penyakit Daun Cabai
Menggunakan YOLOv8 untuk inferensi gambar
"""

import io
import json
import base64
import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ultralytics import YOLO
from PIL import Image

# ─── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Path setup ─────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent
REKOMEN_PATH = BASE_DIR / "rekomendasi.json"
MODEL_3K_PATH = BASE_DIR / "model_3kelas.pt"
MODEL_4K_PATH = BASE_DIR / "model_4kelas.pt"

# ─── Warna bounding box per kelas ───────────────────────────────────────────
CLASS_COLORS = {
    "DaunSehat":  (34, 197, 94),    # hijau
    "HamaThrips": (251, 191, 36),   # kuning
    "VirusKuning":(239, 68, 68),    # merah
    "BercakDaun": (168, 85, 247),   # ungu
}
DEFAULT_COLOR = (99, 102, 241)

# ─── Load rekomendasi ────────────────────────────────────────────────────────
with open(REKOMEN_PATH, "r", encoding="utf-8") as f:
    REKOMENDASI: dict = json.load(f)

# ─── Load model ─────────────────────────────────────────────────────────────
models: dict[str, Optional[YOLO]] = {"3": None, "4": None}

def load_models():
    """Load kedua model YOLOv8 saat startup."""
    if MODEL_3K_PATH.exists():
        logger.info("Loading model 3 kelas...")
        models["3"] = YOLO(str(MODEL_3K_PATH))
        logger.info("Model 3 kelas berhasil dimuat.")
    else:
        logger.warning(f"Model 3 kelas tidak ditemukan: {MODEL_3K_PATH}")

    if MODEL_4K_PATH.exists():
        logger.info("Loading model 4 kelas...")
        models["4"] = YOLO(str(MODEL_4K_PATH))
        logger.info("Model 4 kelas berhasil dimuat.")
    else:
        logger.warning(f"Model 4 kelas tidak ditemukan: {MODEL_4K_PATH}")

load_models()

# ─── FastAPI App ─────────────────────────────────────────────────────────────
app = FastAPI(
    title="API Deteksi Penyakit Daun Cabai",
    description="Deteksi penyakit daun cabai menggunakan YOLOv8",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Helper: gambar bounding box ────────────────────────────────────────────
def draw_boxes(image_np: np.ndarray, detections: list[dict]) -> np.ndarray:
    """Gambar bounding box, label, dan confidence pada gambar."""
    img = image_np.copy()
    h, w = img.shape[:2]
    font_scale = max(0.5, min(w, h) / 800)
    thickness = max(2, int(min(w, h) / 300))

    for det in detections:
        x1, y1, x2, y2 = det["bbox"]
        label = det["label"]
        conf = det["confidence"]
        color = CLASS_COLORS.get(label, DEFAULT_COLOR)

        # Bounding box
        cv2.rectangle(img, (x1, y1), (x2, y2), color, thickness)

        # Label background
        text = f"{label} {conf:.0%}"
        (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)
        label_y = max(y1, th + 8)
        cv2.rectangle(img, (x1, label_y - th - 8), (x1 + tw + 6, label_y + baseline - 2), color, -1)
        cv2.putText(img, text, (x1 + 3, label_y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness)
    return img


def image_to_base64(image_np: np.ndarray) -> str:
    """Konversi numpy image ke base64 PNG string."""
    success, buffer = cv2.imencode(".jpg", image_np, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
    if not success:
        raise ValueError("Gagal mengenkode gambar.")
    return base64.b64encode(buffer).decode("utf-8")


# ─── Endpoint: /predict ──────────────────────────────────────────────────────
@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    model_type: str = Form("3"),
    conf_threshold: float = Form(0.5),
):
    """
    Jalankan inferensi YOLOv8 pada gambar yang diupload.

    - **file**: Gambar daun cabai (JPG/PNG)
    - **model_type**: "3" (3 kelas) atau "4" (4 kelas)
    - **conf_threshold**: Ambang batas confidence (default 0.5)
    """
    # Validasi model
    model = models.get(model_type)
    if model is None:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_type}' tidak tersedia. Pastikan file .pt sudah ada di folder backend.",
        )

    # Validasi file
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File harus berupa gambar (JPG/PNG).")

    # Baca gambar
    try:
        contents = await file.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
        image_np = cv2.cvtColor(np.array(pil_image), cv2.COLOR_RGB2BGR)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal membaca gambar: {str(e)}")

    # Inferensi
    try:
        results = model.predict(source=pil_image, conf=conf_threshold, verbose=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inferensi gagal: {str(e)}")

    # Parsing hasil
    detections: list[dict] = []
    result = results[0]

    if result.boxes is not None and len(result.boxes) > 0:
        for box in result.boxes:
            conf = float(box.conf[0])
            if conf < conf_threshold:
                continue
            cls_id = int(box.cls[0])
            label = model.names[cls_id]
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            detections.append({
                "label": label,
                "confidence": round(conf, 4),
                "bbox": [x1, y1, x2, y2],
            })

    # Gambar bounding box
    annotated = draw_boxes(image_np, detections)
    image_b64 = image_to_base64(annotated)

    # Label unik untuk rekomendasi
    unique_labels = list({d["label"] for d in detections})

    # Susun rekomendasi
    rekomen_list = []
    for lbl in unique_labels:
        if lbl in REKOMENDASI:
            rekomen_list.append({
                "label": lbl,
                **REKOMENDASI[lbl],
            })

    # Response hanya label + confidence (tanpa bbox)
    detections_out = [{"label": d["label"], "confidence": d["confidence"]} for d in detections]

    return JSONResponse({
        "success": True,
        "model_used": f"{model_type} kelas",
        "total_deteksi": len(detections),
        "detections": detections_out,
        "image_base64": image_b64,
        "rekomendasi": rekomen_list,
    })


# ─── Endpoint: /predict_realtime ─────────────────────────────────────────────
@app.post("/predict_realtime")
async def predict_realtime(
    file: UploadFile = File(...),
    model_type: str = Form("3"),
    conf_threshold: float = Form(0.5),
):
    """
    Endpoint khusus realtime — hanya mengembalikan koordinat bounding box
    (tanpa encode gambar ke base64), sehingga lebih cepat untuk loop kamera.

    Response: { success, detections: [{label, confidence, bbox:[x1,y1,x2,y2], color}] }
    """
    model = models.get(model_type)
    if model is None:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_type}' tidak tersedia.",
        )

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File harus berupa gambar.")

    try:
        contents = await file.read()
        pil_image = Image.open(io.BytesIO(contents)).convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal membaca gambar: {str(e)}")

    try:
        results = model.predict(source=pil_image, conf=conf_threshold, verbose=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inferensi gagal: {str(e)}")

    detections: list[dict] = []
    result = results[0]

    # Dapatkan dimensi asli gambar
    img_w, img_h = pil_image.size

    if result.boxes is not None and len(result.boxes) > 0:
        for box in result.boxes:
            conf = float(box.conf[0])
            if conf < conf_threshold:
                continue
            cls_id = int(box.cls[0])
            label = model.names[cls_id]
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            # Normalisasi koordinat ke [0..1] agar bisa scale ke ukuran canvas
            color = CLASS_COLORS.get(label, DEFAULT_COLOR)
            detections.append({
                "label": label,
                "confidence": round(conf, 4),
                "bbox": [x1, y1, x2, y2],
                "bbox_norm": [
                    round(x1 / img_w, 6),
                    round(y1 / img_h, 6),
                    round(x2 / img_w, 6),
                    round(y2 / img_h, 6),
                ],
                "color": f"rgb({color[0]},{color[1]},{color[2]})",
            })

    return JSONResponse({
        "success": True,
        "img_size": [img_w, img_h],
        "total_deteksi": len(detections),
        "detections": detections,
    })


# ─── Endpoint: health check ──────────────────────────────────────────────────
@app.get("/")
def root():
    return {
        "status": "ok",
        "model_3_kelas": "loaded" if models["3"] else "not found",
        "model_4_kelas": "loaded" if models["4"] else "not found",
    }
