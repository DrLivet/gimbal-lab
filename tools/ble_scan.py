"""Lists nearby BLE devices for N seconds (default 30). Run: python tools/ble_scan.py LOG [seconds]"""
import asyncio, sys, time
from bleak import BleakScanner
LOG = open(sys.argv[1], "a"); secs = float(sys.argv[2]) if len(sys.argv) > 2 else 30
def log(s): s = time.strftime("%H:%M:%S ") + s; print(s, flush=True); LOG.write(s + "\n"); LOG.flush()
async def main():
    found = await BleakScanner.discover(timeout=secs, return_adv=True)
    for d, a in sorted(found.values(), key=lambda x: -(x[1].rssi or -999)):
        log(f"{a.rssi:>4} {d.name or a.local_name or '-':32} {d.address} svc={[u[4:8] for u in a.service_uuids]} mfr={ {k: v.hex()[:16] for k, v in a.manufacturer_data.items()} }")
    log("RESULT: scan done")
asyncio.run(main())
