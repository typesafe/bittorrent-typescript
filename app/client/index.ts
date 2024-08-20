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
    this.write(
      Buffer.concat([
        Buffer.from([19]),
        Buffer.from("BitTorrent protocol"),
        Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
        hash,
        Buffer.from("00112233445566778899"),
      ])
    );

    if (ignoreBitfields) {
      return {
        peerId: (await this.awaitMessage("handshake")).subarray(
          1 + 19 + 8 + 20
        ),
      };
    }

    const [hs, bf] = await this.awaitMessages(["handshake", "bitfield"]);

    return { peerId: hs.subarray(1 + 19 + 8 + 20), bitfield: bf.subarray(5) };
  }

  /** Tells the peer we want to start downloading. Resolves when the peer returns an `unchoke` message. */
  async interested() {
    this.connection.write(Buffer.from([0, 0, 0, 1, 2]));
    return this.awaitMessage("unchoke");
  }

  /** Requests a chunk from a piece of a file. */
  async request(index: number, offset: number, length: number) {
    this.write(
      Buffer.concat([
        Buffer.from([0, 0, 0, 13, 6]),
        this.getUInt32Bytes(index),
        this.getUInt32Bytes(offset),
        this.getUInt32Bytes(length),
      ])
    );

    return this.awaitMessage("piece");
  }

  async downloadPiece(
    info: { length: number; pieceLength: number },
    index: number,
    stream: promises.FileHandle
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
      const pc = await this.request(
        index,
        i * DEFAULT_CHUNK_SIZE,
        left < DEFAULT_CHUNK_SIZE ? left : DEFAULT_CHUNK_SIZE
      );

      const content = pc.subarray(13);

      left -= content.length;
      i++;

      await stream.write(content);
    }
  }

  private async awaitMessage(messageType: MessageType) {
    return (await this.awaitMessages([messageType]))[0];
  }

  private async awaitMessages(messages: MessageType[]) {
    return new Promise<Buffer[]>((res, rej) => {
      this.expect(messages, res, rej);
    });
  }

  private expect(
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
      this.off("error", handleError);
      this.off("close", handleError);

      if (
        MessageTypes[msg[4]] == queue[0] ||
        (msg[0] == 19 && queue[0] == "handshake")
      ) {
        result.push(msg);
        if (queue.length == 1) {
          this.off("message", handleError);
          res(result);
        } else {
          queue.shift();
        }
      } else {
        this.off("message", handleError);
        rej("unexpected message");
      }
    };

    this.once("error", handleError);
    this.once("close", handleError);
    this.on("message", handleMessage);
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
