const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { WebSocketServer } = require("ws");
const { randomUUID } = require("node:crypto");

const port = Number(process.env.PORT || 5173);
const siteDir = path.join(__dirname, "site");
const players = new Map();
let worldSeed = Math.random() * 10000;

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".glb", "model/gltf-binary"],
]);

function avatarFor(id) {
  const hue = (Number.parseInt(id.slice(0, 6), 16) || 120) % 360;
  return {
    body: `hsl(${hue} 78% 68%)`,
    mane: `hsl(${(hue + 122) % 360} 86% 58%)`,
    mark: `hsl(${(hue + 236) % 360} 90% 62%)`,
  };
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message, except) {
  const payload = JSON.stringify(message);
  for (const player of players.values()) {
    if (player.socket !== except && player.socket.readyState === player.socket.OPEN) {
      player.socket.send(payload);
    }
  }
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
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
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const id = randomUUID();
  const player = {
    id,
    socket,
    avatar: avatarFor(id.replaceAll("-", "")),
    state: {
      x: 10,
      y: 10,
      z: 10,
      ry: 0,
      moving: false,
    },
  };

  players.set(id, player);

  send(socket, {
    type: "welcome",
    id,
    worldSeed,
    avatar: player.avatar,
    players: [...players.values()]
      .filter((other) => other.id !== id)
      .map((other) => ({
        id: other.id,
        avatar: other.avatar,
        state: other.state,
      })),
  });

  broadcast({
    type: "join",
    player: {
      id,
      avatar: player.avatar,
      state: player.state,
    },
  }, socket);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.type === "regen") {
      worldSeed = Math.random() * 10000;
      broadcast({ type: "regen", worldSeed });
      send(socket, { type: "regen", worldSeed });
      return;
    }

    if (message.type !== "state" || !message.state) return;

    player.state = {
      x: Number(message.state.x) || 0,
      y: Number(message.state.y) || 0,
      z: Number(message.state.z) || 0,
      ry: Number(message.state.ry) || 0,
      moving: Boolean(message.state.moving),
    };

    broadcast({
      type: "state",
      id,
      state: player.state,
    }, socket);
  });

  socket.on("close", () => {
    players.delete(id);
    broadcast({ type: "leave", id }, socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`3D multiplayer world: http://127.0.0.1:${port}`);
});
