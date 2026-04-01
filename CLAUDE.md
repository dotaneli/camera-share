# CameraShare — Claude Instructions

## Session Start Protocol
1. **Always read memory first:** Read all files referenced in `~/.claude/projects/-home-dotaneli-camera-share/memory/MEMORY.md` at the start of every session.
2. **Check progress:** Read `PROGRESS.md` in this repo to understand what was last completed and what comes next.
3. **Checkpoint memory:** After completing each major milestone, update memory files AND `PROGRESS.md`. Do NOT wait until session end — save progress at checkpoints in case of crashes.

## Project Overview
React Native (Expo) app that pairs two phones — one as camera (rear lenses), one as live remote viewfinder + shutter. Zero friction: no accounts, no logins.

## Key Architecture Decisions (DO NOT CHANGE without user approval)
- **Dual-library approach:** `react-native-webrtc` for live video streaming (uses its own camera). `react-native-vision-camera` for high-res photo capture + QR scanning only.
- **No custom native modules.** Everything in JS/TS. User has no Xcode/Android Studio experience.
- **Firebase RTDB** for signaling. Anonymous auth. Disconnect after WebRTC connects.
- **Cloudflare TURN** (free tier) mandatory from day one.
- **EAS Build** for all builds. No local Xcode/Android Studio.
- **Full-res photo transfer** to viewfinder via data channel (64KB chunks).

## Tech Stack
- Expo SDK 52+ with Dev Client + New Architecture
- react-native-webrtc (streaming)
- react-native-vision-camera v4 (photo capture + QR)
- Firebase RTDB + Anonymous Auth
- zustand (state management)
- expo-router (navigation)
- expo-keep-awake, expo-media-library, @react-native-community/netinfo

## User Communication Style
- Explain concepts simply — user is new to mobile native development
- Provide URLs when instructing to visit external services
- Avoid jargon ("native module", "provisioning profile", etc.) or explain in one sentence
- Show exact CLI commands to run

## Build Pipeline
- Project lives on `/home/dotaneli/camera-share/` (ext4, NEVER /mnt/c/)
- Android debug: local WSL2 builds
- iOS: EAS Build (cloud) — `eas build --platform ios`
- Dev Client for hot reload — only rebuild when native deps change
