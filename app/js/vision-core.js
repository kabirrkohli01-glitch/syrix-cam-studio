import {
  FaceLandmarker, GestureRecognizer, ImageSegmenter, PoseLandmarker, ObjectDetector,
} from '../vendor/mediapipe/vision_bundle.mjs';

// Model set-up and result handling shared by the vision worker and the
// in-page fallback, so both run exactly the same models with the same options.

const model = (file) => new URL(`../models/${file}`, import.meta.url).href;

export const WASM_BASE = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
export const SEG_WIDTH = 256;
// Object detection describes the scene for Syrix; a few times a second is
// plenty and keeps the frame budget for the trackers that drive effects.
export const OBJECT_INTERVAL = 450;
// Detections below this score are mostly look-alikes (a mug read as a vase,
// a cushion as a dog) and are not passed on.
const OBJECT_MIN_SCORE = 0.5;

export function peopleOptions(kind, n) {
  return kind === 'face' ? { numFaces: n + 1 } : kind === 'hands' ? { numHands: n * 2 } : kind === 'pose' ? { numPoses: n } : null;
}

export async function createTask(fileset, kind, people) {
  const make = (delegate) => {
    if (kind === 'face') {
      return FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model('face_landmarker.task'), delegate },
        runningMode: 'VIDEO',
        numFaces: people + 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    }
    if (kind === 'hands') {
      return GestureRecognizer.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model('gesture_recognizer.task'), delegate },
        runningMode: 'VIDEO',
        numHands: people * 2,
        // A higher detection bar stops faces, sleeves and furniture being
        // read as hands; tracking an already-found hand stays relaxed.
        minHandDetectionConfidence: 0.7,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
    }
    if (kind === 'pose') {
      return PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model('pose_landmarker_lite.task'), delegate },
        runningMode: 'VIDEO',
        numPoses: people,
        minPoseDetectionConfidence: 0.55,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    }
    if (kind === 'objects') {
      return ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: model('efficientdet_lite0.tflite'), delegate },
        runningMode: 'VIDEO',
        maxResults: 10,
        scoreThreshold: 0.42,
      });
    }
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model('selfie_segmenter_landscape.tflite'), delegate },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  };
  try {
    return await make('GPU');
  } catch (err) {
    console.warn(`GPU inference unavailable for "${kind}", falling back to CPU`, err);
    return make('CPU');
  }
}

// Results are copied into plain objects holding only the fields the app
// reads, so they can be posted between threads and never keep MediaPipe
// memory alive.
const cats = (list) => (list || []).map((c) => ({ categoryName: c.categoryName, score: c.score }));
const points = (lm) => lm.map((p) => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));

export function plainFace(r) {
  if (!r) return null;
  return {
    faceLandmarks: (r.faceLandmarks || []).map(points),
    faceBlendshapes: (r.faceBlendshapes || []).map((b) => ({ categories: cats(b.categories) })),
    facialTransformationMatrixes: (r.facialTransformationMatrixes || []).map((m) => ({ rows: m.rows, columns: m.columns, data: Array.from(m.data || []) })),
  };
}

export function plainHands(r) {
  if (!r) return null;
  const handed = r.handedness || r.handednesses || [];
  return {
    landmarks: (r.landmarks || []).map(points),
    handedness: handed.map(cats),
    gestures: (r.gestures || []).map(cats),
  };
}

export function plainPose(r) {
  if (!r) return null;
  return {
    landmarks: (r.landmarks || []).map(points),
    worldLandmarks: (r.worldLandmarks || []).map(points),
  };
}

export function objectList(r, w, h) {
  if (!r || !r.detections) return [];
  return r.detections
    .filter((d) => d.categories[0] && d.categories[0].score >= OBJECT_MIN_SCORE)
    .map((d) => ({
      label: d.categories[0].categoryName,
      score: d.categories[0].score,
      box: { x: d.boundingBox.originX / w, y: d.boundingBox.originY / h, w: d.boundingBox.width / w, h: d.boundingBox.height / h },
    }));
}

// Smooths the person mask over time. Edges move quickly when the person moves
// and settle when they are still, which removes shimmer without making the
// cut-out lag.
export class MaskSmoother {
  constructor() { this.sm = null; }
  reset() { this.sm = null; }
  // Returns a new 8-bit mask; a new array each time so it can be transferred.
  push(data) {
    if (!this.sm || this.sm.length !== data.length) this.sm = new Float32Array(data);
    const sm = this.sm;
    const out = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i++) {
      const d = data[i] - sm[i];
      const k = Math.min(0.9, 0.45 + Math.abs(d) * 0.9);
      const v = sm[i] + d * k;
      sm[i] = v;
      out[i] = v * 255;
    }
    return out;
  }
}

// Reads the person mask out of a segmenter result (single-channel models
// report the person directly; multi-class models list the person class last).
export function personMask(result) {
  const masks = result && result.confidenceMasks;
  if (!masks || !masks.length) return null;
  const m = masks[masks.length - 1];
  return { data: m.getAsFloat32Array(), w: m.width, h: m.height };
}
