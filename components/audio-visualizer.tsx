"use client"

import { useEffect, useRef } from "react"

interface AudioVisualizerProps {
  analyser: AnalyserNode | null
  isActive: boolean
}

export function AudioVisualizer({ analyser, isActive }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.resetTransform?.()
      ctx.scale(dpr, dpr)
    }

    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    let phase = 0

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const width = rect.width
      const height = rect.height

      ctx.clearRect(0, 0, width, height)

      const barCount = 34
      const gap = 4
      const totalGap = gap * (barCount - 1)
      const barWidth = Math.max(3, (width - totalGap) / barCount)

      if (analyser && isActive) {
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)
        analyser.getByteFrequencyData(dataArray)

        const step = Math.floor(bufferLength / barCount)

        for (let i = 0; i < barCount; i++) {
          const value = dataArray[i * step] || 0
          const normalized = value / 255
          const barHeight = Math.max(5, normalized * (height * 0.88))

          const x = i * (barWidth + gap)
          const y = (height - barHeight) / 2

          // Gradient interpolation from Figma Neon Lime (#d3ff62) to Purple (#ae98f5)
          const ratio = i / barCount
          const r = Math.round(211 * (1 - ratio) + 174 * ratio)
          const g = Math.round(255 * (1 - ratio) + 152 * ratio)
          const b = Math.round(98 * (1 - ratio) + 245 * ratio)

          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
          ctx.beginPath()
          ctx.roundRect(x, y, barWidth, barHeight, 4)
          ctx.fill()
        }
      } else {
        // Resting ambient waveform
        phase += 0.04

        for (let i = 0; i < barCount; i++) {
          const wave = Math.sin(i * 0.28 + phase) * 0.5 + 0.5
          const barHeight = Math.max(4, wave * 18 + 5)
          const x = i * (barWidth + gap)
          const y = (height - barHeight) / 2

          ctx.fillStyle = "rgba(174, 152, 245, 0.35)"
          ctx.beginPath()
          ctx.roundRect(x, y, barWidth, barHeight, 3)
          ctx.fill()
        }
      }

      animationRef.current = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [analyser, isActive])

  return (
    <div className="relative w-full h-24 rounded-2xl bg-[#1b1b20] border border-[#35353d] overflow-hidden flex items-center justify-center p-3 shadow-inner">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  )
}
