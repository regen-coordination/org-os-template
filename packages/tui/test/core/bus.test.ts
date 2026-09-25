import { test, expect } from "bun:test";
import { Emitter } from "../../src/core/bus";

test("on/emit/unsubscribe and listener isolation", () => {
  const errors: unknown[] = [];
  const bus = new Emitter<{ ping: number }>((_, e) => errors.push(e));
  const got: number[] = [];
  const off = bus.on("ping", (n) => got.push(n));
  bus.on("ping", () => { throw new Error("bad listener"); });
  bus.on("ping", (n) => got.push(n * 10));
  bus.emit("ping", 1);
  off();
  bus.emit("ping", 2);
  expect(got).toEqual([1, 10, 20]);
  expect(errors.length).toBe(2);
});
