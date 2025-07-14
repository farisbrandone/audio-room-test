// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Stockage des salles et participants
const rooms = {};

// Gestion des connexions WebSocket
wss.on("connection", (ws) => {
  let userId = null;
  let roomId = null;

  // Gestion des messages
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case "get-rooms":
          handleGetRooms(ws);
          break;

        case "create-room":
          handleCreateRoom(ws, message);
          break;

        case "join-room":
          handleJoinRoom(ws, message);
          userId = message.userId;
          roomId = message.roomId;
          break;

        case "leave-room":
          handleLeaveRoom(message);
          break;

        case "offer":
        case "answer":
        case "candidate":
          forwardMessage(message);
          break;
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  // Gestion de la déconnexion
  ws.on("close", () => {
    if (roomId && userId) {
      handleLeaveRoom({ roomId, userId });
    }
  });

  // Fonctions de gestion
  function handleGetRooms(ws) {
    const roomList = Object.keys(rooms).map((roomId) => ({
      id: roomId,
      name: rooms[roomId].name,
      participants: Object.keys(rooms[roomId].participants).length,
    }));

    ws.send(
      JSON.stringify({
        type: "room-list",
        rooms: roomList,
      })
    );
  }

  function handleCreateRoom(ws, message) {
    const { roomId, roomName, userId } = message;

    if (rooms[roomId]) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Room already exists",
        })
      );
      return;
    }

    rooms[roomId] = {
      id: roomId,
      name: roomName,
      participants: {},
    };

    // Notifier tout le monde de la nouvelle salle
    broadcastRoomList();

    ws.send(
      JSON.stringify({
        type: "room-created",
        roomId,
        roomName,
      })
    );
  }

  function handleJoinRoom(ws, message) {
    const { roomId, userId, userName } = message;

    if (!rooms[roomId]) {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Room does not exist",
        })
      );
      return;
    }

    // Ajouter le participant à la salle
    rooms[roomId].participants[userId] = {
      id: userId,
      name: userName,
      ws: ws,
    };

    // Récupérer la liste des participants existants
    const existingUsers = Object.values(rooms[roomId].participants)
      .filter((user) => user.id !== userId)
      .map((user) => ({ id: user.id, name: user.name }));

    // Envoyer confirmation au participant
    ws.send(
      JSON.stringify({
        type: "room-joined",
        roomId,
        roomName: rooms[roomId].name,
        existingUsers,
      })
    );

    // Notifier les autres participants
    Object.values(rooms[roomId].participants).forEach((user) => {
      if (user.id !== userId && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(
          JSON.stringify({
            type: "user-joined",
            roomId,
            userId,
            userName,
          })
        );
      }
    });

    // Mettre à jour la liste des salles pour tout le monde
    broadcastRoomList();
  }

  function handleLeaveRoom(message) {
    const { roomId, userId } = message;

    if (!rooms[roomId] || !rooms[roomId].participants[userId]) {
      return;
    }

    // Retirer le participant
    delete rooms[roomId].participants[userId];

    // Notifier les autres participants
    Object.values(rooms[roomId].participants).forEach((user) => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(
          JSON.stringify({
            type: "user-left",
            roomId,
            userId,
          })
        );
      }
    });

    // Supprimer la salle si elle est vide
    if (Object.keys(rooms[roomId].participants).length === 0) {
      delete rooms[roomId];
    }

    // Mettre à jour la liste des salles
    broadcastRoomList();
  }

  function forwardMessage(message) {
    const { roomId, toUserId } = message;

    if (!rooms[roomId] || !rooms[roomId].participants[toUserId]) {
      return;
    }

    const targetWs = rooms[roomId].participants[toUserId].ws;

    if (targetWs.readyState === WebSocket.OPEN) {
      targetWs.send(JSON.stringify(message));
    }
  }

  function broadcastRoomList() {
    const roomList = Object.keys(rooms).map((roomId) => ({
      id: roomId,
      name: rooms[roomId].name,
      participants: Object.keys(rooms[roomId].participants).length,
    }));

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: "room-list",
            rooms: roomList,
          })
        );
      }
    });
  }
});

// Servir les fichiers statiques
app.use(express.static("./public"));

app.get("/", (req, res) => {
  console.log(__dirname);
  console.log("zouzou");
  res.sendFile(path.join(__dirname, "../public", "indexMultiple.html"));
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

// Démarrer le serveur
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
