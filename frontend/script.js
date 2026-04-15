/**
 * ChiliScan v2 — Frontend Script
 * Fitur: Upload foto + Kamera Realtime (bounding box langsung di canvas)
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = "https://168.110.195.174.sslip.io";

const CLASS_META = {
  DaunSehat:   { color: "#22c55e", emoji: "🌿", label: "Daun Sehat" },
  HamaThrips:  { color: "#facc15", emoji: "🪲", label: "Hama Thrips" },
  VirusKuning: { color: "#ef4444", emoji: "🦠", label: "Virus Kuning" },
  BercakDaun:  { color: "#a855f7", emoji: "🍂", label: "Bercak Daun" },
};
const DEFAULT_META = { color: "#6366f1", emoji: "❓", label: "Tidak Diketahui" };

// ─── State ────────────────────────────────────────────────────────────────────
let selectedFile    = null;
let activeTab       = "upload";

let cameraStream    = null;
let facingMode      = "environment";
let realtimeActive  = false;
let isProcessing    = false;

// State realtime overlay
let lastDetections  = [];   // bbox terakhir dari API
let rafHandle       = null; // requestAnimationFrame handle
let lastSendTime    = 0;    // timestamp terakhir kirim ke API
let sendInterval    = 300;  // ms antara pengiriman ke API (~3fps)

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const uploadZone        = document.getElementById("uploadZone");
const fileInput         = document.getElementById("fileInput");
const uploadPlaceholder = document.getElementById("uploadPlaceholder");
const uploadPreview     = document.getElementById("uploadPreview");
const previewImg        = document.getElementById("previewImg");
const btnRemove         = document.getElementById("btnRemove");
const btnPredict        = document.getElementById("btnPredict");
const loadingOverlay    = document.getElementById("loadingOverlay");
const loadingTitle      = document.getElementById("loadingTitle");
const errorBanner       = document.getElementById("errorBanner");
const errorMsg          = document.getElementById("errorMsg");
const resultsSection    = document.getElementById("resultsSection");
const resultsMeta       = document.getElementById("resultsMeta");
const resultImage       = document.getElementById("resultImage");
const detectionList     = document.getElementById("detectionList");
const rekomendasiSection= document.getElementById("rekomendasiSection");

const cameraVideo       = document.getElementById("cameraVideo");
const overlayCanvas     = document.getElementById("overlayCanvas");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const realtimeBadge     = document.getElementById("realtimeBadge");
const realtimeControl   = document.getElementById("realtimeControl");
const btnStartCamera    = document.getElementById("btnStartCamera");
const btnStopCamera     = document.getElementById("btnStopCamera");
const btnFlipCamera     = document.getElementById("btnFlipCamera");
const btnSnapshot       = document.getElementById("btnSnapshot");
const toggleRealtime    = document.getElementById("toggleRealtime");

// ─── Tab Switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.getElementById("panelUpload").style.display = tab === "upload" ? "flex" : "none";
  document.getElementById("panelCamera").style.display = tab === "camera" ? "flex" : "none";
  document.getElementById("tabUpload").classList.toggle("active", tab === "upload");
  document.getElementById("tabCamera").classList.toggle("active", tab === "camera");
  if (tab === "upload") stopCamera();
  hideError();
  hideResults();
}
window.switchTab = switchTab;

// ─── Upload ───────────────────────────────────────────────────────────────────
uploadZone.addEventListener("click", (e) => { if (e.target !== btnRemove) fileInput.click(); });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault(); uploadZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) handleFile(file);
  else showError("File bukan gambar. Gunakan JPG, PNG, atau WEBP.");
});
btnRemove.addEventListener("click", (e) => { e.stopPropagation(); clearFile(); });

function handleFile(file) {
  if (file.size > 10 * 1024 * 1024) { showError("Ukuran file terlalu besar (maks. 10 MB)."); return; }
  selectedFile = file;
  previewImg.src = URL.createObjectURL(file);
  uploadPlaceholder.style.display = "none";
  uploadPreview.style.display = "block";
  btnPredict.disabled = false;
  hideError();
}

function clearFile() {
  selectedFile = null; fileInput.value = "";
  previewImg.src = "";
  uploadPlaceholder.style.display = "block";
  uploadPreview.style.display = "none";
  btnPredict.disabled = true;
  hideResults();
}

btnPredict.addEventListener("click", async () => {
  if (!selectedFile) return;
  await runPredict(selectedFile, false);
});

// ─── KAMERA ───────────────────────────────────────────────────────────────────
async function startCamera() {
  hideError();
  try {
    if (cameraStream) stopStreamTracks();
    const constraints = {
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    };
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraVideo.srcObject = cameraStream;
    cameraPlaceholder.style.display = "none";
    cameraVideo.style.display = "block";
    cameraVideo.addEventListener("loadedmetadata", syncCanvasSize, { once: true });
    btnStartCamera.style.display = "none";
    btnStopCamera.style.display  = "inline-flex";
    btnFlipCamera.style.display  = "inline-flex";
    btnSnapshot.style.display    = "inline-flex";
    realtimeControl.style.display= "block";
  } catch (err) {
    if (err.name === "NotAllowedError") showError("Akses kamera ditolak. Izinkan akses kamera di browser Anda.");
    else if (err.name === "NotFoundError") showError("Kamera tidak ditemukan di perangkat ini.");
    else showError("Gagal mengakses kamera: " + err.message);
  }
}
window.startCamera = startCamera;

function syncCanvasSize() {
  overlayCanvas.width  = cameraVideo.videoWidth;
  overlayCanvas.height = cameraVideo.videoHeight;
  overlayCanvas.style.display = "block";
}

function stopCamera() {
  stopRealtimeLoop();
  stopStreamTracks();
  cameraVideo.style.display    = "none";
  overlayCanvas.style.display  = "none";
  cameraPlaceholder.style.display = "flex";
  realtimeBadge.style.display  = "none";
  realtimeControl.style.display= "none";
  btnStartCamera.style.display = "inline-flex";
  btnStopCamera.style.display  = "none";
  btnFlipCamera.style.display  = "none";
  btnSnapshot.style.display    = "none";
  if (toggleRealtime) { toggleRealtime.checked = false; }
  realtimeActive = false;
  lastDetections = [];
  hideResults();
}
window.stopCamera = stopCamera;

function stopStreamTracks() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}

async function flipCamera() {
  facingMode = facingMode === "environment" ? "user" : "environment";
  await startCamera();
}
window.flipCamera = flipCamera;

async function takeSnapshot() {
  if (!cameraStream || isProcessing) return;
  const snapCanvas = document.createElement("canvas");
  snapCanvas.width  = cameraVideo.videoWidth;
  snapCanvas.height = cameraVideo.videoHeight;
  snapCanvas.getContext("2d").drawImage(cameraVideo, 0, 0);
  snapCanvas.toBlob(async (blob) => {
    const file = new File([blob], "snapshot.jpg", { type: "image/jpeg" });
    await runPredict(file, false);
  }, "image/jpeg", 0.92);
}
window.takeSnapshot = takeSnapshot;

// ─── Realtime Mode (requestAnimationFrame + canvas overlay) ──────────────────

function toggleRealtimeMode(enabled) {
  realtimeActive = enabled;
  if (enabled) {
    realtimeBadge.style.display = "flex";
    lastDetections = [];
    lastSendTime = 0;
    startRealtimeLoop();
  } else {
    realtimeBadge.style.display = "none";
    stopRealtimeLoop();
    clearOverlay();
    hideResults();
  }
}
window.toggleRealtimeMode = toggleRealtimeMode;

/**
 * Loop rendering utama menggunakan requestAnimationFrame (~60fps).
 *
 * Setiap frame:
 *   1. Gambar ulang bounding box terakhir di canvas overlay → smooth, tanpa kedip
 *   2. Setiap `sendInterval` ms, kirim frame ke API di background (async)
 *   3. Saat API merespons → update lastDetections → bbox langsung tampil di frame berikutnya
 */
function realtimeRenderLoop(timestamp) {
  if (!realtimeActive || !cameraStream) return;

  // Sinkronkan ukuran canvas kalau belum sesuai
  if (overlayCanvas.width !== cameraVideo.videoWidth ||
      overlayCanvas.height !== cameraVideo.videoHeight) {
    syncCanvasSize();
  }

  // Render bounding box terakhir di atas video
  drawOverlayFromDetections(lastDetections);

  // Throttle: kirim ke API hanya setiap sendInterval ms
  if (!isProcessing && (timestamp - lastSendTime) >= sendInterval) {
    lastSendTime = timestamp;
    sendFrameToAPI(); // non-blocking
  }

  rafHandle = requestAnimationFrame(realtimeRenderLoop);
}

function startRealtimeLoop() {
  stopRealtimeLoop();
  rafHandle = requestAnimationFrame(realtimeRenderLoop);
}

function stopRealtimeLoop() {
  if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
  isProcessing = false;
}

/**
 * Capture frame kecil → POST ke /predict_realtime → update lastDetections.
 * Berjalan sepenuhnya di background, tidak memblokir render loop.
 */
async function sendFrameToAPI() {
  if (!cameraStream || isProcessing) return;
  if (cameraVideo.readyState < 2) return;

  isProcessing = true;
  try {
    // Kirim frame dengan resolusi lebih kecil untuk kecepatan
    const capW = Math.min(cameraVideo.videoWidth, 640);
    const capH = Math.round(capW * cameraVideo.videoHeight / cameraVideo.videoWidth);
    const snap = document.createElement("canvas");
    snap.width = capW; snap.height = capH;
    snap.getContext("2d").drawImage(cameraVideo, 0, 0, capW, capH);

    const blob = await new Promise(res => snap.toBlob(res, "image/jpeg", 0.80));
    if (!blob) return;

    const modelType = document.querySelector('input[name="model"]:checked').value;
    const fd = new FormData();
    fd.append("file", new File([blob], "frame.jpg", { type: "image/jpeg" }));
    fd.append("model_type", modelType);
    fd.append("conf_threshold", "0.45");

    const res = await fetch(`${API_BASE}/predict_realtime`, { method: "POST", body: fd });
    if (!res.ok) return;

    const data = await res.json();
    if (data && data.success) {
      // Simpan deteksi beserta info ukuran frame agar bisa di-scale ke canvas
      lastDetections = (data.detections || []).map(d => ({
        ...d,
        _frameW: capW,
        _frameH: capH,
      }));
      updateDetectionPanel(data);
    }
  } catch (e) {
    console.warn("Realtime API error:", e);
  } finally {
    isProcessing = false;
  }
}

/**
 * Gambar bounding box di atas video secara lokal.
 * Koordinat dari API (ukuran frame kecil) di-scale ke ukuran canvas overlay.
 */
function drawOverlayFromDetections(detections) {
  const ctx = overlayCanvas.getContext("2d");
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!detections || detections.length === 0) return;

  const cw = overlayCanvas.width;
  const ch = overlayCanvas.height;

  detections.forEach(det => {
    const scaleX = cw / (det._frameW || cw);
    const scaleY = ch / (det._frameH || ch);
    const [bx1, by1, bx2, by2] = det.bbox;
    const x1 = Math.round(bx1 * scaleX);
    const y1 = Math.round(by1 * scaleY);
    const x2 = Math.round(bx2 * scaleX);
    const y2 = Math.round(by2 * scaleY);
    const w  = x2 - x1;
    const h  = y2 - y1;

    const meta  = CLASS_META[det.label] || DEFAULT_META;
    const color = det.color || meta.color;
    const conf  = Math.round(det.confidence * 100);
    const text  = `${det.label} ${conf}%`;

    // Bounding box
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.strokeRect(x1, y1, w, h);

    // Label background
    const fontSize = Math.max(13, Math.min(cw, ch) * 0.02);
    ctx.font = `bold ${fontSize}px DM Sans, sans-serif`;
    const textW  = ctx.measureText(text).width;
    const padX = 6, padY = 4;
    const labelH = fontSize + padY * 2;
    const labelY = y1 > labelH ? y1 - labelH : y1 + labelH + 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x1, labelY - fontSize - padY, textW + padX * 2, labelH, 4);
    } else {
      ctx.rect(x1, labelY - fontSize - padY, textW + padX * 2, labelH);
    }
    ctx.fill();

    // Label text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x1 + padX, labelY - padY);
  });
}

function clearOverlay() {
  if (overlayCanvas) {
    overlayCanvas.getContext("2d").clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
  lastDetections = [];
}

/**
 * Update panel deteksi tanpa scroll (untuk mode realtime)
 */
function updateDetectionPanel(data) {
  resultsMeta.innerHTML = `
    <span class="meta-chip">🔴 Live</span>
    <span class="meta-chip">${data.total_deteksi} objek terdeteksi</span>
  `;

  detectionList.innerHTML = "";
  if (!data.detections || data.detections.length === 0) {
    detectionList.innerHTML = `<div class="det-empty">⚠️ Tidak ada objek terdeteksi. Arahkan kamera ke daun cabai.</div>`;
  } else {
    data.detections.forEach((det, i) => {
      const meta = CLASS_META[det.label] || DEFAULT_META;
      const pct  = Math.round(det.confidence * 100);
      const item = document.createElement("div");
      item.className = "det-item";
      item.style.animationDelay = `${i * 60}ms`;
      item.innerHTML = `
        <div class="det-label">
          <span class="det-dot" style="background:${meta.color}"></span>
          ${meta.emoji} ${det.label}
        </div>
        <span class="det-conf">${pct}%</span>
      `;
      detectionList.appendChild(item);
    });
  }

  resultsSection.style.display = "block";
}

function setInterval_(btn, ms) {
  sendInterval = ms;
  document.querySelectorAll(".interval-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}
window.setInterval_ = setInterval_;

// ─── API: untuk upload & snapshot ────────────────────────────────────────────
async function sendToAPI(file) {
  const modelType = document.querySelector('input[name="model"]:checked').value;
  const formData  = new FormData();
  formData.append("file", file);
  formData.append("model_type", modelType);
  formData.append("conf_threshold", "0.5");

  const res = await fetch(`${API_BASE}/predict`, { method: "POST", body: formData });
  if (!res.ok) {
    const errData = await res.json().catch(() => null);
    throw new Error(errData?.detail || `Server error: ${res.status}`);
  }
  return res.json();
}

async function runPredict(file, silent = false) {
  if (!silent) {
    btnPredict.disabled = true;
    loadingTitle.textContent = "Menganalisis Gambar…";
    showLoading(true);
    hideError();
    hideResults();
  }
  try {
    const data = await sendToAPI(file);
    renderResults(data, !silent);
  } catch (err) {
    if (err.name === "TypeError") {
      showError(`Tidak dapat terhubung ke server (${API_BASE})`);
    } else {
      showError(err.message);
    }
  } finally {
    showLoading(false);
    btnPredict.disabled = false;
  }
}

// ─── Render hasil (untuk upload & snapshot) ───────────────────────────────────
function renderResults(data, doScroll = true) {
  renderResultsSilent(data);
  if (doScroll) resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderResultsSilent(data) {
  resultsMeta.innerHTML = `
    <span class="meta-chip">Model ${data.model_used}</span>
    <span class="meta-chip">${data.total_deteksi} objek terdeteksi</span>
  `;
  resultImage.src = `data:image/jpeg;base64,${data.image_base64}`;
  detectionList.innerHTML = "";
  if (!data.detections || data.detections.length === 0) {
    detectionList.innerHTML = `<div class="det-empty">⚠️ Tidak ada objek terdeteksi. Coba arahkan kamera lebih dekat atau ganti sudut.</div>`;
  } else {
    data.detections.forEach((det, i) => {
      const meta = CLASS_META[det.label] || DEFAULT_META;
      const pct  = Math.round(det.confidence * 100);
      const item = document.createElement("div");
      item.className = "det-item";
      item.style.animationDelay = `${i * 60}ms`;
      item.innerHTML = `
        <div class="det-label">
          <span class="det-dot" style="background:${meta.color}"></span>
          ${meta.emoji} ${det.label}
        </div>
        <span class="det-conf">${pct}%</span>
      `;
      detectionList.appendChild(item);
    });
  }
  rekomendasiSection.innerHTML = "";
  if (data.rekomendasi && data.rekomendasi.length > 0) {
    const heading = document.createElement("h3");
    heading.style.cssText = "font-family:var(--font-display);font-size:1.5rem;color:var(--green-900);margin-bottom:16px;";
    heading.textContent = "📋 Rekomendasi Penanganan";
    rekomendasiSection.appendChild(heading);
    data.rekomendasi.forEach(rek => rekomendasiSection.appendChild(buildRekomendasiCard(rek)));
  }
  resultsSection.style.display = "block";
}

function buildRekomendasiCard(rek) {
  const meta  = CLASS_META[rek.label] || DEFAULT_META;
  const theme = `theme-${rek.label}`;
  const penyebabItems = (rek.penyebab  || []).map(p => `<li><span>${p}</span></li>`).join("");
  const rekomenItems  = (rek.rekomendasi || []).map(r => `<li><span>${r}</span></li>`).join("");
  const card = document.createElement("div");
  card.className = `rekom-card ${theme}`;
  card.innerHTML = `
    <div class="rekom-header">
      <span class="rekom-emoji">${meta.emoji}</span>
      <span>${rek.nama_penyakit || rek.label}</span>
      <span class="rekom-badge">${rek.label}</span>
    </div>
    <div class="rekom-body">
      <div class="rekom-col">
        <div class="rekom-col-title">⚡ Penyebab</div>
        <ul class="rekom-list">${penyebabItems}</ul>
      </div>
      <div class="rekom-col">
        <div class="rekom-col-title">✅ Langkah Penanganan</div>
        <ul class="rekom-list">${rekomenItems}</ul>
      </div>
    </div>
  `;
  return card;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function showLoading(show) { loadingOverlay.style.display = show ? "block" : "none"; }
function hideResults()     { resultsSection.style.display = "none"; }
function showError(msg)    { errorMsg.textContent = msg; errorBanner.style.display = "flex"; }
function hideError()       { errorBanner.style.display = "none"; }
window.hideError = hideError;
