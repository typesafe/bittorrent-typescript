import fs from "node:fs";
import { decode, encode } from "./bencode";
import { createHash } from "crypto";
import { URLSearchParams } from "node:url";
import { buffer } from "node:stream/consumers";
import { BitTorrentClient } from "./client";

const args = process.argv;

(async function () {
  switch (args[2]) {
    case "decode": {
      handleDecodeCommand();
      return;
    }
    case "info": {
      handleInfoCommand();
      return;
    }
    case "peers": {
      await handlePeersCommand();

      return;
    }
    case "handshake": {
      await handleHandshakeCommand();

      return;
    }
    case "download_piece": {
      await handleDownloadPieceCommand();
      return;
    }
  }

  async function handleDownloadPieceCommand() {
    const decoded = decode(fs.readFileSync(args[5])) as Map<string, any>;

    const peers = getPeers(decoded);
    const p = (await peers.next()).value!;
    const [host, port] = p.split(":");

    const info = decoded.get("info");
    const hash = createHash("sha1").update(encode(info)).digest();

    const requestedPieceIndex = parseInt(args[6]);

    const connection = await BitTorrentClient.connect(host, parseInt(port));

    await connection.handshake(hash, false);
    await connection.interested();

    const file = await fs.promises.open(args[4], "w");

    await connection.downloadPiece(
      {
        length: info.get("length") as number,
        pieceLength: info.get("piece length") as number,
      },
      requestedPieceIndex,
      file
    );

    await file.close();
    connection.close();

    console.log(`Piece ${args[6]} downloaded to ${args[4]}.`);
  }

  async function handleHandshakeCommand() {
    const decoded = decode(fs.readFileSync(args[3])) as Map<string, any>;
    const info = decoded.get("info");
    const hash = createHash("sha1").update(encode(info)).digest();
    const hostAndPort = args[4].split(":");

    const connection = await BitTorrentClient.connect(
      hostAndPort[0],
      parseInt(hostAndPort[1])
    );

    const res = await connection.handshake(hash, true);

    connection.close();

    console.log(`Peer ID: ${res.peerId.toString("hex")}`);
  }

  async function handlePeersCommand() {
    const decoded = decode(fs.readFileSync(args[3])) as Map<string, any>;

    for await (const peer of getPeers(decoded)) {
      console.log(peer);
    }
  }

  function handleInfoCommand() {
    try {
      const decoded = decode(fs.readFileSync(args[3])) as Map<string, any>;
      const info = decoded.get("info");

      console.log(`Tracker URL: ${decoded.get("announce")?.toString()}`);
      console.log(`Length: ${info.get("length")}`);
      console.log(
        `Info Hash: ${createHash("sha1").update(encode(info)).digest("hex")}`
      );

      console.log(`Piece Length: ${info.get("piece length")}`);
      console.log(`Piece Hashes:`);
      const pieces = info.get("pieces").toString("hex") as string;

      let s = 0;
      while (s < pieces.length) {
        console.log(pieces.substring(s, s + 40));
        s += 40;
      }
    } catch (error: any) {
      console.error(error.message);
    }
  }
})();

function handleDecodeCommand() {
  try {
    const decoded = decode(Buffer.from(args[3]));
    console.log(typeof decode == "number" ? decoded : JSON.stringify(decoded));
  } catch (error: any) {
    console.error(error.message);
  }
}

async function* getPeers(decoded: Map<string, any>) {
  const info = decoded.get("info");
  const query = new URLSearchParams({
    peer_id: "00112233445566778899",
    port: "6881",
    uploaded: "0",
    downloaded: "0",
    left: info.get("length").toString(),
    compact: "1",
  });

  const url =
    (decoded.get("announce")?.toString() as string) +
    "?info_hash=" +
    urlEncodeHash(createHash("sha1").update(encode(info)).digest()) +
    "&" +
    query.toString();

  const response = await fetch(url);
  const body = await buffer(response.body!);
  const value = decode(body) as Map<string, any>;
  const peers = value.get("peers");

  for (let i = 0; i < peers.length; i += 6) {
    const ip: string = Array.from(peers.subarray(i, i + 4))
      .map((value) => `${value}`)
      .join(".");
    const port = Buffer.from(peers.slice(i + 4, i + 6)).readUIntBE(0, 2);
    yield ip + ":" + port;
  }
}

function urlEncodeHash(value: Buffer): string {
  let res = "";

  // let's just encode all bytes, for now
  for (let i = 0; i < value.length; i++) {
    res += `%${value.subarray(i, i + 1).toString("hex")}`;
  }

  return res;
}
