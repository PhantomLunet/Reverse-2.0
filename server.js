const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const os = require("os");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Generate a random 6-character room code
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No I, O, 0, 1 to avoid confusion
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Get local IP for LAN access
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// Room storage
const rooms = new Map();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    maxHttpBufferSize: 15 * 1024 * 1024, // 15MB for audio payloads
  });

  // Helper to advance to next imitator or finish round
  function advanceToNextTurn(room, roomCode) {
    if (!room || !room.turnOrder) return;

    // Find next player who hasn't submitted yet
    const pendingPlayer = room.turnOrder.find((p) => !room.audios[p.id]);

    if (pendingPlayer) {
      room.currentTurnPlayer = pendingPlayer;
      const turnNumber = Object.keys(room.audios).length + 1;

      io.to(roomCode).emit("your-turn", {
        player: { name: pendingPlayer.name, id: pendingPlayer.id },
        turnNumber,
        totalTurns: room.turnOrder.length,
      });

      console.log(`[Game] Room ${roomCode}: Turn ${turnNumber}/${room.turnOrder.length} -> ${pendingPlayer.name}`);
    } else {
      // All imitators done!
      finishImitations(room, roomCode);
    }
  }

  // Helper to transition to results phase
  function finishImitations(room, roomCode) {
    if (!room || room.gameState === "results") return;
    room.gameState = "results";

    const allAudios = Object.values(room.audios).map((a) => ({
      playerName: a.playerName,
      audioData: a.audioData,
      playerId: a.playerId,
      skipped: a.skipped,
    }));

    io.to(roomCode).emit("all-imitations-done", {
      allAudios,
      audios: allAudios,
      originalAudio: room.originalAudio,
      targetText: room.targetText || null,
      speakerName: room.currentSpeaker ? room.currentSpeaker.name : "Speaker",
      speaker: room.currentSpeaker ? room.currentSpeaker.name : "Speaker",
    });

    console.log(`[Game] Room ${roomCode}: All imitations completed! Moving to results.`);
  }

  // Helper to compute rankings and finish round
  function checkAndComputeRankings(room, roomCode) {
    if (!room || !room.rankings) return;
    const submittedCount = Object.keys(room.rankings).length;

    io.to(roomCode).emit("ranking-submitted", {
      submittedCount,
      totalPlayers: room.players.length,
    });

    if (submittedCount >= room.players.length && room.players.length > 0) {
      const scores = {};
      const imitatorCount = room.turnOrder ? room.turnOrder.length : 1;

      // Lower rank = better (1st place gets most points)
      for (const playerRankings of Object.values(room.rankings)) {
        for (const [playerId, rank] of Object.entries(playerRankings)) {
          if (!scores[playerId]) scores[playerId] = 0;
          scores[playerId] += Math.max(1, imitatorCount - rank + 1);
        }
      }

      io.to(roomCode).emit("final-results", {
        scores,
        rankings: room.rankings,
      });

      console.log(`[Game] Room ${roomCode}: All rankings in! Emitted final-results.`);
    }
  }

  io.on("connection", (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);

    // Create a new room (host)
    socket.on("create-room", ({ hostName }, callback) => {
      const roomCode = generateRoomCode();

      rooms.set(roomCode, {
        host: { id: socket.id, name: hostName },
        players: [{ id: socket.id, name: hostName, isHost: true }],
        gameState: "lobby",
        currentSpeaker: null,
        currentTurnPlayer: null,
        turnOrder: [],
        audios: {},
        rankings: {},
        round: 0,
        originalAudio: null,
        targetText: null,
      });

      socket.join(roomCode);
      socket.roomCode = roomCode;

      console.log(`[Room] Created room ${roomCode} by ${hostName}`);

      callback({
        success: true,
        roomCode,
        localIP: getLocalIP(),
        port,
      });
    });

    // Join an existing room
    socket.on("join-room", ({ roomCode, playerName }, callback) => {
      const code = (roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        callback({ success: false, error: "Room not found. Check the code and try again." });
        return;
      }

      if (room.gameState !== "lobby") {
        callback({ success: false, error: "Game already in progress. Please wait for the next round." });
        return;
      }

      if (room.players.length >= 12) {
        callback({ success: false, error: "Room is full (max 12 players)." });
        return;
      }

      if (room.players.some((p) => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
        callback({ success: false, error: "Name already taken. Choose a different name." });
        return;
      }

      const player = { id: socket.id, name: playerName.trim(), isHost: false };
      room.players.push(player);

      socket.join(code);
      socket.roomCode = code;

      // Notify all players in the room
      io.to(code).emit("player-joined", {
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
        newPlayer: playerName.trim(),
      });

      console.log(`[Room] ${playerName.trim()} joined room ${code}`);

      callback({
        success: true,
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
      });
    });

    // Host starts the game
    socket.on("start-game", ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room || room.host.id !== socket.id) return;
      if (room.players.length < 2) {
        socket.emit("error-message", { message: "Need at least 2 players to start Party Mode." });
        return;
      }

      room.gameState = "selecting-speaker";
      room.round += 1;
      room.audios = {};
      room.rankings = {};
      room.originalAudio = null;
      room.targetText = null;

      // Pick speaker (rotate or random)
      const speakerIndex = (room.round - 1) % room.players.length;
      room.currentSpeaker = room.players[speakerIndex];

      // Determine turn order (everyone except speaker)
      room.turnOrder = room.players
        .filter((p) => p.id !== room.currentSpeaker.id)
        .sort(() => Math.random() - 0.5);

      room.currentTurnPlayer = null;

      io.to(roomCode).emit("game-started", {
        speaker: { name: room.currentSpeaker.name, id: room.currentSpeaker.id },
        round: room.round,
        totalPlayers: room.players.length,
      });

      console.log(`[Game] Room ${roomCode} started round ${room.round}, speaker: ${room.currentSpeaker.name}`);
    });

    // Speaker submits their original audio & optional target text
    const handleOriginalAudio = ({ roomCode, audioData, targetText }) => {
      const room = rooms.get(roomCode);
      if (!room || !room.currentSpeaker || room.currentSpeaker.id !== socket.id) return;

      room.originalAudio = audioData;
      room.targetText = targetText || null;
      room.gameState = "playing-reversed";

      const payload = {
        originalAudio: audioData,
        audioData: audioData,
        speakerName: room.currentSpeaker.name,
        speaker: room.currentSpeaker.name,
        targetText: room.targetText,
      };

      // Notify all players (support both event names)
      io.to(roomCode).emit("original-audio-submitted", payload);
      io.to(roomCode).emit("original-submitted", payload);

      console.log(`[Game] Room ${roomCode}: original audio submitted by ${room.currentSpeaker.name} (phrase: "${room.targetText || 'n/a'}")`);
    };
    socket.on("submit-original-audio", handleOriginalAudio);

    // Start turns after listening (support both events)
    const handleNextTurn = ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      advanceToNextTurn(room, roomCode);
    };
    socket.on("request-next-turn", handleNextTurn);
    socket.on("ready-to-imitate", handleNextTurn);

    // Host can skip an inactive player's turn
    const handleSkip = ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room || room.host.id !== socket.id) return;
      if (room.currentTurnPlayer) {
        console.log(`[Game] Room ${roomCode}: Host skipped turn for ${room.currentTurnPlayer.name}`);
        room.audios[room.currentTurnPlayer.id] = {
          playerName: room.currentTurnPlayer.name,
          audioData: "",
          playerId: room.currentTurnPlayer.id,
          skipped: true,
        };
        advanceToNextTurn(room, roomCode);
      }
    };
    socket.on("skip-turn", handleSkip);
    socket.on("skip-current-turn", handleSkip);

    // An imitator submits their imitation audio (support both events)
    const handleSubmitImitation = ({ roomCode, audioData, playerName }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      const player = room.players.find((p) => p.id === socket.id);
      const name = playerName || player?.name || "Player";

      room.audios[socket.id] = {
        playerName: name,
        audioData,
        playerId: socket.id,
      };

      const submittedCount = Object.keys(room.audios).length;
      const totalImitators = room.turnOrder ? room.turnOrder.length : 1;

      // Notify everyone about submission progress
      io.to(roomCode).emit("imitation-submitted", {
        playerName: name,
        playerId: socket.id,
        submittedCount,
        totalImitators,
        currentTurnPlayer: room.currentTurnPlayer,
        turnNumber: submittedCount,
      });

      console.log(`[Game] Room ${roomCode}: ${name} submitted imitation (${submittedCount}/${totalImitators})`);

      // Automatically advance to the next player or finish!
      advanceToNextTurn(room, roomCode);
    };
    socket.on("submit-imitation", handleSubmitImitation);
    socket.on("submit-imitation-audio", handleSubmitImitation);

    // Submit rankings (support both events)
    const handleSubmitRanking = ({ roomCode, rankings }) => {
      const room = rooms.get(roomCode);
      if (!room) return;

      if (!room.rankings) room.rankings = {};
      room.rankings[socket.id] = rankings;

      checkAndComputeRankings(room, roomCode);
    };
    socket.on("submit-ranking", handleSubmitRanking);
    socket.on("submit-rankings", handleSubmitRanking);

    // Host requests new round (support both events)
    const handleNewRound = ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room || room.host.id !== socket.id) return;

      room.gameState = "lobby";
      room.audios = {};
      room.rankings = {};
      room.originalAudio = null;
      room.targetText = null;
      room.currentSpeaker = null;
      room.currentTurnPlayer = null;
      room.turnOrder = [];

      io.to(roomCode).emit("return-to-lobby", {
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
      });
    };
    socket.on("new-round", handleNewRound);
    socket.on("next-round", handleNewRound);

    // Handle disconnect
    socket.on("disconnect", () => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;

      const room = rooms.get(roomCode);
      if (!room) return;

      const disconnectedPlayer = room.players.find((p) => p.id === socket.id);
      room.players = room.players.filter((p) => p.id !== socket.id);

      // Clean up empty room
      if (room.players.length === 0) {
        rooms.delete(roomCode);
        console.log(`[Room] Room ${roomCode} deleted (empty)`);
        return;
      }

      // If host left, assign new host to the first remaining player
      if (room.host.id === socket.id && room.players.length > 0) {
        room.host = room.players[0];
        room.players[0].isHost = true;
      }

      // Remove from turn order if game is running
      if (room.turnOrder) {
        room.turnOrder = room.turnOrder.filter((p) => p.id !== socket.id);
      }
      if (room.rankings && room.rankings[socket.id]) {
        delete room.rankings[socket.id];
      }

      io.to(roomCode).emit("player-left", {
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
        leftPlayer: disconnectedPlayer?.name || "Unknown",
      });

      console.log(`[Room] ${disconnectedPlayer?.name || socket.id} left room ${roomCode}`);

      // Handle in-game state resilience
      if (room.gameState !== "lobby") {
        // If the speaker left before submitting audio
        if (room.currentSpeaker && room.currentSpeaker.id === socket.id && !room.originalAudio) {
          if (room.players.length >= 2) {
            // Pick a new speaker
            room.currentSpeaker = room.players[0];
            room.turnOrder = room.players.filter((p) => p.id !== room.currentSpeaker.id);
            io.to(roomCode).emit("game-started", {
              speaker: { name: room.currentSpeaker.name, id: room.currentSpeaker.id },
              round: room.round,
              totalPlayers: room.players.length,
            });
            io.to(roomCode).emit("error-message", {
              message: `The speaker left. ${room.currentSpeaker.name} is now the new speaker!`,
            });
          } else {
            // Not enough players, return to lobby
            room.gameState = "lobby";
            io.to(roomCode).emit("return-to-lobby", {
              players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
            });
          }
          return;
        }

        // If the current turn player disconnected, advance
        if (room.currentTurnPlayer && room.currentTurnPlayer.id === socket.id) {
          advanceToNextTurn(room, roomCode);
        } else if (room.gameState === "playing-reversed" || room.gameState === "selecting-speaker") {
          // Check if all remaining imitators have submitted
          if (room.turnOrder && Object.keys(room.audios).length >= room.turnOrder.length) {
            finishImitations(room, roomCode);
          }
        } else if (room.gameState === "results") {
          checkAndComputeRankings(room, roomCode);
        }
      }
    });
  });

  httpServer.listen(port, hostname, () => {
    const localIP = getLocalIP();
    console.log(`\n🎮 Rev3rse Game Server running!`);
    console.log(`   Local:   http://localhost:${port}`);
    console.log(`   Network: http://${localIP}:${port}`);
    console.log(`\n   Share the Network URL or QR code for Party Mode!\n`);
  });
});
