# CameraShare

## Agent Behavior
- Read memory (`~/.claude/projects/-home-dotaneli-camera-share/memory/MEMORY.md`) + `PROGRESS.md` at session start.
- **On every session boot:** Fetch and ingest `https://docs.expo.dev/llms-eas.txt` using WebFetch to have current Expo/EAS documentation. This is critical — we've burned builds from outdated Expo knowledge.
- **Read `feedback_expo_knowledge.md` from memory on every session.** It contains hard-won lessons about EAS channels, OTA, build vs update, and debugging. Do NOT skip this.
- Proactively save decisions, dead ends, conclusions, preferences to memory. Don't wait to be asked.
- Checkpoint during long conversations. Update PROGRESS.md at session end.
- Be generous saving, conservative deleting.

## Architecture (DO NOT CHANGE without user approval)
Expo SDK 54 React Native app. Two phones: one camera, one remote viewfinder/shutter. No logins.
- `react-native-webrtc` = live video streaming (its own camera)
- `react-native-vision-camera` v4 = high-res photo capture + QR scanning only
- Firebase RTDB + Anonymous Auth = signaling. Cloudflare TURN = NAT traversal.
- Firebase RTDB REST API = remote crash logging (no native deps)
- zustand, expo-router, expo-keep-awake, expo-media-library, netinfo
- No custom native modules. All JS/TS.

## Dev Rules
- **Live-first:** Ship small via `eas update --channel preview` (free/unlimited). `eas build` only for native dep changes (15/platform/month free). Track build count in PROGRESS.md.
- **OTA vs Build:** `eas update` can ONLY change JS/TS. Adding any package with native code requires `eas build`. If OTA fails silently (stuck on splash or old content), check: does the build have a `channel`? Does runtimeVersion match? Did user open app twice?
- **OTA publish command:** `eas update --channel preview --message "description"`
- **Build pipeline:** EAS Build (cloud). No Xcode/Android Studio. Project on `/home/` (ext4, never /mnt/c/).
- **Remote logging:** Crash logs go to Firebase RTDB. Read with `./scripts/watch-logs.sh --last 30` or `curl`. Always check logs before guessing at fixes.
- **Communication:** Explain simply, no jargon, provide URLs, show exact CLI commands.
