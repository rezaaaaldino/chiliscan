# 🌶️ ChiliScan — Deteksi Penyakit Daun Cabai

Aplikasi web berbasis AI untuk mendeteksi penyakit pada daun cabai menggunakan model YOLOv8.

---

## 📁 Struktur Project

```
chili_app/
├── backend/
│   ├── main.py               # FastAPI server
│   ├── requirements.txt      # Dependensi Python
│   ├── rekomendasi.json      # Data rekomendasi penyakit
│   ├── model_3kelas.pt       # ← Letakkan model Anda di sini
│   └── model_4kelas.pt       # ← Letakkan model Anda di sini
└── frontend/
    ├── index.html
    ├── style.css
    └── script.js
```

---

## ⚙️ Cara Menjalankan

### 1. Persiapan Model

Salin file model YOLOv8 Anda ke folder `backend/`:
- `model_3kelas.pt`
- `model_4kelas.pt`

### 2. Setup Backend

```bash
# Masuk ke folder backend
cd backend

# (Opsional) Buat virtual environment
python -m venv venv

# Aktifkan venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependensi
pip install -r requirements.txt

# Jalankan server FastAPI
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Server akan berjalan di: **http://localhost:8000**

### 3. Buka Frontend

Buka file `frontend/index.html` di browser:
- Double-click `index.html`, **atau**
- Gunakan ekstensi **Live Server** di VS Code

### 4. Gunakan Aplikasi

1. Pilih model (3 kelas / 4 kelas)
2. Upload foto daun cabai
3. Klik **Mulai Deteksi**
4. Lihat hasil bounding box + rekomendasi

---

## 🏷️ Kelas yang Didukung

| Kelas        | Keterangan                    |
|--------------|-------------------------------|
| DaunSehat    | Daun cabai dalam kondisi sehat|
| HamaThrips   | Serangan hama Thrips          |
| VirusKuning  | Virus Gemini / Kuning         |
| BercakDaun   | Jamur Cercospora (model 4k)   |

---

## 🔌 API Endpoint

| Method | Endpoint  | Keterangan              |
|--------|-----------|-------------------------|
| GET    | `/`       | Health check server     |
| POST   | `/predict`| Prediksi gambar daun    |

### POST `/predict` — Parameter

| Field           | Tipe   | Keterangan                       |
|-----------------|--------|----------------------------------|
| `file`          | File   | Gambar daun cabai (JPG/PNG)      |
| `model_type`    | String | `"3"` atau `"4"`                 |
| `conf_threshold`| Float  | Ambang kepercayaan (default 0.5) |

---

## 🛠️ Teknologi

- **Backend**: Python, FastAPI, Ultralytics YOLOv8, OpenCV
- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **AI Model**: YOLOv8 (custom trained)

---

## ❓ Troubleshooting

**Error: "Tidak dapat terhubung ke server"**
→ Pastikan backend sudah berjalan (`uvicorn main:app --reload`)

**Error: "Model tidak tersedia"**
→ Pastikan file `.pt` sudah ada di folder `backend/`

**Gambar tidak terdeteksi**
→ Coba gambar dengan kualitas lebih baik atau ubah sudut pengambilan
