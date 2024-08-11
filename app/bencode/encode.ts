type Value =
  | string
  | Uint8Array
  | number
  | Value[]
  | Map<string, Value>
  | { [key: string]: unknown };

export function encode(value: Value): Uint8Array {
  const w = new Writer();
  w.write(value);

  return w.toUint8Array();
}

class Writer {
  private buffer = Buffer.alloc(64);
  private size = 0;

  write(value: Value): void {
    if (value instanceof Buffer) {
      this.writeString(value.length.toString());
      this.writeString(":");
      this.writeUint8Array(value);
      return;
    }

    if (value instanceof Uint8Array) {
      return this.write(Buffer.from(value));
    }

    if (value instanceof Map) {
      this.writeString("d");
      for (const [k, v] of value.entries()) {
        if (typeof v == "function") {
          continue;
        }

        this.writeString(k.length.toString());
        this.writeString(":");
        this.writeString(k);

        this.write(v);
      }
      this.writeString("e");
      return;
    }

    if (Array.isArray(value)) {
      this.writeString("l");
      for (const item of value) {
        this.write(item);
      }
      this.writeString("e");

      return;
    }

    switch (typeof value) {
      case "string": {
        this.write(Buffer.from(value, "utf8"));
        return;
      }
      case "number": {
        this.writeString("i");
        this.writeString(value.toString());
        this.writeString("e");

        return;
      }
      case "object": {
        this.writeString("d");
        for (const [k, v] of Object.entries(value).filter(
          ([_, val]) => typeof val != "function"
        )) {
          this.writeString(k.length.toString());
          this.writeString(":");
          this.writeString(k);

          this.write(v as Value);
        }
        this.writeString("e");

        return;
      }
    }
  }

  toUint8Array() {
    return this.buffer.subarray(0, this.size);
  }

  private writeUint8Array(value: Buffer) {
    this.ensureFree(value.length);

    value.copy(this.buffer, this.size);
    this.size += value.length;
  }

  private writeString(value: string) {
    this.ensureFree(value.length);
    this.buffer.write(value, this.size, "ascii");
    this.size += value.length;
  }

  private ensureFree(extraSize: number) {
    if (this.buffer.length < this.size + extraSize) {
      this.buffer = Buffer.concat([
        this.toUint8Array(),
        Buffer.alloc(Math.max(extraSize, 64)),
      ]);
    }
  }
}
