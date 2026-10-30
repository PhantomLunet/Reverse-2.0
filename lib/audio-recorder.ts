// Bulletproof Web Audio PCM Recorder & WAV Encoder
// Avoids Chrome/Edge MediaRecorder WebM "EncodingError: Unable to decode audio data" bug.

export interface RecordingResult {
  audioBuffer: AudioBuffer
  wavBlob: Blob
  base64Wav: string
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

// Encodes raw Float32 audio samples into a standard 16-bit mono WAV Blob
export function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  // RIFF identifier
  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, "WAVE")

  // fmt sub-chunk
  writeString(view, 12, "fmt ")
  view.setUint32(16, 16, true) // SubChunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // AudioFormat (1 = PCM)
  view.setUint16(22, 1, true) // NumChannels (1 = Mono)
  view.setUint32(24, sampleRate, true) // SampleRate
  view.setUint32(28, sampleRate * 2, true) // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true) // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true) // BitsPerSample (16 bits)

  // data sub-chunk
  writeString(view, 36, "data")
  view.setUint32(40, samples.length * 2, true)

  // Write PCM 16-bit samples
  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([view], { type: "audio/wav" })
}

// Convert Blob to Base64 fast without string iteration locks
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.includes(",") ? result.split(",")[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Decodes base64 WAV safely; if decodeAudioData fails, falls back to manual WAV header parsing!
export async function decodeAudioSafely(
  audioContext: AudioContext,
  base64Data: string,
): Promise<AudioBuffer> {
  const binaryString = atob(base64Data)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  try {
    // Clone buffer because decodeAudioData detaches the ArrayBuffer
    const clonedBuffer = bytes.buffer.slice(0)
    return await audioContext.decodeAudioData(clonedBuffer)
  } catch (err) {
    console.warn("Native decodeAudioData failed, attempting manual WAV parse fallback...", err)

    // Manual fallback for 16-bit PCM WAV
    const view = new DataView(bytes.buffer)
    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (riff === "RIFF") {
      const channels = view.getUint16(22, true)
      const sampleRate = view.getUint32(24, true)
      const bitsPerSample = view.getUint16(34, true)

      // Find 'data' chunk
      let dataOffset = 36
      while (dataOffset < view.byteLength - 8) {
        const chunkId = String.fromCharCode(
          view.getUint8(dataOffset),
          view.getUint8(dataOffset + 1),
          view.getUint8(dataOffset + 2),
          view.getUint8(dataOffset + 3),
        )
        if (chunkId === "data") break
        dataOffset += 4 + view.getUint32(dataOffset + 4, true)
      }

      const dataLength = view.getUint32(dataOffset + 4, true)
      const sampleCount = dataLength / (bitsPerSample / 8) / channels
      const buffer = audioContext.createBuffer(channels, sampleCount, sampleRate)
      const channelData = buffer.getChannelData(0)

      let sampleOffset = dataOffset + 8
      for (let i = 0; i < sampleCount; i++, sampleOffset += 2) {
        if (sampleOffset + 1 < view.byteLength) {
          const intSample = view.getInt16(sampleOffset, true)
          channelData[i] = intSample / 32768
        }
      }

      return buffer
    }

    throw new Error("Unable to parse audio stream. Please retry.")
  }
}

// Live PCM Audio Recorder using Web Audio API
export class PcmAudioRecorder {
  private audioContext: AudioContext
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private analyser: AnalyserNode | null = null
  private recordedChunks: Float32Array[] = []
  private totalSamples: number = 0
  private isRecording: boolean = false

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext
  }

  public async start(): Promise<AnalyserNode> {
    this.recordedChunks = []
    this.totalSamples = 0
    this.isRecording = true

    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume()
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = 256

    // Using ScriptProcessorNode with bufferSize 4096 (broadest browser compatibility)
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

    this.processor.onaudioprocess = (e) => {
      if (!this.isRecording) return
      const inputData = e.inputBuffer.getChannelData(0)
      const chunk = new Float32Array(inputData.length)
      chunk.set(inputData)
      this.recordedChunks.push(chunk)
      this.totalSamples += chunk.length
    }

    this.source.connect(this.analyser)
    this.analyser.connect(this.processor)
    // Connecting processor to destination is required in some browsers for onaudioprocess to fire
    const muteGain = this.audioContext.createGain()
    muteGain.gain.setValueAtTime(0, this.audioContext.currentTime)
    this.processor.connect(muteGain)
    muteGain.connect(this.audioContext.destination)

    return this.analyser
  }

  public async stop(): Promise<RecordingResult> {
    this.isRecording = false

    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }

    // Merge recorded PCM chunks into a single Float32Array
    const mergedSamples = new Float32Array(this.totalSamples)
    let offset = 0
    for (const chunk of this.recordedChunks) {
      mergedSamples.set(chunk, offset)
      offset += chunk.length
    }

    // Create AudioBuffer directly in memory - ZERO decoding errors!
    const sampleRate = this.audioContext.sampleRate
    const audioBuffer = this.audioContext.createBuffer(
      1,
      Math.max(1, mergedSamples.length),
      sampleRate,
    )
    audioBuffer.copyToChannel(mergedSamples, 0)

    // Encode to WAV Blob and Base64 string for network/storage
    const wavBlob = encodeWAV(mergedSamples, sampleRate)
    const base64Wav = await blobToBase64(wavBlob)

    return {
      audioBuffer,
      wavBlob,
      base64Wav,
    }
  }

  public cancel() {
    this.isRecording = false
    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
    }
    if (this.source) {
      this.source.disconnect()
      this.source = null
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }
    this.recordedChunks = []
    this.totalSamples = 0
  }
}

