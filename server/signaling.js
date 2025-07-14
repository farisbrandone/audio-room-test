// server/signaling.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
const { getTURNCredentials } = require("./turn-service");

dotenv.config();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

wss.on("connection", (ws) => {
  let roomId = null;
  let userId = null;

  ws.on("message", (data) => {
    const message = JSON.parse(data);

    switch (message.type) {
      case "join":
        roomId = message.room;
        userId = message.userId;

        if (!rooms.has(roomId)) {
          rooms.set(roomId, new Map());
        }

        const room = rooms.get(roomId);
        room.set(userId, ws);

        // Notify others in room
        room.forEach((client, id) => {
          if (id !== userId) {
            client.send(
              JSON.stringify({
                type: "new-peer",
                userId: userId,
              })
            );
          }
        });
        break;

      case "offer":
      case "answer":
      case "candidate":
        // Forward to specific peer
        const targetPeer = rooms.get(roomId)?.get(message.target);
        if (targetPeer) targetPeer.send(JSON.stringify(message));
        break;

      case "leave":
        cleanupPeer(roomId, userId);
        break;
    }
  });

  ws.on("close", () => {
    cleanupPeer(roomId, userId);
  });

  function cleanupPeer(roomId, userId) {
    if (roomId && userId) {
      const room = rooms.get(roomId);
      if (room) {
        room.delete(userId);

        // Notify remaining peers
        room.forEach((client) => {
          client.send(
            JSON.stringify({
              type: "peer-left",
              userId: userId,
            })
          );
        });

        if (room.size === 0) rooms.delete(roomId);
      }
    }
  }
});

// Serve static files from public directory
app.use(express.static("./public"));

app.get("/", (req, res) => {
  console.log(__dirname);
  console.log("tonton");
  res.sendFile(__dirname, "/index.html");
});

app.get("/turn-credentials", async (req, res) => {
  try {
    const credentials = await getTURNCredentials();
    if (!credentials) {
      return res.status(500).json({ error: "Failed to get TURN credentials" });
    }

    res.json({
      username: credentials.username,
      credential: credentials.password,
      urls: credentials.urls,
      ttl: 86400, // 24 heures
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(
    `Signaling server running on port ${PORT} url: http://localhost:3000`
  );
});
