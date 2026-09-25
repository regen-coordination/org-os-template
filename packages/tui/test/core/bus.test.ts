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

test("buffered types replay to the first subscriber; other types are dropped without one", () => {
  const bus = new Emitter<{ notice: string; state: number }>(undefined, { buffer: ["notice"] });
  bus.emit("notice", "early-1");
  bus.emit("notice", "early-2");
  bus.emit("state", 1);
  const notices: string[] = [];
  const states: number[] = [];
  bus.on("state", (n) => states.push(n));
  const off = bus.on("notice", (t) => notices.push(t));
  expect(notices).toEqual(["early-1", "early-2"]);
  expect(states).toEqual([]);
  bus.emit("notice", "live");
  const second: string[] = [];
  bus.on("notice", (t) => second.push(t));
  expect(notices).toEqual(["early-1", "early-2", "live"]);
  expect(second).toEqual([]); // replay goes to the first subscriber only
  off();
});

test("the replay buffer is bounded", () => {
  const bus = new Emitter<{ notice: number }>(undefined, { buffer: ["notice"], bufferLimit: 3 });
  for (let i = 0; i < 5; i++) bus.emit("notice", i);
  const got: number[] = [];
  bus.on("notice", (n) => got.push(n));
  expect(got).toEqual([2, 3, 4]);
});
