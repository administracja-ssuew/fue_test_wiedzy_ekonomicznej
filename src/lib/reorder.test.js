import { describe, it, expect } from "vitest";
import { moveItem, moveById, applyModuleOrder } from "./reorder.js";
import { buildPlanItems } from "./plan.js";

const MODULES = [{ id: 1, timePerQ: 30 }, { id: 2, timePerQ: 45 }, { id: 3, timePerQ: 60 }];

describe("moveItem", () => {
  it("przesuwa element w przód i w tył", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], 1, 2)).toEqual(["a", "c", "b", "d"]);
  });

  it("nie mutuje wejścia", () => {
    const src = ["a", "b", "c"];
    const out = moveItem(src, 0, 2);
    expect(src).toEqual(["a", "b", "c"]);
    expect(out).not.toBe(src);
  });

  it("indeks poza zakresem → kopia bez zmian", () => {
    const src = ["a", "b", "c"];
    for (const [f, t] of [[-1, 0], [0, 3], [3, 0], [0, -1], [1, 5]]) {
      const out = moveItem(src, f, t);
      expect(out).toEqual(src);
      expect(out).not.toBe(src);
    }
  });

  it("from === to → kopia bez zmian", () => {
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("moveById", () => {
  const L = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const ids = (xs) => xs.map((x) => x.id);

  it("after → za celem", () => {
    expect(ids(moveById(L, "a", "c", "after"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(moveById(L, "d", "a", "after"))).toEqual(["a", "d", "b", "c"]);
  });

  it("before (domyślnie) → przed celem", () => {
    expect(ids(moveById(L, "a", "c", "before"))).toEqual(["b", "a", "c", "d"]);
    expect(ids(moveById(L, "a", "c"))).toEqual(["b", "a", "c", "d"]);
    expect(ids(moveById(L, "d", "a", "before"))).toEqual(["d", "a", "b", "c"]);
    expect(ids(moveById(L, "c", "b", "before"))).toEqual(["a", "c", "b", "d"]);
  });

  it("na koniec listy", () => {
    expect(ids(moveById(L, "a", "d", "after"))).toEqual(["b", "c", "d", "a"]);
  });

  it("ten sam id albo nieznany id → bez zmian", () => {
    expect(ids(moveById(L, "b", "b", "after"))).toEqual(["a", "b", "c", "d"]);
    expect(ids(moveById(L, "x", "b"))).toEqual(["a", "b", "c", "d"]);
    expect(ids(moveById(L, "a", "x"))).toEqual(["a", "b", "c", "d"]);
  });

  it("nie mutuje wejścia", () => {
    const src = [...L];
    moveById(src, "a", "c", "after");
    expect(ids(src)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("applyModuleOrder", () => {
  const QS = [
    { id: "q1", module: 1 },
    { id: "q2", module: 1 },
    { id: "q4", module: 2, sort_order: 0 },
    { id: "q5", module: 2, sort_order: 1 },
    { id: "q7", module: 3 },
  ];

  it("pytania modułu dostają sort_order 0..n-1 i zajmują pozycje modułu", () => {
    const out = applyModuleOrder(QS, 2, ["q5", "q4"]);
    expect(out.map((q) => q.id)).toEqual(["q1", "q2", "q5", "q4", "q7"]);
    expect(out[2]).toEqual({ id: "q5", module: 2, sort_order: 0 });
    expect(out[3]).toEqual({ id: "q4", module: 2, sort_order: 1 });
  });

  it("inne moduły (także bez sort_order) bez zmian, wejście niezmutowane", () => {
    const out = applyModuleOrder(QS, 2, ["q5", "q4"]);
    expect(out[0]).toBe(QS[0]);
    expect(out[1]).toBe(QS[1]);
    expect(out[4]).toBe(QS[4]);
    expect("sort_order" in out[0]).toBe(false);
    expect(QS[2]).toEqual({ id: "q4", module: 2, sort_order: 0 });
    expect(out).not.toBe(QS);
  });

  it("remisy sort_order → gęsto 0..n-1", () => {
    const tie = [
      { id: "a", module: 1, sort_order: 0 },
      { id: "b", module: 1, sort_order: 0 },
      { id: "c", module: 1, sort_order: 1 },
    ];
    const out = applyModuleOrder(tie, 1, ["c", "a", "b"]);
    expect(out.map((q) => [q.id, q.sort_order])).toEqual([["c", 0], ["a", 1], ["b", 2]]);
  });

  it("plan buildPlanItems używa nowej kolejności w module", () => {
    const before = buildPlanItems(QS, MODULES).map((it) => it.id);
    expect(before).toEqual(["q1", "q2", "q4", "q5", "q7"]);
    const after = buildPlanItems(applyModuleOrder(QS, 2, ["q5", "q4"]), MODULES);
    expect(after.map((it) => it.id)).toEqual(["q1", "q2", "q5", "q4", "q7"]);
    expect(after.map((it) => it.m)).toEqual([1, 1, 2, 2, 3]);
  });

  it("przestawienie w module 1 nie rusza pozostałych", () => {
    const out = applyModuleOrder(QS, 1, ["q2", "q1"]);
    expect(out.map((q) => q.id)).toEqual(["q2", "q1", "q4", "q5", "q7"]);
    expect(out[2]).toBe(QS[2]);
  });
});
