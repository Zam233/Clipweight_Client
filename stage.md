# ClipWright Optimization — Stage Log

## Stage 1: Critical Bug Fixes
**Timestamp**: 2026-07-29T13:45:00+08:00

- Fix: ESLint 9 flat config missing — `npm run lint` completely broken
- Fix: Default API/WS port mismatch (8080 → 8000) in client.ts, settingsStore.ts, WsClient.ts
- Fix: .env.example had wrong default ports (8080 → 8000)
- Fix: previewStore.setCurrentTime allows negative/out-of-bounds time
- Fix: Playback loop ignores loopRegion and isLooping settings
- Fix: historyStore.maxSize not synced with settingsStore.maxUndoHistory
