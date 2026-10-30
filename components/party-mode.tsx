"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import Image from "next/image"
import { QRCodeSVG } from "qrcode.react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AudioVisualizer } from "@/components/audio-visualizer"
import { useSocket } from "@/hooks/use-socket"
import { getRandomPhrase, type PhrasePrompt } from "@/lib/phrase-prompts"
import { sfx } from "@/lib/sound-effects"
import { PcmAudioRecorder, decodeAudioSafely } from "@/lib/audio-recorder"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Mic,
  Play,
  Volume2,
  ArrowLeft,
  AlertCircle,
  Users,
  Copy,
  Check,
  Loader2,
  Trophy,
  Award,
  ArrowRight,
  Dices,
  QrCode,
  Share2,
  FastForward,
  RotateCcw,
  Square,
  Sparkles,
  Crown,
  Smartphone,
  Tv,
  ArrowUp,
  ArrowDown,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type PartyPhase =
  | "choose-role"
  | "host-setup"
  | "join-setup"
  | "lobby"
  | "speaker-prompt"
  | "speaker-countdown"
  | "speaker-recording"
  | "listening-reversed"
  | "waiting-turn"
  | "my-turn-countdown"
  | "my-turn-record"
  | "all-done"
  | "results"

interface Player {
  name: string
  isHost: boolean
  id: string
}

interface AudioEntry {
  playerName: string
  audioData: string
  playerId: string
  skipped?: boolean
}

interface DecodedAudioMap {
  [playerId: string]: {
    raw: AudioBuffer | null
    reversed: AudioBuffer | null
  }
}

interface PartyModeProps {
  onBack: () => void
  initialRoomCode?: string
}

const MAX_RECORD_SECONDS = 8
const MAX_REVERSE_PLAYS = 3

export function PartyMode({ onBack, initialRoomCode }: PartyModeProps) {
  const { isConnected, emit, on, id: socketId } = useSocket()

  // Room & Player State
  const [phase, setPhase] = useState<PartyPhase>(() =>
    initialRoomCode ? "join-setup" : "choose-role",
  )
  const [isHost, setIsHost] = useState(false)
  const [hostName, setHostName] = useState("")
  const [playerName, setPlayerName] = useState("")
  const [roomCode, setRoomCode] = useState(() => initialRoomCode || "")
  const [joinCode, setJoinCode] = useState(() => initialRoomCode || "")
  const [players, setPlayers] = useState<Player[]>([])
  const [error, setError] = useState<string | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)
  const [networkInfo, setNetworkInfo] = useState<{ localIP: string; port: number } | null>(null)

  // Speaker phrase & audio state
  const [speaker, setSpeaker] = useState<{ name: string; id: string } | null>(null)
  const [round, setRound] = useState(0)
  const [speakerPrompt, setSpeakerPrompt] = useState<PhrasePrompt>(() => getRandomPhrase())
  const [customPhrase, setCustomPhrase] = useState("")
  const [targetText, setTargetText] = useState<string | null>(null)

  // Recording & Playback state
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [recordProgress, setRecordProgress] = useState(0)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [reversedAudioBuffer, setReversedAudioBuffer] = useState<AudioBuffer | null>(null)
  const [originalAudioBuffer, setOriginalAudioBuffer] = useState<AudioBuffer | null>(null)
  const [decodedAudios, setDecodedAudios] = useState<DecodedAudioMap>({})
  const [reversedPlayCount, setReversedPlayCount] = useState(0)

  // Turn state
  const [currentTurnPlayer, setCurrentTurnPlayer] = useState<{ name: string; id: string } | null>(null)
  const [turnNumber, setTurnNumber] = useState(0)
  const [totalTurns, setTotalTurns] = useState(0)
  const [submittedCount, setSubmittedCount] = useState(0)
  const [totalImitators, setTotalImitators] = useState(0)
  const [hasSubmitted, setHasSubmitted] = useState(false)

  // Results & Ranking state
  const [allAudios, setAllAudios] = useState<AudioEntry[]>([])
  const [speakerName, setSpeakerName] = useState("")
  const [rankings, setRankings] = useState<string[]>([])
  const [rankingSubmitted, setRankingSubmitted] = useState(false)
  const [rankingCount, setRankingCount] = useState(0)
  const [totalRankers, setTotalRankers] = useState(0)
  const [finalScores, setFinalScores] = useState<Record<string, number> | null>(null)

  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const recorderRef = useRef<PcmAudioRecorder | null>(null)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const onRecordCompleteRef = useRef<((base64: string) => void) | null>(null)

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      audioContextRef.current = new AudioCtx()
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume()
    }
    return audioContextRef.current
  }, [])

  const decodeBase64Audio = useCallback(
    async (base64Data: string): Promise<AudioBuffer> => {
      const ctx = getAudioContext()
      return await decodeAudioSafely(ctx, base64Data)
    },
    [getAudioContext],
  )

  const reverseAudioBuffer = useCallback(
    (buffer: AudioBuffer): AudioBuffer => {
      const ctx = getAudioContext()
      const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const input = buffer.getChannelData(ch)
        const output = reversed.getChannelData(ch)
        for (let i = 0; i < buffer.length; i++) {
          output[i] = input[buffer.length - 1 - i]
        }
      }
      return reversed
    },
    [getAudioContext],
  )

  const playBuffer = useCallback(
    (buffer: AudioBuffer, id: string, onEnd?: () => void) => {
      const ctx = getAudioContext()
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop() } catch {}
      }

      const source = ctx.createBufferSource()
      source.buffer = buffer
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyser.connect(ctx.destination)
      setAnalyserNode(analyser)

      source.onended = () => {
        setIsPlaying(false)
        setPlayingId(null)
        setAnalyserNode(null)
        if (onEnd) onEnd()
      }

      sourceNodeRef.current = source
      source.start()
      setIsPlaying(true)
      setPlayingId(id)
    },
    [getAudioContext],
  )

  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
    }
    setIsPlaying(false)
    setPlayingId(null)
    setAnalyserNode(null)
  }, [])

  // Direct PCM Audio Recording - Immune to Stale Closure & EncodingError
  const startRecording = useCallback(
    async (onComplete: (base64: string) => void) => {
      setError(null)
      try {
        const ctx = getAudioContext()
        const recorder = new PcmAudioRecorder(ctx)
        recorderRef.current = recorder
        onRecordCompleteRef.current = onComplete

        const analyser = await recorder.start()
        setAnalyserNode(analyser)
        setIsRecording(true)

        const startTime = Date.now()
        timerRef.current = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000
          const pct = Math.min(100, (elapsed / MAX_RECORD_SECONDS) * 100)
          setRecordProgress(pct)
          if (elapsed >= MAX_RECORD_SECONDS) {
            stopRecording()
          }
        }, 50)
      } catch (err: any) {
        console.error("Microphone capture error:", err)
        setError("Microphone permission denied or device not found.")
      }
    },
    [getAudioContext],
  )

  const stopRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setRecordProgress(0)

    if (recorderRef.current) {
      try {
        const rec = recorderRef.current
        recorderRef.current = null
        const { base64Wav } = await rec.stop()
        setIsRecording(false)
        setAnalyserNode(null)

        if (onRecordCompleteRef.current) {
          onRecordCompleteRef.current(base64Wav)
          onRecordCompleteRef.current = null
        }
      } catch (err: any) {
        console.error("Error processing recording:", err)
        setError("Failed to process recording.")
        setIsRecording(false)
        setAnalyserNode(null)
      }
    }
  }, [])

  const triggerRecordingCountdown = useCallback(
    (onGo: () => void) => {
      let count = 3
      setCountdown(count)
      sfx.playCountdown(false)

      const interval = setInterval(() => {
        count--
        if (count > 0) {
          setCountdown(count)
          sfx.playCountdown(false)
        } else {
          clearInterval(interval)
          setCountdown(null)
          sfx.playCountdown(true)
          onGo()
        }
      }, 700)
    },
    [],
  )

  // Socket Event Listeners
  useEffect(() => {
    const unsubJoined = on("player-joined", ({ players: ps }: any) => {
      setPlayers(ps)
      sfx.playClick()
    })

    const unsubLeft = on("player-left", ({ players: ps }: any) => {
      setPlayers(ps)
    })

    const unsubGameStarted = on(
      "game-started",
      ({ speaker: sp, round: r, targetText: tt, totalImitators: ti }: any) => {
        setSpeaker(sp)
        setRound(r)
        setTargetText(tt || null)
        setTotalImitators(ti)
        setReversedAudioBuffer(null)
        setOriginalAudioBuffer(null)
        setHasSubmitted(false)
        setSubmittedCount(0)
        setReversedPlayCount(0)
        setDecodedAudios({})
        setRankings([])
        setRankingSubmitted(false)
        setFinalScores(null)

        if (sp.id === socketId) {
          setPhase("speaker-prompt")
        } else {
          setPhase("waiting-turn")
        }
      },
    )

    const unsubOriginalSubmitted = on(
      "original-audio-submitted",
      async ({ originalAudio, reversedAudio, speakerName: sn, targetText: tt }: any) => {
        setSpeakerName(sn)
        if (tt) setTargetText(tt)
        try {
          const revBuf = await decodeBase64Audio(reversedAudio)
          setReversedAudioBuffer(revBuf)
          const origBuf = await decodeBase64Audio(originalAudio)
          setOriginalAudioBuffer(origBuf)
        } catch (e) {
          console.error("Failed to decode audio buffers:", e)
        }

        if (speaker?.id !== socketId) {
          setPhase("listening-reversed")
          sfx.playRewind()
        }
      },
    )

    const unsubYourTurn = on(
      "your-turn",
      ({ turnNumber: tn, totalTurns: tt }: any) => {
        setTurnNumber(tn)
        setTotalTurns(tt)
        setCurrentTurnPlayer({ name: playerName, id: socketId || "" })

        setPhase("my-turn-countdown")
        triggerRecordingCountdown(() => {
          setPhase("my-turn-record")
          startRecording((base64Wav) => {
            emit("submit-imitation-audio", { roomCode, audioData: base64Wav })
            setHasSubmitted(true)
            setPhase("waiting-turn")
            sfx.playSuccess()
          })
        })
      },
    )

    const unsubImitationSubmitted = on(
      "imitation-submitted",
      ({ submittedCount: sc, totalImitators: ti, currentTurnPlayer: ctp, turnNumber: tn }: any) => {
        setSubmittedCount(sc)
        setTotalImitators(ti)
        setCurrentTurnPlayer(ctp)
        setTurnNumber(tn)
      },
    )

    const unsubAllDone = on("all-imitations-done", async ({ allAudios: audios, speakerName: sn, targetText: tt }: any) => {
      setAllAudios(audios)
      setSpeakerName(sn)
      if (tt) setTargetText(tt)

      const audioMap: DecodedAudioMap = {}
      for (const a of audios) {
        if (!a.skipped && a.audioData) {
          try {
            const raw = await decodeBase64Audio(a.audioData)
            const rev = reverseAudioBuffer(raw)
            audioMap[a.playerId] = { raw, reversed: rev }
          } catch (e) {
            console.error(`Failed to decode audio for ${a.playerName}:`, e)
            audioMap[a.playerId] = { raw: null, reversed: null }
          }
        }
      }
      setDecodedAudios(audioMap)
      setPhase("all-done")
    })

    const unsubRankingSubmitted = on("ranking-submitted", ({ submittedCount: sc, totalPlayers }: any) => {
      setRankingCount(sc)
      setTotalRankers(totalPlayers)
    })

    const unsubFinalResults = on("final-results", ({ scores }: any) => {
      setFinalScores(scores)
      setPhase("results")
      sfx.playSuccess()
    })

    const unsubReturnToLobby = on("return-to-lobby", ({ players: ps }: any) => {
      setPlayers(ps)
      setPhase("lobby")
      setHasSubmitted(false)
      setSubmittedCount(0)
      setAllAudios([])
      setRankings([])
      setRankingSubmitted(false)
      setFinalScores(null)
      setReversedAudioBuffer(null)
      setOriginalAudioBuffer(null)
      setDecodedAudios({})
      setReversedPlayCount(0)
      setTargetText(null)
    })

    const unsubError = on("error-message", ({ message }: any) => {
      setError(message)
    })

    return () => {
      unsubJoined()
      unsubLeft()
      unsubGameStarted()
      unsubOriginalSubmitted()
      unsubYourTurn()
      unsubImitationSubmitted()
      unsubAllDone()
      unsubRankingSubmitted()
      unsubFinalResults()
      unsubReturnToLobby()
      unsubError()
    }
  }, [on, socketId, decodeBase64Audio, reverseAudioBuffer, speaker, emit, roomCode, playerName, startRecording, triggerRecordingCountdown])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (recorderRef.current) {
        recorderRef.current.cancel()
      }
      stopPlayback()
    }
  }, [stopPlayback])

  useEffect(() => {
    if (allAudios.length > 0 && rankings.length === 0) {
      setRankings(allAudios.map((a) => a.playerId))
    }
  }, [allAudios, rankings.length])

  const handleCreateRoom = useCallback(() => {
    if (!hostName.trim()) return
    setError(null)

    emit("create-room", { hostName: hostName.trim() }, (response: any) => {
      if (response.success) {
        setRoomCode(response.roomCode)
        setNetworkInfo({ localIP: response.localIP, port: response.port })
        setIsHost(true)
        setPlayers([{ name: hostName.trim(), isHost: true, id: socketId || "" }])
        setPlayerName(hostName.trim())
        setPhase("lobby")
        sfx.playClick()
      } else {
        setError(response.error || "Room creation failed")
      }
    })
  }, [hostName, emit, socketId])

  const handleJoinRoom = useCallback(() => {
    if (!joinCode.trim() || !playerName.trim()) return
    setError(null)

    emit("join-room", { roomCode: joinCode.trim(), playerName: playerName.trim() }, (response: any) => {
      if (response.success) {
        setRoomCode(joinCode.trim().toUpperCase())
        setPlayers(response.players)
        setIsHost(false)
        setPhase("lobby")
        sfx.playClick()
      } else {
        setError(response.error || "Could not join room. Check the 6-character code.")
      }
    })
  }, [joinCode, playerName, emit])

  const handleStartGame = useCallback(() => {
    emit("start-game", { roomCode })
    sfx.playClick()
  }, [emit, roomCode])

  const handleStartSpeakerRecord = useCallback(() => {
    const finalPhrase = customPhrase.trim() || speakerPrompt.phrase
    setTargetText(finalPhrase)
    setPhase("speaker-countdown")
    triggerRecordingCountdown(() => {
      setPhase("speaker-recording")
      startRecording((base64Wav) => {
        emit("submit-original-audio", { roomCode, audioData: base64Wav, targetText: finalPhrase })
        setPhase("waiting-turn")
        sfx.playRewind()
      })
    })
  }, [customPhrase, speakerPrompt, triggerRecordingCountdown, startRecording, emit, roomCode])

  const handlePlayReversed = useCallback(() => {
    if (reversedAudioBuffer && reversedPlayCount < MAX_REVERSE_PLAYS) {
      playBuffer(reversedAudioBuffer, "party-reversed")
      setReversedPlayCount((c) => c + 1)
    }
  }, [reversedAudioBuffer, reversedPlayCount, playBuffer])

  const handleReadyToImitate = useCallback(() => {
    setPhase("waiting-turn")
    emit("ready-to-imitate", { roomCode })
    sfx.playClick()
  }, [emit, roomCode])

  const handleSkipTurn = useCallback(() => {
    emit("skip-current-turn", { roomCode })
    sfx.playClick()
  }, [emit, roomCode])

  const moveRanking = useCallback((fromIndex: number, toIndex: number) => {
    setRankings((prev) => {
      const next = [...prev]
      const [item] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, item)
      return next
    })
  }, [])

  const handleSubmitRanking = useCallback(() => {
    emit("submit-rankings", { roomCode, rankings })
    setRankingSubmitted(true)
    sfx.playClick()
  }, [emit, roomCode, rankings])

  const handleNewRound = useCallback(() => {
    emit("next-round", { roomCode })
    sfx.playClick()
  }, [emit, roomCode])

  const copyRoomCode = () => {
    navigator.clipboard.writeText(roomCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 2000)
    sfx.playClick()
  }

  const copyJoinLink = () => {
    navigator.clipboard.writeText(getJoinUrl())
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
    sfx.playClick()
  }

  const getJoinUrl = () => {
    if (networkInfo && networkInfo.localIP !== "localhost") {
      return `http://${networkInfo.localIP}:${networkInfo.port}/?room=${roomCode}`
    }
    if (typeof window !== "undefined") {
      return `${window.location.origin}/?room=${roomCode}`
    }
    return `/?room=${roomCode}`
  }

  return (
    <div className="min-h-screen bg-[#ffffff] dark:bg-[#111113] text-[#111113] dark:text-[#f5f4ed] flex flex-col justify-between p-4 sm:p-8 max-w-2xl mx-auto selection:bg-[#d3ff62]/30 font-sans transition-colors duration-300">
      {/* Top Bar Header */}
      <header className="flex items-center justify-between border-b border-[#e2e2e8] dark:border-[#35353d] pb-4">
        {phase === "choose-role" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="font-bold text-xs uppercase tracking-wider text-[#61616c] dark:text-[#aaa9b4] hover:text-[#111113] dark:hover:text-[#f5f4ed] hover:bg-[#eaeaf0] dark:hover:bg-[#1b1b20] rounded-xl"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" strokeWidth={2.5} />
            Hub
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isConnected ? "bg-[#d3ff62] shadow-[0_0_10px_#d3ff62] animate-pulse" : "bg-rose-500"
              }`}
            />
            <span className="text-xs font-bold text-[#61616c] dark:text-[#aaa9b4]">
              {isConnected ? "Party Online" : "Connecting..."}
            </span>
          </div>
        )}

        <div className="flex items-center gap-3">
          {roomCode && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#8e8d99] dark:text-[#71717d]">ROOM:</span>
              <span className="font-black text-sm text-[#111113] dark:text-[#f5f4ed] tracking-widest px-2.5 py-1 rounded-lg bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d]">
                {roomCode}
              </span>
              {round > 0 && (
                <span className="text-xs font-black text-[#72a800] dark:text-[#d3ff62] px-2 py-0.5 rounded-full bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d]">
                  Round {round}
                </span>
              )}
            </div>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[#f4f4f7] dark:bg-[#1b1b20] text-[#72a800] dark:text-[#d3ff62] border border-[#e2e2e8] dark:border-[#35353d]">
            <Image
              src="/figma/users.svg"
              alt="Party"
              width={14}
              height={14}
              className="opacity-90"
            />
            03 / Party
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Console */}
      <main className="py-6 space-y-6">
        {error && (
          <Alert variant="destructive" className="rounded-2xl border-rose-500/40 bg-rose-500/10 text-[#f5f4ed]">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="font-bold">Party Notice</AlertTitle>
            <AlertDescription className="text-xs text-[#aaa9b4]">{error}</AlertDescription>
          </Alert>
        )}

        {/* Dynamic Visualizer Bar */}
        {(isRecording || isPlaying) && (
          <AudioVisualizer analyser={analyserNode} isActive={isRecording || isPlaying} />
        )}

        {/* PHASE: CHOOSE ROLE */}
        {phase === "choose-role" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-2xl bg-[#1b1b20] border border-[#35353d] text-[#d3ff62] mb-1">
                <Users className="h-8 w-8" strokeWidth={2.25} />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-[#f5f4ed]">
                Party Mode
              </h2>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium max-w-sm mx-auto">
                Host a room on a big screen or TV, or scan and play directly from your phone!
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Host Card */}
              <button
                type="button"
                onClick={() => {
                  sfx.playClick()
                  setPhase("host-setup")
                }}
                className="p-6 rounded-3xl border border-[#35353d] bg-[#1b1b20] hover:border-[#d3ff62] transition-all text-left cursor-pointer group shadow-xl hover:shadow-[0_0_30px_rgba(211,255,98,0.15)]"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-2xl bg-[#232329] border border-[#35353d] text-[#d3ff62] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Tv className="h-5 w-5" strokeWidth={2.25} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#d3ff62] px-2 py-0.5 rounded-full bg-[#232329] border border-[#35353d]">
                    Host Screen
                  </span>
                </div>
                <h3 className="text-lg font-black text-[#f5f4ed] mb-1">
                  Host New Room
                </h3>
                <p className="text-xs text-[#aaa9b4] leading-relaxed font-medium">
                  Displays the room QR code on this screen so all friends can scan and join.
                </p>
              </button>

              {/* Join Card */}
              <button
                type="button"
                onClick={() => {
                  sfx.playClick()
                  setPhase("join-setup")
                }}
                className="p-6 rounded-3xl border border-[#35353d] bg-[#1b1b20] hover:border-[#ae98f5] transition-all text-left cursor-pointer group shadow-xl hover:shadow-[0_0_30px_rgba(174,152,245,0.15)]"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 rounded-2xl bg-[#232329] border border-[#35353d] text-[#ae98f5] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Smartphone className="h-5 w-5" strokeWidth={2.25} />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#ae98f5] px-2 py-0.5 rounded-full bg-[#232329] border border-[#35353d]">
                    Contestant
                  </span>
                </div>
                <h3 className="text-lg font-black text-[#f5f4ed] mb-1">
                  Join with Code
                </h3>
                <p className="text-xs text-[#aaa9b4] leading-relaxed font-medium">
                  Enter the 6-character room code shown on the host display to play.
                </p>
              </button>
            </div>
          </div>
        )}

        {/* PHASE: HOST SETUP */}
        {phase === "host-setup" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#1b1b20] border border-[#35353d] text-[#d3ff62] flex items-center justify-center">
                <Crown className="h-6 w-6" strokeWidth={2.25} />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-[#f5f4ed]">
                Set Up Your Party Room
              </h2>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium">
                Enter your host name to open the lobby
              </p>
            </div>

            <div className="p-6 rounded-3xl border border-[#35353d] bg-[#1b1b20] shadow-xl space-y-4">
              <div className="space-y-2">
                <Label htmlFor="host-name" className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">
                  Your Host Name
                </Label>
                <Input
                  id="host-name"
                  placeholder="e.g. Alex"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  maxLength={20}
                  className="rounded-xl font-bold text-base py-5 bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#d3ff62]"
                  onKeyDown={(e) => e.key === "Enter" && handleCreateRoom()}
                />
              </div>

              <Button
                size="lg"
                className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
                onClick={handleCreateRoom}
                disabled={!hostName.trim() || !isConnected}
              >
                {!isConnected ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <QrCode className="mr-2 h-5 w-5" />
                    Open Party Room & Generate QR
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* PHASE: JOIN SETUP */}
        {phase === "join-setup" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-[#1b1b20] border border-[#35353d] text-[#ae98f5] flex items-center justify-center">
                <Smartphone className="h-6 w-6" strokeWidth={2.25} />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-[#f5f4ed]">
                Join Party
              </h2>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium">
                Enter the room code and your player name
              </p>
            </div>

            <div className="p-6 rounded-3xl border border-[#35353d] bg-[#1b1b20] shadow-xl space-y-4">
              <div className="space-y-2">
                <Label htmlFor="room-code" className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">
                  6-Letter Room Code
                </Label>
                <Input
                  id="room-code"
                  placeholder="e.g. ABCD23"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="text-center font-mono font-black tracking-[0.25em] uppercase text-2xl py-6 rounded-xl bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#ae98f5]"
                  maxLength={6}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="player-name" className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">
                  Your Nickname
                </Label>
                <Input
                  id="player-name"
                  placeholder="e.g. Jordan"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={20}
                  className="rounded-xl font-bold text-base py-5 bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#ae98f5]"
                  onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                />
              </div>

              <Button
                size="lg"
                className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#ae98f5] text-[#111113] hover:bg-[#9d84f0] shadow-[0_0_25px_rgba(174,152,245,0.25)] active:scale-[0.98] transition-all cursor-pointer"
                onClick={handleJoinRoom}
                disabled={!joinCode.trim() || !playerName.trim() || !isConnected}
              >
                {!isConnected ? "Connecting..." : "Enter Party Room 🎮"}
              </Button>
            </div>
          </div>
        )}

        {/* PHASE: LOBBY WITH QR CODE */}
        {phase === "lobby" && (
          <div className="space-y-6">
            <div className="text-center space-y-4">
              {/* Room Code Badge */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4] mb-1.5">
                  Scan or Enter Room Code
                </p>
                <div className="inline-flex items-center gap-3 p-3 px-6 rounded-2xl border border-[#35353d] bg-[#1b1b20] shadow-xl">
                  <span className="text-4xl sm:text-5xl font-mono font-black tracking-[0.25em] text-[#d3ff62]">
                    {roomCode}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyRoomCode}
                    className="h-10 w-10 p-0 rounded-xl hover:bg-[#232329] cursor-pointer"
                    title="Copy code"
                  >
                    {copiedCode ? <Check className="h-5 w-5 text-[#d3ff62]" /> : <Copy className="h-5 w-5 text-[#aaa9b4]" />}
                  </Button>
                </div>
              </div>

              {/* QR Code Container */}
              <div className="inline-block p-4 bg-white rounded-3xl border border-[#35353d] shadow-2xl">
                <QRCodeSVG value={getJoinUrl()} size={160} level="M" />
              </div>

              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyJoinLink}
                  className="font-bold text-xs rounded-xl border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35]"
                >
                  {copiedLink ? <Check className="h-4 w-4 mr-1.5 text-[#d3ff62]" /> : <Share2 className="h-4 w-4 mr-1.5 text-[#d3ff62]" />}
                  {copiedLink ? "Link Copied!" : "Copy Direct Join Link"}
                </Button>
              </div>
            </div>

            {/* Connected Contestants Roster */}
            <div className="p-6 rounded-3xl border border-[#35353d] bg-[#1b1b20] shadow-xl space-y-3">
              <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">
                <span className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-[#d3ff62]" />
                  Contestants ({players.length} In Room)
                </span>
                <span className="text-[#71717d]">Need 2+ to start</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {players.map((p) => (
                  <div
                    key={p.id || p.name}
                    className="flex items-center justify-between p-3 rounded-2xl border border-[#35353d] bg-[#232329] text-xs font-bold"
                  >
                    <span className="text-[#f5f4ed] truncate max-w-[100px]">
                      {p.name}
                    </span>
                    {p.isHost && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-[#111113] bg-[#d3ff62] px-1.5 py-0.5 rounded-full">
                        <Crown className="h-3 w-3" />
                        HOST
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Host Launch or Waiting */}
            {isHost ? (
              <Button
                size="lg"
                className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
                onClick={handleStartGame}
                disabled={players.length < 2}
              >
                <Sparkles className="h-5 w-5 mr-2" />
                Start Party Game ({players.length} Players Ready)!
              </Button>
            ) : (
              <div className="text-center py-4 text-sm font-bold text-[#d3ff62] animate-pulse">
                Waiting for the host to launch the round...
              </div>
            )}
          </div>
        )}

        {/* PHASE: SPEAKER PROMPT */}
        {phase === "speaker-prompt" && (
          <div className="space-y-6 text-center">
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] shadow-xl space-y-4">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#232329] text-[#d3ff62] border border-[#35353d]">
                <Crown className="h-3.5 w-3.5" />
                You Are The Speaker This Round!
              </span>

              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#f5f4ed] leading-tight">
                &ldquo;{customPhrase.trim() || speakerPrompt.phrase}&rdquo;
              </h2>

              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium max-w-sm mx-auto">
                Speak this phrase clearly. Everyone else will hear it flipped backwards and try to emulate it!
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  sfx.playClick()
                  setSpeakerPrompt(getRandomPhrase(speakerPrompt.phrase))
                  setCustomPhrase("")
                }}
                className="w-full sm:w-auto font-bold text-xs rounded-xl border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35]"
              >
                <Dices className="h-4 w-4 mr-1.5 text-[#d3ff62]" strokeWidth={2.25} />
                Roll New Phrase
              </Button>

              <div className="w-full sm:max-w-xs">
                <Input
                  placeholder="Or write custom..."
                  value={customPhrase}
                  onChange={(e) => setCustomPhrase(e.target.value)}
                  className="h-9 text-xs rounded-xl font-medium bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#d3ff62]"
                  maxLength={35}
                />
              </div>
            </div>

            <Button
              size="lg"
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
              onClick={handleStartSpeakerRecord}
            >
              <Mic className="h-5 w-5 mr-2" strokeWidth={2.5} />
              Start 3-Second Recording Countdown!
            </Button>
          </div>
        )}

        {/* PHASE: COUNTDOWNS */}
        {(phase === "speaker-countdown" || phase === "my-turn-countdown") && (
          <div className="text-center py-12 space-y-4">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-[#1b1b20] border-4 border-[#d3ff62] text-[#d3ff62] flex items-center justify-center animate-bounce shadow-[0_0_30px_rgba(211,255,98,0.25)]">
              <span className="text-5xl font-black">{countdown}</span>
            </div>
            <h3 className="text-xl font-black text-[#f5f4ed]">
              {phase === "speaker-countdown" ? "Get Ready to Speak!" : "Get Ready to Imitate!"}
            </h3>
            <p className="text-sm font-semibold text-[#d3ff62]">
              {phase === "speaker-countdown" ? `Secret Phrase: "${targetText}"` : "Pronounce the backwards sounds!"}
            </p>
          </div>
        )}

        {/* PHASE: SPEAKER RECORDING */}
        {phase === "speaker-recording" && (
          <div className="text-center py-8 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 font-extrabold text-xs uppercase tracking-wider animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              Recording Active
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">Speak Now</p>
              <h3 className="text-3xl font-black tracking-tight text-[#f5f4ed]">
                &ldquo;{targetText}&rdquo;
              </h3>
            </div>

            <div className="w-full max-w-sm mx-auto space-y-1.5">
              <div className="h-2 w-full bg-[#232329] rounded-full overflow-hidden border border-[#35353d]">
                <div
                  className="h-full bg-[#d3ff62] transition-all duration-75"
                  style={{ width: `${recordProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-bold text-[#71717d]">
                <span>0.0s</span>
                <span>Max {MAX_RECORD_SECONDS}.0s</span>
              </div>
            </div>

            <Button
              size="lg"
              variant="destructive"
              onClick={stopRecording}
              className="py-6 px-8 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-rose-500/25 cursor-pointer"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              Done Speaking
            </Button>
          </div>
        )}

        {/* PHASE: IMITATORS LISTENING TO REVERSED */}
        {phase === "listening-reversed" && (
          <div className="space-y-6 text-center">
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] shadow-xl space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#ae98f5]">
                {speakerName} Sent a Reversed Voice Clip!
              </span>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f5f4ed]">
                Listen Closely & Memorize!
              </h3>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium max-w-sm mx-auto">
                Replays remaining: {MAX_REVERSE_PLAYS - reversedPlayCount} of {MAX_REVERSE_PLAYS}
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Button
                size="lg"
                onClick={handlePlayReversed}
                disabled={isPlaying || reversedPlayCount >= MAX_REVERSE_PLAYS || !reversedAudioBuffer}
                className="py-7 text-base font-black tracking-wide rounded-2xl bg-[#ae98f5] text-[#111113] hover:bg-[#9d84f0] shadow-[0_0_25px_rgba(174,152,245,0.25)] active:scale-[0.98] transition-all cursor-pointer"
              >
                <Volume2 className="mr-2 h-5 w-5" strokeWidth={2.25} />
                {reversedPlayCount === 0 ? "Play Inverted Voice 🔄" : `Listen Again (${MAX_REVERSE_PLAYS - reversedPlayCount} left)`}
              </Button>

              {reversedPlayCount > 0 && (
                <Button
                  size="lg"
                  variant="outline"
                  onClick={handleReadyToImitate}
                  className="py-6 text-sm font-bold rounded-2xl border border-[#35353d] bg-[#232329] text-[#d3ff62] hover:bg-[#2c2c35] cursor-pointer"
                >
                  <Check className="mr-2 h-4 w-4 text-[#d3ff62]" strokeWidth={2.5} />
                  I&apos;m Ready to Record My Turn!
                </Button>
              )}
            </div>
          </div>
        )}

        {/* PHASE: MY TURN TO RECORD */}
        {phase === "my-turn-record" && (
          <div className="text-center py-8 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#d3ff62]/15 border border-[#d3ff62]/30 text-[#d3ff62] font-extrabold text-xs uppercase tracking-wider animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-[#d3ff62]" />
              Your Turn to Imitate!
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">Make the Sound</p>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f5f4ed]">
                Say the backwards syllables!
              </h3>
            </div>

            <div className="w-full max-w-sm mx-auto space-y-1.5">
              <div className="h-2 w-full bg-[#232329] rounded-full overflow-hidden border border-[#35353d]">
                <div
                  className="h-full bg-[#d3ff62] transition-all duration-75"
                  style={{ width: `${recordProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-bold text-[#71717d]">
                <span>0.0s</span>
                <span>Max {MAX_RECORD_SECONDS}.0s</span>
              </div>
            </div>

            <Button
              size="lg"
              variant="destructive"
              onClick={stopRecording}
              className="py-6 px-8 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-rose-500/25 cursor-pointer"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              Submit Imitation
            </Button>
          </div>
        )}

        {/* PHASE: WAITING ROOM */}
        {phase === "waiting-turn" && (
          <div className="text-center py-10 space-y-6">
            <div className="w-16 h-16 mx-auto rounded-3xl bg-[#1b1b20] border border-[#35353d] text-[#d3ff62] flex items-center justify-center animate-pulse">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>

            {!originalAudioBuffer && (
              <div className="space-y-1">
                <h3 className="text-xl font-black text-[#f5f4ed]">
                  Waiting for {speaker?.name}...
                </h3>
                <p className="text-xs text-[#aaa9b4] font-medium">
                  The speaker is recording the secret phrase!
                </p>
              </div>
            )}

            {originalAudioBuffer && !hasSubmitted && currentTurnPlayer && currentTurnPlayer.id !== socketId && (
              <div className="space-y-1">
                <h3 className="text-xl font-black text-[#f5f4ed]">
                  {currentTurnPlayer.name} is imitating right now...
                </h3>
                <p className="text-xs font-bold text-[#d3ff62] mt-1">
                  Turn {turnNumber} of {totalTurns} • {submittedCount} submitted
                </p>
              </div>
            )}

            {hasSubmitted && (
              <div className="space-y-1">
                <h3 className="text-xl font-black text-[#f5f4ed]">
                  🎉 Your Imitation is In!
                </h3>
                <p className="text-xs text-[#aaa9b4] font-medium">
                  Waiting for fellow players ({submittedCount}/{totalImitators})...
                </p>
              </div>
            )}

            {isHost && currentTurnPlayer && (
              <div className="pt-4 border-t border-[#35353d]">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSkipTurn}
                  className="font-bold text-xs rounded-xl border border-rose-500/30 bg-[#232329] text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                >
                  <FastForward className="h-4 w-4 mr-1.5" />
                  Skip {currentTurnPlayer.name}&apos;s Turn
                </Button>
              </div>
            )}
          </div>
        )}

        {/* PHASE: ALL DONE - LISTEN REVERSED & RANK */}
        {phase === "all-done" && (
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-2xl bg-[#1b1b20] border border-[#35353d] text-[#d3ff62] mb-1">
                <Trophy className="h-8 w-8" strokeWidth={2.25} />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-[#f5f4ed]">
                Listen & Vote on Imitations!
              </h2>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium">
                Hear each contestant&apos;s reversed imitation and rank who sounded most like the original!
              </p>
            </div>

            {targetText && (
              <div className="p-5 rounded-2xl border border-[#35353d] bg-[#1b1b20] text-center space-y-1">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#d3ff62]">
                  Target Phrase
                </p>
                <p className="text-xl font-black text-[#f5f4ed]">
                  &ldquo;{targetText}&rdquo;
                </p>
              </div>
            )}

            {/* Original Phrase Audio Card */}
            <div className="flex items-center justify-between p-4 rounded-2xl border border-[#35353d] bg-[#1b1b20] shadow-md">
              <div>
                <p className="text-sm font-black text-[#f5f4ed]">
                  Original Reference
                </p>
                <p className="text-xs text-[#aaa9b4] font-medium">
                  Spoken by {speakerName}
                </p>
              </div>

              <Button
                size="sm"
                variant="outline"
                disabled={isPlaying && playingId !== "orig"}
                onClick={() => {
                  if (playingId === "orig") stopPlayback()
                  else if (originalAudioBuffer) playBuffer(originalAudioBuffer, "orig")
                }}
                className="font-bold text-xs rounded-xl border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35] cursor-pointer"
              >
                <Play className={`h-4 w-4 mr-1.5 ${playingId === "orig" ? "text-[#d3ff62] animate-pulse fill-current" : ""}`} />
                {playingId === "orig" ? "Stop" : "Play Reference"}
              </Button>
            </div>

            {/* Submissions Audio Cards */}
            <div className="space-y-2.5">
              <p className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">
                Contestant Submissions (Flipped Back)
              </p>

              {allAudios.map((audio) => {
                const decoded = decodedAudios[audio.playerId]
                const revId = `rev-${audio.playerId}`
                const rawId = `raw-${audio.playerId}`

                return (
                  <div
                    key={audio.playerId}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl border border-[#35353d] bg-[#1b1b20] shadow-sm gap-3"
                  >
                    <span className="font-extrabold text-sm text-[#f5f4ed]">
                      {audio.playerName}
                    </span>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={isPlaying && playingId !== revId}
                        onClick={() => {
                          if (playingId === revId) stopPlayback()
                          else if (decoded?.reversed) playBuffer(decoded.reversed, revId)
                        }}
                        className="font-bold text-xs rounded-xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_15px_rgba(211,255,98,0.2)] cursor-pointer"
                      >
                        <Play className={`h-3.5 w-3.5 mr-1 ${playingId === revId ? "animate-pulse fill-current" : ""}`} />
                        {playingId === revId ? "Stop" : "Play Inverted 🎯"}
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPlaying && playingId !== rawId}
                        onClick={() => {
                          if (playingId === rawId) stopPlayback()
                          else if (decoded?.raw) playBuffer(decoded.raw, rawId)
                        }}
                        className="font-bold text-xs text-[#aaa9b4] hover:text-[#f5f4ed] hover:bg-[#232329]"
                        title="Hear raw backward pronunciation"
                      >
                        Raw Sound
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Reorder / Rank Section */}
            <div className="border-t border-[#35353d] pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-[#f5f4ed]">
                  Your Ranking Ballot (Best to Worst)
                </h3>
                <span className="text-xs font-bold text-[#d3ff62]">#1 = Most Accurate</span>
              </div>

              <div className="space-y-2">
                {rankings.map((pid, idx) => {
                  const entry = allAudios.find((a) => a.playerId === pid)
                  if (!entry) return null

                  const medalColors = [
                    "bg-[#d3ff62] text-[#111113]",
                    "bg-[#ae98f5] text-[#111113]",
                    "bg-[#35353d] text-[#f5f4ed]",
                  ]

                  return (
                    <div
                      key={pid}
                      className="flex items-center justify-between p-3.5 rounded-2xl border border-[#35353d] bg-[#1b1b20] shadow-sm text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`w-6 h-6 rounded-lg font-black flex items-center justify-center text-xs ${
                            idx < 3 ? medalColors[idx] : "bg-[#232329] text-[#71717d]"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="font-extrabold text-sm text-[#f5f4ed]">
                          {entry.playerName}
                        </span>
                      </div>

                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => idx > 0 && moveRanking(idx, idx - 1)}
                          disabled={idx === 0}
                          className="h-8 w-8 p-0 rounded-lg border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35] cursor-pointer"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => idx < rankings.length - 1 && moveRanking(idx, idx + 1)}
                          disabled={idx === rankings.length - 1}
                          className="h-8 w-8 p-0 rounded-lg border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35] cursor-pointer"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {!rankingSubmitted ? (
                <Button
                  size="lg"
                  className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer mt-4"
                  onClick={handleSubmitRanking}
                >
                  <Award className="mr-2 h-5 w-5" />
                  Submit Official Ballot!
                </Button>
              ) : (
                <div className="text-center py-4 text-xs font-bold text-[#aaa9b4] border border-[#35353d] rounded-2xl bg-[#1b1b20]">
                  Ballot submitted! Waiting for all players ({rankingCount}/{totalRankers})...
                </div>
              )}
            </div>
          </div>
        )}

        {/* PHASE: RESULTS LEADERBOARD */}
        {phase === "results" && (
          <div className="space-y-6 text-center">
            <div className="space-y-2">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-[#d3ff62]/15 border border-[#d3ff62]/30 text-[#d3ff62] flex items-center justify-center animate-bounce shadow-[0_0_30px_rgba(211,255,98,0.2)]">
                <Trophy className="h-8 w-8" />
              </div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#f5f4ed]">
                Round {round} Standings! 🏆
              </h2>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium">
                Combined scores calculated from all players&apos; ballots!
              </p>
            </div>

            {finalScores && (
              <div className="space-y-2.5">
                {Object.entries(finalScores)
                  .sort(([, a], [, b]) => b - a)
                  .map(([pid, score], idx) => {
                    const audioEntry = allAudios.find((a) => a.playerId === pid)
                    const name = audioEntry?.playerName || "Player"
                    const decoded = decodedAudios[pid]
                    const revId = `final-${pid}`

                    const medalIcons = ["🥇", "🥈", "🥉"]

                    return (
                      <div
                        key={pid}
                        className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                          idx === 0
                            ? "border-[#d3ff62] bg-[#1b1b20] shadow-[0_0_20px_rgba(211,255,98,0.15)] scale-102"
                            : "border-[#35353d] bg-[#1b1b20]"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">
                            {idx < 3 ? medalIcons[idx] : `#${idx + 1}`}
                          </span>
                          <span className="font-extrabold text-sm text-[#f5f4ed]">
                            {name}
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          <span className="font-black text-sm text-[#d3ff62]">
                            {score} PTS
                          </span>
                          {decoded?.reversed && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 rounded-lg hover:bg-[#232329] cursor-pointer"
                              onClick={() => {
                                if (playingId === revId) stopPlayback()
                                else if (decoded?.reversed) playBuffer(decoded.reversed, revId)
                              }}
                            >
                              <Play className={`h-4 w-4 ${playingId === revId ? "text-[#d3ff62] animate-pulse fill-current" : ""}`} />
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}

            {isHost ? (
              <Button
                size="lg"
                className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
                onClick={handleNewRound}
              >
                <RotateCcw className="mr-2 h-5 w-5" />
                Start Next Round (Rotate Speaker)!
              </Button>
            ) : (
              <p className="text-xs font-bold text-[#aaa9b4] animate-pulse">
                Waiting for the host to launch the next round...
              </p>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#35353d] pt-4 text-center text-xs font-bold text-[#71717d]">
        Party Room: {roomCode || "Offline"} • Rev3rse Party Engine
      </footer>
    </div>
  )
}
