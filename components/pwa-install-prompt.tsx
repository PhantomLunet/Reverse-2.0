"use client"

import React, { useState, useEffect, useCallback } from "react"
import Image from "next/image"
import { Download, Share2, PlusSquare, Smartphone, X, Check, ArrowRight } from "lucide-react"
import { sfx } from "@/lib/sound-effects"

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
  prompt(): Promise<void>
}

interface PwaInstallPromptProps {
  variant?: "header" | "footer"
  className?: string
}

export function PwaInstallPrompt({
  variant = "header",
  className = "",
}: PwaInstallPromptProps) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState<boolean>(false)
  const [isIOS, setIsIOS] = useState<boolean>(false)
  const [modalOpen, setModalOpen] = useState<boolean>(false)
  const [installedSuccess, setInstalledSuccess] = useState<boolean>(false)

  useEffect(() => {
    // Check if running in standalone mode (already installed as PWA)
    const checkStandalone = () => {
      const isStandaloneMode =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes("android-app://")
      setIsStandalone(Boolean(isStandaloneMode))
    }
    checkStandalone()

    // Detect iOS
    const ua = window.navigator.userAgent
    const isAppleDevice = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
    setIsIOS(isAppleDevice)

    // Capture beforeinstallprompt for Android / Chromium browsers
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setIsStandalone(true)
      setInstalledSuccess(true)
      setTimeout(() => setInstalledSuccess(false), 5000)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    window.addEventListener("appinstalled", handleAppInstalled)

    // Register Service Worker for PWA eligibility
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
      window.removeEventListener("appinstalled", handleAppInstalled)
    }
  }, [])

  const handleInstallClick = useCallback(async () => {
    try {
      sfx.playClick()
    } catch {}

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt()
        const choice = await deferredPrompt.userChoice
        if (choice.outcome === "accepted") {
          setInstalledSuccess(true)
          setModalOpen(false)
        }
        setDeferredPrompt(null)
      } catch (err) {
        setModalOpen(true)
      }
    } else {
      // If iOS or browser doesn't expose programmatic prompt, open guide modal
      setModalOpen(true)
    }
  }, [deferredPrompt])

  // Don't show install buttons if already running in standalone PWA mode
  if (isStandalone && !installedSuccess) {
    return null
  }

  return (
    <>
      {/* 1. Header or Footer Quick Install Button */}
      {variant === "footer" ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className={`inline-flex items-center gap-1 hover:text-[#111113] dark:hover:text-[#f5f4ed] text-[#72a800] dark:text-[#d3ff62] font-bold transition-colors cursor-pointer group ${className}`}
          title="Add Rev3rse to your home screen"
        >
          <Download className="h-3 w-3 sm:h-3.5 sm:w-3.5 group-hover:translate-y-0.5 transition-transform" />
          <span>ADD TO HOME SCREEN</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleInstallClick}
          className={`flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-xs font-bold border border-[#35353d] hover:border-[#d3ff62] text-[#f5f4ed] bg-[#1b1b20]/90 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full transition-all shadow-md hover:scale-105 cursor-pointer group ${className}`}
          title="Add Rev3rse to your home screen"
        >
          <Download className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-[#d3ff62] group-hover:animate-bounce" />
          <span className="tracking-wide">
            <span className="hidden sm:inline">ADD TO </span>HOME SCREEN
          </span>
        </button>
      )}

      {/* 2. Success Toast if just installed */}
      {installedSuccess && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-[#1b1b20] border-2 border-[#d3ff62] text-[#f5f4ed] px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-fade-in">
          <div className="w-7 h-7 rounded-full bg-[#d3ff62] text-[#111113] flex items-center justify-center font-bold">
            <Check className="h-4 w-4" />
          </div>
          <div>
            <p className="font-bold text-xs sm:text-sm">Added to Home Screen!</p>
            <p className="text-[11px] text-[#aaa9b4]">Tap the icon anytime to play Rev3rse instantly.</p>
          </div>
        </div>
      )}

      {/* 3. Guide Modal (Especially helpful for iOS Safari & browsers requiring manual step) */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#1b1b20] border border-[#35353d] text-[#f5f4ed] rounded-3xl p-5 sm:p-7 max-w-md w-full relative shadow-2xl flex flex-col gap-5">
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 text-[#aaa9b4] hover:text-[#f5f4ed] p-1 rounded-full hover:bg-[#232329] transition-colors cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Header with App Icon */}
            <div className="flex items-center gap-3.5 border-b border-[#35353d]/60 pb-4">
              <div className="w-12 h-12 rounded-2xl bg-[#d3ff62] p-2 flex items-center justify-center shrink-0 shadow-lg shadow-[#d3ff62]/20">
                <Image
                  src="/figma/reverse-audio-symbol.svg"
                  alt="Rev3rse App Icon"
                  width={32}
                  height={32}
                  className="w-full h-full"
                />
              </div>
              <div>
                <h3 className="text-lg font-black tracking-tight text-[#f5f4ed]">
                  Add Rev3rse to Home Screen
                </h3>
                <p className="text-xs text-[#aaa9b4]">
                  Play anytime without opening a browser
                </p>
              </div>
            </div>

            {/* Instructions */}
            {isIOS ? (
              <div className="flex flex-col gap-3 text-xs sm:text-sm">
                <p className="text-[#aaa9b4]">Follow these quick steps in Safari on your iPhone or iPad:</p>
                <div className="flex items-start gap-3 bg-[#232329] p-3 rounded-2xl border border-[#35353d]">
                  <div className="p-2 bg-[#1b1b20] rounded-xl text-[#d3ff62] shrink-0">
                    <Share2 className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-[#f5f4ed]">1. Tap the Share button</span>
                    <p className="text-[11px] text-[#aaa9b4]">Located at the bottom of Safari (or top right on iPad).</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-[#232329] p-3 rounded-2xl border border-[#35353d]">
                  <div className="p-2 bg-[#1b1b20] rounded-xl text-[#d3ff62] shrink-0">
                    <PlusSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-[#f5f4ed]">2. Select &quot;Add to Home Screen&quot;</span>
                    <p className="text-[11px] text-[#aaa9b4]">Scroll down the share sheet and tap the plus icon.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 bg-[#232329] p-3 rounded-2xl border border-[#35353d]">
                  <div className="p-2 bg-[#1b1b20] rounded-xl text-[#d3ff62] shrink-0">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-[#f5f4ed]">3. Tap &quot;Add&quot;</span>
                    <p className="text-[11px] text-[#aaa9b4]">Rev3rse will appear right on your home screen!</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 text-xs sm:text-sm">
                <p className="text-[#aaa9b4]">Install Rev3rse for an app-like fullscreen experience:</p>
                <div className="flex items-start gap-3 bg-[#232329] p-3 rounded-2xl border border-[#35353d]">
                  <div className="p-2 bg-[#1b1b20] rounded-xl text-[#d3ff62] shrink-0">
                    <Smartphone className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-bold text-[#f5f4ed]">Browser Menu</span>
                    <p className="text-[11px] text-[#aaa9b4]">Tap the three dots (⋮) in Chrome or Edge and select &quot;Install app&quot; or &quot;Add to Home screen&quot;.</p>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-full bg-[#d3ff62] text-[#111113] font-bold text-sm h-11 rounded-xl flex items-center justify-center gap-2 hover:bg-[#b8f533] transition-all cursor-pointer shadow-lg shadow-[#d3ff62]/20"
              >
                <span>Got it!</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

