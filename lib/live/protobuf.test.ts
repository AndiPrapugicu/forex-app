/**
 * The websocket decoder.
 *
 * This parses an UNDOCUMENTED format off a third-party socket, so the fixtures
 * below are real frames captured from `streamer.finance.yahoo.com` with their
 * expected values checked against the REST quote for the same instrument at the
 * same moment. That is the only thing that makes the field numbers below
 * trustworthy — there is no schema to check them against.
 *
 * The failure mode this guards is not a crash. Every field here decodes to a
 * plausible-looking number under the wrong reading: a 32-bit shift silently
 * truncates the timestamp, and skipping the zigzag step doubles it into a
 * perfectly well-formed date in the year 2083. Both would surface as "every
 * quote is stale" rather than as an error.
 */

import { describe, expect, it } from 'vitest';
import { asFloat, asString, asZigZag, decodeFields } from '@/lib/live/protobuf';

function frame(base64: string) {
  return decodeFields(Uint8Array.from(Buffer.from(base64, 'base64')));
}

/** EURUSD=X, captured 2026-08-13T12:03:09Z. REST said 1.1532 at the time. */
const EURUSD = 'CghFVVJVU0Q9WBVanpM/GJDhibD/ZyoDQ0NZMA44AUV3Mb49ZQBAjDrYAQg=';
/** JPY=X — the stream's name for USDJPY. A broker feed showed 159.335. */
const USDJPY = 'CgVKUFk9WBXhWh9DGODwibD/ZyoDQ0NZMA44AUWSEgO9ZQDwUL3YAQg=';
/** BTC-USD. Carries far more fields, including ones we never read. */
const BTCUSD =
  'CgdCVEMtVVNEFY+fd0cYkOGJsP9nIgNVU0QqA0NDQzApOAFFKtaGv0iAwKTOngFVjpF5R11ab3dHZYC4KMR9ZLJ3R7ABgMCkzp4B2AEE4AGAwKTOngHoAYDApM6eAfIBA0JUQ4ECAAAAAM4jc0GJAgAAhn83g3JC';

describe('decodeFields', () => {
  it('reads the ticker, the price and the stamp off a real FX frame', () => {
    const f = frame(EURUSD);

    expect(asString(f.get(1))).toBe('EURUSD=X');
    expect(asFloat(f.get(2))).toBeCloseTo(1.15327, 5);
    expect(asZigZag(f.get(3))).toBe(1786622589000);
  });

  /**
   * The timestamp is the field most likely to be read wrong and least likely to
   * look wrong, so it is pinned as a date rather than as a number.
   */
  it('decodes the stamp to a real moment, not to the year 2083', () => {
    const ms = asZigZag(frame(EURUSD).get(3))!;

    expect(new Date(ms).toISOString()).toBe('2026-08-13T12:03:09.000Z');
    // The zigzag bug doubles it. Naming the wrong answer keeps the test honest
    // about what it is defending against.
    expect(new Date(ms * 2).getUTCFullYear()).toBe(2083);
  });

  it('reads the USD-base pair under the name the stream actually uses', () => {
    const f = frame(USDJPY);

    // Not USDJPY=X — that ticker exists, is accepted, and never sends a frame.
    expect(asString(f.get(1))).toBe('JPY=X');
    // The quotation itself, not its reciprocal: ~159, not ~0.0063.
    expect(asFloat(f.get(2))).toBeCloseTo(159.355, 2);
  });

  it('walks past fields it does not understand to reach ones it does', () => {
    const f = frame(BTCUSD);

    // This frame carries 20 fields including several we never read; the ones we
    // do read sit after them.
    expect(asString(f.get(1))).toBe('BTC-USD');
    expect(asFloat(f.get(2))).toBeCloseTo(63391.56, 1);
    expect(asString(f.get(4))).toBe('USD');
    expect(f.size).toBeGreaterThan(15);
  });

  /**
   * A torn frame must cost one tick, not the page. Every truncation of a real
   * frame has to return something rather than throw.
   */
  it('returns what it could read from a truncated frame instead of throwing', () => {
    const full = Uint8Array.from(Buffer.from(EURUSD, 'base64'));

    for (let cut = 1; cut < full.length; cut++) {
      expect(() => decodeFields(full.subarray(0, cut))).not.toThrow();
    }

    // The ticker and price sit early enough to survive a mid-message cut.
    expect(asString(decodeFields(full.subarray(0, 14)).get(1))).toBe('EURUSD=X');
  });

  it('is empty rather than undefined for an empty frame', () => {
    expect(decodeFields(new Uint8Array(0)).size).toBe(0);
  });

  it('returns null from the accessors when the field is the wrong wire type', () => {
    const f = frame(EURUSD);

    // Field 1 is a string, field 2 a float, field 3 a varint.
    expect(asFloat(f.get(1))).toBeNull();
    expect(asZigZag(f.get(2))).toBeNull();
    expect(asString(f.get(3))).toBeNull();
    expect(asFloat(f.get(999))).toBeNull();
  });

  /**
   * Varints past the fourth group are where a 32-bit shift wraps. A millisecond
   * timestamp is six groups long, so this is not a theoretical concern.
   */
  it('reads a varint wider than 32 bits without wrapping', () => {
    // Field 3, varint, encoding 2^40 exactly.
    const value = 2 ** 40;
    const bytes = [0x18];
    let n = value;
    do {
      const byte = n % 128;
      n = Math.floor(n / 128);
      bytes.push(n > 0 ? byte | 0x80 : byte);
    } while (n > 0);

    const f = decodeFields(Uint8Array.from(bytes));
    expect(f.get(3)).toEqual({ kind: 'varint', value });
  });
});

describe('asZigZag', () => {
  it('maps the encoding back to signed values', () => {
    const z = (value: number) => asZigZag({ kind: 'varint', value });

    expect(z(0)).toBe(0);
    expect(z(1)).toBe(-1);
    expect(z(2)).toBe(1);
    expect(z(3)).toBe(-2);
    expect(z(4294967294)).toBe(2147483647);
  });
});
