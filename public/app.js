// public/app.js
class AudioChatApp {
  constructor() {
    // DOM Elements
    this.roomIdInput = document.getElementById("roomId");
    this.joinBtn = document.getElementById("joinBtn");
    this.leaveBtn = document.getElementById("leaveBtn");
    this.muteBtn = document.getElementById("muteBtn");
    this.deafenBtn = document.getElementById("deafenBtn");
    this.localAudio = document.getElementById("localAudio");
    this.connectionStatus = document.getElementById("connectionStatus");
    this.remotePeers = document.getElementById("remotePeers");
    this.localViz = document.getElementById("localViz");

    // Application state
    this.roomId = null;
    this.userId = this.generateUserId();
    this.localStream = null;
    this.peerConnections = new Map();
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    this.analyser = null;
    this.isMuted = false;
    this.isDeafened = false;

    // WebSocket connection
    this.socket = null;

    // Setup event listeners
    this.setupEventListeners();
  }

  generateUserId() {
    return "user-" + Math.random().toString(36).substring(2, 9);
  }

  setupEventListeners() {
    this.joinBtn.addEventListener("click", () => this.joinRoom());
    this.leaveBtn.addEventListener("click", () => this.leaveRoom());
    this.muteBtn.addEventListener("click", () => this.toggleMute());
    this.deafenBtn.addEventListener("click", () => this.toggleDeafen());
  }

  async joinRoom() {
    this.roomId = this.roomIdInput.value.trim() || "default-room";
    this.updateStatus("Connecting...");

    try {
      // Step 2: Media Acquisition
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      this.localAudio.srcObject = this.localStream;
      this.setupAudioVisualization();

      // Connect to signaling server
      this.connectToSignalingServer();

      this.joinBtn.disabled = true;
      this.leaveBtn.disabled = false;
      this.updateStatus("Connected to room: " + this.roomId);
    } catch (error) {
      console.error("Error accessing media devices:", error);
      this.updateStatus("Error: " + error.message);
    }
  }

  connectToSignalingServer() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    this.socket = new WebSocket(`${protocol}//${host}`);

    this.socket.onopen = () => {
      this.socket.send(
        JSON.stringify({
          type: "join",
          room: this.roomId,
          userId: this.userId,
        })
      );
    };

    this.socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case "new-peer":
          this.handleNewPeer(message.userId);
          break;

        case "offer":
          this.handleOffer(message);
          break;

        case "answer":
          this.handleAnswer(message);
          break;

        case "candidate":
          this.handleICECandidate(message);
          break;

        case "peer-left":
          this.removePeer(message.userId);
          break;
      }
    };
  }

  async handleNewPeer(peerId) {
    if (peerId === this.userId) return;

    // Step 3: Create PeerConnection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // Add TURN servers here for production
      ],
      sdpSemantics: "unified-plan",
    });

    // Step 4: ICE Framework
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.send(
          JSON.stringify({
            type: "candidate",
            target: peerId,
            candidate: event.candidate,
            userId: this.userId,
          })
        );
      }
    };

    pc.ontrack = (event) => {
      this.addRemoteStream(peerId, event.streams[0]);
    };

    // Add local audio tracks
    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    // Save the connection
    this.peerConnections.set(peerId, pc);

    try {
      // Create offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 0,
      });

      await pc.setLocalDescription(offer);

      this.socket.send(
        JSON.stringify({
          type: "offer",
          target: peerId,
          sdp: offer.sdp,
          userId: this.userId,
        })
      );
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  }

  async handleOffer(message) {
    const peerId = message.userId;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      sdpSemantics: "unified-plan",
    });

    this.peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.send(
          JSON.stringify({
            type: "candidate",
            target: peerId,
            candidate: event.candidate,
            userId: this.userId,
          })
        );
      }
    };

    pc.ontrack = (event) => {
      this.addRemoteStream(peerId, event.streams[0]);
    };

    // Add local tracks
    this.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, this.localStream);
    });

    try {
      await pc.setRemoteDescription({
        type: "offer",
        sdp: message.sdp,
      });

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.send(
        JSON.stringify({
          type: "answer",
          target: peerId,
          sdp: answer.sdp,
          userId: this.userId,
        })
      );
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  }

  async handleAnswer(message) {
    const pc = this.peerConnections.get(message.userId);
    if (pc) {
      await pc.setRemoteDescription({
        type: "answer",
        sdp: message.sdp,
      });
    }
  }

  async handleICECandidate(message) {
    const pc = this.peerConnections.get(message.userId);
    if (pc && message.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    }
  }

  addRemoteStream(peerId, stream) {
    // Remove if already exists
    this.removePeer(peerId);

    const peerContainer = document.createElement("div");
    peerContainer.className = "remote-peer";
    peerContainer.id = `peer-${peerId}`;

    const title = document.createElement("h3");
    title.textContent = `Participant: ${peerId.substring(0, 8)}`;

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.controls = true;
    audio.srcObject = stream;

    const viz = document.createElement("div");
    viz.className = "visualizer";
    viz.id = `viz-${peerId}`;

    peerContainer.appendChild(title);
    peerContainer.appendChild(audio);
    peerContainer.appendChild(viz);
    this.remotePeers.appendChild(peerContainer);

    this.setupRemoteVisualization(peerId, stream);
  }

  removePeer(peerId) {
    const peerEl = document.getElementById(`peer-${peerId}`);
    if (peerEl) peerEl.remove();

    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
  }

  setupAudioVisualization() {
    this.analyser = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(this.localStream);
    source.connect(this.analyser);
    this.analyser.fftSize = 32;

    this.visualizeAudio(this.localViz);
  }

  setupRemoteVisualization(peerId, stream) {
    const audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.fftSize = 32;

    this.visualizeAudio(document.getElementById(`viz-${peerId}`), analyser);
  }

  visualizeAudio(container, analyser = this.analyser) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    container.innerHTML = "";

    // Create bars for visualization
    const barWidth = container.clientWidth / bufferLength;
    for (let i = 0; i < bufferLength; i++) {
      const bar = document.createElement("div");
      bar.className = "visualizer-bar";
      bar.style.left = `${i * barWidth}px`;
      bar.style.width = `${barWidth - 2}px`;
      container.appendChild(bar);
    }

    const bars = container.querySelectorAll(".visualizer-bar");

    const draw = () => {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      bars.forEach((bar, i) => {
        const height = (dataArray[i] / 255) * 100;
        bar.style.height = `${height}%`;
      });
    };

    draw();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach((track) => {
      track.enabled = !this.isMuted;
    });
    this.muteBtn.textContent = this.isMuted ? "Unmute" : "Mute";
    this.muteBtn.style.backgroundColor = this.isMuted ? "#e74c3c" : "#3498db";
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    this.deafenBtn.textContent = this.isDeafened ? "Undeafen" : "Deafen";
    this.deafenBtn.style.backgroundColor = this.isDeafened
      ? "#e74c3c"
      : "#3498db";

    this.peerConnections.forEach((pc) => {
      const receivers = pc.getReceivers();
      receivers.forEach((receiver) => {
        if (receiver.track.kind === "audio") {
          receiver.track.enabled = !this.isDeafened;
        }
      });
    });
  }

  leaveRoom() {
    if (this.socket) {
      this.socket.send(
        JSON.stringify({
          type: "leave",
          room: this.roomId,
          userId: this.userId,
        })
      );
      this.socket.close();
    }

    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      this.localAudio.srcObject = null;
    }

    this.remotePeers.innerHTML = "";
    this.joinBtn.disabled = false;
    this.leaveBtn.disabled = true;
    this.updateStatus("Disconnected");
  }

  updateStatus(text) {
    this.connectionStatus.textContent = text;
  }
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  new AudioChatApp();
});
