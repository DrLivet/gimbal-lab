"""Mac Bluetooth check for the Feiyu SCORP-C (same packets as lib/feiyu.js).
Run: python tools/scorp_test.py [log-file]   Needs: pip install bleak
Moves: slow pan right ~1.5 s, stop, slow pan left ~1.5 s, stop, recenter."""
import asyncio, sys, time
from bleak import BleakScanner, BleakClient

SVC = "0000ffff-0000-1000-8000-00805f9b34fb"
WR = "0000ff01-0000-1000-8000-00805f9b34fb"
NT = "0000ff02-0000-1000-8000-00805f9b34fb"
LOG = open(sys.argv[1], "a") if __name__ == "__main__" and len(sys.argv) > 1 else None

def log(*a):
    s = time.strftime("%H:%M:%S ") + " ".join(str(x) for x in a)
    print(s, flush=True)
    if LOG: LOG.write(s + "\n"); LOG.flush()

def crc(b):
    c = 0
    for x in b:
        c ^= x << 8
        for _ in range(8): c = ((c << 1) ^ 0x1021) & 0xFFFF if c & 0x8000 else (c << 1) & 0xFFFF
    return c

def pkt(target, ctype, cmd, data=b""):
    w = (ctype << 13) | cmd
    body = bytes([0x03, target, w & 255, w >> 8, 0, len(data) & 255, len(data) >> 8]) + bytes(data)
    c = crc(body)
    return bytes([0xA5, 0x5A]) + body + bytes([c & 255, c >> 8])

def i16(v): v &= 0xFFFF; return bytes([v & 255, v >> 8])
def joy(pan, tilt): return pkt(0, 0, 14, b"\x00" + i16(pan) + i16(tilt))
RECENTER = pkt(2, 1, 51, b"\x02")
WITH_RESP = True

async def hold(cl, pan, tilt, secs):
    end = time.time() + secs
    while time.time() < end:
        await cl.write_gatt_char(WR, joy(pan, tilt), response=WITH_RESP)
        await asyncio.sleep(1 / 30)

async def main():
    assert joy(450, 0).hex() == "a55a03000e0000050000c2010000302c"
    log("Scanning 15 s ...")
    found = await BleakScanner.discover(timeout=15, return_adv=True)
    for d, a in sorted(found.values(), key=lambda x: -(x[1].rssi or -999)):
        n = d.name or a.local_name
        if n: log(f"  seen {a.rssi:>4} {n}")
    dev = next((d for d, a in found.values() if (d.name or a.local_name or "").startswith("FY_SCORP")), None)
    if not dev:
        log("RESULT: SCORP-C not found. Is it on, and is the Feiyu app closed?"); return
    for attempt in range(1, 4):
        try:
            log(f"Connecting to {dev.name} (try {attempt})")
            await run(dev); return
        except Exception as e:
            log("  connect/run error:", type(e).__name__, e)
            await asyncio.sleep(3)
    log("RESULT: could not connect after 3 tries.")

async def run(dev):
    async with BleakClient(dev, timeout=20) as cl:
        rx = []
        def on(_, data): rx.append(bytes(data)); log("  <-", bytes(data).hex())
        global WITH_RESP
        props = cl.services.get_characteristic(WR).properties
        WITH_RESP = "write" in props
        log("FF01 properties:", props, "-> write with response" if WITH_RESP else "-> write without response")
        await cl.start_notify(NT, on)
        await asyncio.sleep(1)
        sp = int(sys.argv[2]) if len(sys.argv) > 2 else 120
        for label, pan, tilt in [("Pan right", sp, 0), ("Pan left", -sp, 0), ("Tilt up", 0, sp), ("Tilt down", 0, -sp)]:
            log(f"{label} (speed {sp})"); await hold(cl, pan, tilt, 3.0)
            log("Stop");                  await hold(cl, 0, 0, 2.0)
        # Recenter (use mode 2) left out: it appears to stop joystick control until power-cycle.
        log(f"RESULT: commands sent; {len(rx)} notifications received from the gimbal.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        log("RESULT: crashed:", type(e).__name__, e)
