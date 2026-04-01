# CameraShare — Progress Tracker

## Current: Milestone 0.5 (Logging) + Milestone 1 (Role Selection)

## EAS Build Count: 6 / 30 (free tier monthly limit, resets monthly)
## Deploy method: `eas update --branch preview` (free, unlimited, ~30s)

## Milestones

- [x] **M0: Empty shell** — Preview APK on phone. ✅
- [x] **M0.5: Logging** — Structured logger (react-native-logs). ✅
- [x] **M1: Role selection** — Buttons + navigation + audit fixes. ✅ Confirmed on device.
- [x] **M2: QR pairing UI** — QR display + scan + manual code entry. ✅ Audit fixed. Build in progress.
- [ ] **M3: Firebase signaling** — Room creation, joining, message exchange. (needs build — native dep)
- [ ] **M4: WebRTC streaming** — Live video from camera to viewfinder. (needs build — native dep)
- [ ] **M5: Remote shutter** — Tap to capture full-res photo. (OTA)
- [ ] **M6: Photo transfer** — Full-res photo to viewfinder phone. (OTA)
- [ ] **M7: Resilience** — Auto-reconnect, heartbeat, lifecycle handling. (OTA) **= MVP DONE**

## Completed
- [x] Product & technical plan
- [x] Memory system + CLAUDE.md
- [x] Git repo (github.com/dotaneli/camera-share)
- [x] Expo login (dotaneli)
- [x] Firebase project (camera-share-e9232, RTDB + anonymous auth enabled)
- [x] Apple Developer account enrolled
- [x] EAS CLI installed globally
- [x] Preview APK on user's Android phone (standalone, OTA-capable)

## Accounts
- Expo: dotaneli (logged in, EAS builds working)
- GitHub: dotaneli (authenticated, push working)
- Firebase: camera-share-e9232 (RTDB + auth ready, not yet in code)
- Apple Developer: enrolled (no iOS builds yet)
- Cloudflare: not yet (needed for TURN in M4)
- Sentry: NOT YET — needed for M0.5
