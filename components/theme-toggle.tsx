"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import { Moon, Sun } from "lucide-react"
import { sfx } from "@/lib/sound-effects"

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <div className="w-[79.2px] h-[39.6px] rounded-full border border-[#35353d] bg-[#1b1b20] flex items-center justify-between px-2.5 opacity-60">
        <Sun className="h-4 w-4 text-[#71717d]" />
        <Moon className="h-4 w-4 text-[#71717d]" />
      </div>
    )
  }

  // Reliably determine whether current active theme is dark
  const currentTheme = resolvedTheme || theme || "dark"
  const isDark = currentTheme === "dark"

  const toggleTheme = (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      sfx.playClick()
    } catch {}
    const nextTheme = isDark ? "light" : "dark"
    setTheme(nextTheme)
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`relative w-[79.2px] h-[39.6px] rounded-full border transition-all duration-300 flex items-center justify-between px-2.5 cursor-pointer select-none group shadow-inner ${
        isDark
          ? "border-[#35353d] bg-[#1b1b20] hover:border-[#4d4d58]"
          : "border-[#d0d0d8] bg-[#e4e4e9] hover:border-[#b8b8c2]"
      }`}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle theme mode"
    >
      {/* Sliding Active Pill */}
      <div
        className={`absolute top-[3px] w-[32px] h-[32px] rounded-full bg-[#d3ff62] shadow-md transition-all duration-300 ease-out flex items-center justify-center pointer-events-none z-10 ${
          isDark ? "left-[43px]" : "left-[3.5px]"
        }`}
      >
        {isDark ? (
          <Moon className="h-4 w-4 text-[#111113] fill-[#111113]" strokeWidth={2} />
        ) : (
          <Sun className="h-4 w-4 text-[#111113] stroke-[#111113]" strokeWidth={2.5} />
        )}
      </div>

      {/* Sun icon placeholder on left */}
      <div className="w-[32px] h-[32px] flex items-center justify-center z-0 pointer-events-none">
        <Sun
          className={`h-4 w-4 transition-colors duration-200 ${
            !isDark ? "opacity-0" : "text-[#71717d] group-hover:text-[#aaa9b4]"
          }`}
          strokeWidth={2}
        />
      </div>

      {/* Moon icon placeholder on right */}
      <div className="w-[32px] h-[32px] flex items-center justify-center z-0 pointer-events-none">
        <Moon
          className={`h-4 w-4 transition-colors duration-200 ${
            isDark ? "opacity-0" : "text-[#8e8d99] group-hover:text-[#61616c]"
          }`}
          strokeWidth={2}
        />
      </div>
    </button>
  )
}
