"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { io, Socket } from "socket.io-client"

export function useSocket() {
  const socketRef = useRef<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    // Connect to the Socket.IO server on the same host
    const socket = io({
      transports: ["websocket", "polling"],
    })

    socket.on("connect", () => {
      setIsConnected(true)
      console.log("[Socket] Connected:", socket.id)
    })

    socket.on("disconnect", () => {
      setIsConnected(false)
      console.log("[Socket] Disconnected")
    })

    socketRef.current = socket

    return () => {
      socket.disconnect()
    }
  }, [])

  const emit = useCallback(
    (event: string, data?: any, callback?: (response: any) => void) => {
      if (socketRef.current) {
        if (callback) {
          socketRef.current.emit(event, data, callback)
        } else {
          socketRef.current.emit(event, data)
        }
      }
    },
    [],
  )

  const on = useCallback(
    (event: string, handler: (...args: any[]) => void) => {
      socketRef.current?.on(event, handler)
      return () => {
        socketRef.current?.off(event, handler)
      }
    },
    [],
  )

  const off = useCallback(
    (event: string, handler?: (...args: any[]) => void) => {
      if (handler) {
        socketRef.current?.off(event, handler)
      } else {
        socketRef.current?.removeAllListeners(event)
      }
    },
    [],
  )

  return {
    socket: socketRef.current,
    isConnected,
    emit,
    on,
    off,
    id: socketRef.current?.id || null,
  }
}
