import { expect, test, describe } from "vitest";
import { decode, encode } from ".";

describe("bencode", () => {
  describe("encode", () => {
    test.each([
      ["", "0:"],
      ["foo", "3:foo"],
      ["👌🏻", "8:👌🏻"],
      [Buffer.from([0, 1, 2, 3]), "4:\x00\x01\x02\x03"],

      [42, "i42e"],
      [-123, "i-123e"],

      [[], "le"],
      [[[]], "llee"],
      [["a", "b"], "l1:a1:be"],
      [["a", "b", 42], "l1:a1:bi42ee"],
      [["a", "b", 42, [123]], "l1:a1:bi42eli123eee"],

      [{}, "de"],
      [{ a: 1 }, "d1:ai1ee"],
    ])("'%s' -> '%s'", (input, result) => {
      const actual = encode(input);
      expect(actual.toString()).toEqual(result);
    });
  });
});
