"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import type { Socket } from "socket.io-client"

// Generate a random 6-character room code (avoiding ambiguous letters)
function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

const PEER_PREFIX = "rev3rse-v2-"

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
]

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false)
  const [myId, setMyId] = useState<string | null>(null)
  const transportRef = useRef<"detecting" | "socket.io" | "webrtc">("detecting")

  const socketRef = useRef<Socket | null>(null)
  const peerInstanceRef = useRef<any>(null)
  const clientConnRef = useRef<any>(null)
  const hostConnectionsRef = useRef<Map<string, any>>(new Map())
  const listenersRef = useRef<Map<string, Set<(...args: any[]) => void>>>(new Map())
  const reqCallbacksRef = useRef<Map<string, (res: any) => void>>(new Map())

  // WebRTC Host state (used when this browser creates a room on Vercel / P2P)
  const hostRoomRef = useRef<{
    roomCode: string
    host: { id: string; name: string }
    players: Array<{ id: string; name: string; isHost: boolean }>
    gameState: "lobby" | "selecting-speaker" | "playing-reversed" | "results"
    currentSpeaker: { id: string; name: string } | null
    currentTurnPlayer: { id: string; name: string } | null
    turnOrder: Array<{ id: string; name: string; isHost: boolean }>
    audios: Record<string, { playerName: string; audioData: string; playerId: string; skipped?: boolean }>
    rankings: Record<string, any>
    round: number
    originalAudio: string | null
    targetText: string | null
  } | null>(null)

  // Local event emitter dispatcher
  const triggerLocal = useCallback((event: string, ...args: any[]) => {
    const handlers = listenersRef.current.get(event)
    if (handlers) {
      handlers.forEach((h) => {
        try {
          h(...args)
        } catch (err) {
          console.error(`[Transport] Error in handler for event '${event}':`, err)
        }
      })
    }
  }, [])

  // WebRTC Host: broadcast an event to all connected player data channels AND local host
  const broadcastToRoom = useCallback(
    (event: string, payload: any) => {
      hostConnectionsRef.current.forEach((conn) => {
        try {
          if (conn.open) {
            conn.send({ type: "event", event, payload })
          }
        } catch (e) {
          console.error("[Host] Broadcast error:", e)
        }
      })
      triggerLocal(event, payload)
    },
    [triggerLocal],
  )

  // WebRTC Host: Helper to advance to next imitator turn or finish imitations
  const advanceToNextTurn = useCallback(
    (room: NonNullable<typeof hostRoomRef.current>) => {
      if (!room || !room.turnOrder) return

      const pendingPlayer = room.turnOrder.find((p) => !room.audios[p.id])

      if (pendingPlayer) {
        room.currentTurnPlayer = pendingPlayer
        const turnNumber = Object.keys(room.audios).length + 1

        broadcastToRoom("your-turn", {
          player: { name: pendingPlayer.name, id: pendingPlayer.id },
          turnNumber,
          totalTurns: room.turnOrder.length,
          totalImitators: room.turnOrder.length,
        })
      } else {
        // All imitations done!
        if (room.gameState !== "results") {
          room.gameState = "results"
          const allAudios = Object.values(room.audios).map((a) => ({
            playerName: a.playerName,
            audioData: a.audioData,
            playerId: a.playerId,
            skipped: a.skipped,
          }))

          broadcastToRoom("all-imitations-done", {
            allAudios,
            audios: allAudios,
            originalAudio: room.originalAudio,
            targetText: room.targetText || null,
            speakerName: room.currentSpeaker ? room.currentSpeaker.name : "Speaker",
            speaker: room.currentSpeaker ? room.currentSpeaker.name : "Speaker",
          })
        }
      }
    },
    [broadcastToRoom],
  )

  // WebRTC Host: Helper to check rankings and compute scores
  const checkAndComputeRankings = useCallback(
    (room: NonNullable<typeof hostRoomRef.current>) => {
      if (!room || !room.rankings) return
      const submittedCount = Object.keys(room.rankings).length

      broadcastToRoom("ranking-submitted", {
        submittedCount,
        totalPlayers: room.players.length,
      })

      if (submittedCount >= room.players.length && room.players.length > 0) {
        const scores: Record<string, number> = {}
        const imitatorCount = room.turnOrder ? room.turnOrder.length : 1

        // Lower rank index = better (1st place gets most points)
        for (const playerRankings of Object.values(room.rankings)) {
          if (Array.isArray(playerRankings)) {
            playerRankings.forEach((playerId, index) => {
              if (!scores[playerId]) scores[playerId] = 0
              scores[playerId] += Math.max(1, imitatorCount - index)
            })
          } else if (typeof playerRankings === "object") {
            for (const [playerId, rank] of Object.entries(playerRankings)) {
              if (!scores[playerId]) scores[playerId] = 0
              scores[playerId] += Math.max(1, imitatorCount - (rank as number) + 1)
            }
          }
        }

        broadcastToRoom("final-results", {
          scores,
          rankings: room.rankings,
        })
      }
    },
    [broadcastToRoom],
  )

  // Initialize Transport (Dual Engine: Socket.IO if server is running, WebRTC P2P fallback for Vercel)
  useEffect(() => {
    let isMounted = true
    let socketTimeout: NodeJS.Timeout | null = null

    async function initTransport() {
      // 1. Check if dedicated Socket.IO URL is provided or attempt origin
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || ""

      try {
        const { io } = await import("socket.io-client")
        const s = io(socketUrl, {
          transports: ["websocket", "polling"],
          timeout: 2000,
          reconnectionAttempts: 1,
        })

        socketRef.current = s

        s.on("connect", () => {
          if (!isMounted) return
          if (socketTimeout) clearTimeout(socketTimeout)
          transportRef.current = "socket.io"
          setIsConnected(true)
          setMyId(s.id || null)
          console.log("[Transport] Connected via Socket.IO:", s.id)
        })

        s.on("disconnect", () => {
          if (!isMounted) return
          if (transportRef.current === "socket.io") {
            setIsConnected(false)
          }
        })

        s.on("connect_error", () => {
          // If socket fails (as on Vercel serverless), fall back smoothly to WebRTC P2P
          if (transportRef.current === "detecting" && isMounted) {
            console.log("[Transport] Socket.IO unavailable. Switching to WebRTC P2P mode (Vercel serverless compatible).")
            transportRef.current = "webrtc"
            setIsConnected(true)
            const fallbackId = `peer_${Math.random().toString(36).substring(2, 9)}`
            setMyId(fallbackId)
          }
        })

        socketTimeout = setTimeout(() => {
          if (transportRef.current === "detecting" && isMounted) {
            console.log("[Transport] Socket.IO connection timed out. Falling back to WebRTC P2P mode.")
            transportRef.current = "webrtc"
            setIsConnected(true)
            const fallbackId = `peer_${Math.random().toString(36).substring(2, 9)}`
            setMyId(fallbackId)
          }
        }, 1500)
      } catch {
        if (isMounted) {
          transportRef.current = "webrtc"
          setIsConnected(true)
          setMyId(`peer_${Math.random().toString(36).substring(2, 9)}`)
        }
      }
    }

    initTransport()

    return () => {
      isMounted = false
      if (socketTimeout) clearTimeout(socketTimeout)
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
      if (peerInstanceRef.current) {
        try {
          peerInstanceRef.current.destroy()
        } catch {}
      }
    }
  }, [])

  // WebRTC Host: Handle incoming request from client connection
  const handleHostIncomingMessage = useCallback(
    (conn: any, msg: any) => {
      if (!msg || typeof msg !== "object") return
      const room = hostRoomRef.current
      if (!room) return

      const { type, reqId, event, data } = msg

      if (type === "req") {
        if (event === "join-room") {
          const { playerName } = data
          if (room.gameState !== "lobby") {
            conn.send({
              type: "res",
              reqId,
              response: { success: false, error: "Game already in progress. Please wait for the next round." },
            })
            return
          }

          if (room.players.length >= 12) {
            conn.send({
              type: "res",
              reqId,
              response: { success: false, error: "Room is full (max 12 players)." },
            })
            return
          }

          if (room.players.some((p) => p.name.toLowerCase() === playerName.trim().toLowerCase())) {
            conn.send({
              type: "res",
              reqId,
              response: { success: false, error: "Name already taken. Choose a different name." },
            })
            return
          }

          const newPlayer = { id: conn.peer, name: playerName.trim(), isHost: false }
          room.players.push(newPlayer)
          hostConnectionsRef.current.set(conn.peer, conn)

          conn.send({
            type: "res",
            reqId,
            response: { success: true, players: room.players },
          })

          broadcastToRoom("player-joined", {
            players: room.players,
            newPlayer: playerName.trim(),
          })
        } else if (event === "submit-original-audio") {
          room.originalAudio = data.audioData
          room.targetText = data.targetText || null
          room.gameState = "playing-reversed"

          broadcastToRoom("original-audio-submitted", {
            originalAudio: data.audioData,
            audioData: data.audioData,
            speakerName: room.currentSpeaker?.name || "Speaker",
            speaker: room.currentSpeaker?.name || "Speaker",
            targetText: room.targetText,
          })
        } else if (event === "ready-to-imitate" || event === "request-next-turn") {
          advanceToNextTurn(room)
        } else if (event === "submit-imitation-audio" || event === "submit-imitation") {
          const senderPlayer = room.players.find((p) => p.id === conn.peer)
          const pName = senderPlayer ? senderPlayer.name : "Player"
          room.audios[conn.peer] = {
            playerName: pName,
            audioData: data.audioData,
            playerId: conn.peer,
          }

          const submittedCount = Object.keys(room.audios).length
          const totalImitators = room.turnOrder ? room.turnOrder.length : 1

          broadcastToRoom("imitation-submitted", {
            playerName: pName,
            playerId: conn.peer,
            submittedCount,
            totalImitators,
            currentTurnPlayer: room.currentTurnPlayer,
            turnNumber: submittedCount,
          })

          advanceToNextTurn(room)
        } else if (event === "skip-current-turn" || event === "skip-turn") {
          if (room.currentTurnPlayer) {
            room.audios[room.currentTurnPlayer.id] = {
              playerName: room.currentTurnPlayer.name,
              audioData: "",
              playerId: room.currentTurnPlayer.id,
              skipped: true,
            }
            advanceToNextTurn(room)
          }
        } else if (event === "submit-rankings" || event === "submit-ranking") {
          if (!room.rankings) room.rankings = {}
          room.rankings[conn.peer] = data.rankings
          checkAndComputeRankings(room)
        }
      }
    },
    [broadcastToRoom, advanceToNextTurn, checkAndComputeRankings],
  )

  // Emit event abstraction
  const emit = useCallback(
    async (event: string, data?: any, callback?: (response: any) => void) => {
      // 1. If connected via Socket.IO, route through native socket
      if (transportRef.current === "socket.io" && socketRef.current) {
        if (callback) {
          socketRef.current.emit(event, data, callback)
        } else {
          socketRef.current.emit(event, data)
        }
        return
      }

      // 2. WebRTC P2P Mode (Vercel Serverless)
      const { Peer } = await import("peerjs")

      if (event === "create-room") {
        const roomCode = generateRoomCode()
        const peerId = `${PEER_PREFIX}${roomCode.toLowerCase()}`

        try {
          if (peerInstanceRef.current) {
            try {
              peerInstanceRef.current.destroy()
            } catch {}
          }

          const hostPeer = new Peer(peerId, {
            debug: 1,
            config: { iceServers: ICE_SERVERS },
          })

          peerInstanceRef.current = hostPeer

          hostPeer.on("open", (id: string) => {
            console.log("[P2P Host] Room created with Peer ID:", id)
            setMyId(id)

            hostRoomRef.current = {
              roomCode,
              host: { id, name: data.hostName },
              players: [{ id, name: data.hostName, isHost: true }],
              gameState: "lobby",
              currentSpeaker: null,
              currentTurnPlayer: null,
              turnOrder: [],
              audios: {},
              rankings: {},
              round: 0,
              originalAudio: null,
              targetText: null,
            }

            if (callback) {
              callback({
                success: true,
                roomCode,
                localIP: typeof window !== "undefined" ? window.location.hostname : "localhost",
                port: typeof window !== "undefined" && window.location.port ? parseInt(window.location.port, 10) : 443,
              })
            }
          })

          hostPeer.on("connection", (conn: any) => {
            console.log("[P2P Host] New peer connected:", conn.peer)

            // Immediately attach data handler (do not wait or nest in conn.on('open'))
            conn.on("data", (msg: any) => {
              console.log("[P2P Host] Received data from peer:", conn.peer, msg?.event || msg?.type)
              handleHostIncomingMessage(conn, msg)
            })

            conn.on("open", () => {
              console.log("[P2P Host] DataChannel opened with peer:", conn.peer)
            })

            conn.on("error", (err: any) => {
              console.error("[P2P Host] Peer connection error:", err)
            })

            conn.on("close", () => {
              console.log("[P2P Host] Peer disconnected:", conn.peer)
              hostConnectionsRef.current.delete(conn.peer)
              const room = hostRoomRef.current
              if (room) {
                const disconnected = room.players.find((p) => p.id === conn.peer)
                room.players = room.players.filter((p) => p.id !== conn.peer)
                if (room.turnOrder) {
                  room.turnOrder = room.turnOrder.filter((p) => p.id !== conn.peer)
                }
                broadcastToRoom("player-left", {
                  players: room.players,
                  leftPlayer: disconnected?.name || "Player",
                })
              }
            })
          })

          hostPeer.on("error", (err: any) => {
            console.error("[P2P Host] Error:", err)
            if (callback) {
              callback({ success: false, error: "Failed to initialize P2P room. Please try again." })
            }
          })
        } catch (e: any) {
          console.error("[P2P Host] Init failed:", e)
          if (callback) {
            callback({ success: false, error: e?.message || "P2P initialization error" })
          }
        }
        return
      }

      if (event === "join-room") {
        const rawCode = (data.roomCode || "").trim().toLowerCase()
        const targetHostId = `${PEER_PREFIX}${rawCode}`

        try {
          if (peerInstanceRef.current) {
            try {
              peerInstanceRef.current.destroy()
            } catch {}
          }

          const clientPeer = new Peer({
            debug: 1,
            config: { iceServers: ICE_SERVERS },
          })

          peerInstanceRef.current = clientPeer

          clientPeer.on("open", (id: string) => {
            setMyId(id)
            console.log("[P2P Client] Connected to signaling with ID:", id, "Connecting to host:", targetHostId)
            const conn = clientPeer.connect(targetHostId, { reliable: true })
            clientConnRef.current = conn

            let joinSent = false
            const sendJoinReq = () => {
              if (joinSent) return
              joinSent = true
              const reqId = Math.random().toString(36).substring(2, 9)
              console.log("[P2P Client] Sending join-room request:", reqId, data)
              if (callback) {
                reqCallbacksRef.current.set(reqId, callback)
              }

              conn.send({
                type: "req",
                reqId,
                event: "join-room",
                data,
              })

              setTimeout(() => {
                if (reqCallbacksRef.current.has(reqId)) {
                  console.warn("[P2P Client] Join request timed out for reqId:", reqId)
                  const cb = reqCallbacksRef.current.get(reqId)
                  reqCallbacksRef.current.delete(reqId)
                  cb?.({ success: false, error: "Host did not respond. Check room code." })
                }
              }, 10000)
            }

            // Immediately attach data handler
            conn.on("data", (msg: any) => {
              console.log("[P2P Client] Received data from host:", msg?.type, msg?.event)
              if (!msg || typeof msg !== "object") return
              if (msg.type === "res" && msg.reqId) {
                const cb = reqCallbacksRef.current.get(msg.reqId)
                if (cb) {
                  cb(msg.response)
                  reqCallbacksRef.current.delete(msg.reqId)
                }
              } else if (msg.type === "event" && msg.event) {
                triggerLocal(msg.event, msg.payload)
              }
            })

            if (conn.open) {
              sendJoinReq()
            } else {
              conn.on("open", () => {
                console.log("[P2P Client] Connected to host DataChannel successfully")
                sendJoinReq()
              })
            }

            conn.on("error", (err: any) => {
              console.error("[P2P Client] Connection error:", err)
              if (callback) {
                callback({ success: false, error: "Could not connect to host. Check room code." })
              }
            })
          })

          clientPeer.on("error", (err: any) => {
            console.error("[P2P Client] Peer error:", err)
            if (callback) {
              callback({ success: false, error: "Room not found or host is offline." })
            }
          })
        } catch (e: any) {
          console.error("[P2P Client] Join error:", e)
          if (callback) {
            callback({ success: false, error: "Connection failed" })
          }
        }
        return
      }

      // 3. Gameplay actions within P2P Room
      // If we are Host:
      if (hostRoomRef.current) {
        const room = hostRoomRef.current

        if (event === "start-game") {
          room.gameState = "selecting-speaker"
          room.round += 1
          room.audios = {}
          room.rankings = {}
          room.originalAudio = null
          room.targetText = null

          const speakerIndex = (room.round - 1) % room.players.length
          room.currentSpeaker = room.players[speakerIndex]
          room.turnOrder = room.players
            .filter((p) => p.id !== room.currentSpeaker?.id)
            .sort(() => Math.random() - 0.5)

          room.currentTurnPlayer = null

          broadcastToRoom("game-started", {
            speaker: { name: room.currentSpeaker.name, id: room.currentSpeaker.id },
            round: room.round,
            totalPlayers: room.players.length,
            totalImitators: room.turnOrder.length,
          })
        } else if (event === "submit-original-audio") {
          room.originalAudio = data.audioData
          room.targetText = data.targetText || null
          room.gameState = "playing-reversed"

          broadcastToRoom("original-audio-submitted", {
            originalAudio: data.audioData,
            audioData: data.audioData,
            speakerName: room.currentSpeaker?.name || "Speaker",
            speaker: room.currentSpeaker?.name || "Speaker",
            targetText: room.targetText,
          })
        } else if (event === "ready-to-imitate" || event === "request-next-turn") {
          advanceToNextTurn(room)
        } else if (event === "submit-imitation-audio" || event === "submit-imitation") {
          const myIdVal = myId || "host"
          const hostPlayer = room.players.find((p) => p.isHost)
          room.audios[myIdVal] = {
            playerName: hostPlayer?.name || "Host",
            audioData: data.audioData,
            playerId: myIdVal,
          }

          const submittedCount = Object.keys(room.audios).length
          const totalImitators = room.turnOrder ? room.turnOrder.length : 1

          broadcastToRoom("imitation-submitted", {
            playerName: hostPlayer?.name || "Host",
            playerId: myIdVal,
            submittedCount,
            totalImitators,
            currentTurnPlayer: room.currentTurnPlayer,
            turnNumber: submittedCount,
          })

          advanceToNextTurn(room)
        } else if (event === "skip-current-turn" || event === "skip-turn") {
          if (room.currentTurnPlayer) {
            room.audios[room.currentTurnPlayer.id] = {
              playerName: room.currentTurnPlayer.name,
              audioData: "",
              playerId: room.currentTurnPlayer.id,
              skipped: true,
            }
            advanceToNextTurn(room)
          }
        } else if (event === "submit-rankings" || event === "submit-ranking") {
          const myIdVal = myId || "host"
          if (!room.rankings) room.rankings = {}
          room.rankings[myIdVal] = data.rankings
          checkAndComputeRankings(room)
        } else if (event === "next-round" || event === "new-round") {
          room.gameState = "lobby"
          room.audios = {}
          room.rankings = {}
          room.originalAudio = null
          room.targetText = null
          room.currentSpeaker = null
          room.currentTurnPlayer = null
          room.turnOrder = []

          broadcastToRoom("return-to-lobby", {
            players: room.players,
          })
        }
        return
      }

      // If we are a Contestant Peer connected to Host:
      if (clientConnRef.current && clientConnRef.current.open) {
        clientConnRef.current.send({
          type: "req",
          reqId: Math.random().toString(36).substring(2, 9),
          event,
          data,
        })
      }
    },
    [broadcastToRoom, advanceToNextTurn, checkAndComputeRankings, handleHostIncomingMessage, myId],
  )

  // Subscribe to socket/webrtc events
  const on = useCallback(
    (event: string, handler: (...args: any[]) => void) => {
      // Also register on Socket.IO if it is active
      if (socketRef.current) {
        socketRef.current.on(event, handler)
      }

      // Register in local listeners Map (used by P2P WebRTC)
      if (!listenersRef.current.has(event)) {
        listenersRef.current.set(event, new Set())
      }
      listenersRef.current.get(event)!.add(handler)

      return () => {
        if (socketRef.current) {
          socketRef.current.off(event, handler)
        }
        listenersRef.current.get(event)?.delete(handler)
      }
    },
    [],
  )

  const off = useCallback((event: string, handler?: (...args: any[]) => void) => {
    if (socketRef.current) {
      if (handler) {
        socketRef.current.off(event, handler)
      } else {
        socketRef.current.removeAllListeners(event)
      }
    }

    if (handler) {
      listenersRef.current.get(event)?.delete(handler)
    } else {
      listenersRef.current.delete(event)
    }
  }, [])

  return {
    socket: socketRef.current,
    isConnected,
    emit,
    on,
    off,
    id: myId || socketRef.current?.id || null,
  }
}
