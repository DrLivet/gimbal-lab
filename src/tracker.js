// Person detection on a <video>, using MediaPipe (vendored in /vendor so it works offline).
// mode 'face' (fast, best at a desk) or 'body' (keeps following when you turn away or walk).
// Returns candidates [{x, y, w, h, score, facing}] in 0..1 coordinates of the raw camera frame.
import { facingScore } from './follow.js';

const BASE = new URL('../vendor/', import.meta.url).href;
let visionPromise = null;

async function vision() {
  visionPromise ??= (async () => {
    const mp = await import(`${BASE}mediapipe/vision_bundle.mjs`);
    const files = await mp.FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    return { mp, files };
  })();
  return visionPromise;
}

export class Tracker {
  constructor(mode = 'face') { this.mode = mode; this.task = null; this.lastTs = 0; }

  async load() {
    const { mp, files } = await vision();
    const make = async (delegate) => {
      if (this.mode === 'body') {
        return mp.PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: `${BASE}models/pose_landmarker_lite.task`, delegate },
          runningMode: 'VIDEO', numPoses: 3,
        });
      }
      return mp.FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: `${BASE}models/blaze_face_short_range.tflite`, delegate },
        runningMode: 'VIDEO', minDetectionConfidence: 0.5,
      });
    };
    try { this.task = await make('GPU'); } catch { this.task = await make('CPU'); }
    return this;
  }

  close() { try { this.task?.close(); } catch { /* ignore */ } this.task = null; }

  detect(video) {
    if (!this.task || video.readyState < 2 || !video.videoWidth) return [];
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const W = video.videoWidth; const H = video.videoHeight;
    if (this.mode === 'body') {
      const r = this.task.detectForVideo(video, ts);
      return (r.landmarks || []).map((lm) => {
        // Head from nose/eyes/ears (0..8); fall back to shoulders when the face is hidden.
        const head = lm.slice(0, 9).filter((p) => (p.visibility ?? 1) > 0.5);
        const pts = head.length >= 2 ? head : [lm[11], lm[12]];
        const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
        const w = Math.max(0.06, Math.max(...xs) - Math.min(...xs));
        const x = (Math.max(...xs) + Math.min(...xs)) / 2;
        const y = (Math.max(...ys) + Math.min(...ys)) / 2 + (head.length >= 2 ? 0 : -w);
        const facing = head.length >= 5 ? facingScore([lm[5], lm[2], lm[0]]) : 0.1;
        return { x, y, w, h: w, score: 1, facing };
      });
    }
    const r = this.task.detectForVideo(video, ts);
    return (r.detections || []).map((d) => {
      const b = d.boundingBox;
      return {
        x: (b.originX + b.width / 2) / W, y: (b.originY + b.height / 2) / H,
        w: b.width / W, h: b.height / H,
        score: d.categories?.[0]?.score ?? 1,
        facing: facingScore(d.keypoints),
      };
    });
  }
}
