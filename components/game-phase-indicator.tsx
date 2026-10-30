"use client"

import { cn } from "@/lib/utils"
import { Mic, Volume2, RotateCcw, ThumbsUp, Award, Check } from "lucide-react"

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

interface GamePhaseIndicatorProps {
  phase: GamePhase
}

const phases = [
  { id: "record", step: "1", label: "Speak", icon: Mic },
  { id: "listen", step: "2", label: "Reverse", icon: Volume2 },
  { id: "imitate", step: "3", label: "Imitate", icon: RotateCcw },
  { id: "vote", step: "4", label: "Judge", icon: ThumbsUp },
  { id: "reveal", step: "5", label: "Verdict", icon: Award },
]

function getPhaseIndex(phase: GamePhase): number {
  switch (phase) {
    case "setup":
    case "start":
    case "requesting-permission":
    case "counting-down-original":
    case "recording-original":
    case "original-recorded":
      return 0
    case "playing-reversed":
      return 1
    case "counting-down-imitation":
    case "recording-imitation":
    case "imitation-recorded":
      return 2
    case "voting":
      return 3
    case "reveal":
    case "game-over":
      return 4
    default:
      return 0
  }
}

export function GamePhaseIndicator({ phase }: GamePhaseIndicatorProps) {
  const currentIndex = getPhaseIndex(phase)

  return (
    <nav aria-label="Game Progress" className="w-full px-3 py-3 bg-[#1b1b20] rounded-2xl border border-[#35353d] shadow-sm">
      <ol className="flex items-center justify-between gap-1 sm:gap-2">
        {phases.map((p, index) => {
          const Icon = p.icon
          const isActive = index === currentIndex
          const isCompleted = index < currentIndex

          return (
            <li key={p.id} className="flex items-center flex-1 last:flex-initial">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold transition-all duration-300",
                    isActive &&
                      "bg-[#d3ff62] text-[#111113] shadow-md shadow-[#d3ff62]/30 scale-105 ring-2 ring-[#d3ff62]/40 font-black",
                    isCompleted &&
                      "bg-[#ae98f5]/20 text-[#ae98f5] border border-[#ae98f5]/40",
                    !isActive &&
                      !isCompleted &&
                      "bg-[#232329] text-[#71717d] border border-transparent",
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" strokeWidth={3} />
                  ) : (
                    <Icon className="h-4 w-4" strokeWidth={isActive ? 2.5 : 2} />
                  )}
                </div>

                <div className="hidden sm:flex flex-col text-left">
                  <span
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-wider leading-none",
                      isActive
                        ? "text-[#d3ff62]"
                        : isCompleted
                        ? "text-[#ae98f5]"
                        : "text-[#71717d]",
                    )}
                  >
                    Step {p.step}
                  </span>
                  <span
                    className={cn(
                      "text-xs font-bold leading-tight mt-0.5",
                      isActive
                        ? "text-[#f5f4ed]"
                        : isCompleted
                        ? "text-[#f5f4ed]/80"
                        : "text-[#71717d]",
                    )}
                  >
                    {p.label}
                  </span>
                </div>
              </div>

              {index < phases.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-1 mx-2 rounded-full transition-colors duration-300",
                    index < currentIndex
                      ? "bg-[#ae98f5]/50"
                      : "bg-[#232329]",
                  )}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
