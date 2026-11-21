// Point d'entrée empaqueté par tools/build-vendor.mjs → window.BasicPitchLib
import * as tf from '@tensorflow/tfjs';
import { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } from '@spotify/basic-pitch';

// charge le modèle depuis la mémoire (window.BASIC_PITCH_MODEL) : pas de fetch de fichiers
function loadModel() {
  const m = window.BASIC_PITCH_MODEL;
  if (!m) return Promise.reject(new Error('Modèle Basic Pitch absent'));
  const bin = atob(m.weights);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const weightSpecs = m.topology.weightsManifest.flatMap((g) => g.weights);
  return tf.loadGraphModel(tf.io.fromMemory({
    modelTopology: m.topology.modelTopology,
    weightSpecs,
    weightData: buf.buffer,
    format: m.topology.format,
    generatedBy: m.topology.generatedBy,
    convertedBy: m.topology.convertedBy,
    signature: m.topology.signature,
    userDefinedMetadata: m.topology.userDefinedMetadata,
  }));
}

window.BasicPitchLib = { tf, BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime, loadModel };
