import { expect, test, describe } from "vitest";
import { decode } from "./decode";
import { readFileSync } from "node:fs";

describe("decode torrent file", () => {
  test("should parse all content", () => {
    const decoded = decode(
      readFileSync(__dirname + "/../../sample.torrent")
    ) as Map<string, unknown>;

    expect((decoded.get("announce") as Buffer).toString()).toEqual(
      "http://bittorrent-test-tracker.codecrafters.io/announce"
    );
    expect((decoded.get("created by") as Buffer).toString()).toEqual(
      "mktorrent 1.1"
    );

    const info = decoded.get("info") as Map<string, unknown>;

    expect((info.get("name") as Buffer).toString()).toEqual("sample.txt");
    expect(info.get("length")).toEqual(92063);
    expect(info.get("piece length")).toEqual(32768);
  });
});
