import { readFileSync } from "node:fs";
import { decode } from "./bencode";

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

      console.log(
        `Tracker URL: ${decoded.get("announce")?.toString()}\nLength: ${decoded
          .get("info")
          .get("length")}`
      );
    } catch (error: any) {
      console.error(error.message);
    }
  }
}
