import { Readable } from "node:stream";

type Value = Uint8Array | number | Value[] | Map<string, Value>;

export function decode(payload: Uint8Array): Value {
  return decodeValue(payload);
}

function decodeValue(payload: Uint8Array, offset = { value: 0 }) {
  switch (payload[offset.value]) {
    case Markers.Integer:
      return decodeInteger(payload, offset);
    case Markers.LIST:
      return decodeList(payload, offset);
    case Markers.DICT:
      return decodeDictionary(payload, offset);
    default:
      return decodeString(payload, offset);
  }
}

function decodeDictionary(
  payload: Uint8Array,
  offset = { value: 0 }
): Map<string, Value> {
  const result = new Map<string, Value>();
  (result as any).toJSON = mapToJson;

  offset.value++;

  while (true) {
    if (payload[offset.value] == Markers.END) {
      offset.value++;
      break;
    }

    result.set(
      decodeString(payload, offset).toString(),
      decodeValue(payload, offset)
    );
  }

  return result;
}

function decodeList(payload: Uint8Array, offset = { value: 0 }): Value[] {
  // this is only ever invoked when we're at an 'l' marker, so we can skip it
  offset.value++;
  const result: Value[] = [];

  while (true) {
    if (payload[offset.value] == Markers.END) {
      offset.value++;
      break;
    }

    result.push(decodeValue(payload, offset));
  }

  return result;
}

function decodeInteger(payload: Uint8Array, offset = { value: 0 }): number {
  let value = 0;
  let negative = false;

  // this is only ever invoked when we're at an 'i' marker, so we can skip it
  offset.value++;

  if (payload[offset.value] == Markers.MINUS) {
    negative = true;
    offset.value++;
  }

  while (true) {
    const c = payload[offset.value];
    offset.value++;

    if (c >= Markers.ZERO && c <= Markers.NINE) {
      value = value * 10 + c - Markers.ZERO;
      continue;
    }

    if (c == Markers.END) {
      break;
    }

    throwUnexpectedCharacterError(payload, offset.value, "'e' or digit");
  }

  return negative ? -value : value;
}

function decodeString(payload: Uint8Array, offset = { value: 0 }): Uint8Array {
  let size = 0;

  while (true) {
    const c = payload[offset.value];
    offset.value++;
    if (c >= Markers.ZERO && c <= Markers.NINE) {
      size = size * 10 + c - Markers.ZERO;
      continue;
    }

    if (c == Markers.COLON) {
      break;
    }

    throwUnexpectedCharacterError(payload, offset.value, "':'");
  }

  const ret = payload.subarray(offset.value, offset.value + size);
  offset.value += size;

  (ret as any).toJSON = uint8ArrayToJson;
  return ret;
}

// attached as `toJSON` to `Uin8Array` to support JSON serialization
function uint8ArrayToJson() {
  //@ts-ignore
  return this.toString();
}

// attached as `toJSON` to `Map` to support JSON serialization
function mapToJson() {
  //@ts-ignore
  return Object.fromEntries((this as Map<string, unknown>).entries());
}

const Markers = {
  ZERO: "0".charCodeAt(0),
  NINE: "9".charCodeAt(0),
  COLON: ":".charCodeAt(0),
  Integer: "i".charCodeAt(0),
  MINUS: "-".charCodeAt(0),
  LIST: "l".charCodeAt(0),
  DICT: "d".charCodeAt(0),
  END: "e".charCodeAt(0),
} as const;

function throwUnexpectedCharacterError(
  payload: Uint8Array,
  offset: number,
  expected: string
) {
  throw new Error(
    `Unexpected character at ${offset}. Expected ${expected}, got '${String.fromCharCode(
      payload[offset]
    )}' (${payload[offset]}).`
  );
}
