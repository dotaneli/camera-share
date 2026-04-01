# CameraShare

## Agent Behavior
- Read memory (`~/.claude/projects/-home-dotaneli-camera-share/memory/MEMORY.md`) + `PROGRESS.md` at session start.
- Proactively save decisions, dead ends, conclusions, preferences to memory. Don't wait to be asked.
- Checkpoint during long conversations. Update PROGRESS.md at session end.
- Be generous saving, conservative deleting.

## Architecture (DO NOT CHANGE without user approval)
Expo SDK 52+ React Native app. Two phones: one camera, one remote viewfinder/shutter. No logins.
- `react-native-webrtc` = live video streaming (its own camera)
- `react-native-vision-camera` v4 = high-res photo capture + QR scanning only
- Firebase RTDB + Anonymous Auth = signaling. Cloudflare TURN = NAT traversal.
- zustand, expo-router, expo-keep-awake, expo-media-library, netinfo
- No custom native modules. All JS/TS.

## Dev Rules
- **Live-first:** Deploy empty shell to device ASAP. Ship small via `eas update` (free/unlimited). `eas build` only for native dep changes (15/platform/month free). Track build count in PROGRESS.md.
- **OTA vs Build:** `eas update` can ONLY change JS/TS. Adding any package with native code (ios/android folders, Expo config plugin) requires `eas build`. Always check before updating. If OTA fails silently (stuck on splash), a missing native dep is likely the cause.
- **Build pipeline:** EAS Build (cloud). No Xcode/Android Studio. Project on `/home/` (ext4, never /mnt/c/).
- **Communication:** Explain simply, no jargon, provide URLs, show exact CLI commands.
