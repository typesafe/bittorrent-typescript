import { readFileSync } from "node:fs";
import { decode, encode } from "./bencode";
import { createHash } from "crypto";
import { request } from "node:https";
import { URLSearchParams } from "node:url";
import { buffer } from "node:stream/consumers";
import { createConnection } from "node:net";

const args = process.argv;

(async function () {
  switch (args[2]) {
    case "decode": {
      try {
        const decoded = decode(Buffer.from(args[3]));
        console.log(
          typeof decode == "number" ? decoded : JSON.stringify(decoded)
        );
      } catch (error: any) {
        console.error(error.message);
      }
      return;
    }
    case "info": {
      try {
        const decoded = decode(readFileSync(args[3])) as Map<string, any>;
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
      return;
    }
    case "peers": {
      const decoded = decode(readFileSync(args[3])) as Map<string, any>;
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
        console.log(ip + ":" + port);
      }

      return;
    }
    case "handshake": {
      const decoded = decode(readFileSync(args[3])) as Map<string, any>;
      const info = decoded.get("info");
      const hash = createHash("sha1").update(encode(info)).digest();
      const hostAndPort = args[4].split(":");
      const connection = createConnection(
        { host: hostAndPort[0], port: parseInt(hostAndPort[1]) },
        () => {
          connection.write(
            Buffer.concat([
              Buffer.from([19]),
              Buffer.from("BitTorrent protocol"),
              Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
              hash,
              Buffer.from("00112233445566778899"),
            ])
          );
        }
      );

      connection.on("data", (data) => {
        console.log(
          `Peer ID: ${data.subarray(1 + 19 + 8 + 20).toString("hex")}`
        );
        connection.end();
      });

      connection.on("error", (err) => console.log);
      connection.on("close", (hadError) => {
        //console.log(hadError ? "closed after error" : "closed");
      });
      connection.on("end", () => {
        //console.log("end");
      });
    }
  }
})();

function urlEncodeHash(value: Buffer): string {
  let res = "";

  // let's just encode all bytes, for now
  for (let i = 0; i < value.length; i++) {
    res += `%${value.subarray(i, i + 1).toString("hex")}`;
  }

  return res;
}
