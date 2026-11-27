# Handover: gimbal-lab (updated 2026-11-27)

Read this first. It covers what the owner wants, what exists, what has been tried on the real hardware, and what to do next.

## START HERE: where the last session stopped (2026-11-26, ~19:20 local)

The last session ran **on the owner's Mac** and ended mid-task when the usage limit was hit.

**Owner-confirmed since the previous notes:**
- 🔄 Knob-twist gesture (portrait/landscape) works **both ways**.
- ✋ Palm = record start/stop works. The ☝️ point gesture isn't needed (owner forgot it existed; leave it in but don't push it).
- Voice is **parked** for now.

**In progress: Sony camera (ILCE-7M4, a7 IV) Bluetooth record control** (`lib/sony.js`, on `main`; unit tests pass, never worked on hardware):
- Mac BLE scan sees the camera as `ILCE-7M4` (manufacturer id 0x012D) and also `OM5-8055QE` and `FY_SCORP_C_31`.
- `tools/sony_test.py` (exists **only on the Mac**, not pushed) connected and listed services `8000ff00, 8000cc00, 8000dd00, 8000ee00, 8000bb00`. Status notify on FF02 worked.
- Writing the record button to FF01 failed: **`GATT Protocol Error: Insufficient Encryption`**. The camera needs a bonded (paired) link. Bleak can't call `pair()` on macOS.
- The camera sat on its "Pairing / ILCE-7M4 / Cancel" screen, but no pairing completed and nothing showed in the phone's Bluetooth list.
- The last edit (not yet run) made `sony_test.py` retry the write 8 times, 3 s apart, so macOS gets a chance to start pairing and show its prompt.

**Next for Sony, in order:**
1. Camera: MENU › Network › Bluetooth: Bluetooth Function **On**, Bluetooth Rmt Ctrl **On**, then **Pairing** (leave that screen open).
2. Try it **from the app on the S24** first (Settings › Sony camera › Connect). Android usually shows its own pair prompt when it meets an encrypted characteristic. Accept it on both the phone and the camera.
3. If you're on the Mac: run the retry version of `tools/sony_test.py` from Terminal (via a `.command` launcher, because the Claude app process has no Bluetooth). Watch for a macOS pairing prompt and the camera's "OK".
4. If neither pairs: remove any old "ILCE-7M4" entry from Mac/phone Bluetooth settings, then on the camera use MENU › Network › Bluetooth › **Pairing** again (or reset the camera's Bluetooth/network settings) and retry.
5. Once a write goes through, confirm 0x010F/0x010E toggles recording, then check `lib/sony.js` uses the same sequence.

**Unpushed work on the Mac (`~/Documents/code/gimbal-lab`):** local commit `afe5ce1` ("HANDOVER: twist confirmed both ways; Sony control and point gesture built, untested; voice parked") and `tools/sony_test.py` with the retry edit. A Mac session should commit and `git push` those first: `git pull --rebase` then push. This file already includes the gist of `afe5ce1`.

## The owner and the goal

- The owner is not a developer and usually works from a **Samsung Galaxy S24** and a **Mac laptop**. Keep instructions short and in plain language. Do the work rather than describing it.
- Hardware:
  - **DJI OM 4** phone gimbal, about 4 years old. It holds the S24.
  - **FeiyuTech SCORP-C** camera gimbal. Its Bluetooth name is **`FY_SCORP_C_31`**. The official **Feiyu SCORP** app on the S24 connects to it, moves it and calibrates it.
- **What they want:** their own **app**, usable on the phone *and* the Mac, with every recommended feature:
  1. Control the gimbals from the app, with a joystick and recenter.
  2. **Follow me / keep me in frame**, including during a live stream.
  3. **Voice control.**
  4. Saved, repeatable camera moves (slow pan, reveal, timelapse pan).
  5. A prompter/script overlay. They had an earlier prompter app that beat the Elgato prompter software.
  6. A **desk studio for live streaming:** both gimbals on the desk with two cameras. A Mac runs the app and OBS, both gimbals track the owner, and the app switches to the camera they are facing.
- Order agreed with the owner: **OM 4 first**, then add the SCORP-C.

## Architecture decision

An installable **web app (PWA)** using **Web Bluetooth**, hosted on **GitHub Pages**. One codebase runs in Chrome on Android and on the Mac; Safari and iPhone do not support Web Bluetooth.

The live-stream camera conflict is solved by the **Mac being the director**:
- The S24 connects over USB in webcam mode. The camera on the SCORP-C connects through an HDMI capture stick.
- The app watches both feeds, steers both gimbals, and switches OBS scenes over the OBS WebSocket (`ws://localhost:4455`).
- macOS lets Chrome and OBS share a camera.

## Repo layout (branch `claude/vigilant-lamport-624791`, PR DrLivet/gimbal-lab#1)

| Path | What | State |
|---|---|---|
| `lab.html`, `styles.css`, `src/lab.js` | **Gimbal Lab** diagnostics page: OM 4 wake-up ladder plus a generic BLE explorer | done; tested against a simulated gimbal |
| `lib/duml.js` | DJI DUML framing (crc8 seed 0x77; crc16 seed 0x3692 over the whole packet), parser, decoder | done; verified against 3 real Mimo packets |
| `lib/om.js` | OM 4 BLE driver (service FFF0, notify FFF4, write FFF5) and `LADDER` of wake-up steps | done |
| `lib/ble.js`, `lib/explorer.js` | Web Bluetooth helpers; explorer for unknown devices | done |
| `lib/gimbal.js` | the app-facing gimbal interface (`setVelocity`, `moveBy`, `recenter`, `offset`), with `DjiOm4` implemented and a `MODELS` registry | done, untested on hardware |
| `lib/feiyu.js` | Feiyu SCORP-C driver (AK protocol), same interface as `DjiOm4`; registered in `MODELS` | done; packets match the Feiyu app's own Java builder byte for byte; untested on hardware |
| `src/follow.js` | follow-me controller (framing presets, deadzone with hysteresis, smoothing, lost-person stop), `pickTarget`, `facingScore` | done, unit tested |
| `src/tracker.js` | MediaPipe FaceDetector (`face`) or PoseLandmarker (`body`) on a `<video>` | done, not yet run in a browser |
| `src/voice.js` | speech commands behind the wake word "gimbal" (stops "all right" panning the camera mid-stream) | done, unit tested |
| `src/moves.js` | preset and recorded moves, legs split to the 25.5 s per-command limit | done, unit tested |
| `src/obs.js` | OBS WebSocket v5 client (auth, scene list, switch) | done, untested against OBS |
| `src/store.js` | settings stored in localStorage | done |
| `vendor/` | MediaPipe tasks-vision 1.2.3 (wasm) plus face and pose models, vendored for offline use | done |
| `test/*.mjs` | `node test/<name>.test.mjs` for duml, follow, voice and moves; `page.test.mjs` runs the lab in headless Chromium with a mock gimbal (needs Playwright) | all passing |

### Main app (built 2026-11-26: `index.html`, `app.css`, `src/app.js`, PWA files; `test/app.test.mjs` passes)
What follows was the spec; all of it is in place except multi-camera use on real hardware is untested.

### Original spec (the main app)
- `index.html` plus `src/app.js` and `app.css`: the main app screen.
  - **Rigs:** each rig is a camera, a gimbal, a tracker and a follow controller. The phone shows one full-screen rig; the Mac shows a grid of 2 or more.
  - Per rig: camera picker, gimbal connect, Follow toggle, and an overlay showing the face box and framing target.
  - Dock: Follow, Record (MediaRecorder, then download), virtual joystick, Recenter, Voice on/off, Prompter, Moves.
  - Sheets: Moves (presets, record a custom move, play), Prompter (script, speed, size, mirror), Studio (OBS connect, map cameras to scenes, auto-switch by `facingScore` with a hold time), Settings (framing, speed, tilt on/off, face/body, invert pan/tilt, step or speed method, wake word).
  - Link to `lab.html`.
- PWA: `manifest.webmanifest`, `sw.js` (network-first app-shell cache), PNG icons (PIL is available).
- Extend `test/` with an app smoke test: Chromium with `--use-fake-device-for-media-stream`, the mock gimbal from `test/mock-gimbal.js`, and a stubbed tracker.
- Pan/tilt direction differs between the selfie and back cameras. Flip pan automatically for the selfie camera and keep the manual invert toggles.

## What happened on the real OM 4 (important)

- On the S24 in Chrome, the om-research demo page (om-research.flab.dev) **connected**, and correctly framed rotate commands went out with no write errors. **The gimbal did not move.**
- That demo uses a fixed seq of 1 and attr 0x00, sends no heartbeat, and ignores everything the gimbal sends back.
- Mimo's own packets use an incrementing seq and attr 0x40, and Mimo sends heartbeats continuously (`04/50 01 04 05`, `00/00 02 00`).
- **Gimbal Lab's "Run test"** walks through these additions one by one, and stores the first step that works in `localStorage['om4.wakeStep']`. `lib/gimbal.js` replays it on connect.
- **Not yet run on hardware**, because the owner hasn't merged the PR or turned on Pages yet.
- Things the owner should check if it still doesn't move:
  - Force-stop Mimo.
  - Unpair "OM4…" from Android's Bluetooth settings (it also advertises as a HID remote).
  - Gimbal unfolded and in Follow mode.

## App status (2026-11-26 evening)
- Live at https://drlivet.github.io/gimbal-lab/ (main, GitHub Pages). Installed on the owner's S24 as a WebAPK (`org.chromium.webapk.ac09b56b3cddb2663_v2`). Mac: opened in Chrome; owner to click Install.
- Owner wants real installed apps (Android APK + Mac app, files on device, not GitHub-hosted) **later**; keep the web app while testing. Note: Android WebView has no Web Bluetooth, so an APK needs a TWA (Chrome engine) or a native BLE bridge.
- **Microphone:** the S24 Ultra bottom mic is failing. Measured via Chrome remote debugging (adb forward tcp:9222 localabstract:chrome_devtools_remote): input "Default" = digital silence (-140 dB), "Speakerphone" = hears (peaks -10 dB), "Headset earpiece" = raw only. `src/mic.js` picks the first non-silent input; voice uses Web Speech `start(audioTrack)` (Chrome 158 supports it) with fallback; recordings use the same mic. **Voice recognition from that track is not yet confirmed on the phone** (one try started but heard nothing; owner may not have been speaking).
- Phone remote-debug helper used for these checks: Runtime.evaluate over the DevTools websocket on :9222.

## Confirmed on the owner's phone + OM 5 (2026-11-26, late afternoon)
Owner-tested and working: follow-me (smooth, holds still when you're still, follows up/down), ✋ palm = record start/stop (3-2-1 countdown), ⟳ portrait/landscape button. **Built but not yet tried by the owner:** 🔄 knob-twist gesture, voice ("gimbal landscape/portrait/follow me") on the real phone. Recording saves standard MP4 (H.264 + AAC) on the phone (Downloads, or a folder picked in Settings › Recordings).
Key findings:
- **Directions differ per mount/orientation.** The OM 5 measured both axes reversed in some sessions, only pan in others. The app now checks on every connect by nudging each axis and watching the picture (`src/calibrate.js`), stored per gimbal + front/back camera. Don't hard-code directions.
- **Follow tuning:** gain 2, delay prediction 0.45 s (uses past commanded camera position), hold-still zone after 0.5 s settled, edge search sweep 60°/s for 2.5 s. **Speed-matching (feed-forward) made the real OM 5 swing ±100°/s — keep `matchSpeed: 0`.** Room simulation tests in `test/follow.test.mjs` cover gimbal speed ×0.5–1.6 and 0.2–0.5 s delay.
- **OM 5 reports its attitude only ~1×/s** (04/05), too slow for feedback control.
- **Portrait/landscape:** roll speed commands (04/0c roll) rotate the OM 5 phone clamp and it stays. `src/orient.js` closes the loop on the phone's gravity sensor (devicemotion) and stops at 0°/±90°.
- **OM 5 hardware buttons (record, M) send nothing to our app** — probably need a handshake only DJI Mimo sends. Capturing Mimo on the S24 failed: Samsung omits btsnoop from bugreports, SysDump's bluetooth folder was empty, the snoop socket never opened, and `dumpsys bluetooth_manager` BTSNOOP_LOG_SUMMARY strips ACL payloads. Mimo (`mimo.sz` 2.12.12) is AppGuard/PairIP-packed, so no static decompile. Next idea: capture on a non-Samsung Android or a rooted device; tools ready: `tools/btsnoop_duml.mjs`, `tools/btsnooz.mjs`.
- Phone tips: the app's offline cache can serve stale code after a deploy — fetch files with `{cache:'reload'}` then reload. Tapping Connect while connected disconnects.

## DJI gimbal results (2026-11-26, from the Mac with `tools/om4_test.py`)
- **The owner's DJI gimbal is an OM 5** (BLE name `OM5-8055QE`), not an OM 4. Same DUML protocol and FFF0 service.
- macOS keeps it connected at system level (paired as a remote), so it doesn't advertise; the test retrieves it with CoreBluetooth `retrieveConnectedPeripheralsWithServices` (FFF0). On the phone, unpair it from Android Bluetooth settings first if Chrome can't see it.
- Relative rotate 04/14 (every ladder variant): **no ack, no movement**. Speed command 04/0c: **acked and moves accurately**. 30°/s for 2 s gave 63.6° pan; 20°/s tilt gave ~41°. Attitude 04/05: pitch/roll/yaw in 0.1°; pitch wraps at ±180 (rests near -172).
- So `DjiOm4` now defaults to `method: 'speed'`; `moveBy`/`recenter` use speed over time. Heartbeats (04/50, 00/00) were running in the successful test.

## SCORP-C protocol (decoded 2026-11-26 from the owner's Feiyu SCORP app v1.5.12)

- BLE name `FY_SCORP_C_xx`. Service `FFFF`, write `FF01`, notify `FF02`. Supports a larger MTU.
- Packet: `A5 5A 03 <target> <u16 cmdType<<13|cmdId> <msgId> <u16 len> <data> <u16 crc>`, all little endian. The CRC is CRC-16/XMODEM over bytes from `03` to the end of the data.
- Joystick: PUSH (type 0) to target 0, cmd 14, data `[roll 0/1, pan i16, tilt i16]`. Full scale is ±450. The app sends at 30 Hz and keeps sending zeros for 1 s after release.
- Recenter: SET (type 1) to target 2, cmd 51 (use mode), data `[2]` ("restore initial position"). Use mode 0 = sleep, 3 = wake.
- Follow mode: SET to target 2, cmd 50. Values: 0 lock, 1 pan follow, 2 pan+tilt follow, 3 three-axis.
- Each axis has a reverse setting on the gimbal (user params 10 tilt, 11 pan). Direction and the degrees-per-second scale (`settings.maxSpeed`) still need checking on the real gimbal.
- Decompiled sources and extracted assets are on the external drive: `/Volumes/Livet Build Storage/Future project builds/gimbal-lab/2026-11-26-feiyu-apk/`.
- Phone access from the Mac works over **wireless debugging** (the USB cable did not show up as a data device). It's already paired: `adb connect 192.168.28.232:42315` while Wireless debugging is on; the port can change, and `adb mdns services` shows it.
- Browser tests on the Mac: use Playwright 1.62.1 (matches the cached Chromium 1234), installed at `/Volumes/Livet Build Storage/Future project builds/gimbal-lab/2026-11-26-test-deps` (run with `NODE_PATH=<that>/node_modules`). The old page-test failure was the mock: `navigator.bluetooth = …` is silently ignored on a secure page, so real Bluetooth ran and macOS killed the browser. Fixed with `Object.defineProperty`. macOS also blocks camera access for automated browsers, so `test/app.test.mjs` uses a canvas stream as the camera.

### SCORP-C hardware results (2026-11-26, from the Mac with `tools/scorp_test.py` / `tools/scorp_experiments.py`)
- Connects; the gimbal streams cmd 30 (attitude, ~10 Hz) and acknowledges SET commands (use mode → RESPONSE_SET).
- The Feiyu app's log (tag `20191206`) shows it sends exactly our joystick packet (course ±450 at 30 Hz) and, for SCORP-C, no app-status push (`scorp_c.json` has no `appStatusPush`).
- **CONFIRMED 2026-11-26 11:43 (owner watched): joystick pans and tilts the SCORP-C** from our packets, with no extra preparation. Earlier failures came after use mode 2 ("restore initial position"), which stops joystick control until power-cycle. `FeiyuScorp.recenter()` drives back by offset; `restoreInitialPosition()` is kept but unused.
- Attitude cmd 30 fields (i16 at data[1], [3], [5]): the third tracks pan (falls on right, rises on left); the first two jump ~4850 on tilt up. Units unconfirmed; tune `settings.maxSpeed` (deg/s at full stick) by eye.
- The gimbal stops advertising a few minutes after a disconnect (seen while on the charger). Press its power button before testing.
- macOS won't give Bluetooth to the Claude app process; run BLE tools via the `.command` launchers in `/Volumes/Livet Build Storage/Future project builds/gimbal-lab/` (they open Terminal, which has Bluetooth access) and read the `.log` files.
- **Next test (owner present, gimbal freshly powered on):** double-click `SCORP-C experiments.command` and watch. Each trial logs the angle span; a big span on trial A = joystick works and use mode 2 was the culprit.

## Next steps

### A. Owner to-dos (the GitHub side)
1. Merge PR DrLivet/gimbal-lab#1 (mark it ready for review, then merge).
2. Turn on GitHub Pages: **Settings → Pages → Deploy from branch → `main` / root**. The URL will be https://drlivet.github.io/gimbal-lab/ (the lab is at `/lab.html`).
3. Open it in Chrome on the S24, connect the OM 4, tap **Run test**, then **Copy log** and paste it to Claude.

### B. On the Mac session (needs the phone on USB). This is why this handover exists.
Prereqs on the phone: Developer options on (tap Build number 7 times), then **USB debugging** on. Accept the "Allow USB debugging" prompt.

1. Install adb: `brew install android-platform-tools`. If Homebrew is missing, install it first, or download Google's platform-tools zip.
2. `adb devices`: the S24 should be listed as `device`.
3. **DONE 2026-11-26 (see the SCORP-C section).** Copy the Feiyu app off the phone to learn the SCORP-C protocol (interoperability with the owner's own device):
   - `adb shell pm list packages | grep -i -E "feiyu|scorp"`
   - `adb shell pm path <package>`, then `adb pull` every APK path it prints. It may be split APKs.
   - Decompile with **jadx** (`brew install jadx`). Search for `BluetoothGatt`, `UUID.fromString`, `writeCharacteristic`, `setCharacteristicNotification`, and the packet builder or checksum code.
   - Goal: the service and characteristic UUIDs, the packet framing and checksum, and the commands for joystick/speed, recenter, mode and calibration.
   - Write the result as `lib/feiyu.js` implementing the same interface as `DjiOm4` in `lib/gimbal.js`, and enable it in `MODELS`.
4. **Bluetooth traffic captures** (ground truth for both gimbals):
   - Turn on Developer options → **Enable Bluetooth HCI snoop log**, then switch Bluetooth off and on.
   - Use the Feiyu app's joystick (right, left, up, down, about 5 s apart), recenter, lock mode on and off. Then use DJI Mimo's joystick with the OM 4.
   - `adb bugreport bugreport.zip`. The log is at `FS/data/misc/bluetooth/logs/btsnoop_hci.log` inside the zip. Parse it with Wireshark/tshark, or a small Python btsnoop parser filtering ATT writes and notifications.
   - For the OM 4, this shows exactly what Mimo sends before a move works.
5. Optional: Chrome on the Mac can also run Gimbal Lab against either gimbal (Mac Bluetooth). Its Explore tab lists the SCORP-C's services.

## Conventions
- Commit to `claude/vigilant-lamport-624791` and push. PR DrLivet/gimbal-lab#1 is open (draft).
- Plain JS ES modules, no build step, so GitHub Pages serves the repo as is.
- Run all `test/*.test.mjs` before pushing.
- Credit om-research (MIT) for the OM protocol.
