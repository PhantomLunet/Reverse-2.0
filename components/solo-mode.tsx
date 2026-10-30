"use client"

import type React from "react"
import { useState, useRef, useCallback, useEffect } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AudioVisualizer } from "@/components/audio-visualizer"
import { getRandomPhrase, type PhrasePrompt } from "@/lib/phrase-prompts"
import { sfx } from "@/lib/sound-effects"
import { PcmAudioRecorder } from "@/lib/audio-recorder"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  Mic,
  Play,
  Volume2,
  ArrowLeft,
  Check,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Dices,
  Square,
  Sparkles,
  Trophy,
  ArrowUpRight,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

type SoloPhase =
  | "prompt"
  | "counting-down-original"
  | "recording-original"
  | "original-recorded"
  | "listening-reversed"
  | "counting-down-imitation"
  | "recording-imitation"
  | "reveal"

const MAX_RECORD_SECONDS = 8

interface SoloModeProps {
  onBack: () => void
}

export function SoloMode({ onBack }: SoloModeProps) {
  const [phase, setPhase] = useState<SoloPhase>("prompt")
  const [currentPrompt, setCurrentPrompt] = useState<PhrasePrompt>(() => getRandomPhrase())
  const [customPhrase, setCustomPhrase] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [activePlayingId, setActivePlayingId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [recordProgress, setRecordProgress] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const [originalAudio, setOriginalAudio] = useState<AudioBuffer | null>(null)
  const [reversedAudio, setReversedAudio] = useState<AudioBuffer | null>(null)
  const [rawImitationAudio, setRawImitationAudio] = useState<AudioBuffer | null>(null)
  const [reversedImitationAudio, setReversedImitationAudio] = useState<AudioBuffer | null>(null)
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const recorderRef = useRef<PcmAudioRecorder | null>(null)
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  const targetPhrase = customPhrase.trim() || currentPrompt.phrase

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
    (buffer: AudioBuffer, playId: string, onEnd?: () => void) => {
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
      setActivePlayingId(playId)
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

  // Direct PCM capture - immune to EncodingError
  const startRecording = useCallback(
    async (isImitation: boolean) => {
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
        console.error("Microphone access failed", err)
        setPermissionError("Could not access microphone. Please allow mic permission.")
        setPhase(isImitation ? "listening-reversed" : "prompt")
      }
    },
    [getAudioContext],
  )

  const stopRecording = useCallback(
    async (isImitation: boolean) => {
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
            setPhase("reveal")
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
          setPermissionError("Recording failed. Please try again.")
          setPhase(isImitation ? "listening-reversed" : "prompt")
        }
      }
    },
    [reverseAudioBuffer],
  )

  const triggerCountdown = useCallback(
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

  const rollNewPrompt = useCallback(() => {
    sfx.playClick()
    setCurrentPrompt(getRandomPhrase(currentPrompt.phrase))
    setCustomPhrase("")
  }, [currentPrompt.phrase])

  const restartPractice = useCallback(() => {
    stopPlayback()
    setOriginalAudio(null)
    setReversedAudio(null)
    setRawImitationAudio(null)
    setReversedImitationAudio(null)
    setPermissionError(null)
    setCustomPhrase("")
    rollNewPrompt()
    setPhase("prompt")
  }, [rollNewPrompt, stopPlayback])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (recorderRef.current) {
        recorderRef.current.cancel()
      }
      stopPlayback()
    }
  }, [stopPlayback])

  return (
    <div className="min-h-[100dvh] bg-[#ffffff] dark:bg-[#111113] text-[#111113] dark:text-[#f5f4ed] flex flex-col justify-between p-4 sm:p-6 md:p-8 max-w-2xl mx-auto selection:bg-[#d3ff62]/30 transition-colors duration-300 w-full overflow-x-hidden">
      {/* Top Header */}
      <header className="flex items-center justify-between pb-3 sm:pb-4 border-b border-[#e2e2e8] dark:border-[#35353d]">
        <button
          type="button"
          onClick={onBack}
          disabled={isRecording}
          className="inline-flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-[#61616c] dark:text-[#aaa9b4] hover:text-[#111113] dark:hover:text-[#f5f4ed] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
          <span>Hub</span>
        </button>

        <div className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#d3ff62]/10 text-[#72a800] dark:text-[#d3ff62] border border-[#d3ff62]/20">
            01 / Practice Mode
          </span>
          <ThemeToggle />
        </div>
      </header>

      {/* Main Game Screen */}
      <main className="py-6 space-y-6">
        {permissionError && (
          <Alert variant="destructive" className="rounded-2xl border-rose-500/40 bg-rose-500/10 text-rose-300">
            <AlertTitle className="font-bold text-rose-400">Microphone Notice</AlertTitle>
            <AlertDescription className="text-xs">{permissionError}</AlertDescription>
          </Alert>
        )}

        {/* Dynamic Visualizer Bar */}
        <AudioVisualizer analyser={analyserNode} isActive={isRecording || isPlaying} />

        {/* PHASE 1: PHRASE CARD */}
        {phase === "prompt" && (
          <div className="space-y-6 text-center">
            {/* Big Card */}
            <div className="p-8 rounded-[24px] border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] shadow-xl space-y-4">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#d3ff62]/10 text-[#72a800] dark:text-[#d3ff62] border border-[#d3ff62]/20">
                <Sparkles className="h-3 w-3" />
                {currentPrompt.category}
              </span>

              <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-[#111113] dark:text-[#f5f4ed] leading-tight">
                &ldquo;{targetPhrase}&rdquo;
              </h2>

              <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] max-w-sm mx-auto font-medium">
                Say this phrase clearly when recording starts. It will be flipped into crazy backwards syllables!
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={rollNewPrompt}
                className="w-full sm:w-auto font-bold text-xs rounded-xl border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] text-[#111113] dark:text-[#f5f4ed] hover:border-[#d3ff62]/40 h-10 px-4 flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Dices className="h-4 w-4 text-[#72a800] dark:text-[#d3ff62]" strokeWidth={2.25} />
                <span>Roll Another Phrase</span>
              </button>

              <div className="w-full sm:max-w-xs">
                <Input
                  placeholder="Or type custom phrase..."
                  value={customPhrase}
                  onChange={(e) => setCustomPhrase(e.target.value)}
                  className="h-10 text-xs rounded-xl font-medium bg-[#f4f4f7] dark:bg-[#1b1b20] border-[#e2e2e8] dark:border-[#35353d] text-[#111113] dark:text-[#f5f4ed] placeholder:text-[#8e8d99] dark:placeholder:text-[#71717d]"
                  maxLength={40}
                />
              </div>
            </div>

            {/* Big Neon Lime Start Button */}
            <button
              type="button"
              className="w-full py-5 text-base sm:text-lg font-black tracking-wide rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#b8f533] shadow-lg shadow-[#d3ff62]/20 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
              onClick={() => triggerCountdown(false)}
            >
              <Mic className="h-5 w-5" strokeWidth={2.5} />
              <span>Start 3-Second Recording Countdown!</span>
            </button>
          </div>
        )}

        {/* COUNTDOWN SCREEN */}
        {(phase === "counting-down-original" || phase === "counting-down-imitation") && (
          <div className="text-center py-12 space-y-4">
            <div className="w-24 h-24 mx-auto rounded-3xl bg-[#f4f4f7] dark:bg-[#1b1b20] border-4 border-[#d3ff62] text-[#72a800] dark:text-[#d3ff62] flex items-center justify-center animate-bounce shadow-xl shadow-[#d3ff62]/20">
              <span className="text-5xl font-black">{countdown}</span>
            </div>
            <h3 className="text-xl font-black text-[#111113] dark:text-[#f5f4ed]">
              {phase === "counting-down-original" ? "Get Ready to Speak!" : "Get Ready to Imitate!"}
            </h3>
            <p className="text-sm font-semibold text-[#72a800] dark:text-[#d3ff62]">
              {phase === "counting-down-original" ? `"${targetPhrase}"` : "Say the backwards syllables out loud!"}
            </p>
          </div>
        )}

        {/* RECORDING IN PROGRESS */}
        {(phase === "recording-original" || phase === "recording-imitation") && (
          <div className="text-center py-8 space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-rose-500/15 border-2 border-rose-500/30 text-rose-500 text-xs font-bold uppercase tracking-wider animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              Recording In Progress...
            </div>

            <div>
              <p className="text-xs uppercase font-bold text-[#61616c] dark:text-[#aaa9b4] mb-1">
                {phase === "recording-original" ? "Speak Clearly:" : "Imitate Backwards Now:"}
              </p>
              <h3 className="text-2xl sm:text-3xl font-black tracking-tight text-[#111113] dark:text-[#f5f4ed]">
                {phase === "recording-original" ? `"${targetPhrase}"` : "Repeat the flipped audio!"}
              </h3>
            </div>

            {/* Time Remaining Bar */}
            <div className="w-full max-w-sm mx-auto space-y-1.5">
              <div className="h-2.5 w-full bg-[#eaeaf0] dark:bg-[#1b1b20] rounded-full overflow-hidden p-0.5 border border-[#e2e2e8] dark:border-[#35353d]">
                <div
                  className="h-full bg-gradient-to-r from-[#d3ff62] to-[#ae98f5] rounded-full transition-all duration-75"
                  style={{ width: `${recordProgress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs font-bold text-[#8e8d99] dark:text-[#71717d]">
                <span>0s</span>
                <span>Max {MAX_RECORD_SECONDS}s</span>
              </div>
            </div>

            <Button
              size="lg"
              variant="destructive"
              onClick={() => stopRecording(phase === "recording-imitation")}
              className="px-8 py-6 font-bold text-sm rounded-2xl shadow-lg active:scale-95 cursor-pointer bg-rose-600 hover:bg-rose-500"
            >
              <Square className="h-4 w-4 mr-2 fill-current" />
              Done Speaking (Stop)
            </Button>
          </div>
        )}

        {/* ORIGINAL RECORDED -> LISTEN REVERSED */}
        {phase === "original-recorded" && (
          <div className="space-y-6 text-center">
            <div className="p-4 rounded-2xl bg-[#d3ff62]/10 border border-[#d3ff62]/30 text-[#72a800] dark:text-[#d3ff62] font-bold text-sm flex items-center justify-center gap-2">
              <Check className="h-5 w-5" strokeWidth={3} />
              Original Phrase Captured & Flipped Backwards!
            </div>

            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="w-full py-5 text-base font-black rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#b8f533] shadow-lg shadow-[#d3ff62]/20 active:scale-[0.98] transition-all cursor-pointer flex items-center justify-center gap-2"
                onClick={() => {
                  if (reversedAudio) {
                    playBuffer(reversedAudio, "reversed")
                    setPhase("listening-reversed")
                  }
                }}
              >
                <Volume2 className="h-5 w-5" strokeWidth={2.5} />
                <span>Hear It Backwards Now! 🔄</span>
              </button>

              <button
                type="button"
                onClick={() => setPhase("prompt")}
                className="font-bold text-xs text-[#61616c] dark:text-[#aaa9b4] hover:text-[#111113] dark:hover:text-[#f5f4ed] flex items-center justify-center gap-1.5 py-2 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                <span>Re-record Phrase</span>
              </button>
            </div>
          </div>
        )}

        {/* LISTENING & PREPARING IMITATION */}
        {phase === "listening-reversed" && (
          <div className="space-y-6 text-center">
            <div className="p-8 rounded-[24px] border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#7a58e6] dark:text-[#ae98f5]">
                Backward Emulation
              </span>
              <h3 className="text-2xl font-black text-[#111113] dark:text-[#f5f4ed]">
                Memorize The Flipped Sounds
              </h3>
              <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] max-w-sm mx-auto font-medium">
                Listen as many times as you want! Try repeating the weird alien syllables out loud.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={() => reversedAudio && playBuffer(reversedAudio, "reversed")}
                disabled={isPlaying}
                className="flex-1 py-5 text-sm font-bold rounded-2xl border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] text-[#111113] dark:text-[#f5f4ed] hover:border-[#ae98f5]/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Volume2 className="h-4 w-4 text-[#7a58e6] dark:text-[#ae98f5]" strokeWidth={2.25} />
                <span>Listen Again</span>
              </button>

              <button
                type="button"
                onClick={() => triggerCountdown(true)}
                disabled={isPlaying}
                className="flex-1 py-5 text-sm font-black rounded-2xl bg-[#d3ff62] text-[#111113] hover:bg-[#b8f533] shadow-lg shadow-[#d3ff62]/20 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Mic className="h-5 w-5" strokeWidth={2.5} />
                <span>Record My Imitation!</span>
              </button>
            </div>
          </div>
        )}

        {/* REVEAL & SIDE-BY-SIDE VERDICT */}
        {phase === "reveal" && (
          <div className="space-y-6 text-center animate-fade-in">
            <div className="p-6 rounded-[24px] border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#72a800] dark:text-[#d3ff62]">
                The Great Reveal 🎯
              </span>
              <h3 className="text-3xl font-black text-[#111113] dark:text-[#f5f4ed]">
                Did You Sound Like The Original?
              </h3>
              <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] font-medium">
                Target: &ldquo;{targetPhrase}&rdquo;
              </p>
            </div>

            {/* Two Audio Comparison Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Original Phrase */}
              <div
                onClick={() => {
                  if (activePlayingId === "orig") stopPlayback()
                  else if (originalAudio) playBuffer(originalAudio, "orig")
                }}
                className={`p-6 rounded-[24px] border-2 text-left cursor-pointer transition-all ${
                  activePlayingId === "orig"
                    ? "border-[#d3ff62] bg-[#d3ff62]/10"
                    : "border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] hover:border-[#d3ff62]/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#72a800] dark:text-[#d3ff62]">
                    What You Intended
                  </span>
                  <div className="w-8 h-8 rounded-full bg-[#d3ff62]/20 flex items-center justify-center text-[#72a800] dark:text-[#d3ff62]">
                    <Play className={`h-4 w-4 ${activePlayingId === "orig" ? "animate-pulse fill-current" : ""}`} />
                  </div>
                </div>
                <h4 className="text-lg font-black text-[#111113] dark:text-[#f5f4ed]">
                  Original Phrase
                </h4>
                <p className="text-xs text-[#61616c] dark:text-[#aaa9b4] mt-0.5">
                  &ldquo;{targetPhrase}&rdquo;
                </p>
              </div>

              {/* Imitation Flipped Back */}
              <div
                onClick={() => {
                  if (activePlayingId === "rev-imit") stopPlayback()
                  else if (reversedImitationAudio) playBuffer(reversedImitationAudio, "rev-imit")
                }}
                className={`p-6 rounded-[24px] border-2 text-left cursor-pointer transition-all ${
                  activePlayingId === "rev-imit"
                    ? "border-[#ae98f5] bg-[#ae98f5]/10"
                    : "border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] hover:border-[#ae98f5]/40"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase tracking-wider text-[#7a58e6] dark:text-[#ae98f5]">
                    Your Voice Flipped Back
                  </span>
                  <div className="w-8 h-8 rounded-full bg-[#ae98f5]/20 flex items-center justify-center text-[#7a58e6] dark:text-[#ae98f5]">
                    <Play className={`h-4 w-4 ${activePlayingId === "rev-imit" ? "animate-pulse fill-current" : ""}`} />
                  </div>
                </div>
                <h4 className="text-lg font-black text-[#111113] dark:text-[#f5f4ed]">
                  Imitation Flipped 🎯
                </h4>
                <p className="text-xs text-[#61616c] dark:text-[#aaa9b4] mt-0.5">
                  Does it sound like English?
                </p>
              </div>
            </div>

            {/* Self Rating Buttons */}
            <div className="p-6 rounded-[24px] border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] space-y-4">
              <p className="text-sm font-bold text-[#111113] dark:text-[#f5f4ed]">
                How close was your backward imitation?
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    sfx.playSuccess()
                    restartPractice()
                  }}
                  className="flex-1 py-5 text-sm font-black rounded-xl bg-[#d3ff62] text-[#111113] hover:bg-[#b8f533] shadow-md shadow-[#d3ff62]/20 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ThumbsUp className="h-4 w-4" />
                  <span>Nailed It! 🎉 (Next Phrase)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sfx.playBuzzer()
                    restartPractice()
                  }}
                  className="flex-1 py-5 text-sm font-black rounded-xl border border-rose-500/40 text-rose-500 hover:bg-rose-500/10 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <ThumbsDown className="h-4 w-4" />
                  <span>Epic Fail! 💥 (Try Another)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#e2e2e8] dark:border-[#35353d] pt-4 text-center text-xs font-semibold text-[#8e8d99] dark:text-[#71717d]">
        Rev3rse • Solo Practice Calibration
      </footer>
    </div>
  )
}
