// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Store connected peers
const peers = {};

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case "join":
        peers[data.id] = ws;
        break;
      case "offer":
      case "answer":
      case "candidate":
        // Forward signaling data to target peer
        if (peers[data.target]) {
          peers[data.target].send(JSON.stringify(data));
        }
        break;
    }
  });

  ws.on("close", () => {
    // Cleanup disconnected peers
    Object.keys(peers).forEach((id) => {
      if (peers[id] === ws) delete peers[id];
    });
  });
});

// Serve HTML page
app.get("/", (req, res) => {
  console.log(__dirname);
  res.sendFile(__dirname + "public", "/index.html");
});

server.listen(3000, () => {
  console.log("Signaling server running on http://localhost:3000");
});
