"""Mac Bluetooth check for the DJI OM 4: runs the same wake-up ladder as Gimbal Lab
(lib/om.js LADDER) and measures movement from the gimbal's own attitude pushes (04/05).
Run: python tools/om4_test.py LOG"""
import asyncio, sys, time
from bleak import BleakScanner, BleakClient

SVC = "0000fff0-0000-1000-8000-00805f9b34fb"
NOTIFY = "0000fff4-0000-1000-8000-00805f9b34fb"
WRITE = "0000fff5-0000-1000-8000-00805f9b34fb"
LOG = open(sys.argv[1], "a") if len(sys.argv) > 1 else None
def log(*a):
    s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a); print(s, flush=True)
    if LOG: LOG.write(s + "\n"); LOG.flush()

def _t8():
    t = []
    for i in range(256):
        c = i
        for _ in range(8): c = (c >> 1) ^ 0x8C if c & 1 else c >> 1
        t.append(c)
    return t
T8 = _t8()
def crc8(b):
    c = 0x77
    for x in b: c = T8[(x ^ c) & 0xff]
    return c
def crc16(b, c=0x3692):
    for x in b:
        c ^= x
        for _ in range(8): c = (c >> 1) ^ 0x8408 if c & 1 else c >> 1
    return c & 0xffff

def build(cmd_set, cmd, payload=b"", seq=1, attr=0x40, src=0x02, dst=0x04):
    n = 4 + 7 + len(payload) + 2
    hdr = bytes([0x55, n & 0xff, 0x04 | ((n >> 8) & 3)]); hdr += bytes([crc8(hdr)])
    p = hdr + bytes([src, dst, seq & 0xff, (seq >> 8) & 0xff, attr, cmd_set, cmd]) + bytes(payload)
    c = crc16(p); return p + bytes([c & 0xff, c >> 8])
def i16(v): v = max(-32768, min(32767, round(v))) & 0xffff; return bytes([v & 255, v >> 8])
def rot(yaw=0, pitch=0, roll=0, time_s=1, mode=0x04):
    return i16(yaw * 10) + i16(roll * 10) + i16(pitch * 10) + bytes([mode, max(0, min(255, round(time_s * 10)))])

# cross-check against lib/duml.js output
assert build(4, 0x14, rot(25), seq=1, attr=0).hex() == "551504a902040100000414fa0000000000040a964e"
assert build(4, 0x50, b"\x01\x04\x05", seq=7).hex() == "55100456020407004004500104055a3a"
assert build(0, 0, b"\x02\x00", seq=300).hex() == "550f04a202042c014000000200bdad"

class Om4:
    def __init__(self, cl): self.cl = cl; self.seq = 1; self.buf = b""; self.att = None; self.batt = None; self.acks = []; self.hb = set(); self.lock = asyncio.Lock()
    def feed(self, data):
        self.buf += bytes(data)
        while True:
            i = self.buf.find(b"\x55")
            if i < 0: self.buf = b""; return
            self.buf = self.buf[i:]
            if len(self.buf) < 4: return
            if crc8(self.buf[:3]) != self.buf[3]: self.buf = self.buf[1:]; continue
            n = self.buf[1] | ((self.buf[2] & 3) << 8)
            if n < 13: self.buf = self.buf[1:]; continue
            if len(self.buf) < n: return
            raw, self.buf = self.buf[:n], self.buf[n:]
            attr, cs, cmd, p = raw[8], raw[9], raw[10], raw[11:n - 2]
            if cs == 4 and cmd == 5 and len(p) >= 6:
                g = lambda o: int.from_bytes(p[o:o + 2], "little", signed=True) / 10
                self.att = (g(0), g(2), g(4), time.time())
            elif cs == 5 and cmd == 6 and p: self.batt = p[0]
            elif attr & 0x80: self.acks.append((cs, cmd, p.hex()))
    async def send(self, cs, cmd, payload=b"", seq=None, attr=0x40):
        if seq is None: seq = self.seq; self.seq = self.seq % 0xffff + 1
        pkt = build(cs, cmd, payload, seq=seq, attr=attr)
        async with self.lock:
            for k in range(0, len(pkt), 20): await self.cl.write_gatt_char(WRITE, pkt[k:k + 20], response=False)
    async def heartbeat_loop(self):
        while True:
            if "status" in self.hb: await self.send(4, 0x50, b"\x01\x04\x05")
            if "ping" in self.hb: await self.send(0, 0, b"\x02\x00")
            await asyncio.sleep(1)

async def already_connected():
    """A gimbal macOS itself is connected to (e.g. paired as a remote) doesn't advertise.
    Ask CoreBluetooth for connected peripherals with the DJI service instead."""
    from bleak.backends.corebluetooth.CentralManagerDelegate import CentralManagerDelegate
    from bleak.backends.device import BLEDevice
    from CoreBluetooth import CBUUID
    mgr = CentralManagerDelegate(); await mgr.wait_until_ready()
    for svc in ("FFF0", "1812", "180A"):
        peers = mgr.central_manager.retrieveConnectedPeripheralsWithServices_([CBUUID.UUIDWithString_(svc)])
        for p in peers or []:
            name = p.name() or ""
            log(f"  macOS-connected peripheral via {svc}: {name}")
            if name.upper().startswith("OM"):
                return BLEDevice(str(p.identifier().UUIDString()), name, (p, mgr))
    return None

async def main():
    log("Scanning 15 s for OM 4 ...")
    found = await BleakScanner.discover(timeout=15, return_adv=True)
    dev = None
    for d, a in found.values():
        n = d.name or a.local_name or ""
        if n.upper().startswith("OM") or any("fff0" in u for u in a.service_uuids): log("  candidate", n, a.rssi, a.service_uuids[:3]); dev = dev or d
    if not dev:
        # macOS often shows no name until connected: try nearby unnamed devices for the FFF0 service.
        near = sorted([(a.rssi, d) for d, a in found.values() if not (d.name or a.local_name) and (a.rssi or -999) > -70], key=lambda x: -x[0])
        for rssi, d in near[:6]:
            try:
                async with BleakClient(d, timeout=8) as probe:
                    uu = [s.uuid for s in probe.services]
                    log("  probe", d.address[:8], rssi, "name", probe.name if hasattr(probe, "name") else "?", "services", [u[4:8] for u in uu][:6])
                    if SVC in uu: dev = d; break
            except Exception as e:
                log("  probe", d.address[:8], rssi, "failed", type(e).__name__)
    if not dev:
        dev = await already_connected()
    if not dev: log("RESULT: OM 4/5 not found. Is it unfolded and on, and not connected to the phone?"); return
    async with BleakClient(dev, timeout=20) as cl:
        g = Om4(cl); await cl.start_notify(NOTIFY, lambda _, d: g.feed(d)); hbt = asyncio.create_task(g.heartbeat_loop())
        await asyncio.sleep(2)
        log(f"connected to {dev.name}; battery {g.batt}%; attitude {g.att[:3] if g.att else 'none yet'}")
        if len(sys.argv) > 2 and sys.argv[2] == "app":
            # Exactly what the app's speed method does: speed command at 10 Hz, then zero.
            g.hb.update({"status", "ping"}); await asyncio.sleep(1.5)
            for label, yaw, pitch in [("pan right", 30, 0), ("pan left", -30, 0), ("tilt up", 0, 20), ("tilt down", 0, -20)]:
                before = g.att
                t0 = time.time()
                while time.time() - t0 < 2:
                    await g.send(4, 0x0c, rot(yaw=yaw, pitch=pitch, time_s=0, mode=0x80)); await asyncio.sleep(0.1)
                await g.send(4, 0x0c, rot(0, time_s=0, mode=0x80)); await asyncio.sleep(1.2)
                after = g.att
                ch = [round(after[k] - before[k], 1) for k in range(3)] if before and after else None
                log(f"APP {label}: pitch/roll/yaw change {ch}")
            hbt.cancel(); log("RESULT: done"); return
        steps = [
            ("demo", "fixed seq 1, no reply flag", None, lambda d: g.send(4, 0x14, rot(25 * d), seq=1, attr=0)),
            ("mimo-framing", "counting seq + reply flag", None, lambda d: g.send(4, 0x14, rot(25 * d))),
            ("heartbeat", "+ status heartbeat", lambda: g.hb.add("status"), lambda d: g.send(4, 0x14, rot(25 * d))),
            ("ping", "+ ping heartbeat", lambda: g.hb.add("ping"), lambda d: g.send(4, 0x14, rot(25 * d))),
            ("enable", "+ motion control on 04/01", lambda: g.send(4, 0x01, b"\x01"), lambda d: g.send(4, 0x14, rot(25 * d))),
            ("stick", "+ stick control on 04/58", lambda: g.send(4, 0x58, b"\x01"), lambda d: g.send(4, 0x14, rot(25 * d))),
            ("speed", "speed mode 04/0c 30 deg/s 1 s", None, None),
        ]
        for sid, title, prep, run in steps:
            if prep:
                r = prep();
                if asyncio.iscoroutine(r): await r
                await asyncio.sleep(2.5)
            g.acks.clear(); before = g.att
            if sid == "speed":
                await g.send(4, 0x0c, rot(30, time_s=0, mode=0x80)); await asyncio.sleep(1); await g.send(4, 0x0c, rot(0, time_s=0, mode=0x80))
            else:
                await run(+1)
            await asyncio.sleep(2.2); after = g.att
            moved = None
            if before and after and after[3] > before[3]:
                moved = max(abs(after[k] - before[k]) for k in range(3))
            log(f"STEP {sid} ({title}): attitude change {moved if moved is not None else 'no data'} deg; acks {g.acks[:3]}")
            if sid == "speed": await g.send(4, 0x0c, rot(-30, time_s=0, mode=0x80)); await asyncio.sleep(1); await g.send(4, 0x0c, rot(0, time_s=0, mode=0x80))
            else: await run(-1)
            await asyncio.sleep(1.8)
        hbt.cancel()
        log("RESULT: done")

try: asyncio.run(main())
except Exception as e: log("RESULT: crashed:", type(e).__name__, e)
