"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import Image from "next/image"
import { Volume2, VolumeX, ArrowRight, Play, Sparkles } from "lucide-react"

interface IntroVideoProps {
  onComplete: () => void
  src?: string
}

export function IntroVideo({ onComplete, src = "/intro.mp4" }: IntroVideoProps) {
  const [isFadingOut, setIsFadingOut] = useState(false)
  const [isMuted, setIsMuted] = useState(true)
  const [progress, setProgress] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [hasInteracted, setHasInteracted] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const bgVideoRef = useRef<HTMLVideoElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hasCompletedRef = useRef(false)

  const handleFinish = useCallback(() => {
    if (hasCompletedRef.current) return
    hasCompletedRef.current = true
    setIsFadingOut(true)
    setTimeout(() => {
      onComplete()
    }, 600)
  }, [onComplete])

  // Try to start autoplay as soon as component mounts
  useEffect(() => {
    const v = videoRef.current
    const bgV = bgVideoRef.current

    if (v) {
      v.muted = true
      const playPromise = v.play()
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true)
          })
          .catch((err) => {
            console.log("[IntroVideo] Autoplay blocked, waiting for user tap:", err)
            setIsPlaying(false)
          })
      }
    }

    if (bgV) {
      bgV.muted = true
      bgV.play().catch(() => {})
    }
  }, [])

  // Sync background video time if needed
  const handleTimeUpdate = () => {
    const v = videoRef.current
    if (v && v.duration) {
      const pct = (v.currentTime / v.duration) * 100
      setProgress(pct)
    }
  }

  // Handle unmute / mute toggle
  const toggleSound = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const v = videoRef.current
    if (!v) return

    if (isMuted) {
      v.muted = false
      setIsMuted(false)
      setHasInteracted(true)
      // If was paused, play
      v.play().catch(() => {})
    } else {
      v.muted = true
      setIsMuted(true)
    }
  }

  // If user clicks anywhere on the video area, unmute if currently muted
  const handleStageClick = () => {
    const v = videoRef.current
    if (!v) return

    if (v.paused) {
      v.play().then(() => setIsPlaying(true)).catch(() => {})
    }

    if (isMuted && !hasInteracted) {
      v.muted = false
      setIsMuted(false)
      setHasInteracted(true)
    }
  }

  // Keyboard navigation: Escape or Space to skip, M to mute/unmute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " " || e.key === "Enter") {
        e.preventDefault()
        handleFinish()
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault()
        toggleSound()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleFinish, isMuted])

  return (
    <div
      ref={containerRef}
      onClick={handleStageClick}
      className={`fixed inset-0 z-[100] bg-[#0c0c0e] flex flex-col justify-between overflow-hidden select-none transition-opacity duration-700 ease-out cursor-pointer ${
        isFadingOut ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      aria-label="Rev3rse Intro Animation"
      role="dialog"
    >
      {/* Ambient glowing video backdrop for immersive cinematic feel */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30">
        <video
          ref={bgVideoRef}
          src={src}
          playsInline
          muted
          loop
          className="w-full h-full object-cover scale-125 blur-3xl"
          tabIndex={-1}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c0e] via-transparent to-[#0c0c0e]/80" />
      </div>

      {/* Top Bar Overlay */}
      <header className="relative z-20 flex items-center justify-between p-4 sm:p-6 md:p-8 max-w-7xl mx-auto w-full">
        {/* Brand identity */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#1b1b20] border border-[#35353d] flex items-center justify-center p-1.5 shadow-lg">
            <Image
              src="/figma/reverse-audio-symbol.svg"
              alt="Rev3rse Logo"
              width={24}
              height={24}
              className="w-full h-full"
              priority
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm sm:text-base tracking-wider text-[#f5f4ed]">
              Rev3rse
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#d3ff62] uppercase tracking-widest px-2 py-0.5 rounded-full bg-[#1b1b20] border border-[#35353d]">
              <Sparkles className="w-2.5 h-2.5 text-[#d3ff62]" />
              Intro
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Sound Toggle Button */}
          <button
            type="button"
            onClick={toggleSound}
            className={`flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs font-bold border transition-all cursor-pointer backdrop-blur-md shadow-lg ${
              isMuted
                ? "bg-[#1b1b20]/80 border-[#35353d] text-[#aaa9b4] hover:text-[#f5f4ed] hover:border-[#d3ff62]/50"
                : "bg-[#d3ff62]/15 border-[#d3ff62]/40 text-[#d3ff62] shadow-[0_0_15px_rgba(211,255,98,0.2)]"
            }`}
            title={isMuted ? "Unmute audio (M)" : "Mute audio (M)"}
          >
            {isMuted ? (
              <>
                <VolumeX className="w-4 h-4 text-[#aaa9b4]" />
                <span className="hidden sm:inline">Tap for Sound</span>
              </>
            ) : (
              <>
                <Volume2 className="w-4 h-4 text-[#d3ff62]" />
                <span className="hidden sm:inline">Sound On</span>
              </>
            )}
          </button>

          {/* Skip Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleFinish()
            }}
            className="flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-full text-xs font-bold bg-[#1b1b20]/90 hover:bg-[#d3ff62] text-[#f5f4ed] hover:text-[#111113] border border-[#35353d] hover:border-[#d3ff62] transition-all cursor-pointer backdrop-blur-md shadow-lg group active:scale-95"
            title="Skip Intro (Escape / Space)"
          >
            <span>Skip</span>
            <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </header>

      {/* Center Stage: Hero Video Container */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-2 sm:p-6 md:p-8 max-w-5xl mx-auto w-full">
        <div className="relative w-full rounded-2xl sm:rounded-3xl overflow-hidden border border-[#35353d]/50 bg-[#111113] shadow-2xl shadow-black/80 flex items-center justify-center aspect-[2206/946] max-h-[75vh]">
          <video
            ref={videoRef}
            src={src}
            playsInline
            autoPlay
            muted={isMuted}
            preload="auto"
            onEnded={handleFinish}
            onTimeUpdate={handleTimeUpdate}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            className="w-full h-full object-contain"
          />

          {/* Tap-to-play overlay if browser blocked autoplay */}
          {!isPlaying && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center gap-3 text-center p-4">
              <div className="w-14 h-14 rounded-full bg-[#d3ff62] text-[#111113] flex items-center justify-center shadow-[0_0_30px_rgba(211,255,98,0.4)] animate-pulse">
                <Play className="w-6 h-6 fill-current ml-0.5" />
              </div>
              <p className="text-sm font-bold text-[#f5f4ed]">Click to play intro</p>
            </div>
          )}

          {/* Sound reminder pill if muted */}
          {isPlaying && isMuted && !hasInteracted && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none animate-bounce">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#111113]/90 border border-[#35353d] text-[11px] font-bold text-[#d3ff62] backdrop-blur-md shadow-xl">
                <Volume2 className="w-3 h-3" />
                Tap anywhere to unmute audio
              </span>
            </div>
          )}
        </div>
      </main>

      {/* Bottom Progress Bar & Hint */}
      <footer className="relative z-20 p-4 sm:p-6 max-w-7xl mx-auto w-full flex flex-col gap-2">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#71717d] px-1">
          <span>REV3RSE INTRO</span>
          <span className="hidden sm:inline">Press Space or click anywhere to skip</span>
        </div>

        {/* Smooth neon progress line */}
        <div className="w-full h-1 bg-[#232329] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#d3ff62] rounded-full transition-all duration-100 ease-linear shadow-[0_0_8px_#d3ff62]"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </footer>
    </div>
  )
}
