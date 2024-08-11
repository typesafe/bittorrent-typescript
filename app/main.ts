import { readFileSync } from "node:fs";
import { decode, encode } from "./bencode";
import { createHash } from "crypto";

const args = process.argv;

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
  }
}
