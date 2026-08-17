/**
 * Just enough protobuf to read one message off a websocket.
 *
 * WHY NOT A LIBRARY. `protobufjs` is ~250KB and, more to the point, it wants a
 * `.proto` schema — and the schema this decodes is not published. Yahoo's
 * streamer is undocumented; the field numbers below were read off live frames,
 * not off a spec, and a schema-driven parser would give a false impression that
 * they are guaranteed. What we need is three fields out of a flat message, and
 * the wire format is small enough to read directly.
 *
 * THE WIRE FORMAT IS SELF-DESCRIBING, WHICH IS THE WHOLE REASON THIS IS SAFE.
 * Every field is a varint tag carrying `(fieldNumber << 3) | wireType`, so an
 * unknown field can be measured and skipped without knowing what it means. That
 * is the property that lets this survive Yahoo adding fields — and they will,
 * without telling anyone.
 *
 * Nothing here throws on malformed input. A truncated or corrupt frame returns
 * what it managed to read, and the caller drops the tick if the fields it needs
 * are missing. A trading screen must not blank out because one frame arrived
 * torn.
 */

export type WireValue =
  | { kind: 'varint'; value: number }
  | { kind: 'fixed64'; bytes: Uint8Array }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'fixed32'; bytes: Uint8Array };

/**
 * Reads a base-128 varint. Returns the value and the offset just past it.
 *
 * PLAIN NUMBERS, NOT BIGINT, AND ACCUMULATED BY MULTIPLICATION. JavaScript's
 * bitwise operators are 32-bit, so the obvious `value |= byte << shift` silently
 * wraps on the fifth group — which is exactly where a millisecond timestamp
 * lives. Multiplying by a power of two is the same arithmetic without the
 * truncation.
 *
 * The precision ceiling is 2^53, past which this loses low bits. That is not
 * reachable by anything Yahoo sends — their largest field is a millisecond
 * stamp, which stays under 2^53 until the year 285,000 — but a caller reading
 * some future 64-bit id field should know the limit is here.
 */
function readVarint(buf: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0;
  let scale = 1;
  let i = at;

  // Ten groups is the maximum a 64-bit varint can occupy; more than that is a
  // corrupt frame, not a very large number.
  for (let n = 0; n < 10 && i < buf.length; n++, i++) {
    const byte = buf[i];
    value += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) return { value, next: i + 1 };
    scale *= 128;
  }

  return null;
}

/**
 * Splits a message into its fields.
 *
 * LAST FIELD WINS on a repeat. Protobuf's own rule for scalars, and it is the
 * right one here for a different reason too: if a frame ever carried two prices,
 * the later one is the more recent.
 */
export function decodeFields(buf: Uint8Array): Map<number, WireValue> {
  const out = new Map<number, WireValue>();
  let i = 0;

  while (i < buf.length) {
    const tag = readVarint(buf, i);
    if (!tag) break;
    i = tag.next;

    const field = Math.floor(tag.value / 8);
    const wire = tag.value % 8;

    if (wire === 0) {
      const v = readVarint(buf, i);
      if (!v) break;
      out.set(field, { kind: 'varint', value: v.value });
      i = v.next;
    } else if (wire === 5) {
      if (i + 4 > buf.length) break;
      out.set(field, { kind: 'fixed32', bytes: buf.subarray(i, i + 4) });
      i += 4;
    } else if (wire === 1) {
      if (i + 8 > buf.length) break;
      out.set(field, { kind: 'fixed64', bytes: buf.subarray(i, i + 8) });
      i += 8;
    } else if (wire === 2) {
      const len = readVarint(buf, i);
      if (!len) break;
      const start = len.next;
      const end = start + Number(len.value);
      if (end > buf.length) break;
      out.set(field, { kind: 'bytes', bytes: buf.subarray(start, end) });
      i = end;
    } else {
      // Groups (3 and 4) are deprecated and Yahoo does not send them. Without
      // a length there is no way to skip one, so stop rather than guess and
      // misread every field after it.
      break;
    }
  }

  return out;
}

export function asFloat(v: WireValue | undefined): number | null {
  if (v?.kind !== 'fixed32') return null;
  const view = new DataView(v.bytes.buffer, v.bytes.byteOffset, 4);
  const n = view.getFloat32(0, true);
  return Number.isFinite(n) ? n : null;
}

export function asString(v: WireValue | undefined): string | null {
  if (v?.kind !== 'bytes') return null;
  return new TextDecoder().decode(v.bytes);
}

/**
 * Undoes zigzag encoding, which protobuf uses for `sint` fields so that small
 * negative numbers stay small on the wire.
 *
 * NOT OPTIONAL FOR YAHOO'S TIMESTAMP, and getting it wrong is not obvious:
 * their `time` is declared `sint64`, so a plain varint read returns exactly
 * double the real value — which is still a plausible-looking millisecond
 * timestamp, just in the year 2083. It would sail past any "is this a number"
 * check and surface as every quote being decades stale.
 */
export function asZigZag(v: WireValue | undefined): number | null {
  if (v?.kind !== 'varint') return null;
  const n = v.value;
  // The bitwise form of this, `(n >>> 1) ^ -(n & 1)`, is 32-bit and would
  // mangle any timestamp. Arithmetic says the same thing at full width.
  return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
}
