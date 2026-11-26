# gimbal-lab

Our own software for controlling phone/camera gimbals over Bluetooth, starting with:

- **DJI OM 4** (holds the S24)
- **FeiyuTech SCORP-C** (`FY_SCORP_C_31`, holds a camera)

The end goal is a desk live-stream studio: both gimbals keep you in frame, voice control, and auto camera switching, driven from a Mac running OBS.

## Stage 1: Gimbal Lab test page (this repo today)

A single web page, served by GitHub Pages, that talks to the gimbals with Chrome's Web Bluetooth.

**DJI OM 4 tab**
1. **Connect**: shows whether the gimbal is talking back, its battery, and its live position.
2. **Find the wake-up**: the OM 4 accepted our commands but didn't move. This test tries, one step at a time, the extra messages DJI Mimo sends (heartbeats, "motion control on", and so on), turns the gimbal 25° and back after each step, and reports the first step that makes it move.
3. **Drive it**: hold-to-move arrows and a sweep, plus a raw-command box for experiments.

**Explore (SCORP-C) tab**
Connects to any Bluetooth device, lists every service it exposes, listens to everything it sends, and can write raw bytes. We use this to learn the SCORP-C, whose protocol hasn't been published.

**Log**: *Copy log* puts everything on the clipboard to paste to Claude.

### Using it
- Open the GitHub Pages address in **Chrome** (Android or Mac). Safari and iPhone don't support Web Bluetooth.
- Fully close DJI Mimo or the Feiyu app first. A gimbal only talks to one app at a time.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | the page |
| `duml.js` | DJI "DUML" packet builder/parser (framing, CRCs, decoding) |
| `om.js` | OM 4 driver and the wake-up test ladder |
| `ble.js` | Web Bluetooth helpers |
| `explorer.js` | generic Bluetooth explorer |
| `test/` | `node test/duml.test.mjs` checks the packet code against real captured packets; `node test/page.test.mjs` drives the page in headless Chrome against a simulated gimbal (needs Playwright) |

## Credits

The OM-series protocol notes come from the MIT-licensed [alkersan/om-research](https://github.com/alkersan/om-research) and the discussion in its issues and PRs. This is experimental. Use at your own risk, and consider declining gimbal firmware updates once things work.
