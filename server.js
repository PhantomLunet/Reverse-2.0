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

// Get local IP for LAN access, filtering out virtual switches/adapters
function getLocalIP() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  if (process.env.PUBLIC_URL) {
    try {
      const u = new URL(process.env.PUBLIC_URL);
      return u.hostname;
    } catch {}
  }

  const interfaces = os.networkInterfaces();
  const virtualRegex = /(vethernet|virtual|vbox|vmware|wsl|docker|loopback|pseudo|tailscale|hamachi)/i;
  const preferredRegex = /(wi-?fi|wireless|wlan|eth|ethernet|en\d+)/i;

  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    const isVirtual = virtualRegex.test(name);
    const isPreferred = preferredRegex.test(name);

    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        if (iface.address.startsWith("127.") || iface.address.startsWith("169.254.")) {
          continue;
        }

        let score = 0;
        if (!isVirtual) score += 50;
        if (isPreferred) score += 40;
        if (iface.address.startsWith("192.168.")) score += 30;
        else if (iface.address.startsWith("10.")) score += 20;
        else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(iface.address) && isVirtual) {
          score -= 30;
        }

        candidates.push({ address: iface.address, name, score });
      }
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].address;
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
    cors: {
      origin: "*",
      methods: ["GET", "POST", "OPTIONS"],
      credentials: false,
    },
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

    // Join an existing room (with seamless reconnect support)
    socket.on("join-room", ({ roomCode, playerName }, callback) => {
      const code = (roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        callback({ success: false, error: "Room not found. Check the code and try again." });
        return;
      }

      const pName = (playerName || "").trim();
      if (!pName) {
        callback({ success: false, error: "Please enter a valid nickname." });
        return;
      }

      // Check if this player is already registered (reconnecting or refreshed)
      const existingPlayer = room.players.find(
        (p) => p.name.toLowerCase() === pName.toLowerCase()
      );

      if (existingPlayer) {
        // Player rejoining! Update their active socket ID
        existingPlayer.id = socket.id;
        if (existingPlayer.isHost) {
          room.host.id = socket.id;
        }

        socket.join(code);
        socket.roomCode = code;

        console.log(`[Room] ${pName} reconnected to room ${code} (state: ${room.gameState})`);

        // Broadcast updated roster to all clients
        io.to(code).emit("player-joined", {
          players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
          newPlayer: pName,
        });

        // Provide complete room & game state so the reconnecting player can jump right in
        callback({
          success: true,
          players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
          gameState: room.gameState,
          round: room.round,
          speaker: room.currentSpeaker ? { name: room.currentSpeaker.name, id: room.currentSpeaker.id } : null,
          targetText: room.targetText,
          originalAudio: room.originalAudio,
          currentTurnPlayer: room.currentTurnPlayer ? { name: room.currentTurnPlayer.name, id: room.currentTurnPlayer.id } : null,
        });

        // If game is in progress, also re-dispatch the current phase event to this socket
        if (room.gameState === "selecting-speaker" && room.currentSpeaker) {
          socket.emit("game-started", {
            speaker: { name: room.currentSpeaker.name, id: room.currentSpeaker.id },
            round: room.round,
            totalPlayers: room.players.length,
          });
        } else if (room.gameState === "playing-reversed" && room.originalAudio) {
          socket.emit("original-audio-submitted", {
            originalAudio: room.originalAudio,
            audioData: room.originalAudio,
            speakerName: room.currentSpeaker ? room.currentSpeaker.name : "Speaker",
            speaker: room.currentSpeaker ? room.currentSpeaker.name : "Speaker",
            speakerId: room.currentSpeaker ? room.currentSpeaker.id : null,
            targetText: room.targetText,
            totalImitators: room.turnOrder ? room.turnOrder.length : 0,
          });
        }
        return;
      }

      // New player trying to join an already started game
      if (room.gameState !== "lobby") {
        callback({ success: false, error: "Game already in progress. Please wait for the next round." });
        return;
      }

      if (room.players.length >= 12) {
        callback({ success: false, error: "Room is full (max 12 players)." });
        return;
      }

      const player = { id: socket.id, name: pName, isHost: false };
      room.players.push(player);

      socket.join(code);
      socket.roomCode = code;

      // Notify all players in the room with fresh cloned roster
      io.to(code).emit("player-joined", {
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
        newPlayer: pName,
      });

      console.log(`[Room] ${pName} joined room ${code} (total: ${room.players.length})`);

      callback({
        success: true,
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
        gameState: room.gameState,
      });
    });

    // Room state synchronization heartbeat
    socket.on("sync-room-state", ({ roomCode, playerName }, callback) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);

      if (!room) {
        if (callback) callback({ success: false, error: "Room not found" });
        return;
      }

      if (playerName) {
        const pName = playerName.trim();
        const existing = room.players.find((p) => p.name.toLowerCase() === pName.toLowerCase());
        if (existing) {
          existing.id = socket.id;
          if (existing.isHost) room.host.id = socket.id;
          socket.join(code);
          socket.roomCode = code;
        }
      }

      if (callback) {
        callback({
          success: true,
          players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
          gameState: room.gameState,
          round: room.round,
          speaker: room.currentSpeaker ? { name: room.currentSpeaker.name, id: room.currentSpeaker.id } : null,
          targetText: room.targetText,
          originalAudio: room.originalAudio,
          currentTurnPlayer: room.currentTurnPlayer ? { name: room.currentTurnPlayer.name, id: room.currentTurnPlayer.id } : null,
          readyCount: room.readyImitators ? room.readyImitators.size : 0,
          totalNeeded: room.turnOrder ? room.turnOrder.length : 0,
        });
      }
    });

    // Host starts the game
    socket.on("start-game", ({ roomCode }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return;

      // Allow starting if socket matches host ID or belongs to a player marked as host
      const isHostSocket = room.host.id === socket.id || room.players.some((p) => p.isHost && p.id === socket.id);
      if (!isHostSocket) {
        console.warn(`[Game] Non-host ${socket.id} attempted to start room ${code}`);
        return;
      }

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

      // Pick speaker (rotate through players)
      const speakerIndex = (room.round - 1) % room.players.length;
      room.currentSpeaker = room.players[speakerIndex];

      // Determine turn order (everyone except speaker)
      room.turnOrder = room.players
        .filter((p) => p.id !== room.currentSpeaker.id)
        .sort(() => Math.random() - 0.5);

      room.currentTurnPlayer = null;

      const gamePayload = {
        speaker: { name: room.currentSpeaker.name, id: room.currentSpeaker.id },
        round: room.round,
        totalPlayers: room.players.length,
        totalImitators: room.turnOrder.length,
      };

      // Broadcast to entire room
      io.to(code).emit("game-started", gamePayload);

      console.log(`[Game] Room ${code} started round ${room.round}, speaker: ${room.currentSpeaker.name}`);
    });

    // Speaker submits their original audio & optional target text
    const handleOriginalAudio = ({ roomCode, audioData, targetText }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || !room.currentSpeaker || (room.currentSpeaker.id !== socket.id && room.currentSpeaker.name !== (room.players.find(p => p.id === socket.id)?.name))) return;

      room.originalAudio = audioData;
      room.targetText = targetText || null;
      room.gameState = "playing-reversed";
      room.readyImitators = new Set();

      const totalNeeded = room.turnOrder ? room.turnOrder.length : 0;
      const payload = {
        originalAudio: audioData,
        audioData: audioData,
        speakerName: room.currentSpeaker.name,
        speaker: room.currentSpeaker.name,
        speakerId: room.currentSpeaker.id,
        targetText: room.targetText,
        totalImitators: totalNeeded,
      };

      // Notify all players (support both event names)
      io.to(code).emit("original-audio-submitted", payload);
      io.to(code).emit("original-submitted", payload);

      console.log(`[Game] Room ${code}: original audio submitted by ${room.currentSpeaker.name} (phrase: "${room.targetText || 'n/a'}", waiting for ${totalNeeded} imitators)`);
    };
    socket.on("submit-original-audio", handleOriginalAudio);

    // Handle player confirming they are ready to imitate
    const handleReadyToImitate = ({ roomCode, playerName }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || !room.turnOrder || room.gameState !== "playing-reversed") return;

      if (!room.readyImitators) room.readyImitators = new Set();
      room.readyImitators.add(socket.id);

      const totalNeeded = room.turnOrder.length;
      const readyCount = room.readyImitators.size;
      const pName = playerName || (room.players.find((p) => p.id === socket.id)?.name) || "Player";

      // Broadcast ready count update to all players
      io.to(code).emit("imitator-ready-update", {
        readyCount,
        totalNeeded,
        readyPlayerId: socket.id,
        readyPlayerName: pName,
      });

      console.log(`[Game] Room ${code}: Imitator ready ${readyCount}/${totalNeeded} (${pName})`);

      // Once all contestants in turnOrder have confirmed ready, start the round!
      if (readyCount >= totalNeeded) {
        console.log(`[Game] Room ${code}: All ${totalNeeded} imitators ready! Starting turns.`);
        io.to(code).emit("all-imitators-ready", {
          totalImitators: totalNeeded,
        });

        setTimeout(() => {
          advanceToNextTurn(room, code);
        }, 500);
      }
    };
    socket.on("ready-to-imitate", handleReadyToImitate);

    // Host can force start turns if someone is inactive or taking too long
    const handleForceStartTurns = ({ roomCode }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room || room.gameState !== "playing-reversed") return;
      const isHostSocket = room.host.id === socket.id || room.players.some((p) => p.isHost && p.id === socket.id);
      if (!isHostSocket) return;
      console.log(`[Game] Room ${code}: Host force-started turns.`);
      io.to(code).emit("all-imitators-ready", {
        totalImitators: room.turnOrder ? room.turnOrder.length : 1,
        forced: true,
      });
      setTimeout(() => {
        advanceToNextTurn(room, code);
      }, 300);
    };
    socket.on("force-start-turns", handleForceStartTurns);
    socket.on("request-next-turn", handleForceStartTurns);

    // Host can skip an inactive player's turn
    const handleSkip = ({ roomCode }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return;
      const isHostSocket = room.host.id === socket.id || room.players.some((p) => p.isHost && p.id === socket.id);
      if (!isHostSocket) return;
      if (room.currentTurnPlayer) {
        console.log(`[Game] Room ${code}: Host skipped turn for ${room.currentTurnPlayer.name}`);
        room.audios[room.currentTurnPlayer.id] = {
          playerName: room.currentTurnPlayer.name,
          audioData: "",
          playerId: room.currentTurnPlayer.id,
          skipped: true,
        };
        advanceToNextTurn(room, code);
      }
    };
    socket.on("skip-turn", handleSkip);
    socket.on("skip-current-turn", handleSkip);

    // An imitator submits their imitation audio (support both events)
    const handleSubmitImitation = ({ roomCode, audioData, playerName }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
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
      io.to(code).emit("imitation-submitted", {
        playerName: name,
        playerId: socket.id,
        submittedCount,
        totalImitators,
        currentTurnPlayer: room.currentTurnPlayer,
        turnNumber: submittedCount,
      });

      console.log(`[Game] Room ${code}: ${name} submitted imitation (${submittedCount}/${totalImitators})`);

      // Automatically advance to the next player or finish!
      advanceToNextTurn(room, code);
    };
    socket.on("submit-imitation", handleSubmitImitation);
    socket.on("submit-imitation-audio", handleSubmitImitation);

    // Submit rankings (support both events)
    const handleSubmitRanking = ({ roomCode, rankings }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return;

      if (!room.rankings) room.rankings = {};
      room.rankings[socket.id] = rankings;

      checkAndComputeRankings(room, code);
    };
    socket.on("submit-ranking", handleSubmitRanking);
    socket.on("submit-rankings", handleSubmitRanking);

    // Host requests new round (support both events)
    const handleNewRound = ({ roomCode }) => {
      const code = (roomCode || socket.roomCode || "").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return;
      const isHostSocket = room.host.id === socket.id || room.players.some((p) => p.isHost && p.id === socket.id);
      if (!isHostSocket) return;

      room.gameState = "lobby";
      room.audios = {};
      room.rankings = {};
      room.originalAudio = null;
      room.targetText = null;
      room.currentSpeaker = null;
      room.currentTurnPlayer = null;
      room.turnOrder = [];

      io.to(code).emit("return-to-lobby", {
        players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
      });
    };
    socket.on("new-round", handleNewRound);
    socket.on("next-round", handleNewRound);

    // Handle room departure (Back button or disconnect with grace period)
    const disconnectTimeouts = new Map();

    const handlePlayerExit = (reason = "left") => {
      const roomCode = socket.roomCode;
      if (!roomCode) return;

      const room = rooms.get(roomCode);
      if (!room) return;

      const disconnectedPlayer = room.players.find((p) => p.id === socket.id);
      if (!disconnectedPlayer) return;

      const executeRemoval = () => {
        // Double check if player already reconnected with a new socket ID
        const currentP = room.players.find((p) => p.name.toLowerCase() === disconnectedPlayer.name.toLowerCase());
        if (currentP && currentP.id !== socket.id) {
          // Player already reconnected with another socket! Don't delete them.
          return;
        }

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
        if (room.readyImitators) {
          room.readyImitators.delete(socket.id);
        }
        if (room.rankings && room.rankings[socket.id]) {
          delete room.rankings[socket.id];
        }

        io.to(roomCode).emit("player-left", {
          players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
          leftPlayer: disconnectedPlayer?.name || "Player",
        });

        console.log(`[Room] ${disconnectedPlayer?.name || socket.id} removed from room ${roomCode} (${reason})`);

        // Handle in-game state resilience
        if (room.gameState !== "lobby") {
          // If the speaker left before submitting audio
          if (room.currentSpeaker && room.currentSpeaker.id === socket.id && !room.originalAudio) {
            if (room.players.length >= 2) {
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
              room.gameState = "lobby";
              io.to(roomCode).emit("return-to-lobby", {
                players: room.players.map((p) => ({ name: p.name, isHost: p.isHost, id: p.id })),
              });
            }
            return;
          }

          if (room.currentTurnPlayer && room.currentTurnPlayer.id === socket.id) {
            advanceToNextTurn(room, roomCode);
          } else if (room.gameState === "playing-reversed") {
            if (room.turnOrder && room.readyImitators && room.turnOrder.length > 0 && room.readyImitators.size >= room.turnOrder.length) {
              advanceToNextTurn(room, roomCode);
            } else if (room.turnOrder && Object.keys(room.audios).length >= room.turnOrder.length) {
              finishImitations(room, roomCode);
            }
          } else if (room.gameState === "selecting-speaker") {
            if (room.turnOrder && Object.keys(room.audios).length >= room.turnOrder.length) {
              finishImitations(room, roomCode);
            }
          } else if (room.gameState === "results") {
            checkAndComputeRankings(room, roomCode);
          }
        }
      };

      socket.leave(roomCode);
      delete socket.roomCode;

      if (reason === "left") {
        // Explicit exit via leave button -> remove immediately
        executeRemoval();
      } else {
        // Transient network disconnect -> 12-second grace period before removal
        console.log(`[Room] ${disconnectedPlayer.name} disconnected. Holding spot for 12s...`);
        const timer = setTimeout(executeRemoval, 12000);
        disconnectTimeouts.set(`${roomCode}_${disconnectedPlayer.name.toLowerCase()}`, timer);
      }
    };

    socket.on("leave-room", () => handlePlayerExit("left"));
    socket.on("disconnect", () => handlePlayerExit("disconnected"));
  });

  httpServer.listen(port, hostname, () => {
    const localIP = getLocalIP();
    console.log(`\n🎮 Rev3rse Game Server running!`);
    console.log(`   Local:   http://localhost:${port}`);
    console.log(`   Network: http://${localIP}:${port}`);
    console.log(`\n   Share the Network URL or QR code for Party Mode!\n`);
  });
});
