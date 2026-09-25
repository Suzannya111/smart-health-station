/**
 * Smart Care — AOJ-20A thermometer wire parser.
 *
 * PURE + side-effect free, so the wire contract is unit-testable without any
 * hardware. `ble-thermometer.js` is the only caller.
 *
 * PRESERVED WIRE FORMAT (do not change — blueprint §7):
 *   bytes.length >= 6 && bytes[0] === 0xAA && bytes[2] === 0xC1
 *   celsius = ((bytes[4] << 8) | bytes[5]) / 100.0
 *   accept only 30.0 <= celsius <= 45.0
 *
 * Origin: _source/original-index.html lines 548–551.
 */

/** Default plausibility window — identical to the original constants. */
export const FRAME_MIN_C = 30.0;
export const FRAME_MAX_C = 45.0;

/** Minimum frame length required by the gate. */
export const FRAME_MIN_LENGTH = 6;

/**
 * Coerce the many shapes a BLE notification may arrive in into a Uint8Array view
 * WITHOUT copying or mutating the source.
 * @param {DataView|ArrayBuffer|ArrayBufferView|Uint8Array|number[]} input
 * @returns {Uint8Array|null}
 */
function toBytes(input) {
  if (!input) return null;
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    // DataView (has .buffer byteOffset byteLength) or any TypedArray
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  return null;
}

/**
 * Parse an AOJ-20A notification frame.
 *
 * @param {DataView|ArrayBuffer|ArrayBufferView|Uint8Array|number[]} dataViewOrBuffer
 * @param {{ minC?: number, maxC?: number }} [options] plausibility window
 *        (normally fed from config.ble.minValidTempC / maxValidTempC)
 * @returns {{ celsius: number, raw: number[] } | null}
 *          `null` when the frame is too short, fails the header gate, or the
 *          decoded value falls outside the plausibility window.
 */
export function parseThermometerFrame(dataViewOrBuffer, { minC = FRAME_MIN_C, maxC = FRAME_MAX_C } = {}) {
  const bytes = toBytes(dataViewOrBuffer);
  if (!bytes) return null;

  // PRESERVED GATE — byte-exact:
  if (bytes.length >= FRAME_MIN_LENGTH && bytes[0] === 0xAA && bytes[2] === 0xC1) {
    // PRESERVED DECODE — byte-exact:
    const celsius = ((bytes[4] << 8) | bytes[5]) / 100.0;

    // Plausibility window (bounds come from config, default 30.0–45.0).
    if (celsius >= minC && celsius <= maxC) {
      return { celsius, raw: Array.from(bytes) };
    }
  }

  return null;
}

/**
 * Convenience predicate mirroring the gate (useful for logging/diagnostics).
 * @param {DataView|ArrayBuffer|ArrayBufferView|Uint8Array|number[]} input
 */
export function isThermometerFrame(input) {
  const bytes = toBytes(input);
  if (!bytes) return false;
  return bytes.length >= FRAME_MIN_LENGTH && bytes[0] === 0xAA && bytes[2] === 0xC1;
}

export default parseThermometerFrame;
