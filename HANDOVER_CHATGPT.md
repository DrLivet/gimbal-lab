# Gimbal Studio: handover for ChatGPT / Codex (as of 2026-11-27)

> **Paste this whole file into ChatGPT** (or point Codex at the GitHub repo `DrLivet/gimbal-lab`). It describes everything built on 2026-11-25/26, what has been proven on the real hardware, and what to do next. The longer engineering log is `HANDOVER.md` in the same repo.

---

## 0. Instructions for the assistant taking over

- The owner is **not a developer**. Keep replies short, plain and action-first. Give exact taps or clicks, and one step at a time when hardware is involved.
- The repo is **https://github.com/DrLivet/gimbal-lab**. `main` is live on GitHub Pages at **https://drlivet.github.io/gimbal-lab/**. Pushing to `main` redeploys the app within about a minute.
- Code style: **plain JavaScript ES modules, no build step, no framework, no npm dependencies at runtime.** GitHub Pages serves the files exactly as they are in the repo.
- Before any push, run the tests: `for t in test/*.test.mjs; do node $t; done` (Node 18+). `test/page.test.mjs` and `test/app.test.mjs` need Playwright with Chromium. All of them pass on `main` as of a850b1a.
- **Don't hard-code gimbal directions.** They differ by mount, camera and orientation, and the app calibrates them on each connect.
- If you can't run code (plain ChatGPT chat), write complete files and tell the owner exactly where they go. Codex connected to GitHub can make the changes and open PRs.

---

## 1. What the owner wants

An **app of their own**, running on their **Samsung Galaxy S24 Ultra** (Chrome) and their **Mac** (Chrome), that controls their gimbals and cameras for vlogging and live streaming:

1. Gimbal control: joystick, recenter, and portrait/landscape. ✅
2. **Follow me** (keep the owner in frame), including while live streaming. ✅
3. **Hands-free control** with hand signals and voice, so they don't need to touch the phone. ✅ hand signals; voice is built but **parked**.
4. Saved, repeatable camera moves (slow pan, reveal, timelapse pan). ✅ built
5. A prompter/script overlay. ✅ built
6. A **desk live-stream studio**: two gimbals plus two cameras on the desk. The Mac runs the app and OBS, both gimbals track the owner, and the app switches OBS to the camera they're facing. Built, **not yet tried on hardware**.
7. **Sony camera control** (start/stop recording on the Sony from the app or gestures). Built; **blocked on Bluetooth pairing** (see section 5).
8. Later: real installed apps (an Android APK and a Mac app). For now it's an installable web app (PWA).

## 2. Hardware

| Device | Bluetooth name | Status |
|---|---|---|
| **DJI OM 5** phone gimbal (the notes first called it an OM 4) | `OM5-8055QE` | ✅ fully working: follow, joystick, roll for portrait/landscape |
| **FeiyuTech SCORP-C** camera gimbal | `FY_SCORP_C_31` | ✅ joystick pan/tilt confirmed from our own packets |
| **Sony A7 IV** camera (`ILCE-7M4`) | `ILCE-7M4` | ⚠️ connects, but commands are refused until it's paired (section 5) |
| Samsung Galaxy S24 Ultra | — | runs the app. Its **bottom mic is failing**, so the app picks a working mic automatically |
| MacBook Pro | — | runs the app in Chrome, plus Python BLE test tools |

## 3. Architecture

- **Installable web app (PWA) + Web Bluetooth**, hosted on GitHub Pages. One codebase for Android Chrome and Mac Chrome. Safari and iPhone have no Web Bluetooth.
- Camera vision uses **MediaPipe tasks-vision 1.2.3**, vendored in `vendor/` so it works offline. It provides face detection, pose and hand gestures.
- Studio mode makes the **Mac the director**. The S24 connects over USB as a webcam, and the Sony connects through an HDMI capture stick. The app watches both feeds, steers both gimbals, and switches OBS scenes over the OBS WebSocket v5 (`ws://localhost:4455`).
- Settings are stored in `localStorage`. Recordings are saved to a folder the owner picks (File System Access API) or to Downloads.

### Files

| Path | What it does |
|---|---|
| `index.html`, `app.css`, `src/app.js` | **Gimbal Studio**, the main app. "Rigs" (camera + gimbal + tracker + follow), a dock (Follow, Record, joystick, Recenter, Voice, Prompter, Moves, ⟳ orientation) and sheets (Moves, Prompter, Studio/OBS, Settings) |
| `lab.html`, `src/lab.js`, `styles.css` | **Gimbal Lab**, a diagnostics page: DJI wake-up ladder plus a generic BLE explorer |
| `manifest.webmanifest`, `sw.js`, `icons/` | PWA install and offline cache (network-first app shell) |
| `lib/ble.js`, `lib/explorer.js` | Web Bluetooth helpers and a device explorer |
| `lib/duml.js` | DJI DUML packet framing: crc8 seed 0x77, crc16 seed 0x3692 over the whole packet, a parser and a decoder |
| `lib/om.js` | DJI OM BLE transport: service FFF0, notify FFF4, write FFF5, heartbeats |
| `lib/gimbal.js` | The app-facing gimbal interface (`setVelocity`, `moveBy`, `recenter`, `offset`), with the `DjiOm4` class (works for the OM 5) and a `MODELS` registry |
| `lib/feiyu.js` | `FeiyuScorp` driver, same interface as `DjiOm4` |
| `lib/sony.js` | Sony BLE remote (freemote protocol) |
| `src/follow.js` | Follow-me controller: framing presets, deadzone, delay prediction, hold-still, edge search, walking mode |
| `src/tracker.js` | MediaPipe face/body tracking on a `<video>` |
| `src/calibrate.js` | On connect, nudges each axis and watches the picture to learn the pan/tilt directions. Stored per gimbal + front/back camera |
| `src/gesture.js` | Hand signals: ✋ palm / ☝️ point held about 1 s = record, ✌️ peace = follow on/off, 🔄 twist = portrait/landscape |
| `src/orient.js` | Portrait/landscape: roll the OM 5 clamp, closing the loop on the phone's gravity sensor |
| `src/voice.js` | Voice commands after the wake word "gimbal" (Web Speech API) |
| `src/mic.js` | Finds a microphone input that isn't silent (works around the S24's dead mic) |
| `src/moves.js` | Preset and recorded moves, split into legs within the 25.5 s per-command limit |
| `src/obs.js` | OBS WebSocket v5 client: auth, scene list, switching |
| `src/saver.js` | Saves takes as MP4 (H.264 + AAC) to a chosen folder |
| `src/beep.js` | Audio cues: beeps and the 3-2-1 countdown |
| `src/store.js` | Settings and defaults |
| `test/*.test.mjs`, `test/mock-gimbal.js` | Unit tests plus headless-Chromium tests of the app and the lab |
| `tools/*.py`, `tools/*.mjs` | Mac-side Python BLE tools (bleak): `ble_scan.py`, `om4_test.py`, `scorp_test.py`, `scorp_experiments.py`; btsnoop parsers |

## 4. What was built and proven (2026-11-25 → 26)

**Owner-tested and working on the real phone and gimbal:**
- Gimbal Studio installed on the S24 from the live site.
- **Follow me** is smooth. It holds still when the owner is still, follows up and down, and keeps up with fast moves.
- ✋ **Palm = record start/stop**, with a 3-2-1 countdown and beeps. It saves standard MP4.
- ⟳ **Portrait/landscape** button, and the 🔄 **knob-twist gesture** in both directions.
- **SCORP-C joystick** pan/tilt from our own packets (tested from the Mac).
- **OM 5 speed control** from the Mac: 30°/s for 2 s gave 63.6° of pan.
- Also built that day: auto-reconnect, auto-follow, Speakerphone mic first, a video quality setting, releasing the camera when the app goes to the background, and walking mode.

**Built but not yet tried by the owner:** voice on the phone (parked), saved moves, prompter, OBS studio auto-switching with two rigs, and Sony record.

### Protocol facts learned (all of these cost time to discover)

**DJI OM 5 (DUML over BLE FFF0/FFF4/FFF5)**
- Relative rotate (cmd 04/14) gets **no ack and no movement**. **Speed command 04/0c is acked and moves accurately**, so `DjiOm4` uses `method: 'speed'`.
- Send heartbeats continuously (04/50 and 00/00) and use an incrementing seq with attr 0x40.
- Roll speed (04/0c, roll axis) rotates the phone clamp for portrait/landscape.
- Attitude (04/05) arrives only about once a second, which is too slow for feedback. Pitch wraps at ±180°.
- **Follow tuning that works:** gain 2, delay prediction 0.45 s, hold-still after 0.5 s settled, edge search 60°/s for 2.5 s. **Keep `matchSpeed: 0`**, because speed feed-forward made the real OM 5 swing ±100°/s.
- The OM 5's own buttons (record, M) send nothing to our app. They probably need a handshake that only DJI Mimo sends. Capturing Mimo on the Samsung failed: no btsnoop, and Mimo is packed, so it couldn't be decompiled.
- On macOS the OM 5 stays system-connected and doesn't advertise. The Mac tool retrieves it with `retrieveConnectedPeripheralsWithServices(FFF0)`. On the phone, unpair it in Android Bluetooth settings if Chrome can't see it.

**FeiyuTech SCORP-C (decoded from the official Feiyu SCORP app v1.5.12)**
- Service `FFFF`, write `FF01`, notify `FF02`.
- Packet: `A5 5A 03 <target> <u16 cmdType<<13 | cmdId> <msgId> <u16 len> <data> <u16 crc>`, little endian. The CRC is CRC-16/XMODEM over the bytes from `03` to the end of the data.
- Joystick: PUSH (type 0) to target 0, cmd 14, data `[roll 0/1, pan i16, tilt i16]`, ±450 full scale, sent at 30 Hz, with zeros for 1 s after release.
- Follow mode: SET (type 1) to target 2, cmd 50 (0 lock, 1 pan follow, 2 pan+tilt, 3 three-axis).
- **Avoid use-mode 2 ("restore initial position", target 2, cmd 51).** It kills joystick control until a power cycle, so `recenter()` drives back by offset instead.
- The gimbal streams attitude (cmd 30) at about 10 Hz. The third i16 tracks pan.
- It stops advertising a few minutes after a disconnect, so press its power button before testing.

**Sony A7 IV (`lib/sony.js`)**
- Service `8000FF00-FF00-FFFF-FFFF-FFFFFFFFFFFF`. FF01 = button writes (2 bytes, press then release), FF02 = status notifications.
- Record = press `0x010F`, release `0x010E` (it toggles recording). Status `02 D5 20/00` = recording started/stopped.
- The camera needs: MENU › Network › Bluetooth › Bluetooth Function **On**, **Bluetooth Rmt Ctrl On**, then **Pairing**.

## 5. Where it stopped: Sony pairing (do this next)

- From the Mac (Python/bleak), the camera was found, connected, and its services were listed. FF02 notifications turned on.
- **Writing to FF01 failed with `GATT Protocol Error: Insufficient Encryption`.** The camera only accepts commands over a **bonded (paired)** link, and bleak can't force pairing on macOS.
- The camera sat on its "Pairing / ILCE-7M4 / Cancel" screen, and pairing never completed.

**Next steps, in order:**
1. On the camera, turn Bluetooth Rmt Ctrl on and open the Pairing screen.
2. **Try from the S24 first:** Gimbal Studio › Settings › Sony camera › Connect. Android normally shows its own pairing prompt when it hits an encrypted characteristic. Accept it on the phone and on the camera.
3. If that fails, remove any old "ILCE-7M4" entry from the phone's and the Mac's Bluetooth lists, re-open Pairing on the camera, and retry.
4. On the Mac, try the retry version of `tools/sony_test.py`. It retries the write 8 times, 3 s apart, so macOS can start pairing. Run it from Terminal, because the Claude/ChatGPT app process may not have Bluetooth permission.
5. Once a write works, confirm `0x010F`/`0x010E` toggles recording and the status shows `D5 20` and then `D5 00`.
- In code, if Android needs it, make `lib/sony.js` catch the encryption error, wait, and retry the write a few times (the same idea as the Mac tool).

## 6. Other open items (suggested order)

1. **Sony pairing** (section 5).
2. **Desk studio on the Mac:** two rigs (S24 on the OM 5 over USB webcam, Sony on the SCORP-C over HDMI capture). Check that both follow, then connect OBS (Tools › WebSocket Server Settings, port 4455) and test auto-switching by `facingScore`.
3. **SCORP-C tuning:** confirm the pan/tilt direction and `settings.maxSpeed` (degrees per second at full stick) by eye.
4. **Voice** (parked): `src/mic.js` picks the Speakerphone mic, but recognition from that mic isn't confirmed on the phone yet.
5. **Saved moves and the prompter:** test them with the owner.
6. **Packaging later:** an Android APK must be a **TWA (Trusted Web Activity)**, because Android WebView has no Web Bluetooth, or it needs a native BLE bridge. The Mac app can be a Chrome-installed PWA for now.

## 7. Practical tips

- **Stale app after a deploy:** the offline cache can serve old code. Reload twice, or clear site data for drlivet.github.io.
- Tapping **Connect** while already connected **disconnects**.
- The phone can be reached from the Mac over **Wireless debugging** (adb). It's already paired; find the port with `adb mdns services`. The USB cable didn't show up as a data device.
- Phone remote debugging (to read the app's console): `adb forward tcp:9222 localabstract:chrome_devtools_remote`.
- Feiyu decompile output and the Mac test environments are on the owner's external drive: `/Volumes/Livet Build Storage/Future project builds/gimbal-lab/`.
- **Not yet on GitHub:** the owner's Mac clone (`~/Documents/code/gimbal-lab`) has a local commit `afe5ce1` and `tools/sony_test.py` (retry version) that were never pushed. On the Mac: `cd ~/Documents/code/gimbal-lab && git pull --rebase && git push`.
- Credit **om-research (MIT)** for the DJI OM protocol work, and **freemote** for the Sony protocol.
