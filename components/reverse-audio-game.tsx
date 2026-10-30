"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AudioVisualizer } from "@/components/audio-visualizer"
import { GamePhaseIndicator } from "@/components/game-phase-indicator"
import { getRandomPhrase, type PhrasePrompt } from "@/lib/phrase-prompts"
import { sfx } from "@/lib/sound-effects"
import { PcmAudioRecorder } from "@/lib/audio-recorder"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Mic,
  Play,
  RotateCcw,
  Volume2,
  ArrowRight,
  Heart,
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Dices,
  Square,
  Trophy,
  Sparkles,
  Swords,
  Check,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type GamePhase =
  | "setup"
  | "start"
  | "requesting-permission"
  | "counting-down-original"
  | "recording-original"
  | "original-recorded"
  | "playing-reversed"
  | "counting-down-imitation"
  | "recording-imitation"
  | "imitation-recorded"
  | "voting"
  | "reveal"
  | "game-over"

interface PlayerState {
  name: string
  lives: number
}

const DEFAULT_LIVES = 3
const MAX_RECORD_SECONDS = 8
const MAX_REVERSE_PLAYS = 3

interface ReverseAudioGameProps {
  onBack?: () => void
}

export function ReverseAudioGame({ onBack }: ReverseAudioGameProps) {
  const [phase, setPhase] = useState<GamePhase>("setup")
  const [startingLives, setStartingLives] = useState(DEFAULT_LIVES)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [recordProgress, setRecordProgress] = useState(0)

  const [phrasePrompt, setPhrasePrompt] = useState<PhrasePrompt>(() => getRandomPhrase())
  const [customPhrase, setCustomPhrase] = useState("")
  const [targetText, setTargetText] = useState<string | null>(null)

  const [originalAudio, setOriginalAudio] = useState<AudioBuffer | null>(null)
  const [reversedAudio, setReversedAudio] = useState<AudioBuffer | null>(null)
  const [rawImitationAudio, setRawImitationAudio] = useState<AudioBuffer | null>(null)
  const [reversedImitationAudio, setReversedImitationAudio] = useState<AudioBuffer | null>(null)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const [player1, setPlayer1] = useState<PlayerState>({ name: "Player 1", lives: DEFAULT_LIVES })
  const [player2, setPlayer2] = useState<PlayerState>({ name: "Player 2", lives: DEFAULT_LIVES })
  const [currentRecorder, setCurrentRecorder] = useState<1 | 2>(1)
  const [voteResult, setVoteResult] = useState<boolean | null>(null)
  const [roundCount, setRoundCount] = useState(1)
  const [reversedPlayCount, setReversedPlayCount] = useState(0)

  const audioContextRef = useRef<AudioContext | null>(null)
  const recorderRef = useRef<PcmAudioRecorder | null>(null)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

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
        setActivePlayingId(null)
        setAnalyserNode(null)
        if (onEnd) onEnd()
      }

      sourceNodeRef.current = source
      source.start()
      setIsPlaying(true)
      setActivePlayingId(id)
    },
    [getAudioContext],
  )

  const stopPlayback = useCallback(() => {
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop() } catch {}
    }
    setIsPlaying(false)
    setActivePlayingId(null)
    setAnalyserNode(null)
  }, [])

  // Direct PCM Audio Recording - Immune to Stale Closure & EncodingError
  const startRecording = useCallback(
    async (isImitation = false) => {
      setPermissionError(null)
      try {
        const ctx = getAudioContext()
        const recorder = new PcmAudioRecorder(ctx)
        recorderRef.current = recorder

        const analyser = await recorder.start()
        setAnalyserNode(analyser)
        setIsRecording(true)
        setPhase(isImitation ? "recording-imitation" : "recording-original")

        const startTime = Date.now()
        timerRef.current = setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000
          const pct = Math.min(100, (elapsed / MAX_RECORD_SECONDS) * 100)
          setRecordProgress(pct)
          if (elapsed >= MAX_RECORD_SECONDS) {
            stopRecording(isImitation)
          }
        }, 50)
      } catch (err: any) {
        console.error("Microphone capture failed:", err)
        setPermissionError("Could not access microphone. Please allow mic permission.")
        setPhase(isImitation ? "playing-reversed" : "start")
      }
    },
    [getAudioContext],
  )

  const stopRecording = useCallback(
    async (isImitation = false) => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setRecordProgress(0)

      if (recorderRef.current) {
        try {
          const rec = recorderRef.current
          recorderRef.current = null
          const { audioBuffer } = await rec.stop()
          setIsRecording(false)
          setAnalyserNode(null)

          if (isImitation) {
            setRawImitationAudio(audioBuffer)
            const reversedImit = reverseAudioBuffer(audioBuffer)
            setReversedImitationAudio(reversedImit)
            setPhase("imitation-recorded")
            sfx.playSuccess()
          } else {
            setOriginalAudio(audioBuffer)
            const reversed = reverseAudioBuffer(audioBuffer)
            setReversedAudio(reversed)
            setPhase("original-recorded")
            sfx.playRewind()
          }
        } catch (err: any) {
          console.error("Audio recording processing failed", err)
          setPermissionError("Audio capture failed. Please try again.")
          setPhase(isImitation ? "playing-reversed" : "start")
        }
      }
    },
    [reverseAudioBuffer],
  )

  const triggerRecordingWithCountdown = useCallback(
    (isImitation: boolean) => {
      setPhase(isImitation ? "counting-down-imitation" : "counting-down-original")
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
          startRecording(isImitation)
        }
      }, 700)
    },
    [startRecording],
  )

  const handleStartGame = useCallback(() => {
    const finalPhrase = customPhrase.trim() || phrasePrompt.phrase
    setTargetText(finalPhrase)
    triggerRecordingWithCountdown(false)
  }, [customPhrase, phrasePrompt, triggerRecordingWithCountdown])

  const handleStartImitation = useCallback(() => {
    triggerRecordingWithCountdown(true)
  }, [triggerRecordingWithCountdown])

  const playReversedAudio = useCallback(() => {
    if (reversedAudio && reversedPlayCount < MAX_REVERSE_PLAYS) {
      setPhase("playing-reversed")
      playBuffer(reversedAudio, "reversed")
      setReversedPlayCount((prev) => prev + 1)
    }
  }, [reversedAudio, playBuffer, reversedPlayCount])

  const handleVote = useCallback(
    (wasClose: boolean) => {
      setVoteResult(wasClose)

      if (wasClose) {
        sfx.playSuccess()
      } else {
        sfx.playBuzzer()
        const imitatorPlayer = currentRecorder === 1 ? player2 : player1
        const setImitatorPlayer = currentRecorder === 1 ? setPlayer2 : setPlayer1
        const newLives = imitatorPlayer.lives - 1
        setImitatorPlayer({ ...imitatorPlayer, lives: newLives })

        if (newLives <= 0) {
          setPhase("game-over")
          return
        }
      }

      setPhase("reveal")
    },
    [currentRecorder, player1, player2],
  )

  const nextRound = useCallback(() => {
    setOriginalAudio(null)
    setReversedAudio(null)
    setRawImitationAudio(null)
    setReversedImitationAudio(null)
    setIsRecording(false)
    setIsPlaying(false)
    setActivePlayingId(null)
    setVoteResult(null)
    setRoundCount((prev) => prev + 1)
    setCurrentRecorder((prev) => (prev === 1 ? 2 : 1))
    setReversedPlayCount(0)
    setCustomPhrase("")
    setPhrasePrompt(getRandomPhrase(phrasePrompt.phrase))
    setPhase("start")
    sfx.playClick()
  }, [phrasePrompt.phrase])

  const resetGame = useCallback(() => {
    setPlayer1((prev) => ({ ...prev, lives: startingLives }))
    setPlayer2((prev) => ({ ...prev, lives: startingLives }))
    setRoundCount(1)
    setCurrentRecorder(1)
    setOriginalAudio(null)
    setReversedAudio(null)
    setRawImitationAudio(null)
    setReversedImitationAudio(null)
    setVoteResult(null)
    setReversedPlayCount(0)
    setCustomPhrase("")
    setPhrasePrompt(getRandomPhrase())
    setPhase("start")
    sfx.playClick()
  }, [startingLives])

  const handleSetupSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!player1.name.trim() || !player2.name.trim()) return
      setPlayer1((prev) => ({ ...prev, lives: startingLives }))
      setPlayer2((prev) => ({ ...prev, lives: startingLives }))
      setPhase("start")
      sfx.playClick()
    },
    [player1.name, player2.name, startingLives],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (recorderRef.current) {
        recorderRef.current.cancel()
      }
      stopPlayback()
    }
  }, [stopPlayback])

  const recorder = currentRecorder === 1 ? player1 : player2
  const imitator = currentRecorder === 1 ? player2 : player1

  // Player Scorecard Styled with Figma Palette
  const PlayerScorecard = ({
    player,
    playerNumber,
    isActive,
  }: {
    player: PlayerState
    playerNumber: 1 | 2
    isActive: boolean
  }) => {
    const isP1 = playerNumber === 1
    const accentColor = isP1 ? "#d3ff62" : "#ae98f5"
    const activeBorder = isActive
      ? isP1
        ? "border-[#d3ff62] shadow-[0_0_20px_rgba(211,255,98,0.15)] bg-[#1b1b20]"
        : "border-[#ae98f5] shadow-[0_0_20px_rgba(174,152,245,0.15)] bg-[#1b1b20]"
      : "border-[#35353d] bg-[#1b1b20]/60 opacity-80"

    return (
      <div className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${activeBorder}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs"
            style={{
              backgroundColor: isP1 ? "#d3ff62" : "#ae98f5",
              color: "#111113",
            }}
          >
            P{playerNumber}
          </div>
          <div className="truncate">
            <p className="font-extrabold text-sm text-[#f5f4ed] truncate">{player.name}</p>
            {isActive && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider block"
                style={{ color: accentColor }}
              >
                Speaking Now
              </span>
            )}
          </div>
        </div>

        {/* Lives */}
        <div className="flex items-center gap-1.5 shrink-0">
          {Array.from({ length: startingLives }).map((_, i) => (
            <Heart
              key={i}
              className="h-4 w-4 transition-all"
              style={{
                fill: i < player.lives ? accentColor : "transparent",
                color: i < player.lives ? accentColor : "#71717d",
                opacity: i < player.lives ? 1 : 0.3,
              }}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#ffffff] dark:bg-[#111113] text-[#111113] dark:text-[#f5f4ed] flex flex-col justify-between p-4 sm:p-8 max-w-2xl mx-auto selection:bg-[#d3ff62]/30 font-sans transition-colors duration-300">
      {/* Top Header */}
      <header className="flex items-center justify-between pb-4 border-b border-[#e2e2e8] dark:border-[#35353d]">
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            disabled={isRecording}
            className="font-bold text-xs uppercase tracking-wider text-[#61616c] dark:text-[#aaa9b4] hover:text-[#111113] dark:hover:text-[#f5f4ed] hover:bg-[#eaeaf0] dark:hover:bg-[#1b1b20] rounded-xl"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" strokeWidth={2.5} />
            Hub
          </Button>
        )}

        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full bg-[#f4f4f7] dark:bg-[#1b1b20] text-[#7a58e6] dark:text-[#ae98f5] border border-[#e2e2e8] dark:border-[#35353d]">
            <Image
              src="/figma/repeat-2.svg"
              alt="1v1"
              width={14}
              height={14}
              className="opacity-90"
            />
            02 / 1v1 Battle
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Game Screen */}
      <main className="py-6 space-y-6">
        {/* Match Header with Lives and Stepper */}
        {phase !== "setup" && phase !== "game-over" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <PlayerScorecard player={player1} playerNumber={1} isActive={currentRecorder === 1} />
              <PlayerScorecard player={player2} playerNumber={2} isActive={currentRecorder === 2} />
            </div>
            <GamePhaseIndicator phase={phase} />
          </div>
        )}

        {permissionError && (
          <Alert variant="destructive" className="rounded-2xl border-rose-500/40 bg-rose-500/10 text-[#f5f4ed]">
            <AlertTitle className="font-bold">Microphone Notice</AlertTitle>
            <AlertDescription className="text-xs text-[#aaa9b4]">{permissionError}</AlertDescription>
          </Alert>
        )}

        {/* Dynamic Visualizer Bar */}
        {(isRecording || isPlaying) && (
          <AudioVisualizer analyser={analyserNode} isActive={isRecording || isPlaying} />
        )}

        {/* PHASE: SETUP */}
        {phase === "setup" && (
          <form onSubmit={handleSetupSubmit} className="space-y-6">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-2xl bg-[#1b1b20] border border-[#35353d] text-[#ae98f5] mb-1">
                <Swords className="h-8 w-8" strokeWidth={2.25} />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-[#f5f4ed]">
                1v1 Head-to-Head Duel
              </h2>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium max-w-md mx-auto">
                Challenge a friend on the same screen. Speak a phrase, flip it backwards, and see who survives!
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Player 1 Input */}
              <div className="p-5 rounded-2xl border border-[#35353d] bg-[#1b1b20] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-[#d3ff62] text-[#111113] font-black text-xs flex items-center justify-center">
                    1
                  </span>
                  <Label htmlFor="player1" className="text-xs font-bold uppercase tracking-wider text-[#d3ff62]">
                    Player 1 Name
                  </Label>
                </div>
                <Input
                  id="player1"
                  placeholder="e.g. Alex"
                  value={player1.name}
                  onChange={(e) => setPlayer1({ ...player1, name: e.target.value })}
                  maxLength={18}
                  className="rounded-xl font-bold text-base bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#d3ff62]"
                  required
                />
              </div>

              {/* Player 2 Input */}
              <div className="p-5 rounded-2xl border border-[#35353d] bg-[#1b1b20] space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-[#ae98f5] text-[#111113] font-black text-xs flex items-center justify-center">
                    2
                  </span>
                  <Label htmlFor="player2" className="text-xs font-bold uppercase tracking-wider text-[#ae98f5]">
                    Player 2 Name
                  </Label>
                </div>
                <Input
                  id="player2"
                  placeholder="e.g. Sam"
                  value={player2.name}
                  onChange={(e) => setPlayer2({ ...player2, name: e.target.value })}
                  maxLength={18}
                  className="rounded-xl font-bold text-base bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#ae98f5]"
                  required
                />
              </div>
            </div>

            {/* Life Pool Selector */}
            <div className="p-5 rounded-2xl border border-[#35353d] bg-[#1b1b20] space-y-3">
              <Label className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4] flex items-center gap-1.5">
                <Heart className="h-3.5 w-3.5 text-[#d3ff62] fill-[#d3ff62]" />
                Starting Lives per Player ({startingLives} Lives)
              </Label>
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 5].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setStartingLives(lvl)}
                    className={`py-3 text-xs font-bold rounded-xl border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      startingLives === lvl
                        ? "bg-[#d3ff62] text-[#111113] border-[#d3ff62] shadow-[0_0_15px_rgba(211,255,98,0.25)] font-black"
                        : "bg-[#232329] text-[#aaa9b4] border-[#35353d] hover:border-[#aaa9b4]"
                    }`}
                  >
                    <Heart className={`h-3.5 w-3.5 ${startingLives === lvl ? "fill-[#111113] text-[#111113]" : ""}`} />
                    {lvl} {lvl === 1 ? "Life" : "Lives"}
                  </button>
                ))}
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
              disabled={!player1.name.trim() || !player2.name.trim()}
            >
              <Swords className="h-5 w-5 mr-2" />
              Start 1v1 Battle!
            </Button>
          </form>
        )}

        {/* PHASE: START ROUND */}
        {phase === "start" && (
          <div className="space-y-6 text-center">
            {/* Round info card */}
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#232329] text-[#d3ff62] border border-[#35353d] text-xs font-bold uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" />
                Round {roundCount} • {recorder.name}&apos;s Turn to Speak
              </div>

              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#f5f4ed] leading-tight">
                &ldquo;{customPhrase.trim() || phrasePrompt.phrase}&rdquo;
              </h2>

              <p className="text-xs sm:text-sm text-[#d3ff62] font-bold max-w-sm mx-auto">
                👀 {imitator.name}, look away! Only {recorder.name} should see this secret phrase.
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  sfx.playClick()
                  setPhrasePrompt(getRandomPhrase(phrasePrompt.phrase))
                  setCustomPhrase("")
                }}
                className="w-full sm:w-auto font-bold text-xs rounded-xl border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35]"
              >
                <Dices className="h-4 w-4 mr-1.5 text-[#d3ff62]" strokeWidth={2.25} />
                Roll New Phrase
              </Button>

              <div className="w-full sm:max-w-xs">
                <Input
                  placeholder="Or custom phrase..."
                  value={customPhrase}
                  onChange={(e) => setCustomPhrase(e.target.value)}
                  className="h-9 text-xs rounded-xl font-medium bg-[#232329] border-[#35353d] text-[#f5f4ed] focus:border-[#d3ff62]"
                  maxLength={35}
                />
              </div>
            </div>

            <Button
              size="lg"
              onClick={handleStartGame}
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
            >
              <Mic className="mr-2 h-5 w-5" strokeWidth={2.5} />
              {recorder.name}, Start Recording!
            </Button>
          </div>
        )}

        {/* PHASE: COUNTDOWN */}
        {(phase === "counting-down-original" || phase === "counting-down-imitation") && (
          <div className="text-center py-12 space-y-4">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-[#1b1b20] border-4 border-[#d3ff62] text-[#d3ff62] flex items-center justify-center animate-bounce shadow-[0_0_30px_rgba(211,255,98,0.25)]">
              <span className="text-5xl font-black">{countdown}</span>
            </div>
            <h3 className="text-xl font-black text-[#f5f4ed]">
              {phase === "counting-down-original" ? `${recorder.name}, Speak Clearly!` : `${imitator.name}, Pronounce the Backwards Sound!`}
            </h3>
            <p className="text-sm font-semibold text-[#d3ff62]">
              {phase === "counting-down-original" ? `Phrase: "${targetText}"` : "Say the funny backwards sounds you just heard!"}
            </p>
          </div>
        )}

        {/* PHASE: RECORDING ORIGINAL */}
        {phase === "recording-original" && (
          <div className="text-center py-8 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 font-extrabold text-xs uppercase tracking-wider animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              {recorder.name} is Recording
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">Say It Loud and Clear</p>
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
              onClick={() => stopRecording(false)}
              className="py-6 px-8 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-rose-500/25 cursor-pointer"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              I&apos;m Done Speaking
            </Button>
          </div>
        )}

        {/* PHASE: ORIGINAL RECORDED -> PASS DEVICE */}
        {phase === "original-recorded" && (
          <div className="space-y-6 text-center">
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] space-y-3">
              <span className="text-3xl">📱</span>
              <h3 className="text-2xl font-black text-[#f5f4ed]">
                Pass Device to {imitator.name}!
              </h3>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium max-w-sm mx-auto">
                {imitator.name}, listen closely to the reversed syllables and prepare your vocal imitation!
              </p>
            </div>

            <Button
              size="lg"
              onClick={playReversedAudio}
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#ae98f5] text-[#111113] hover:bg-[#9d84f0] shadow-[0_0_25px_rgba(174,152,245,0.25)] active:scale-[0.98] transition-all cursor-pointer"
              disabled={isPlaying}
            >
              <Volume2 className="mr-2 h-5 w-5" strokeWidth={2.25} />
              Play Reversed Audio 🔄
            </Button>
          </div>
        )}

        {/* PHASE: PLAYING REVERSED */}
        {phase === "playing-reversed" && (
          <div className="space-y-6 text-center">
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#ae98f5]">
                Listening Mode • {MAX_REVERSE_PLAYS - reversedPlayCount} Replays Left
              </span>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f5f4ed]">
                {imitator.name}, Memorize the Backwards Sound!
              </h3>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium">
                Try breaking down the strange noises into simple vowel and consonant sounds.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button
                size="lg"
                onClick={playReversedAudio}
                variant="outline"
                disabled={isPlaying || reversedPlayCount >= MAX_REVERSE_PLAYS}
                className="flex-1 py-6 text-sm font-bold rounded-2xl border border-[#35353d] bg-[#232329] text-[#f5f4ed] hover:bg-[#2c2c35]"
              >
                <RotateCcw className="mr-2 h-4 w-4" strokeWidth={2.25} />
                Listen Again ({MAX_REVERSE_PLAYS - reversedPlayCount})
              </Button>

              <Button
                size="lg"
                onClick={handleStartImitation}
                disabled={isPlaying}
                className="flex-1 py-6 text-sm font-black rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_20px_rgba(211,255,98,0.25)] cursor-pointer"
              >
                <Mic className="mr-2 h-5 w-5" strokeWidth={2.5} />
                I&apos;m Ready to Imitate!
              </Button>
            </div>
          </div>
        )}

        {/* PHASE: RECORDING IMITATION */}
        {phase === "recording-imitation" && (
          <div className="text-center py-8 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#ae98f5]/15 border border-[#ae98f5]/30 text-[#ae98f5] font-extrabold text-xs uppercase tracking-wider animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ae98f5]" />
              {imitator.name} is Imitating
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-[#aaa9b4]">Make the Backwards Sounds!</p>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f5f4ed]">
                Pronounce the syllables exactly as you heard them!
              </h3>
            </div>

            <div className="w-full max-w-sm mx-auto space-y-1.5">
              <div className="h-2 w-full bg-[#232329] rounded-full overflow-hidden border border-[#35353d]">
                <div
                  className="h-full bg-[#ae98f5] transition-all duration-75"
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
              onClick={() => stopRecording(true)}
              className="py-6 px-8 rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg shadow-rose-500/25 cursor-pointer"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              Done Speaking
            </Button>
          </div>
        )}

        {/* PHASE: IMITATION RECORDED */}
        {phase === "imitation-recorded" && (
          <div className="space-y-6 text-center">
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] space-y-3">
              <span className="text-3xl">🎯</span>
              <h3 className="text-2xl font-black text-[#f5f4ed]">
                Imitation Captured!
              </h3>
              <p className="text-xs sm:text-sm text-[#aaa9b4] font-medium">
                Both players come together to compare the audio and decide if {imitator.name} nailed it.
              </p>
            </div>

            <Button
              size="lg"
              onClick={() => setPhase("voting")}
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
            >
              <ArrowRight className="mr-2 h-5 w-5" strokeWidth={2.25} />
              Compare Voices & Vote!
            </Button>
          </div>
        )}

        {/* PHASE: VOTING */}
        {phase === "voting" && (
          <div className="space-y-6">
            <div className="text-center space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-[#d3ff62]">
                The Moment of Truth
              </span>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#f5f4ed]">
                Listen & Vote
              </h3>
              <p className="text-xs text-[#aaa9b4]">
                Listen to the original phrase, then listen to {imitator.name}&apos;s flipped voice!
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Original Phrase Audio */}
              <button
                type="button"
                onClick={() => {
                  if (activePlayingId === "orig") stopPlayback()
                  else if (originalAudio) playBuffer(originalAudio, "orig")
                }}
                className={`p-6 rounded-3xl border text-left transition-all cursor-pointer shadow-md ${
                  activePlayingId === "orig"
                    ? "border-[#d3ff62] shadow-[0_0_20px_rgba(211,255,98,0.2)] bg-[#1b1b20]"
                    : "border-[#35353d] bg-[#1b1b20] hover:border-[#d3ff62]/50"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-[#d3ff62]">
                    {recorder.name}&apos;s Voice
                  </span>
                  <div className="w-8 h-8 rounded-full bg-[#232329] border border-[#35353d] flex items-center justify-center text-[#d3ff62]">
                    <Play className={`h-4 w-4 ${activePlayingId === "orig" ? "animate-pulse fill-current" : ""}`} />
                  </div>
                </div>
                <h4 className="text-lg font-black text-[#f5f4ed]">
                  Original Phrase
                </h4>
                <p className="text-xs text-[#aaa9b4] mt-1 font-medium">
                  What was originally spoken
                </p>
              </button>

              {/* Imitation Flipped Audio */}
              <button
                type="button"
                onClick={() => {
                  if (activePlayingId === "rev-imit") stopPlayback()
                  else if (reversedImitationAudio) playBuffer(reversedImitationAudio, "rev-imit")
                }}
                className={`p-6 rounded-3xl border text-left transition-all cursor-pointer shadow-md ${
                  activePlayingId === "rev-imit"
                    ? "border-[#ae98f5] shadow-[0_0_20px_rgba(174,152,245,0.2)] bg-[#1b1b20]"
                    : "border-[#35353d] bg-[#1b1b20] hover:border-[#ae98f5]/50"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-black uppercase tracking-wider text-[#ae98f5]">
                    {imitator.name}&apos;s Voice (Flipped)
                  </span>
                  <div className="w-8 h-8 rounded-full bg-[#232329] border border-[#35353d] flex items-center justify-center text-[#ae98f5]">
                    <Play className={`h-4 w-4 ${activePlayingId === "rev-imit" ? "animate-pulse fill-current" : ""}`} />
                  </div>
                </div>
                <h4 className="text-lg font-black text-[#f5f4ed]">
                  Imitation Flipped Back 🎯
                </h4>
                <p className="text-xs text-[#aaa9b4] mt-1 font-medium">
                  Does it sound like the original?
                </p>
              </button>
            </div>

            {/* Voting Decisions */}
            <div className="p-6 rounded-3xl border border-[#35353d] bg-[#1b1b20] space-y-4 text-center">
              <p className="text-sm font-bold text-[#f5f4ed]">
                Did {imitator.name} recreate the original words?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  size="lg"
                  onClick={() => handleVote(true)}
                  className="flex-1 py-6 text-sm font-black rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_20px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
                >
                  <ThumbsUp className="mr-2 h-5 w-5" />
                  Nailed It! 🎉 (Pass Round)
                </Button>
                <Button
                  size="lg"
                  onClick={() => handleVote(false)}
                  variant="outline"
                  className="flex-1 py-6 text-sm font-black rounded-2xl border border-rose-500/40 bg-[#232329] text-rose-400 hover:bg-rose-500/10 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <ThumbsDown className="mr-2 h-5 w-5" />
                  Missed It! 💥 (Lose 1 Life)
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* PHASE: REVEAL */}
        {phase === "reveal" && (
          <div className="space-y-6 text-center">
            <div
              className={`p-8 rounded-3xl border text-center space-y-3 ${
                voteResult
                  ? "border-[#d3ff62]/40 bg-[#d3ff62]/10"
                  : "border-rose-500/40 bg-rose-500/10"
              }`}
            >
              <span className="text-4xl">{voteResult ? "🎉" : "💥"}</span>
              <h3 className={`text-3xl font-black ${voteResult ? "text-[#d3ff62]" : "text-rose-400"}`}>
                {voteResult ? `${imitator.name} Passed!` : `${imitator.name} Lost 1 Life!`}
              </h3>
              {targetText && (
                <p className="text-sm font-bold text-[#f5f4ed]">
                  The Secret Phrase Was: &ldquo;{targetText}&rdquo;
                </p>
              )}
            </div>

            <Button
              size="lg"
              onClick={nextRound}
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
            >
              <ArrowRight className="mr-2 h-5 w-5" strokeWidth={2.25} />
              Next Round (Swap Roles)!
            </Button>
          </div>
        )}

        {/* PHASE: GAME OVER */}
        {phase === "game-over" && (
          <div className="space-y-6 text-center py-6">
            <div className="p-8 rounded-3xl border border-[#35353d] bg-[#1b1b20] shadow-2xl space-y-4">
              <div className="w-20 h-20 mx-auto rounded-3xl bg-[#d3ff62]/20 text-[#d3ff62] flex items-center justify-center animate-bounce">
                <Trophy className="h-10 w-10" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#d3ff62]">Battle Winner</span>
              <h3 className="text-3xl sm:text-4xl font-black tracking-tight text-[#f5f4ed]">
                {player1.lives > 0 ? player1.name : player2.name} Wins the Duel! 🏆
              </h3>
              <p className="text-sm font-medium text-[#aaa9b4]">
                All opponent lives were depleted!
              </p>
            </div>

            <Button
              size="lg"
              onClick={resetGame}
              className="w-full py-7 text-base font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#c2f247] shadow-[0_0_25px_rgba(211,255,98,0.25)] active:scale-[0.98] transition-all cursor-pointer"
            >
              <RotateCcw className="mr-2 h-5 w-5" strokeWidth={2.25} />
              Rematch & Play Again!
            </Button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#35353d] pt-4 text-center text-xs font-bold text-[#71717d]">
        Round {roundCount} • 1v1 Battle Mode
      </footer>
    </div>
  )
}
