# CameraShare — Progress Tracker

## Current: Milestone 5 (Remote shutter + video + audio + zoom) — awaiting device verification

## EAS Build Count: 15 Android (LIMIT HIT — resets May 1) + 7 iOS / 15 per platform per month
## Deploy method: `eas update --branch preview` (free, unlimited, ~30s)

## Milestones

- [x] **M0: Empty shell** — Preview APK on phone. ✅
- [x] **M0.5: Logging** — Firebase RTDB remote logger + crash handlers + breadcrumbs. ✅ Live observability confirmed.
- [x] **M1: Role selection** — Buttons + navigation + audit fixes. ✅ Confirmed on device.
- [x] **M2: QR pairing UI** — QR display + scan + manual code entry. ✅ Working on device. Camera + viewfinder both functional.
- [x] **M3: Firebase signaling** — Room create/join, anonymous auth, real-time status. ✅ Cross-platform confirmed.
- [x] **M4: WebRTC streaming** — Live video working! ICE connected, remote track received. ✅
- [ ] **M5: Remote shutter + video + audio + zoom** — Photo + video capture with camera-hardware swap, audio streaming, hardware zoom via native patches. (BUILD) ← PENDING DEVICE TEST
- [ ] **M6: Photo transfer** — Full-res photo to viewfinder phone. Implemented as part of M5 (`lib/file-transfer.ts`). Needs device validation.
- [ ] **M7: Resilience** — Mutual disconnect, auto-reconnect, heartbeat, quality indicator. (OTA) **= MVP DONE**

## M5 design notes

- **Camera hardware contention:** vision-camera and webrtc cannot simultaneously own the rear camera. `lib/webrtc.ts` exports `pauseCameraCapture()` / `resumeCameraCapture()`. The latter uses `RTCRtpSender.replaceTrack` so we avoid SDP renegotiation mid-call.
- **Audio:** `getUserMedia({ audio: true })` in `lib/webrtc.ts` + `NSMicrophoneUsageDescription` + `RECORD_AUDIO` permission.
- **Zoom:** `plugins/withWebRTCZoom.js` patches `react-native-webrtc`'s native source to expose `mediaStreamTrackSetZoom(trackId, factor)`. Android uses reflection into `Camera2Capturer`; iOS uses `AVCaptureDevice rampToVideoZoomFactor`. Fails silently (try/catch) if patch misses.
- **Durability:** Captured photos/videos are saved to the camera phone's local gallery too, not only sent to viewfinder. Prevents data loss on disconnect.
- **File transfer:** Chunked base64 over data channel, 16KB chunks. Tests in `__tests__/file-transfer.test.ts`.

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
