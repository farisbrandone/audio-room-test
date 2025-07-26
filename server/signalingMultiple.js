// server/signaling.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const dotenv = require("dotenv");
const { getTURNCredentials } = require("./turn-service");
const path = require("path");

dotenv.config();
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  clientTracking: false, // Désactive le tracking global pour éviter les fuites mémoire
});

const rooms = new Map();

// Optimisation : gestion des heartbeats pour détecter les déconnexions silencieuses
const HEARTBEAT_INTERVAL = 30000; // 30 secondes
const CONNECTION_TIMEOUT = 60000; // 60 secondes

wss.on("connection", (ws) => {
  let roomId = null;
  let userId = null;
  let heartbeat = null;

  // Fonction pour envoyer un ping
  const sendPing = () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      heartbeat = setTimeout(() => {
        ws.terminate(); // Ferme la connexion si pas de réponse
      }, CONNECTION_TIMEOUT);
    }
  };

  // Démarrer les heartbeats
  sendPing();
  const pingInterval = setInterval(sendPing, HEARTBEAT_INTERVAL);

  ws.on("pong", () => {
    clearTimeout(heartbeat);
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "join":
          roomId = message.room;
          userId = message.userId;

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Map());
          }

          const room = rooms.get(roomId);

          // Envoyer TOUJOURS la liste des pairs existants
          const existingPeers = Array.from(room.keys());
          console.log(`Nouvel utilisateur ${userId} dans ${roomId}`);
          console.log(`Pairs existants: ${existingPeers.join(", ")}`);
          ws.send(
            JSON.stringify({
              type: "existing-peers",
              peers: existingPeers,
            })
          );

          room.set(userId, ws);

          // Notifier les autres (sauf le nouveau)
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
          if (!roomId || !userId) break;

          // Forwarder uniquement si le destinataire est dans la même salle
          const targetPeer = rooms.get(roomId)?.get(message.target);
          if (targetPeer && targetPeer.readyState === WebSocket.OPEN) {
            targetPeer.send(JSON.stringify(message));
          }
          break;

        case "location":
          // Diffuser la localisation à toute la salle
          broadcastToRoom(roomId, userId, {
            type: "location",
            userId: userId,
            location: message.location,
          });
          break;

        case "ping":
          // Renvoyer directement le pong sans passer par la salle
          ws.send(
            JSON.stringify({
              type: "pong",
              id: message.id,
            })
          );
          break;

        case "leave":
          cleanupPeer(roomId, userId);
          break;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    clearInterval(pingInterval);
    clearTimeout(heartbeat);
    cleanupPeer(roomId, userId);
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    clearInterval(pingInterval);
    clearTimeout(heartbeat);
    cleanupPeer(roomId, userId);
  });

  function cleanupPeer(roomId, userId) {
    if (!roomId || !userId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    if (room.delete(userId)) {
      // Notifier les autres participants
      broadcastToRoom(roomId, userId, {
        type: "peer-left",
        userId: userId,
      });

      // Nettoyer la salle si vide
      if (room.size === 0) {
        rooms.delete(roomId);
      }
    }
  }

  // Fonction utilitaire pour diffuser un message à toute la salle
  function broadcastToRoom(roomId, senderId, message) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.forEach((client, id) => {
      if (id !== senderId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }
});

// Serve static files from public directory
app.use(express.static("./public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "indexMultiple2.html"));
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
    console.error("TURN credentials error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Middleware pour gérer les erreurs 404
app.use((req, res) => {
  res.status(404).send("Not found");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(
    `Signaling server running on port ${PORT} url: http://localhost:3000`
  );
});
