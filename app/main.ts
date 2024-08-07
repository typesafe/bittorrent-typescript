import { decode } from "./bencode";

const args = process.argv;
const bencodedValue = args[3];

if (args[2] === "decode") {
  try {
    const decoded = decode(Buffer.from(bencodedValue));
    console.log(JSON.stringify(decoded.toString()));
  } catch (error: any) {
    console.error(error.message);
  }
}
