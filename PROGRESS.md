# CameraShare — Progress Tracker

## Current Phase: Phase 1 MVP — Week 1 (Project Setup + Pairing)

## Completed
- [x] Product & technical plan (expert panel discussion, architecture, PRD)
- [x] Memory system initialized for session persistence
- [x] CLAUDE.md created with instructions for future sessions

## In Progress
- [ ] Initialize Expo project
- [ ] Git repo setup + GitHub remote

## Up Next (Week 1)
- [ ] Install core dependencies (webrtc, vision-camera, zustand, expo-router, etc.)
- [ ] Role selection screen ("I'm the Camera" / "I'm the Viewfinder")
- [ ] Firebase project setup (RTDB, anonymous auth, security rules)
- [ ] Camera phone: room creation + QR code display + 6-digit code
- [ ] Viewfinder phone: QR scanner + manual code entry
- [ ] First EAS Build (Dev Client for both platforms)

## Week 2: WebRTC Connection
- [ ] Firebase RTDB signaling module
- [ ] WebRTC peer connection (720p, 30fps)
- [ ] STUN + TURN configuration
- [ ] Video stream: camera -> viewfinder
- [ ] Data channel for controls

## Week 3: Capture + Photo Transfer
- [ ] Remote shutter via data channel
- [ ] Full-res photo capture (vision-camera)
- [ ] Photo transfer (compressed preview + full-res background)

## Week 4: Stability
- [ ] Auto-reconnect, heartbeat, ICE restart
- [ ] iOS/Android lifecycle handling
- [ ] Room cleanup

## Week 5: Testing + Polish
- [ ] Cross-platform testing matrix
- [ ] Performance optimization
