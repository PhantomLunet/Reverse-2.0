"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ModeSelector } from "@/components/mode-selector"
import { ReverseAudioGame } from "@/components/reverse-audio-game"
import { PartyMode } from "@/components/party-mode"
import { SoloMode } from "@/components/solo-mode"
import { IntroVideo } from "@/components/intro-video"

export type GameMode = "select" | "solo" | "1v1" | "party"

function HomeContent() {
  const searchParams = useSearchParams()
  const roomParam = searchParams.get("room")

  // Play intro video on initial visit/load (bypassed if opening directly via a multiplayer room invite link)
  const [showIntro, setShowIntro] = useState(() => !roomParam)
  const [mode, setMode] = useState<GameMode>(() => (roomParam ? "party" : "select"))
  const [initialRoomCode, setInitialRoomCode] = useState<string | undefined>(
    () => roomParam || undefined,
  )

  useEffect(() => {
    if (roomParam) {
      setInitialRoomCode(roomParam.toUpperCase())
      setMode("party")
      setShowIntro(false)
    }
  }, [roomParam])

  return (
    <main className="min-h-screen bg-background relative">
      {/* Short Video Intro Animation Overlay */}
      {showIntro && (
        <IntroVideo onComplete={() => setShowIntro(false)} />
      )}

      {mode === "select" && (
        <ModeSelector
          onSelectMode={setMode}
          onReplayIntro={() => setShowIntro(true)}
        />
      )}
      {mode === "solo" && <SoloMode onBack={() => setMode("select")} />}
      {mode === "1v1" && <ReverseAudioGame onBack={() => setMode("select")} />}
      {mode === "party" && (
        <PartyMode
          onBack={() => {
            setInitialRoomCode(undefined)
            setMode("select")
          }}
          initialRoomCode={initialRoomCode}
        />
      )}
    </main>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Loading Rev3rse...</div>}>
      <HomeContent />
    </Suspense>
  )
}
