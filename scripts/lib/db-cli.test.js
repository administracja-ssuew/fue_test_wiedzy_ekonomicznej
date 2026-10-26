import { parseEnv, upsertEnv, projectRefFromUrl, extractSection, isReadOnlySql, parseArgs } from "./db-cli.js";

describe("parseEnv / upsertEnv", () => {
  it("czyta zmienne, pomija komentarze i zdejmuje cudzysłowy", () => {
    expect(parseEnv('# x\nA=1\nB="dwa"\r\nC = trzy\n')).toEqual({ A: "1", B: "dwa", C: "trzy" });
  });
  it("podmienia istniejącą zmienną bez ruszania reszty", () => {
    expect(upsertEnv("A=1\nB=2\n", "A", "9")).toBe("A=9\nB=2\n");
  });
  it("dopisuje nową zmienną i zachowuje CRLF", () => {
    expect(upsertEnv("A=1\r\n", "T", "sbp_x")).toBe("A=1\r\nT=sbp_x\r\n");
    expect(upsertEnv("", "T", "x")).toBe("T=x\n");
  });
});

describe("projectRefFromUrl", () => {
  it("wyciąga ref z adresu projektu", () => {
    expect(projectRefFromUrl("https://ytbwmmqwbfcugouourih.supabase.co")).toBe("ytbwmmqwbfcugouourih");
    expect(projectRefFromUrl("https://abc.supabase.co/")).toBe("abc");
    expect(projectRefFromUrl("http://localhost:54321")).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe("extractSection", () => {
  const sql = [
    "-- ─── 44. A", "select 44;", "",
    "-- ─── 45. B", "-- opis", "revoke x;", "", "",
    "-- ─── 46. C", "select 46;",
  ].join("\n");
  it("wycina sekcję do następnego nagłówka, bez końcowych pustych linii", () => {
    expect(extractSection(sql, 45)).toEqual({ text: "-- ─── 45. B\n-- opis\nrevoke x;", from: 4, to: 6 });
  });
  it("ostatnia sekcja idzie do końca pliku", () => {
    expect(extractSection(sql, 46).text).toBe("-- ─── 46. C\nselect 46;");
  });
  it("nie myli 4 z 44 ani 45 z 450", () => {
    expect(extractSection(sql, 4)).toBeNull();
    expect(extractSection("-- ─── 450. X\nselect 1;", 45)).toBeNull();
  });
});

describe("isReadOnlySql", () => {
  it("SELECT i WITH są tylko do odczytu", () => {
    expect(isReadOnlySql("select * from quiz_sessions where created_at > now();")).toBe(true);
    expect(isReadOnlySql("with x as (select 1) select * from x")).toBe(true);
    expect(isReadOnlySql("select 'drop table' as t")).toBe(true);
  });
  it("zapis, DDL i kilka instrukcji wymagają potwierdzenia", () => {
    expect(isReadOnlySql("update modules set time_per_q = 45")).toBe(false);
    expect(isReadOnlySql("select 1; drop table x")).toBe(false);
    expect(isReadOnlySql("with d as (delete from x returning *) select * from d")).toBe(false);
    expect(isReadOnlySql("revoke execute on function f() from anon")).toBe(false);
    expect(isReadOnlySql("")).toBe(false);
  });
});

describe("parseArgs", () => {
  it("rozpoznaje podkomendę, flagi i sekcję", () => {
    expect(parseArgs(["sql", "--section", "45", "--stage"])).toMatchObject({ cmd: "sql", section: "45", stage: true, yes: false });
    expect(parseArgs(["sql", "plik.sql", "-y"])).toMatchObject({ cmd: "sql", rest: ["plik.sql"], yes: true });
    expect(parseArgs(["query", "select 1"])).toMatchObject({ cmd: "query", rest: ["select 1"] });
  });
});
