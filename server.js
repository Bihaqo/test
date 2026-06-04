const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

loadEnvFile(path.join(__dirname, ".env"));

const port = Number(process.env.PORT || 5173);
const siteDir = path.join(__dirname, "site");
const heygenBaseUrl = "https://api.heygen.com";
const maxJsonBytes = 45 * 1024 * 1024;
const maxAssetBytes = 32 * 1024 * 1024;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const [key, ...valueParts] = trimmed.split("=");
    const value = valueParts.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function requireHeyGenKey() {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    const error = new Error("HEYGEN_API_KEY is not set. Add it to .env and restart the server.");
    error.status = 500;
    throw error;
  }
  return apiKey;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxJsonBytes) {
        const error = new Error("Request is too large.");
        error.status = 413;
        reject(error);
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        const error = new Error("Invalid JSON body.");
        error.status = 400;
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function normalizeBase64(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "");
}

function extractHeyGenMessage(payload, text, status) {
  const message =
    payload?.error?.message ||
    payload?.message ||
    payload?.data?.message ||
    payload?.error;

  if (message) return String(message);
  if (/<html[\s>]/i.test(text) || /<body[\s>]/i.test(text)) {
    return `HeyGen API temporarily unavailable (HTTP ${status}). Try again in a minute.`;
  }
  return text || `HeyGen request failed with HTTP ${status}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function heygenFetch(route, options = {}, attempt = 1) {
  const response = await fetch(`${heygenBaseUrl}${route}`, {
    ...options,
    headers: {
      "x-api-key": requireHeyGenKey(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    if ([502, 503, 504].includes(response.status) && attempt < 3) {
      await sleep(1200 * attempt);
      return heygenFetch(route, options, attempt + 1);
    }

    const message = extractHeyGenMessage(payload, text, response.status);
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function uploadAsset(image) {
  const mime = String(image?.mime || "");
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    const error = new Error("Upload a PNG, JPG, or WEBP image.");
    error.status = 400;
    throw error;
  }

  const buffer = Buffer.from(normalizeBase64(image?.data), "base64");
  if (!buffer.length) {
    const error = new Error("Image is empty.");
    error.status = 400;
    throw error;
  }
  if (buffer.length > maxAssetBytes) {
    const error = new Error("HeyGen accepts assets up to 32 MB.");
    error.status = 413;
    throw error;
  }

  const extension = mime.split("/")[1].replace("jpeg", "jpg");
  const filename = String(image?.name || `portrait-${Date.now()}.${extension}`).replace(/[^\w.-]/g, "_");
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: mime }), filename);

  const payload = await heygenFetch("/v3/assets", {
    method: "POST",
    body: formData,
    headers: {
      "Idempotency-Key": randomUUID(),
    },
  });

  return payload.data;
}

async function createVideo(body, assetId) {
  const script = String(body.script || "").trim();
  const voiceId = String(body.voiceId || "").trim();

  if (!script) {
    const error = new Error("Script is required.");
    error.status = 400;
    throw error;
  }
  if (!voiceId) {
    const error = new Error("Voice ID is required for image-to-video.");
    error.status = 400;
    throw error;
  }

  const request = {
    type: "image",
    image: {
      type: "asset_id",
      asset_id: assetId,
    },
    script,
    voice_id: voiceId,
    title: String(body.title || "Talking photo").trim().slice(0, 120),
    resolution: ["720p", "1080p", "4k"].includes(body.resolution) ? body.resolution : "1080p",
    aspect_ratio: ["auto", "16:9", "9:16", "1:1", "4:5", "5:4"].includes(body.aspectRatio)
      ? body.aspectRatio
      : "auto",
    fit: ["contain", "cover"].includes(body.fit) ? body.fit : "contain",
    output_format: "mp4",
    voice_settings: {
      speed: Number(body.speed) || 1,
      pitch: Number(body.pitch) || 0,
      volume: 1,
    },
  };

  if (["low", "medium", "high"].includes(body.expressiveness)) {
    request.expressiveness = body.expressiveness;
  }

  const motionPrompt = String(body.motionPrompt || "").trim();
  if (motionPrompt) {
    request.motion_prompt = motionPrompt.slice(0, 600);
  }

  const payload = await heygenFetch("/v3/videos", {
    method: "POST",
    body: JSON.stringify(request),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
  });

  return payload.data;
}

async function handleApi(request, response, requestUrl) {
  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    sendJson(response, 200, { hasHeyGenKey: Boolean(process.env.HEYGEN_API_KEY) });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/voices") {
    const query = requestUrl.search || "?limit=50";
    const payload = await heygenFetch(`/v3/voices${query}`);
    sendJson(response, 200, payload);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/generate") {
    const body = await readJsonBody(request);
    const asset = await uploadAsset(body.image);
    const video = await createVideo(body, asset.asset_id);
    sendJson(response, 200, { asset, video });
    return;
  }

  const videoMatch = requestUrl.pathname.match(/^\/api\/videos\/([^/]+)$/);
  if (request.method === "GET" && videoMatch) {
    const videoId = encodeURIComponent(videoMatch[1]);
    const payload = await heygenFetch(`/v3/videos/${videoId}`);
    sendJson(response, 200, payload);
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

function serveStatic(requestUrl, response) {
  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(siteDir, normalized);

  if (!filePath.startsWith(siteDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": mimeTypes.get(path.extname(filePath)) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Max-Age": "86400",
      });
      response.end();
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, error.status || 500, {
      error: error.message || "Unexpected server error.",
      details: error.payload,
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`HeyGen talking photo studio: http://127.0.0.1:${port}`);
});
