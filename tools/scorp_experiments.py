"""Tries joystick with different 'preparation' messages and measures movement from the
gimbal's own position reports (cmd 30). Run: python tools/scorp_experiments.py LOG"""
import asyncio, sys, time
from bleak import BleakScanner, BleakClient
sys.path.insert(0, __file__.rsplit('/', 1)[0])
from scorp_test import pkt, joy, WR, NT, crc

LOG = open(sys.argv[1], "a")
def log(*a):
    s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a); print(s, flush=True); LOG.write(s + "\n"); LOG.flush()

APP_STATUS = pkt(4, 0, 114, bytes([1, 0, 4, 0]))
HEARTBEAT0 = pkt(0, 0, 153)
HEARTBEAT4 = pkt(4, 0, 153)
WAKE = pkt(2, 1, 51, b"\x03")

class Rx:
    def __init__(self): self.buf = b""; self.angles = []; self.other = []
    def feed(self, data):
        self.buf += bytes(data)
        while True:
            i = self.buf.find(b"\xa5\x5a")
            if i < 0: self.buf = self.buf[-1:]; return
            self.buf = self.buf[i:]
            if len(self.buf) < 11: return
            n = self.buf[7] | (self.buf[8] << 8)
            if len(self.buf) < n + 11: return
            p, self.buf = self.buf[:n + 11], self.buf[n + 11:]
            w = p[4] | (p[5] << 8); cmd = w & 0x1fff; d = p[9:9 + n]
            if cmd == 30 and n >= 7:
                self.angles.append(tuple(int.from_bytes(d[k:k + 2], "little", signed=True) for k in (1, 3, 5)))
            elif cmd not in (73,):
                self.other.append((cmd, w >> 13, d.hex()))

async def trial(cl, rx, name, prep, extra_every=None, pan=450, tilt=0, secs=3):
    if prep:
        for b in prep: await cl.write_gatt_char(WR, b, response=False); await asyncio.sleep(0.1)
        await asyncio.sleep(0.5)
    rx.angles.clear(); rx.other.clear()
    await asyncio.sleep(0.6); before = rx.angles[-1] if rx.angles else None
    t0 = time.time(); last_extra = 0
    while time.time() - t0 < secs:
        if extra_every and time.time() - last_extra > 1:
            for b in extra_every: await cl.write_gatt_char(WR, b, response=False)
            last_extra = time.time()
        await cl.write_gatt_char(WR, joy(pan, tilt), response=False)
        await asyncio.sleep(1 / 30)
    for _ in range(30): await cl.write_gatt_char(WR, joy(0, 0), response=False); await asyncio.sleep(1 / 30)
    await asyncio.sleep(0.5); after = rx.angles[-1] if rx.angles else None
    span = [max(a[k] for a in rx.angles) - min(a[k] for a in rx.angles) for k in range(3)] if rx.angles else None
    log(f"TRIAL {name}: before={before} after={after} span={span} other={rx.other[:4]}")

async def main():
    found = await BleakScanner.discover(timeout=12, return_adv=True)
    dev = next((d for d, a in found.values() if (d.name or a.local_name or "").startswith("FY_SCORP")), None)
    if not dev: log("RESULT: SCORP-C not found"); return
    async with BleakClient(dev, timeout=20) as cl:
        rx = Rx(); await cl.start_notify(NT, lambda _, d: rx.feed(d)); await asyncio.sleep(1.5)
        log("connected; first angles", rx.angles[-1] if rx.angles else None)
        # Never sends use-mode 2 ("restore initial position"): evidence suggests it stops joystick until power-cycle.
        await trial(cl, rx, "A pan right, joystick only", None)
        await trial(cl, rx, "A2 pan left, joystick only", None, pan=-450)
        await trial(cl, rx, "A3 tilt up, joystick only", None, pan=0, tilt=450)
        await trial(cl, rx, "A4 tilt down, joystick only", None, pan=0, tilt=-450)
        await trial(cl, rx, "D wake (use mode 3) then pan right", [WAKE], None)
        await trial(cl, rx, "D2 pan left", None, pan=-450)
        await trial(cl, rx, "C heartbeat + pan right", [HEARTBEAT0, HEARTBEAT4], [HEARTBEAT0, HEARTBEAT4])
        await trial(cl, rx, "C2 heartbeat + pan left", None, [HEARTBEAT0, HEARTBEAT4], pan=-450)
        log("RESULT: done")

try: asyncio.run(main())
except Exception as e: log("RESULT: crashed:", type(e).__name__, e)
