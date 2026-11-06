"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { ModeSelector } from "@/components/mode-selector"
import { ReverseAudioGame } from "@/components/reverse-audio-game"
import { PartyMode } from "@/components/party-mode"
import { SoloMode } from "@/components/solo-mode"

export type GameMode = "select" | "solo" | "1v1" | "party"

function HomeContent() {
  const searchParams = useSearchParams()
  const roomParam = searchParams.get("room")

  // Intro animation plays natively on first visit, bypassed if joining directly via a multiplayer invite link
  const [mode, setMode] = useState<GameMode>(() => (roomParam ? "party" : "select"))
  const [initialRoomCode, setInitialRoomCode] = useState<string | undefined>(
    () => roomParam || undefined,
  )
  const [initialPlayIntro, setInitialPlayIntro] = useState(() => !roomParam)

  useEffect(() => {
    if (roomParam) {
      setInitialRoomCode(roomParam.toUpperCase())
      setMode("party")
      setInitialPlayIntro(false)
    }
  }, [roomParam])

  return (
    <main className="min-h-screen bg-background relative overflow-x-hidden">
      {mode === "select" && (
        <ModeSelector
          onSelectMode={setMode}
          initialPlayIntro={initialPlayIntro}
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
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
          Loading Rev3rse...
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  )
}

