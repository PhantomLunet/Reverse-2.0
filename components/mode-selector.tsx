"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import type { GameMode } from "@/app/page"
import { ThemeToggle } from "@/components/theme-toggle"
import { sfx } from "@/lib/sound-effects"
import Image from "next/image"
import {
  Volume2,
  ArrowUpRight,
  Headphones,
  Repeat2,
  Users,
  Mic,
  Ear,
  Play,
  RotateCcw,
  Sparkles,
  ArrowLeft,
  AudioLines,
} from "lucide-react"

interface ModeSelectorProps {
  onSelectMode: (mode: GameMode) => void
  onReplayIntro?: () => void
  initialPlayIntro?: boolean
}

export function ModeSelector({
  onSelectMode,
  onReplayIntro,
  initialPlayIntro = true,
}: ModeSelectorProps) {
  // Navigation: intro -> how-to-play -> modes
  const [view, setView] = useState<"intro" | "how-to-play" | "modes">("intro")
  const [activeDemo, setActiveDemo] = useState<string | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const demoOscRef = useRef<any>(null)

  // Native coded intro animation states:
  // 0: Center Neon Pulse (0ms - 800ms)
  // 1: Stereo Waveform Burst & Cassette Orbits (800ms - 1800ms)
  // 2: Sonic Shockwave Ripples + 3D Icon Zoom + Wordmark Impact (1800ms - 2800ms)
  // 3: Seamless Landing UI Unfurl (Header, Tagline, Paragraph, CTA, Footer) (2800ms - 3800ms)
  // 4: Settled & fully interactive (>= 3800ms)
  const [animStage, setAnimStage] = useState<number>(() => (initialPlayIntro ? 0 : 4))
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false)
  const introAudioRef = useRef<HTMLAudioElement | null>(null)
  const introTimersRef = useRef<NodeJS.Timeout[]>([])

  const clearIntroTimers = useCallback(() => {
    introTimersRef.current.forEach(clearTimeout)
    introTimersRef.current = []
  }, [])

  const skipIntro = useCallback(() => {
    clearIntroTimers()
    setAnimStage(4)
    if (introAudioRef.current) {
      try {
        introAudioRef.current.pause()
        introAudioRef.current.currentTime = 0
      } catch {}
    }
  }, [clearIntroTimers])

  const startIntroSequence = useCallback(
    (withSound = false) => {
      clearIntroTimers()
      setAnimStage(0)

      if (withSound || soundEnabled) {
        try {
          if (!introAudioRef.current) {
            introAudioRef.current = new Audio("/intro-sfx.mp3")
            introAudioRef.current.volume = 0.85
          }
          introAudioRef.current.currentTime = 0
          introAudioRef.current.play().catch(() => {})
        } catch {}
      }

      const t1 = setTimeout(() => setAnimStage(1), 800)
      const t2 = setTimeout(() => setAnimStage(2), 1800)
      const t3 = setTimeout(() => setAnimStage(3), 2800)
      const t4 = setTimeout(() => setAnimStage(4), 3800)

      introTimersRef.current = [t1, t2, t3, t4]
    },
    [clearIntroTimers, soundEnabled],
  )

  useEffect(() => {
    if (initialPlayIntro) {
      startIntroSequence(false)
    } else {
      setAnimStage(4)
    }
    return () => {
      clearIntroTimers()
      if (introAudioRef.current) {
        try {
          introAudioRef.current.pause()
        } catch {}
      }
    }
  }, [initialPlayIntro, startIntroSequence, clearIntroTimers])

  // Keyboard shortcut: Space, Enter, or Escape skips intro immediately
  useEffect(() => {
    if (animStage >= 4) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter" || e.key === "Escape") {
        e.preventDefault()
        skipIntro()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [animStage, skipIntro])

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      audioCtxRef.current = new AudioCtx()
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }, [])

  // Play synthetic backward/forward preview sound bites for the interactive cards
  const playInteractiveDemo = useCallback(
    (demoId: string) => {
      try {
        if (activeDemo === demoId) {
          setActiveDemo(null)
          return
        }

        const ctx = getAudioContext()
        setActiveDemo(demoId)

        const now = ctx.currentTime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)

        if (demoId === "machine-original" || demoId === "stage-1") {
          // Normal forward spoken cadence
          osc.type = "sine"
          osc.frequency.setValueAtTime(220, now)
          osc.frequency.exponentialRampToValueAtTime(330, now + 0.3)
          osc.frequency.exponentialRampToValueAtTime(196, now + 0.6)
          osc.frequency.exponentialRampToValueAtTime(260, now + 1.0)
          gain.gain.setValueAtTime(0.2, now)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1)
          osc.start(now)
          osc.stop(now + 1.1)
        } else if (demoId === "machine-reversed" || demoId === "stage-2") {
          // Strange backward reverse cadence (swells and flips)
          osc.type = "triangle"
          osc.frequency.setValueAtTime(260, now)
          osc.frequency.exponentialRampToValueAtTime(196, now + 0.4)
          osc.frequency.exponentialRampToValueAtTime(330, now + 0.8)
          osc.frequency.exponentialRampToValueAtTime(220, now + 1.1)
          gain.gain.setValueAtTime(0.01, now)
          gain.gain.exponentialRampToValueAtTime(0.25, now + 0.9)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2)
          osc.start(now)
          osc.stop(now + 1.2)
        } else if (demoId === "stage-3") {
          // Vocal imitation (funny wobbly human-like pitch)
          osc.type = "sawtooth"
          osc.frequency.setValueAtTime(250, now)
          osc.frequency.linearRampToValueAtTime(210, now + 0.3)
          osc.frequency.linearRampToValueAtTime(310, now + 0.7)
          osc.frequency.linearRampToValueAtTime(240, now + 1.1)
          gain.gain.setValueAtTime(0.12, now)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2)
          osc.start(now)
          osc.stop(now + 1.2)
        } else if (demoId === "stage-4") {
          // Reveal (rewound and clear triumph chord)
          osc.type = "sine"
          osc.frequency.setValueAtTime(220, now)
          osc.frequency.exponentialRampToValueAtTime(440, now + 0.5)
          osc.frequency.setValueAtTime(554.37, now + 0.7)
          osc.frequency.setValueAtTime(659.25, now + 0.9)
          gain.gain.setValueAtTime(0.2, now)
          gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3)
          osc.start(now)
          osc.stop(now + 1.3)
        }

        setTimeout(() => {
          setActiveDemo(null)
        }, 1300)
      } catch (e) {
        console.error("Demo playback error", e)
        setActiveDemo(null)
      }
    },
    [activeDemo, getAudioContext],
  )

  useEffect(() => {
    return () => {
      if (demoOscRef.current) {
        try {
          demoOscRef.current.stop()
        } catch {}
      }
    }
  }, [])

  return (
    <div
      className={`h-[100dvh] max-h-[100dvh] w-full flex flex-col justify-between selection:bg-[#d3ff62]/40 relative overflow-hidden transition-colors duration-1000 font-sans ${
        animStage < 3
          ? "bg-[#0b0b0e] text-[#f5f4ed]"
          : "bg-[#ffffff] dark:bg-[#111113] text-[#111113] dark:text-[#f5f4ed]"
      }`}
    >
      {/* Floating Skip Pill during Intro Animation */}
      {view === "intro" && animStage < 4 && (
        <button
          type="button"
          onClick={skipIntro}
          className="fixed top-3 right-3 sm:top-5 sm:right-6 z-50 flex items-center gap-2 bg-[#1b1b20]/85 hover:bg-[#232329] text-[#f5f4ed] border border-[#35353d] hover:border-[#d3ff62] px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-xs font-semibold backdrop-blur-md transition-all shadow-xl hover:scale-105 cursor-pointer"
        >
          <span>Skip Intro</span>
          <span className="text-[#d3ff62]">→</span>
        </button>
      )}

      {/* ======================================================== */}
      {/* 1. INTRO / HERO VIEW (Viewport-Fit for Mobile, Tablet & Desktop) */}
      {/* ======================================================== */}
      {view === "intro" && (
        <div className="h-[100dvh] max-h-[100dvh] w-full flex flex-col justify-between p-3 sm:p-5 md:p-8 max-w-7xl mx-auto relative z-10 overflow-hidden">
          {/* Left Sound Orbit with Glowing Waves (Anchored to Screen Edge on ALL devices) */}
          <div
            className={`absolute left-0 -translate-x-1/2 top-[24%] sm:top-[28%] lg:top-1/2 -translate-y-1/2 w-[280px] h-[280px] sm:w-[350px] sm:h-[350px] md:w-[420px] md:h-[420px] lg:w-[480px] lg:h-[480px] pointer-events-none transition-all duration-700 z-0 ${
              animStage >= 1
                ? "opacity-45 sm:opacity-55 scale-100"
                : "opacity-0 scale-75"
            }`}
          >
            <Image
              src="/figma/sound-orbit.svg"
              alt=""
              width={480}
              height={480}
              className="w-full h-full animate-spin-slow"
            />
            {/* Left Equalizer Waveform Bars - nestled in visible inner hemisphere */}
            <div className="absolute top-1/2 -translate-y-1/2 right-[14px] sm:right-[26px] md:right-[38px] flex items-center gap-0.5 sm:gap-1 md:gap-1.5 h-16 sm:h-20">
              {[14, 28, 48, 32, 68, 96, 72, 38, 88, 110, 80, 48, 102, 120, 84, 56, 36, 80].map(
                (h, i) => (
                  <div
                    key={`lo-${i}`}
                    style={{
                      height: `${h * (animStage === 1 ? 0.65 : 0.42)}px`,
                      animationDelay: `${i * 0.08}s`,
                    }}
                    className="w-0.5 sm:w-1 bg-[#ae98f5] rounded-full animate-pulse transition-all duration-300 shadow-[0_0_8px_rgba(174,152,245,0.4)]"
                  />
                ),
              )}
            </div>
          </div>

          {/* Right Sound Orbit with Glowing Waves (Anchored to Screen Edge on ALL devices) */}
          <div
            className={`absolute right-0 translate-x-1/2 top-[24%] sm:top-[28%] lg:top-1/2 -translate-y-1/2 w-[280px] h-[280px] sm:w-[350px] sm:h-[350px] md:w-[420px] md:h-[420px] lg:w-[480px] lg:h-[480px] pointer-events-none transition-all duration-700 z-0 ${
              animStage >= 1
                ? "opacity-45 sm:opacity-55 scale-100"
                : "opacity-0 scale-75"
            }`}
          >
            <Image
              src="/figma/sound-orbit.svg"
              alt=""
              width={480}
              height={480}
              className="w-full h-full animate-spin-reverse-slow"
            />
            {/* Right Equalizer Waveform Bars - nestled in visible inner hemisphere */}
            <div className="absolute top-1/2 -translate-y-1/2 left-[14px] sm:left-[26px] md:left-[38px] flex items-center gap-0.5 sm:gap-1 md:gap-1.5 h-16 sm:h-20">
              {[36, 80, 120, 102, 48, 80, 110, 88, 38, 72, 96, 68, 32, 48, 28, 14, 48, 80].map(
                (h, i) => (
                  <div
                    key={`ro-${i}`}
                    style={{
                      height: `${h * (animStage === 1 ? 0.65 : 0.42)}px`,
                      animationDelay: `${i * 0.08}s`,
                    }}
                    className="w-0.5 sm:w-1 bg-[#ae98f5] rounded-full animate-pulse transition-all duration-300 shadow-[0_0_8px_rgba(174,152,245,0.4)]"
                  />
                ),
              )}
            </div>
          </div>

          {/* Top Header - Slides down in Stage 3 */}
          <header
            className={`flex items-center justify-between w-full pb-2.5 sm:pb-3.5 border-b border-[#e2e2e8] dark:border-[#35353d]/40 shrink-0 transition-all duration-700 z-20 ${
              animStage >= 3
                ? "opacity-100 translate-y-0"
                : "opacity-0 -translate-y-6 pointer-events-none"
            }`}
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="relative w-6 h-6 sm:w-8 sm:h-8 shrink-0">
                <Image
                  src="/figma/reverse-audio-symbol.svg"
                  alt="Rev3rse logo"
                  width={32}
                  height={32}
                  className="w-full h-full"
                  priority
                />
              </div>
              <span className="font-bold tracking-wider text-[#61616c] dark:text-[#aaa9b4] text-[10px] sm:text-xs uppercase">
                THE AUDIO PARTY GAME
              </span>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-5">
              <button
                type="button"
                onClick={() => {
                  const next = !soundEnabled
                  setSoundEnabled(next)
                  if (next) {
                    if (!introAudioRef.current) {
                      introAudioRef.current = new Audio("/intro-sfx.mp3")
                      introAudioRef.current.volume = 0.85
                    }
                    introAudioRef.current.currentTime = 0
                    introAudioRef.current.play().catch(() => {})
                  } else {
                    introAudioRef.current?.pause()
                  }
                }}
                className={`flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-semibold border px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full transition-all cursor-pointer ${
                  soundEnabled
                    ? "border-[#d3ff62] text-[#d3ff62] bg-[#d3ff62]/10 shadow-[0_0_15px_rgba(211,255,98,0.25)]"
                    : "border-[#e2e2e8] dark:border-[#35353d] text-[#61616c] dark:text-[#aaa9b4] hover:border-[#d3ff62]"
                }`}
                title="Toggle sound effects"
              >
                <Volume2 className={`h-3 w-3 sm:h-3.5 sm:w-3.5 ${soundEnabled ? "text-[#d3ff62]" : ""}`} />
                <span>{soundEnabled ? "SOUND ON" : "SOUND FX"}</span>
              </button>
              <ThemeToggle />
            </div>
          </header>

          {/* Central Brand Stage - Viewport Fit & Vertically Balanced */}
          <main className="relative flex-1 flex flex-col items-center justify-center text-center py-2 sm:py-4 md:py-6 my-auto min-h-0 w-full max-w-4xl mx-auto z-10">
            {/* Stage 0 & 1: Center Glowing Rewind Emblem */}
            <div
              className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center pointer-events-none transition-all duration-700 z-30 ${
                animStage <= 1
                  ? "opacity-100 scale-100"
                  : "opacity-0 scale-150 pointer-events-none"
              }`}
            >
              <div className="relative flex items-center justify-center">
                <div className="w-13 h-13 sm:w-16 sm:h-16 rounded-2xl bg-[#d3ff62] shadow-[0_0_60px_rgba(211,255,98,0.85)] flex items-center justify-center animate-neon-pulse">
                  <div className="w-7 h-7 sm:w-8 sm:h-8 relative">
                    <Image
                      src="/figma/reverse-audio-symbol.svg"
                      alt="Reverse Audio"
                      width={32}
                      height={32}
                      className="w-full h-full"
                      priority
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Stage 2: Concentric Sonic Ripples (Mathematically Centered) */}
            {animStage >= 2 && animStage < 4 && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[240px] h-[240px] sm:w-[360px] sm:h-[360px] md:w-[460px] md:h-[460px] pointer-events-none z-0 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-[#ae98f5]/40 animate-sonic-ripple-1" />
                <div className="absolute inset-0 rounded-full border-2 border-[#d3ff62]/40 animate-sonic-ripple-2" />
                <div className="absolute inset-0 rounded-full border-2 border-[#ae98f5]/30 animate-sonic-ripple-3" />
                <div className="absolute inset-0 rounded-full border-2 border-[#d3ff62]/30 animate-sonic-ripple-4" />
              </div>
            )}

            {/* Tilted 3D App Icon - Zooms forward and tilts in Stage 2 */}
            <div
              onClick={() => {
                sfx.playClick()
                startIntroSequence(true)
                if (onReplayIntro) onReplayIntro()
              }}
              className={`mb-2 sm:mb-3.5 md:mb-5 transition-all duration-700 hover:scale-105 cursor-pointer shrink-0 group z-20 ${
                animStage >= 2
                  ? "opacity-100 scale-100 translate-y-0"
                  : "opacity-0 scale-50 translate-y-8 pointer-events-none"
              }`}
              title="Click to replay intro animation"
            >
              <div className="-rotate-6 inline-block bg-[#f4f4f7] dark:bg-[#1b1b20] border-2 border-[#e2e2e8] dark:border-[#35353d] group-hover:border-[#d3ff62] rounded-[18px] sm:rounded-[26px] md:rounded-[32px] p-2 sm:p-2.5 md:p-3 shadow-2xl shadow-black/30 dark:shadow-black/80 transition-colors">
                <div className="w-13 h-13 sm:w-16 sm:h-16 md:w-20 md:h-20 lg:w-24 lg:h-24 relative">
                  <Image
                    src="/figma/reverse-audio-big.svg"
                    alt="Rev3rse App Icon"
                    width={96}
                    height={96}
                    className="w-full h-full"
                    priority
                  />
                </div>
              </div>
            </div>

            {/* Fluid Responsive Wordmark Title - Impacts in Stage 2 */}
            <h1
              className={`text-5xl sm:text-6xl md:text-7xl lg:text-8xl xl:text-9xl font-black tracking-tight leading-[0.92] mb-1 sm:mb-2 md:mb-3 shrink-0 transition-all duration-700 z-20 ${
                animStage >= 2
                  ? "opacity-100 scale-100 translate-y-0 drop-shadow-[0_0_35px_rgba(211,255,98,0.25)]"
                  : "opacity-0 scale-90 translate-y-6"
              } ${
                animStage < 3
                  ? "text-[#ffffff]"
                  : "text-[#111113] dark:text-[#f5f4ed]"
              }`}
            >
              Rev3rse
            </h1>

            {/* Tagline Badge - Unfurls in Stage 3 */}
            <p
              className={`font-bold text-[10px] sm:text-xs md:text-sm tracking-widest text-[#72a800] dark:text-[#d3ff62] uppercase mb-1.5 sm:mb-2.5 md:mb-3.5 shrink-0 transition-all duration-700 z-20 ${
                animStage >= 3
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-3"
              }`}
            >
              SOUND WRONG. LAUGH RIGHT.
            </p>

            {/* Subtitle Description - Unfurls in Stage 3 */}
            <div
              className={`text-xs sm:text-sm md:text-base max-w-[280px] sm:max-w-md mx-auto font-normal leading-relaxed mb-3.5 sm:mb-5 md:mb-7 px-2 shrink-0 transition-all duration-700 z-20 ${
                animStage >= 3
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-4"
              } ${
                animStage < 3
                  ? "text-[#aaa9b4]"
                  : "text-[#61616c] dark:text-[#aaa9b4]"
              }`}
            >
              <p>A normal phrase. A backward voice.</p>
              <p>A very good reason to lose it.</p>
            </div>

            {/* Main CTA Button: Transitions to Full How To Play Page */}
            <div
              className={`flex flex-col items-center gap-1.5 sm:gap-2 w-full max-w-xs sm:max-w-none transition-all duration-700 z-20 shrink-0 ${
                animStage >= 3
                  ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
                  : "opacity-0 scale-90 translate-y-6 pointer-events-none"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  sfx.playClick()
                  setView("how-to-play")
                }}
                className="w-full sm:w-auto bg-[#d3ff62] text-[#111113] font-bold text-sm sm:text-base md:text-lg h-11 sm:h-13 md:h-14 px-7 sm:px-9 rounded-xl flex items-center justify-center gap-3 sm:gap-4 hover:bg-[#b8f533] active:scale-[0.98] transition-all shadow-xl shadow-[#d3ff62]/25 cursor-pointer group"
              >
                <span>Let&apos;s hear it</span>
                <ArrowUpRight className="h-4.5 w-4.5 sm:h-5 sm:w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>

              <p className="text-[10px] sm:text-xs text-[#8e8d99] dark:text-[#71717d] font-medium">
                Your voice is the only equipment.
              </p>
            </div>
          </main>

          {/* Footer Bar - Slides up in Stage 3 */}
          <footer
            className={`flex flex-col sm:flex-row items-center justify-between border-t border-[#e2e2e8] dark:border-[#35353d]/40 pt-2 sm:pt-3 text-[10px] sm:text-xs text-[#8e8d99] dark:text-[#71717d] font-medium gap-1.5 sm:gap-2.5 shrink-0 z-20 transition-all duration-700 ${
              animStage >= 3
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-6 pointer-events-none"
            }`}
          >
            <span>GOOD COMPANY. BAD IMPRESSIONS.</span>
            <div className="flex items-center gap-2.5 sm:gap-3 tracking-wider">
              <button
                type="button"
                onClick={() => {
                  sfx.playClick()
                  startIntroSequence(true)
                  if (onReplayIntro) onReplayIntro()
                }}
                className="hover:text-[#111113] dark:hover:text-[#f5f4ed] text-[#72a800] dark:text-[#d3ff62] font-bold transition-colors cursor-pointer"
                title="Replay intro animation sequence"
              >
                INTRO
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => setView("how-to-play")}
                className="hover:text-[#111113] dark:hover:text-[#f5f4ed] transition-colors cursor-pointer"
              >
                HOW TO PLAY
              </button>
              <span>•</span>
              <button
                type="button"
                onClick={() => setView("modes")}
                className="hover:text-[#111113] dark:hover:text-[#f5f4ed] transition-colors cursor-pointer"
              >
                GAME MODES
              </button>
            </div>
          </footer>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. FULL HOW TO PLAY PAGE (Matching Figma How to play · Desktop, Tablet & iPhone) */}
      {/* ======================================================== */}
      {view === "how-to-play" && (
        <div className="flex-1 flex flex-col w-full animate-fade-in overflow-x-hidden">
          {/* Navigation Bar (Exact Figma Frame 5:9473 & 5:9960) */}
          <nav className="border-b border-[#e2e2e8] dark:border-[#35353d] px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 h-16 sm:h-20 lg:h-24 flex items-center justify-between sticky top-0 bg-[#ffffff]/90 dark:bg-[#111113]/90 backdrop-blur-md z-30 shrink-0">
            <button
              type="button"
              onClick={() => {
                sfx.playClick()
                setView("intro")
              }}
              className="flex items-center gap-2.5 sm:gap-3 group cursor-pointer"
            >
              <div className="relative w-7 h-7 sm:w-8 sm:h-8 lg:w-9 lg:h-9 shrink-0">
                <Image
                  src="/figma/reverse-audio-symbol.svg"
                  alt="Rev3rse logo"
                  width={36}
                  height={36}
                  className="w-full h-full"
                />
              </div>
              <span className="font-extrabold text-xl sm:text-2xl text-[#111113] dark:text-[#f5f4ed]">
                Rev3rse
              </span>
            </button>

            <div className="flex items-center gap-3 sm:gap-6">
              <div className="hidden md:flex items-center gap-6 text-sm font-medium">
                <span className="text-[#111113] dark:text-[#f5f4ed] font-bold border-b-2 border-[#d3ff62] pb-1">
                  How to play
                </span>
                <button
                  type="button"
                  onClick={() => {
                    sfx.playClick()
                    setView("modes")
                  }}
                  className="text-[#61616c] dark:text-[#aaa9b4] hover:text-[#111113] dark:hover:text-[#f5f4ed] transition-colors cursor-pointer"
                >
                  Game modes
                </button>
              </div>

              <div className="hidden sm:flex items-center gap-2 border border-[#e2e2e8] dark:border-[#35353d] px-3.5 py-1.5 sm:py-2 rounded-full text-[11px] font-semibold text-[#61616c] dark:text-[#aaa9b4]">
                <Volume2 className="h-4 w-4" />
                <span>SOUND ON</span>
              </div>

              <ThemeToggle />
            </div>
          </nav>

          {/* Section 1: Hero & The Backward Machine (Figma 5:9486 & 5:9970) */}
          <section className="px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-8 sm:py-12 lg:py-16 flex flex-col lg:flex-row items-center justify-between gap-8 lg:gap-12 xl:gap-16 max-w-7xl mx-auto w-full">
            {/* Left Column: Big Copy */}
            <div className="flex-1 flex flex-col items-start gap-4 sm:gap-6 w-full">
              <p className="font-bold text-[11px] sm:text-xs tracking-widest text-[#72a800] dark:text-[#d3ff62] uppercase">
                YOUR VOICE. COMPLETELY BACKWARDS.
              </p>

              <div className="font-black text-4xl sm:text-6xl md:text-7xl lg:text-[76px] xl:text-[90px] text-[#111113] dark:text-[#f5f4ed] leading-[0.98] tracking-tight">
                <p>Say it.</p>
                <p className="text-[#72a800] dark:text-[#d3ff62]">Flip it.</p>
                <p>Lose it.</p>
              </div>

              <p className="text-[#61616c] dark:text-[#aaa9b4] text-sm sm:text-base md:text-lg max-w-lg font-normal leading-relaxed">
                The audio party game where you imitate backward sounds, flip them around, and try not to fall apart.
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 pt-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    sfx.playClick()
                    setView("modes")
                  }}
                  className="bg-[#d3ff62] text-[#111113] font-bold text-base h-12 sm:h-14 px-7 rounded-xl flex items-center justify-center gap-3 sm:gap-4 hover:bg-[#b8f533] active:scale-[0.98] transition-all shadow-xl shadow-[#d3ff62]/20 cursor-pointer group"
                >
                  <span>Start playing</span>
                  <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>

                <div className="text-xs text-[#8e8d99] dark:text-[#71717d] font-medium sm:pl-2 text-center sm:text-left">
                  <p>No downloads.</p>
                  <p>Just your voice.</p>
                </div>
              </div>
            </div>

            {/* Right Column: The Backward Machine Card */}
            <div className="w-full lg:w-[460px] xl:w-[520px] shrink-0 max-w-full">
              <div className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-7 md:p-8 flex flex-col gap-4 sm:gap-5 shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between pb-1 border-b border-[#e2e2e8] dark:border-[#35353d]/40">
                  <span className="font-bold text-[11px] uppercase tracking-wider text-[#61616c] dark:text-[#aaa9b4]">
                    THE BACKWARD MACHINE
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#d3ff62] animate-pulse" />
                    <span className="text-[10px] font-bold text-[#72a800] dark:text-[#d3ff62]">READY</span>
                  </div>
                </div>

                {/* Track 1: Original Audio Preview */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#61616c] dark:text-[#aaa9b4]">01 / YOUR VOICE</span>
                    <span className="text-[#8e8d99] dark:text-[#71717d]">0:04</span>
                  </div>

                  {/* Waveform 1 */}
                  <div
                    onClick={() => playInteractiveDemo("machine-original")}
                    className="h-14 sm:h-16 bg-[#eaeaf0] dark:bg-[#232329] border border-[#e2e2e8] dark:border-[#35353d] rounded-2xl px-2.5 sm:px-3 flex items-center gap-0.5 sm:gap-1 cursor-pointer hover:border-[#d3ff62] transition-colors group overflow-hidden min-w-0 w-full"
                    title="Click to audition original"
                  >
                    {[10, 18, 30, 20, 42, 62, 46, 24, 56, 78, 52, 32, 68, 86, 58, 38, 24, 54, 76, 42, 66, 46, 26, 56, 74, 42, 24, 50, 36, 20, 30, 16, 10].map((h, i) => (
                      <div
                        key={i}
                        style={{ height: `${h * 0.55}px` }}
                        className={`min-w-[2px] flex-1 rounded-full transition-all ${
                          activeDemo === "machine-original" ? "bg-[#d3ff62] scale-y-110" : "bg-[#72a800] dark:bg-[#d3ff62] opacity-80 group-hover:opacity-100"
                        }`}
                      />
                    ))}
                    <div className="ml-1 pl-1 shrink-0">
                      <Play className="h-4 w-4 text-[#72a800] dark:text-[#d3ff62] shrink-0" />
                    </div>
                  </div>
                </div>

                {/* Reverse Chip Transport Divider */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="h-px bg-[#e2e2e8] dark:bg-[#35353d] flex-1" />
                  <div className="bg-[#f0ebff] dark:bg-[#30283f] text-[#7a58e6] dark:text-[#ae98f5] px-3 sm:px-3.5 py-1.5 rounded-full text-[10px] sm:text-[11px] font-bold flex items-center gap-1.5 sm:gap-2 border border-[#7a58e6]/20 shrink-0">
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>FLIP THE AUDIO</span>
                  </div>
                  <div className="h-px bg-[#e2e2e8] dark:bg-[#35353d] flex-1" />
                </div>

                {/* Track 2: Reversed Audio Preview */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#61616c] dark:text-[#aaa9b4]">02 / BEAUTIFUL NONSENSE</span>
                    <span className="text-[#7a58e6] dark:text-[#ae98f5] font-semibold flex items-center gap-1">
                      <Volume2 className="h-3.5 w-3.5" /> Flipped
                    </span>
                  </div>

                  {/* Waveform 2 */}
                  <div
                    onClick={() => playInteractiveDemo("machine-reversed")}
                    className="h-14 sm:h-16 bg-[#eaeaf0] dark:bg-[#232329] border border-[#e2e2e8] dark:border-[#35353d] rounded-2xl px-2.5 sm:px-3 flex items-center gap-0.5 sm:gap-1 cursor-pointer hover:border-[#ae98f5] transition-colors group overflow-hidden min-w-0 w-full"
                    title="Click to audition flipped"
                  >
                    {[10, 16, 30, 20, 36, 50, 24, 42, 74, 56, 26, 46, 66, 42, 76, 54, 24, 38, 58, 86, 68, 32, 52, 78, 56, 24, 46, 62, 42, 20, 30, 18, 10].map((h, i) => (
                      <div
                        key={i}
                        style={{ height: `${h * 0.55}px` }}
                        className={`min-w-[2px] flex-1 rounded-full transition-all ${
                          activeDemo === "machine-reversed" ? "bg-[#ae98f5] scale-y-110" : "bg-[#7a58e6] dark:bg-[#ae98f5] opacity-80 group-hover:opacity-100"
                        }`}
                      />
                    ))}
                    <div className="ml-1 pl-1 shrink-0">
                      <Play className="h-4 w-4 text-[#7a58e6] dark:text-[#ae98f5] shrink-0" />
                    </div>
                  </div>
                </div>

                {/* Listening Reminder */}
                <div className="border-t border-[#e2e2e8] dark:border-[#35353d] pt-3 flex items-center gap-2.5 text-xs text-[#111113] dark:text-[#f5f4ed]">
                  <Ear className="h-4 w-4 text-[#7a58e6] dark:text-[#ae98f5] shrink-0" />
                  <p className="font-medium">Don&apos;t decode it. Try to sound like it.</p>
                </div>
              </div>

              <div className="flex items-center justify-center gap-2 pt-3 text-xs text-[#61616c] dark:text-[#aaa9b4]">
                <Sparkles className="h-3.5 w-3.5 text-[#72a800] dark:text-[#d3ff62]" />
                <span>Not a guessing game. An imitation game.</span>
              </div>
            </div>
          </section>

          {/* Section 2: Four Steps. Infinite Nonsense. (Figma 5:9589 & 5:10070) */}
          <section className="border-t border-[#e2e2e8] dark:border-[#35353d] px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-10 lg:py-14 max-w-7xl mx-auto w-full">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-8">
              <div className="flex flex-col gap-2">
                <span className="font-bold text-xs tracking-widest text-[#72a800] dark:text-[#d3ff62] uppercase">
                  HOW TO PLAY
                </span>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-[#111113] dark:text-[#f5f4ed] tracking-tight">
                  Four steps. Infinite nonsense.
                </h2>
              </div>
              <p className="text-sm text-[#61616c] dark:text-[#aaa9b4] max-w-xs font-normal">
                Listen closely. Make weird noises. Let the reverse button do the rest.
              </p>
            </div>

            {/* Steps: Responsive Grid on all screens */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 lg:gap-6">
              {/* Step 1 */}
              <div className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-5 hover:border-[#d3ff62]/50 transition-all">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#8e8d99] dark:text-[#71717d]">01 /</span>
                  <div className="w-9 h-9 rounded-xl bg-[#d3ff62]/10 text-[#72a800] dark:text-[#d3ff62] flex items-center justify-center">
                    <Mic className="h-5 w-5" />
                  </div>
                </div>

                <div className="h-8 sm:h-9 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[10, 22, 32, 24, 12, 28, 40, 26, 16, 35, 44, 29, 20, 12, 28, 39, 22, 34, 24, 14, 29, 38].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#72a800] dark:bg-[#d3ff62] rounded-full" />
                  ))}
                </div>

                <div>
                  <h3 className="font-bold text-base sm:text-lg text-[#111113] dark:text-[#f5f4ed] mb-1.5">
                    Record a phrase.
                  </h3>
                  <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] leading-relaxed">
                    Player 1 says an original phrase into their device. Keep it ordinary. For now.
                  </p>
                </div>
              </div>

              {/* Step 2 */}
              <div className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-5 hover:border-[#ae98f5]/50 transition-all">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#8e8d99] dark:text-[#71717d]">02 /</span>
                  <div className="w-9 h-9 rounded-xl bg-[#ae98f5]/10 text-[#7a58e6] dark:text-[#ae98f5] flex items-center justify-center">
                    <RotateCcw className="h-5 w-5" />
                  </div>
                </div>

                <div className="h-8 sm:h-9 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[24, 12, 29, 40, 26, 16, 35, 44, 29, 20, 12, 28, 39, 22, 34, 24, 14, 29, 38, 22, 12, 26].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#7a58e6] dark:bg-[#ae98f5] rounded-full" />
                  ))}
                </div>

                <div>
                  <h3 className="font-bold text-base sm:text-lg text-[#111113] dark:text-[#f5f4ed] mb-1.5">
                    Listen backward.
                  </h3>
                  <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] leading-relaxed">
                    We reverse that recording and play the strange, backward audio to Player 2.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-5 hover:border-[#111113]/30 dark:hover:border-white/30 transition-all">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#8e8d99] dark:text-[#71717d]">03 /</span>
                  <div className="w-9 h-9 rounded-xl bg-neutral-500/10 text-neutral-400 flex items-center justify-center">
                    <AudioLines className="h-5 w-5" />
                  </div>
                </div>

                <div className="h-8 sm:h-9 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[40, 26, 16, 35, 44, 29, 20, 12, 28, 39, 22, 34, 24, 14, 29, 38, 22, 12, 26, 18, 10, 16].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#61616c] dark:bg-[#f5f4ed] rounded-full" />
                  ))}
                </div>

                <div>
                  <h3 className="font-bold text-base sm:text-lg text-[#111113] dark:text-[#f5f4ed] mb-1.5">
                    Imitate the sounds.
                  </h3>
                  <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] leading-relaxed">
                    Player 2 records their best imitation of the backward sounds. No decoding!
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-6 flex flex-col justify-between gap-5 hover:border-[#d3ff62]/50 transition-all">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#8e8d99] dark:text-[#71717d]">04 /</span>
                  <div className="w-9 h-9 rounded-xl bg-[#d3ff62]/10 text-[#72a800] dark:text-[#d3ff62] flex items-center justify-center">
                    <Repeat2 className="h-5 w-5" />
                  </div>
                </div>

                <div className="h-8 sm:h-9 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[35, 44, 29, 20, 12, 28, 39, 22, 34, 24, 14, 29, 38, 22, 12, 26, 18, 10, 16, 8, 5, 9].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#72a800] dark:bg-[#d3ff62] rounded-full" />
                  ))}
                </div>

                <div>
                  <h3 className="font-bold text-base sm:text-lg text-[#111113] dark:text-[#f5f4ed] mb-1.5">
                    Flip for the reveal.
                  </h3>
                  <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] leading-relaxed">
                    Reverse Player 2’s recording. Compare it with the original and enjoy the chaos.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: An Example Round ("Pass me the pizza.") (Figma 5:9760 & 5:10103) */}
          <section className="px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-8 lg:py-12 max-w-7xl mx-auto w-full">
            <div className="bg-[#f0ebff] dark:bg-[#30283f] rounded-3xl p-5 sm:p-8 lg:p-10 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-6 lg:gap-10 xl:gap-14 shadow-2xl overflow-hidden">
              {/* Left Side: Headline */}
              <div className="flex-1 flex flex-col gap-3 sm:gap-4">
                <span className="font-bold text-[11px] sm:text-xs tracking-widest text-[#7a58e6] dark:text-[#ae98f5] uppercase">
                  AN EXAMPLE ROUND
                </span>

                <h3 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-[#111113] dark:text-[#f5f4ed] leading-tight">
                  &ldquo;Pass me the pizza.&rdquo;
                </h3>

                <p className="text-xs sm:text-sm md:text-base text-[#61616c] dark:text-[#aaa9b4] leading-relaxed max-w-md">
                  It starts as dinner plans. Player 2 copies the backward audio — not the original words. The second flip reveals what came back.
                </p>

                <p className="font-semibold text-xs sm:text-sm text-[#7a58e6] dark:text-[#ae98f5]">
                  Same phrase. Entirely different energy.
                </p>
              </div>

              {/* Right Side: 4 Audio Stages */}
              <div className="w-full lg:w-[480px] xl:w-[560px] flex flex-col gap-2.5 max-w-full">
                {/* Stage 1 */}
                <div
                  onClick={() => playInteractiveDemo("stage-1")}
                  className="bg-[#ffffff] dark:bg-[#111113] rounded-xl p-3 sm:p-3.5 px-3.5 sm:px-4 flex items-center justify-between gap-3 cursor-pointer hover:ring-2 hover:ring-[#d3ff62] transition-all shadow-sm group min-w-0"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[10px] text-[#72a800] dark:text-[#d3ff62] uppercase tracking-wider">
                      01 / ORIGINAL
                    </span>
                    <span className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Player 1 records phrase</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="h-7 w-20 sm:w-32 md:w-44 flex items-center gap-0.5 overflow-hidden">
                      {[4, 8, 12, 8, 16, 24, 18, 9, 22, 30, 20, 12, 26, 32, 22, 14, 9, 20, 28, 16, 26, 18, 10].map((h, i) => (
                        <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#72a800] dark:bg-[#d3ff62] rounded-full" />
                      ))}
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#f4f4f7] dark:bg-[#232329] flex items-center justify-center text-[#72a800] dark:text-[#d3ff62]">
                      <Play className={`h-3.5 w-3.5 ${activeDemo === "stage-1" ? "fill-current animate-pulse" : ""}`} />
                    </div>
                  </div>
                </div>

                {/* Stage 2 */}
                <div
                  onClick={() => playInteractiveDemo("stage-2")}
                  className="bg-[#ffffff] dark:bg-[#111113] rounded-xl p-3 sm:p-3.5 px-3.5 sm:px-4 flex items-center justify-between gap-3 cursor-pointer hover:ring-2 hover:ring-[#ae98f5] transition-all shadow-sm group min-w-0"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[10px] text-[#7a58e6] dark:text-[#ae98f5] uppercase tracking-wider">
                      02 / REVERSED
                    </span>
                    <span className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Player 2 listens to this</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="h-7 w-20 sm:w-32 md:w-44 flex items-center gap-0.5 overflow-hidden">
                      {[10, 18, 26, 16, 28, 20, 9, 14, 22, 32, 26, 12, 20, 30, 22, 9, 18, 24, 16, 8, 12, 8, 4].map((h, i) => (
                        <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#7a58e6] dark:bg-[#ae98f5] rounded-full" />
                      ))}
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#f4f4f7] dark:bg-[#232329] flex items-center justify-center text-[#7a58e6] dark:text-[#ae98f5]">
                      <Play className={`h-3.5 w-3.5 ${activeDemo === "stage-2" ? "fill-current animate-pulse" : ""}`} />
                    </div>
                  </div>
                </div>

                {/* Stage 3 */}
                <div
                  onClick={() => playInteractiveDemo("stage-3")}
                  className="bg-[#ffffff] dark:bg-[#111113] rounded-xl p-3 sm:p-3.5 px-3.5 sm:px-4 flex items-center justify-between gap-3 cursor-pointer hover:ring-2 hover:ring-neutral-400 transition-all shadow-sm group min-w-0"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[10px] text-[#111113] dark:text-[#f5f4ed] uppercase tracking-wider">
                      03 / IMITATION
                    </span>
                    <span className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Player 2 copies sounds</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="h-7 w-20 sm:w-32 md:w-44 flex items-center gap-0.5 overflow-hidden">
                      {[9, 20, 28, 16, 26, 18, 10, 22, 28, 16, 9, 18, 14, 7, 12, 6, 4, 4, 7, 12, 7, 16, 24].map((h, i) => (
                        <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#61616c] dark:bg-[#f5f4ed] rounded-full" />
                      ))}
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#f4f4f7] dark:bg-[#232329] flex items-center justify-center text-[#111113] dark:text-[#f5f4ed]">
                      <Play className={`h-3.5 w-3.5 ${activeDemo === "stage-3" ? "fill-current animate-pulse" : ""}`} />
                    </div>
                  </div>
                </div>

                {/* Stage 4 */}
                <div
                  onClick={() => playInteractiveDemo("stage-4")}
                  className="bg-[#ffffff] dark:bg-[#111113] rounded-xl p-3 sm:p-3.5 px-3.5 sm:px-4 flex items-center justify-between gap-3 cursor-pointer hover:ring-2 hover:ring-[#d3ff62] transition-all shadow-sm group min-w-0"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="font-bold text-[10px] text-[#72a800] dark:text-[#d3ff62] uppercase tracking-wider">
                      04 / THE REVEAL
                    </span>
                    <span className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Reverse it. Compare. Laugh.</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="h-7 w-20 sm:w-32 md:w-44 flex items-center gap-0.5 overflow-hidden">
                      {[14, 22, 32, 26, 12, 20, 30, 22, 9, 18, 24, 16, 7, 11, 7, 4, 4, 6, 12, 7, 14, 19, 9].map((h, i) => (
                        <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#72a800] dark:bg-[#d3ff62] rounded-full" />
                      ))}
                    </div>
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#f4f4f7] dark:bg-[#232329] flex items-center justify-center text-[#72a800] dark:text-[#d3ff62]">
                      <Play className={`h-3.5 w-3.5 ${activeDemo === "stage-4" ? "fill-current animate-pulse" : ""}`} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Mode Preview (3 Ways to Play) (Figma 5:9924 & 5:10198) */}
          <section className="px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-8 sm:py-12 lg:py-14 max-w-7xl mx-auto w-full">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 pb-6">
              <div>
                <span className="font-bold text-xs tracking-widest text-[#72a800] dark:text-[#d3ff62] uppercase">
                  3 WAYS TO PLAY
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-[#111113] dark:text-[#f5f4ed]">
                  Same chaos. Your kind of company.
                </h3>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
              {/* Practice Mode */}
              <button
                type="button"
                onClick={() => onSelectMode("solo")}
                className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 hover:border-[#d3ff62] transition-all text-left group cursor-pointer shadow-sm"
              >
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#eaeaf0] dark:bg-[#232329] flex items-center justify-center text-[#72a800] dark:text-[#d3ff62] group-hover:scale-110 transition-transform shrink-0">
                  <Headphones className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm sm:text-base text-[#111113] dark:text-[#f5f4ed] truncate">Practice mode</h4>
                  <p className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Solo warm-up</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[#8e8d99] dark:text-[#71717d] group-hover:text-[#111113] dark:group-hover:text-[#f5f4ed] transition-colors shrink-0" />
              </button>

              {/* 1v1 Mode */}
              <button
                type="button"
                onClick={() => onSelectMode("1v1")}
                className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 hover:border-[#ae98f5] transition-all text-left group cursor-pointer shadow-sm"
              >
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#eaeaf0] dark:bg-[#232329] flex items-center justify-center text-[#7a58e6] dark:text-[#ae98f5] group-hover:scale-110 transition-transform shrink-0">
                  <Repeat2 className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm sm:text-base text-[#111113] dark:text-[#f5f4ed] truncate">1v1 mode</h4>
                  <p className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Trade turns with a friend</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[#8e8d99] dark:text-[#71717d] group-hover:text-[#111113] dark:group-hover:text-[#f5f4ed] transition-colors shrink-0" />
              </button>

              {/* Party Mode (spans 2 columns on tablet sm) */}
              <button
                type="button"
                onClick={() => onSelectMode("party")}
                className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-2xl p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 hover:border-[#d3ff62] transition-all text-left group cursor-pointer shadow-sm sm:col-span-2 lg:col-span-1"
              >
                <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-[#eaeaf0] dark:bg-[#232329] flex items-center justify-center text-[#72a800] dark:text-[#d3ff62] group-hover:scale-110 transition-transform shrink-0">
                  <Users className="h-5 w-5 sm:h-6 sm:w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm sm:text-base text-[#111113] dark:text-[#f5f4ed] truncate">Party mode</h4>
                  <p className="text-xs text-[#61616c] dark:text-[#aaa9b4] truncate">Bring the whole group</p>
                </div>
                <ArrowUpRight className="h-4 w-4 text-[#8e8d99] dark:text-[#71717d] group-hover:text-[#111113] dark:group-hover:text-[#f5f4ed] transition-colors shrink-0" />
              </button>
            </div>

            {/* Bottom Callout Bar */}
            <div className="mt-8 pt-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm sm:text-base md:text-lg font-semibold text-[#61616c] dark:text-[#aaa9b4] text-center sm:text-left">
                Ready to hear yourself differently?
              </p>
              <button
                type="button"
                onClick={() => {
                  sfx.playClick()
                  setView("modes")
                }}
                className="w-full sm:w-auto bg-[#d3ff62] text-[#111113] font-bold text-base h-12 sm:h-14 px-8 rounded-xl flex items-center justify-center gap-3 sm:gap-4 hover:bg-[#b8f533] active:scale-[0.98] transition-all shadow-xl shadow-[#d3ff62]/20 cursor-pointer group"
              >
                <span>Start playing</span>
                <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
          </section>

          {/* Footer */}
          <footer className="border-t border-[#e2e2e8] dark:border-[#35353d] px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-6 sm:py-8 flex flex-col sm:flex-row items-center justify-between text-xs text-[#8e8d99] dark:text-[#71717d] gap-2">
            <span>GOOD COMPANY. BAD IMPRESSIONS.</span>
            <span>© REV3RSE</span>
          </footer>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. GAME MODES VIEW (Matching Figma Game modes · Desktop, Tablet & iPhone) */}
      {/* ======================================================== */}
      {view === "modes" && (
        <div className="flex-1 flex flex-col justify-between w-full animate-fade-in overflow-x-hidden min-h-[100dvh]">
          {/* Header */}
          <header className="border-b border-[#e2e2e8] dark:border-[#35353d] px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 h-16 sm:h-20 lg:h-24 flex items-center justify-between sticky top-0 bg-[#ffffff]/90 dark:bg-[#111113]/90 backdrop-blur-md z-30 shrink-0">
            <button
              type="button"
              onClick={() => {
                sfx.playClick()
                setView("how-to-play")
              }}
              className="flex items-center gap-2.5 sm:gap-3 group cursor-pointer"
            >
              <div className="relative w-7 h-7 sm:w-8 sm:h-8 lg:w-9 lg:h-9 shrink-0">
                <Image
                  src="/figma/reverse-audio-symbol.svg"
                  alt="Rev3rse logo"
                  width={36}
                  height={36}
                  className="w-full h-full"
                />
              </div>
              <span className="font-extrabold text-xl sm:text-2xl text-[#111113] dark:text-[#f5f4ed]">
                Rev3rse
              </span>
            </button>

            <div className="flex items-center gap-3 sm:gap-6">
              <button
                type="button"
                onClick={() => {
                  sfx.playClick()
                  setView("how-to-play")
                }}
                className="hidden md:flex items-center gap-1.5 text-sm font-semibold text-[#61616c] dark:text-[#aaa9b4] hover:text-[#111113] dark:hover:text-[#f5f4ed] transition-colors cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>How to play</span>
              </button>

              <div className="hidden sm:flex items-center gap-2 border border-[#e2e2e8] dark:border-[#35353d] px-3.5 py-1.5 sm:py-2 rounded-full text-[11px] font-semibold text-[#61616c] dark:text-[#aaa9b4]">
                <Volume2 className="h-4 w-4" />
                <span>SOUND ON</span>
              </div>

              <ThemeToggle />
            </div>
          </header>

          {/* Game Modes Main Section */}
          <main className="px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-6 sm:py-10 md:py-12 max-w-7xl mx-auto w-full flex-1 flex flex-col justify-center">
            {/* Page Header */}
            <div className="pb-6 sm:pb-8 text-center sm:text-left">
              <p className="font-bold text-[11px] sm:text-xs tracking-widest text-[#72a800] dark:text-[#d3ff62] uppercase mb-1.5">
                CHOOSE YOUR EXPERIMENT
              </p>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-[#111113] dark:text-[#f5f4ed] tracking-tight">
                Three ways to reverse.
              </h2>
            </div>

            {/* 3 Main Mode Cards: 1 col on mobile, 2 col on tablet (3rd spans 2), 3 col on desktop */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
              {/* 01 / Practice Mode */}
              <div
                onClick={() => onSelectMode("solo")}
                className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-7 flex flex-col justify-between gap-5 sm:gap-6 hover:border-[#d3ff62] transition-all cursor-pointer group shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#8e8d99] dark:text-[#71717d]">01 /</span>
                  <div className="w-10 h-10 rounded-2xl bg-[#eaeaf0] dark:bg-[#232329] text-[#72a800] dark:text-[#d3ff62] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Headphones className="h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl sm:text-2xl font-black text-[#111113] dark:text-[#f5f4ed]">
                    Practice mode
                  </h3>
                  <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] leading-relaxed">
                    Test phrases, train your ears, and hear yourself backward in private.
                  </p>
                </div>

                <div className="h-9 sm:h-10 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[12, 24, 38, 22, 14, 28, 42, 26, 16, 36, 44, 28, 18, 12, 26, 38, 20, 32, 22].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#72a800] dark:bg-[#d3ff62] rounded-full" />
                  ))}
                </div>

                <div className="pt-2">
                  <span className="w-full h-11 sm:h-12 rounded-xl bg-[#eaeaf0] dark:bg-[#232329] text-[#111113] dark:text-[#f5f4ed] group-hover:bg-[#d3ff62] group-hover:text-[#111113] font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                    Play solo
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </div>

              {/* 02 / 1v1 Mode */}
              <div
                onClick={() => onSelectMode("1v1")}
                className="bg-[#f4f4f7] dark:bg-[#1b1b20] border border-[#e2e2e8] dark:border-[#35353d] rounded-3xl p-5 sm:p-7 flex flex-col justify-between gap-5 sm:gap-6 hover:border-[#ae98f5] transition-all cursor-pointer group shadow-xl"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-[#8e8d99] dark:text-[#71717d]">02 /</span>
                  <div className="w-10 h-10 rounded-2xl bg-[#eaeaf0] dark:bg-[#232329] text-[#7a58e6] dark:text-[#ae98f5] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Repeat2 className="h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl sm:text-2xl font-black text-[#111113] dark:text-[#f5f4ed]">
                    1v1 mode
                  </h3>
                  <p className="text-xs sm:text-sm text-[#61616c] dark:text-[#aaa9b4] leading-relaxed">
                    Pass the device, trade backwards impressions, and vote on who nailed it.
                  </p>
                </div>

                <div className="h-9 sm:h-10 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[22, 14, 28, 42, 26, 16, 36, 44, 28, 18, 12, 26, 38, 20, 32, 22, 12, 24, 38].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#7a58e6] dark:bg-[#ae98f5] rounded-full" />
                  ))}
                </div>

                <div className="pt-2">
                  <span className="w-full h-11 sm:h-12 rounded-xl bg-[#eaeaf0] dark:bg-[#232329] text-[#111113] dark:text-[#f5f4ed] group-hover:bg-[#ae98f5] group-hover:text-[#111113] font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                    Play 1v1
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                </div>
              </div>

              {/* 03 / Party Mode (Inverted Electric Lime Card, spans 2 cols on tablet sm) */}
              <div
                onClick={() => onSelectMode("party")}
                className="bg-[#d3ff62] text-[#111113] rounded-3xl p-5 sm:p-7 flex flex-col justify-between gap-5 sm:gap-6 hover:brightness-105 transition-all cursor-pointer group shadow-2xl shadow-[#d3ff62]/20 sm:col-span-2 lg:col-span-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-black text-xs text-[#111113]/70">03 /</span>
                  <div className="w-10 h-10 rounded-2xl bg-[#111113] text-[#d3ff62] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Users className="h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl sm:text-2xl font-black text-[#111113]">
                    Party mode
                  </h3>
                  <p className="text-xs sm:text-sm text-[#111113]/80 leading-relaxed font-medium">
                    Host on TV, scan QR codes with phones, and submit backwards recordings live.
                  </p>
                </div>

                <div className="h-9 sm:h-10 flex items-center gap-0.5 sm:gap-1 overflow-hidden min-w-0 w-full">
                  {[36, 44, 28, 18, 12, 26, 38, 20, 32, 22, 12, 24, 38, 22, 14, 28, 42, 26, 16].map((h, i) => (
                    <div key={i} style={{ height: `${h * 0.65}px` }} className="min-w-[2px] flex-1 bg-[#111113] rounded-full" />
                  ))}
                </div>

                <div className="pt-2">
                  <span className="w-full h-11 sm:h-12 rounded-xl bg-[#111113] text-[#f5f4ed] group-hover:bg-[#232329] font-bold text-sm flex items-center justify-center gap-2 transition-colors">
                    Start a party
                    <ArrowUpRight className="h-4 w-4 text-[#d3ff62]" />
                  </span>
                </div>
              </div>
            </div>

            {/* Bottom Tips Row (Figma: "Before you make some noise") */}
            <div className="mt-8 sm:mt-10 border border-[#e2e2e8] dark:border-[#35353d] bg-[#f4f4f7] dark:bg-[#1b1b20] rounded-3xl p-4 sm:p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <span className="font-bold text-xs uppercase tracking-wider text-[#61616c] dark:text-[#aaa9b4]">
                Before you make some noise
              </span>

              <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 text-xs text-[#61616c] dark:text-[#aaa9b4]">
                <div className="flex items-center gap-1.5">
                  <Mic className="h-4 w-4 text-[#72a800] dark:text-[#d3ff62]" />
                  <span>Use microphone</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Volume2 className="h-4 w-4 text-[#7a58e6] dark:text-[#ae98f5]" />
                  <span>Turn up volume</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Ear className="h-4 w-4 text-[#72a800] dark:text-[#d3ff62]" />
                  <span>Listen closely</span>
                </div>
              </div>
            </div>
          </main>

          {/* Footer */}
          <footer className="border-t border-[#e2e2e8] dark:border-[#35353d] px-4 sm:px-6 md:px-8 lg:px-12 xl:px-16 py-4 sm:py-6 flex items-center justify-between text-xs text-[#8e8d99] dark:text-[#71717d] shrink-0">
            <span>GOOD COMPANY. BAD IMPRESSIONS.</span>
            <span>© REV3RSE</span>
          </footer>
        </div>
      )}
    </div>
  )
}
