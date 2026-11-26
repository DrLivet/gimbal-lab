// Works out which way the gimbal really turns, by watching the camera.
// Every gimbal/phone mount differs (the owner's OM 5 tilts the opposite way to the SCORP-C),
// so after connecting we nudge each axis a little and see which way the picture slides.
// Pure helpers (profiles, bestShift, decide) are unit-tested in test/calibrate.test.mjs.

// Column and row brightness sums of an RGBA image: a cheap 1-D fingerprint per axis.
export function profiles(data, W, H) {
  const col = new Float64Array(W); const row = new Float64Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; const l = data[i] + data[i + 1] + data[i + 2];
      col[x] += l; row[y] += l;
    }
  }
  const norm = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map((v) => v - m); };
  return { col: norm(col), row: norm(row) };
}

// How far (in samples) the content of `a` moved to land in `b`. +: moved right/down.
// Returns { shift, contrast } — contrast is how distinct the best match is (0 = flat wall).
export function bestShift(a, b, max) {
  const n = a.length; const errs = [];
  let best = 0; let bestE = Infinity;
  for (let s = -max; s <= max; s++) {
    let e = 0; let k = 0;
    for (let i = Math.max(0, -s); i < Math.min(n, n - s); i++) { const d = a[i] - b[i + s]; e += d * d; k++; }
    e /= k; errs.push(e);
    if (e < bestE) { bestE = e; best = s; }
  }
  const mean = errs.reduce((x, y) => x + y, 0) / errs.length;
  return { shift: best, contrast: mean > 0 ? 1 - bestE / mean : 0 };
}

// Turning the camera right slides the picture left; tilting it up slides the picture down.
// `shift` was measured after commanding `dir` (+1/-1) on that axis.
// Returns 'ok' (gimbal already turns the way we think), 'flip', or null (couldn't tell).
export function decide(axis, dir, { shift, contrast }, minShift = 3) {
  if (Math.abs(shift) < minShift || contrast < 0.2) return null;
  const expected = axis === 'pan' ? -dir : dir;
  return Math.sign(shift) === expected ? 'ok' : 'flip';
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// rig: { video, setVelocity(pan, tilt) } (velocity in the same frame the follow logic uses).
// Returns { pan: 'ok'|'flip'|null, tilt: ... }. Leaves the gimbal where it started.
export async function calibrate(rig, { speed = 20, ms = 600 } = {}) {
  const v = rig.video; const W = 96; const H = Math.max(16, Math.round((96 * v.videoHeight) / (v.videoWidth || 1)));
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = c.getContext('2d', { willReadFrequently: true });
  const grab = () => { g.drawImage(v, 0, 0, W, H); return profiles(g.getImageData(0, 0, W, H).data, W, H); };
  const nudge = async (p, t) => {
    const A = grab(); rig.setVelocity(p, t); await wait(ms); rig.setVelocity(0, 0); await wait(450);
    const B = grab(); rig.setVelocity(-p, -t); await wait(ms); rig.setVelocity(0, 0); await wait(350);
    return p ? bestShift(A.col, B.col, Math.round(W / 3)) : bestShift(A.row, B.row, Math.round(H / 3));
  };
  const out = {};
  for (const axis of ['pan', 'tilt']) {
    out[axis] = null;
    for (const dir of [1, -1]) {   // the other way too, in case it's against an end stop
      const r = await nudge(axis === 'pan' ? speed * dir : 0, axis === 'tilt' ? speed * dir : 0);
      out[axis] = decide(axis, dir, r);
      if (out[axis]) break;
    }
  }
  return out;
}
