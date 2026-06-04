const form = document.querySelector("#generator-form");
const imageInput = document.querySelector("#image-input");
const dropzone = document.querySelector("#dropzone");
const imagePreview = document.querySelector("#image-preview");
const emptyPreview = document.querySelector("#empty-preview");
const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const resultVideo = document.querySelector("#result-video");
const downloadLink = document.querySelector("#download-link");
const submitButton = document.querySelector("#submit-button");
const voicesButton = document.querySelector("#voices-button");
const voicesList = document.querySelector("#voices-list");
const keyWarning = document.querySelector("#key-warning");
const speed = document.querySelector("#speed");
const speedValue = document.querySelector("#speed-value");
const pitch = document.querySelector("#pitch");
const pitchValue = document.querySelector("#pitch-value");
const voiceId = document.querySelector("#voice-id");
const apiBaseUrlInput = document.querySelector("#api-base-url");

let selectedImage = null;
let pollTimer = null;
const apiBaseStorageKey = "heygenApiBaseUrl";

function isHostedStaticPage() {
  return location.hostname.endsWith("github.io");
}

function getApiBaseUrl() {
  return apiBaseUrlInput.value.trim().replace(/\/$/, "");
}

function apiUrl(path) {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}${path}`;
}

function setStatus(text, state = "idle") {
  statusText.textContent = text;
  statusDot.dataset.state = state;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? "Генерирую..." : "Создать видео";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("Не удалось прочитать файл.")));
    reader.readAsDataURL(file);
  });
}

async function prepareImage(file) {
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    setStatus("Нужен PNG, JPG или WEBP", "error");
    return;
  }
  if (file.size > 32 * 1024 * 1024) {
    setStatus("Картинка больше 32 MB", "error");
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  selectedImage = {
    name: file.name,
    mime: file.type,
    data: dataUrl,
  };

  imagePreview.src = dataUrl;
  imagePreview.hidden = false;
  emptyPreview.hidden = true;
  dropzone.classList.add("has-file");
  dropzone.querySelector(".dropzone-title").textContent = file.name;
  dropzone.querySelector(".dropzone-copy").textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  setStatus("Фото готово", "ready");
}

async function apiJson(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Запрос не удался.");
  }
  return payload;
}

function collectPayload() {
  const data = new FormData(form);
  return {
    image: selectedImage,
    script: String(data.get("script") || ""),
    voiceId: String(data.get("voiceId") || ""),
    title: String(data.get("title") || ""),
    aspectRatio: String(data.get("aspectRatio") || "auto"),
    resolution: String(data.get("resolution") || "1080p"),
    fit: String(data.get("fit") || "contain"),
    expressiveness: String(data.get("expressiveness") || "low"),
    motionPrompt: String(data.get("motionPrompt") || ""),
    speed: Number(data.get("speed") || 1),
    pitch: Number(data.get("pitch") || 0),
  };
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function pollVideo(videoId) {
  stopPolling();

  async function tick() {
    try {
      const payload = await apiJson(`/api/videos/${encodeURIComponent(videoId)}`);
      const video = payload.data || {};
      const status = video.status || (video.video_url ? "completed" : "processing");

      if (video.video_url) {
        resultVideo.src = video.video_url;
        resultVideo.hidden = false;
        downloadLink.href = video.video_url;
        downloadLink.hidden = false;
        setStatus("Видео готово", "ready");
        setBusy(false);
        return;
      }

      if (status === "failed" || video.failure_message) {
        setStatus(video.failure_message || "HeyGen не смог сгенерировать видео", "error");
        setBusy(false);
        return;
      }

      setStatus(`Рендеринг: ${status}`, "working");
      pollTimer = setTimeout(tick, 8000);
    } catch (error) {
      setStatus(error.message, "error");
      setBusy(false);
    }
  }

  tick();
}

async function submitGeneration(event) {
  event.preventDefault();
  stopPolling();

  if (!selectedImage) {
    setStatus("Сначала загрузите портрет", "error");
    return;
  }

  resultVideo.hidden = true;
  resultVideo.removeAttribute("src");
  downloadLink.hidden = true;
  setBusy(true);
  setStatus("Загружаю фото в HeyGen", "working");

  try {
    const payload = await apiJson("/api/generate", {
      method: "POST",
      body: JSON.stringify(collectPayload()),
    });
    const videoId = payload.video?.video_id || payload.video?.id;
    if (!videoId) {
      throw new Error("HeyGen не вернул video_id.");
    }

    setStatus(`Видео создано: ${videoId}`, "working");
    pollVideo(videoId);
  } catch (error) {
    setStatus(error.message, "error");
    setBusy(false);
  }
}

function renderVoices(voices) {
  voicesList.innerHTML = "";
  const items = voices.slice(0, 24);
  if (!items.length) {
    voicesList.textContent = "Голоса не найдены. Введите Voice ID вручную.";
    voicesList.hidden = false;
    return;
  }

  for (const voice of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "voice-item";
    button.innerHTML = `<strong>${voice.name || voice.voice_id || voice.id}</strong><span>${voice.language || voice.locale || ""}</span>`;
    button.addEventListener("click", () => {
      voiceId.value = voice.voice_id || voice.id || "";
      setStatus("Голос выбран", "ready");
    });
    voicesList.append(button);
  }
  voicesList.hidden = false;
}

async function loadVoices() {
  voicesButton.disabled = true;
  voicesButton.textContent = "Загружаю...";
  try {
    const payload = await apiJson("/api/voices?limit=50");
    renderVoices(payload.data?.voices || payload.data?.items || payload.data || []);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    voicesButton.disabled = false;
    voicesButton.textContent = "Загрузить голоса";
  }
}

async function checkConfig() {
  if (isHostedStaticPage() && !getApiBaseUrl()) {
    keyWarning.textContent = "GitHub Pages открыт, но API backend URL не указан. Разместите Node-сервер отдельно и вставьте его URL.";
    keyWarning.hidden = false;
    return;
  }

  try {
    const config = await apiJson("/api/config");
    keyWarning.textContent = config.hasHeyGenKey
      ? ""
      : "HEYGEN_API_KEY не найден. Добавьте ключ в .env и перезапустите сервер.";
    keyWarning.hidden = config.hasHeyGenKey;
  } catch {
    keyWarning.textContent = "API backend недоступен. Проверьте URL сервера и CORS-настройки.";
    keyWarning.hidden = false;
  }
}

imageInput.addEventListener("change", () => prepareImage(imageInput.files[0]));
form.addEventListener("submit", submitGeneration);
voicesButton.addEventListener("click", loadVoices);

dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("is-over");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("is-over");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("is-over");
  const [file] = event.dataTransfer.files;
  if (file) {
    imageInput.files = event.dataTransfer.files;
    prepareImage(file);
  }
});

speed.addEventListener("input", () => {
  speedValue.textContent = `${Number(speed.value).toFixed(2)}x`;
});

pitch.addEventListener("input", () => {
  pitchValue.textContent = pitch.value;
});

apiBaseUrlInput.value = localStorage.getItem(apiBaseStorageKey) || "";
apiBaseUrlInput.addEventListener("change", () => {
  localStorage.setItem(apiBaseStorageKey, getApiBaseUrl());
  checkConfig();
});

checkConfig();
