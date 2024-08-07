import { expect, test, describe } from "vitest";
import { decode } from ".";

describe("bencode", () => {
  describe("decode", () => {
    test.each([
      ["3:foo", "foo"],
      ["1:a", "a"],
      ["0:", ""],
      
      ["i42e", 42],
      ["i-123e", -123],

      ["le", []],
      ["llee", [[]]],
      ["l1:a1:be", ["a", "b"]],
      ["l1:a1:bi42ee", ["a", "b", 42]],

      ["de", {}],
      ["d1:ai1ee", { a: 1 }],
    ])("'%s' -> '%s'", (input, result) => {
      const actual = decode(Buffer.from(input));

      if (Array.isArray(result)) {
        expect(actual).toBeInstanceOf(Array);
        expect((actual as unknown[]).length).toEqual(result.length);
        return;
      }

      if (result instanceof Map) {
        expect(actual).toBeInstanceOf(Map);

        expect(
          Object.fromEntries((actual as Map<string, unknown>).entries())
        ).toEqual(result);

        return;
      }

      const expected = result;
      expect(JSON.stringify(actual)).toEqual(JSON.stringify(expected));
    });
  });
});
