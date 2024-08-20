import exp from "constants";
import { promises, WriteStream } from "fs";
import { createConnection, Socket } from "net";
import { EventEmitter } from "stream";

export class BitTorrentClient extends EventEmitter<
  Record<MessageType, [Buffer]> & {
    message: [Buffer];
    error: [Error];
    close: [];
  }
> {
  static async connect(host: string, port: number) {
    return new Promise<BitTorrentClient>((res, rej) => {
      const connection = createConnection({ host, port }, () => {
        console.log(`connected to ${host}:${port}`);
        connection.off("error", rej);
        res(new BitTorrentClient(connection));
      });

      connection.once("error", rej);
    });
  }

  constructor(private connection: Socket) {
    super();
    this.initHandlers(connection);
  }

  close() {
    this.connection.destroy();
    this.removeAllListeners();
  }

  /**
   * Get the peer's id and bitfields indicating which pieces of the specifie file hash it has.
   * @param hash The hash of the file info.
   * @param ignoreBitfields Indicates whether the method should resolve only after the bitfields have been received.
   */
  async handshake(
    hash: Buffer,
    ignoreBitfields: boolean
  ): Promise<{ peerId: Buffer; bitfield?: Buffer }> {
    const p = Buffer.concat([
      Buffer.from([19]),
      Buffer.from("BitTorrent protocol"),
      Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
      hash,
      Buffer.from("00112233445566778899"),
    ]);

    if (ignoreBitfields) {
      return {
        peerId: (await this.sendRequest(p, "handshake")).subarray(
          1 + 19 + 8 + 20
        ),
      };
    }

    const [hs, bf] = await this.sendRequest(p, ["handshake", "bitfield"]);

    return { peerId: hs.subarray(1 + 19 + 8 + 20), bitfield: bf.subarray(5) };
  }

  /** Tells the peer we want to start downloading. Resolves when the peer returns an `unchoke` message. */
  interested() {
    return this.sendRequest(Buffer.from([0, 0, 0, 1, 2]), "unchoke");
  }

  /** Requests a chunk from a piece of a file. */
  request(index: number, offset: number, length: number) {
    return this.sendRequest(
      Buffer.concat([
        Buffer.from([0, 0, 0, 13, 6]),
        this.getUInt32Bytes(index),
        this.getUInt32Bytes(offset),
        this.getUInt32Bytes(length),
      ]),
      "piece"
    );
  }

  async downloadPiece(
    info: { length: number; pieceLength: number },
    index: number,
    stream: promises.FileHandle,
    streamPosition = 0
  ) {
    // A file is split in pieces and every piece is split in chunks
    const pieces = Math.ceil(info.length / info.pieceLength);
    const requestedPieceLength =
      index < pieces - 1
        ? info.pieceLength
        : info.length - info.pieceLength * (pieces - 1);

    let left = requestedPieceLength;
    let i = 0;

    while (left > 0) {
      const chunkSize = left < DEFAULT_CHUNK_SIZE ? left : DEFAULT_CHUNK_SIZE;
      const pc = await this.request(index, i * DEFAULT_CHUNK_SIZE, chunkSize);

      const content = pc.subarray(13);

      console.log(
        `index ${i}: writing ${content.length} bytes at ${
          streamPosition + i * DEFAULT_CHUNK_SIZE
        }`
      );

      await stream.write(
        content,
        0,
        content.length,
        streamPosition + i * DEFAULT_CHUNK_SIZE
      );

      left -= content.length;
      i++;
    }
  }

  async download(
    info: { length: number; pieceLength: number },
    stream: promises.FileHandle
  ) {
    const pieces = Math.ceil(info.length / info.pieceLength);
    for (let i = 0; i < pieces; i++) {
      await this.downloadPiece(info, i, stream, info.pieceLength * i);
    }
  }
  private async sendRequest(
    requestPayload: Buffer,
    expectedResponseMessageType: MessageType
  ): Promise<Buffer>;
  private async sendRequest(
    requestPayload: Buffer,
    expectedResponseMessageTypes: MessageType[]
  ): Promise<Buffer[]>;
  private async sendRequest(
    requestPayload: Buffer,
    expectedResponseMessageTypes: MessageType | MessageType[]
  ) {
    const singleMessage = typeof expectedResponseMessageTypes == "string";
    const p = new Promise<Buffer[]>((res, rej) => {
      this.resolveRequest(
        requestPayload,
        singleMessage
          ? [expectedResponseMessageTypes]
          : expectedResponseMessageTypes,
        res,
        rej
      );
    });

    return singleMessage ? p.then((r) => r[0]) : p;
  }

  private resolveRequest(
    requestPayload: Buffer,
    expectedMessageTypes: MessageType[],
    res: (value: Buffer[] | PromiseLike<Buffer[]>) => void,
    rej: (reason?: any) => void
  ) {
    const queue = Array.from(expectedMessageTypes);
    const result: Buffer[] = [];

    const handleError = (err?: any) => {
      this.off("error", handleError);
      this.off("close", handleError);
      this.off("message", handleError);

      rej(err);
    };

    const handleMessage = (msg: Buffer) => {
      const expectedMessage = queue.shift();

      if (
        MessageTypes[msg[4]] == expectedMessage ||
        (msg[0] == 19 && expectedMessage == "handshake")
      ) {
        result.push(msg);
        if (queue.length == 0) {
          this.off("message", handleMessage);
          this.off("error", handleError);
          this.off("close", handleError);
          res(result);
        }
      } else {
        console.log("unexpected message", msg);
        this.off("message", handleMessage);
        this.off("error", handleError);
        this.off("close", handleError);
        rej("unexpected message");
      }
    };

    this.on("error", handleError);
    this.on("close", handleError);
    this.on("message", handleMessage);

    // IMPORTANT: only after wiring the handlers we can send the request
    // else we risk losing messages
    this.write(requestPayload);
  }

  /// Wires the necessary events and translates incoming chunks to emitted message events
  private initHandlers(connection: Socket) {
    // keeps track of an incomplete message
    let messageBuffer: Buffer | null = null;
    let remainingMessageSize = 0;

    const handler = (data: Buffer) => {
      // console.log("RX", data.length);
      if (messageBuffer) {
        // we only got part of the message the last time we handled a `data` event
        data.copy(messageBuffer, messageBuffer.length - remainingMessageSize);
        remainingMessageSize -= data.length;
        if (!remainingMessageSize) {
          this.emitMessageEvents(messageBuffer);
          messageBuffer = null;
        }
      } else {
        // handshakes are a special case
        let size =
          data[0] == 19 ? 1 + 19 + 8 + 20 + 20 : data.readUint32BE() + 4;

        if (data.length < size) {
          messageBuffer = Buffer.alloc(size);
          data.copy(messageBuffer);
          remainingMessageSize = size - data.length;
          return;
        }

        this.emitMessageEvents(data.subarray(0, size));

        if (data.length > size) {
          // we received more than one message
          handler(data.subarray(size));
        }
      }
    };

    connection.on("data", handler);
    connection.on("error", (err) => {
      console.log("ERROR", err);
      this.emit("error", err);
    });
    connection.on("close", (err) => {
      console.log("CLOSE", err);
      this.emit("close");
    });
  }

  private emitMessageEvents(buffer: Buffer) {
    // console.log("EMIT", buffer);

    this.emit("message", buffer);
    if (buffer[0] == 19) {
      this.emit("handshake", buffer);
    } else {
      this.emit(MessageTypes[buffer[4]], buffer);
    }
  }

  private write(buffer: Buffer) {
    // console.log("WRITE", buffer);
    this.connection.write(buffer);
  }

  private getUInt32Bytes(value: number) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(value);
    return buf;
  }
}

const DEFAULT_CHUNK_SIZE = 2 ** 14;

const MessageTypes = [
  "choke",
  "unchoke",
  "interested",
  "not interested",
  "have",
  "bitfield",
  "request",
  "piece",
  "cancel",

  // add this as last one, its a special case, not part of the spec
  // and its index has no meaning
  "handshake",
] as const;

type MessageType = (typeof MessageTypes)[number];
