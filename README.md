# 🔄 Rev3rse — The Backwards Audio Party Game

Rev3rse is an audio party game where players record a phrase, hear it reversed, try to pronounce the backwards syllables, and then listen to their imitation reversed back to see if it recreated the original words!

## 🎮 Game Modes

1. **Solo Practice Mode**:
   - Single-player sandbox to test your backward speaking skills alone.
   - Built-in phrase prompt generator with categories (Funny, Tongue Twisters, Movies, Short & Sweet, Hard).
   - Listen to the reversed phrase, record your imitation, and compare original vs reversed back.

2. **1v1 Battle Mode**:
   - Pass-and-play duel on a single device with a customizable lives system (1 to 5 lives).
   - 3-2-1 countdown, 8-second max recording duration, and live waveform visualizer.
   - Secret phrase reveal and side-by-side comparison voting.

3. **Party Mode (2–12 Players)**:
   - Multiplayer room system powered by Socket.IO.
   - **QR Code & Direct Join Links**: Show the host screen or TV and scan with phone camera to join immediately.
   - One player speaks, everyone hears the reversed audio, and each takes a turn imitating.
   - **Dual Audio Playback**: Hear both the *reversed-back imitation* (the goal!) and the *raw backwards noises*.
   - Everyone ranks the imitations from best to worst on their own device to crown the winner!

## 🚀 Getting Started

### Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) or share your network IP printed in the terminal for phones on the same Wi-Fi.

### Production Build
```bash
npm run build
npm start
```
