import { useEffect, useRef, useState } from 'react'
import type { DataPoint, RecognitionAnalysisState } from '../api'

type WSMessage = { type: string; payload: unknown }

export type GeneratorStatus = { running: boolean }
export type TripFoundPayload = {
  id: string
  started_at: string
  ended_at: string
  template_name?: string
  match_threshold_percent?: number
  match_percent: number
  phases?: { phase: string; from: string; to: string }[]
}

export function useWebSocket(options: {
  onPoint?: (p: DataPoint) => void
  onTripFound?: (t: TripFoundPayload) => void
  onGeneratorStatus?: (s: GeneratorStatus) => void
  onAnalysisState?: (s: RecognitionAnalysisState) => void
}) {
  const [connected, setConnected] = useState(false)
  const ref = useRef<WebSocket | null>(null)
  const optsRef = useRef(options)
  optsRef.current = options

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const ws = new WebSocket(`${proto}//${host}/ws`)
    ref.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      try {
        const msg: WSMessage = JSON.parse(e.data)
        const { onPoint, onTripFound, onGeneratorStatus, onAnalysisState } = optsRef.current
        if (msg.type === 'point' && onPoint) {
          const p = msg.payload as { t: string; speed: number; weight: number; phase: string }
          onPoint({ t: p.t, speed: p.speed, weight: p.weight, phase: p.phase })
        } else if (msg.type === 'trip_found' && onTripFound) {
          onTripFound(msg.payload as TripFoundPayload)
        } else if (msg.type === 'generator_status' && onGeneratorStatus) {
          onGeneratorStatus((msg.payload as { running: boolean }) as GeneratorStatus)
        } else if (msg.type === 'analysis_state' && onAnalysisState) {
          onAnalysisState(msg.payload as RecognitionAnalysisState)
        }
      } catch (_) {}
    }

    return () => {
      ws.close()
      ref.current = null
    }
  }, [])

  return { connected }
}
