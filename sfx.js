// Centralized sound-effect playback.
// Audio is gated by the Autoplay Policy, so the first mute gesture is a fake
// no-op that primes the AudioContext; every real sound then plays on top.
const cache = new Map();

function load(name) {
  if (!cache.has(name)) {
    cache.set(name, new Audio('./sfx/' + name + '.wav'));
  }
  return cache.get(name);
}

export function play(name) {
  try {
    const a = load(name);
    a.currentTime = 0;
    a.play();
  } catch (e) {
    // ignore audio failures (autoplay blocks, missing file, etc.)
  }
}

// For rapid-fire sounds (shooting) clone the node so shots can overlap.
export function playOverlap(name) {
  try {
    const n = load(name).cloneNode();
    n.play();
  } catch (e) {
    // ignore
  }
}

// Call from any first user gesture to satisfy the autoplay gate.
export function unlock() {
  try {
    load('jump').play().catch(() => {});
  } catch (e) { /* noop */ }
}
