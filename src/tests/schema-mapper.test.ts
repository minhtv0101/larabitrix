import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Env } from "../types";
import {
  slugify,
  buildListSchema,
  transformToBitrix,
  transformToClean,
  invalidateSchema,
} from "../services/schema-mapper";
import {
  mockFetch,
  bitrixOk,
  fixtureSchema,
  fixtureFieldsResponse,
  fixtureElement,
  makeTestEnv,
} from "./_helpers";

vi.mock("../middleware/rate-limiter", () => ({
  sleep: () => Promise.resolve(),
  RATE_LIMIT_DELAY_MS: 0,
}));

describe("slugify", () => {
  it("lowercases and replaces spaces with underscores", () => {
    expect(slugify("Phone Number")).toBe("phone_number");
  });

  it("strips punctuation", () => {
    expect(slugify("Phone Number!")).toBe("phone_number");
  });

  it("trims leading/trailing whitespace", () => {
    expect(slugify("  note  ")).toBe("note");
  });

  it("handles mixed case", () => {
    expect(slugify("SooBuoiHoc")).toBe("soobuoihoc");
  });
});

describe("transformToBitrix", () => {
  it("maps clean keys into PROPERTY_VALUES", () => {
    const schema = fixtureSchema();
    const result = transformToBitrix({ phone: "+84123", note: "hi" }, schema);
    expect(result).toEqual({
      PROPERTY_VALUES: { PROPERTY_123: "+84123", PROPERTY_124: "hi" },
    });
  });

  it("silently drops unmapped clean keys", () => {
    const schema = fixtureSchema();
    const { PROPERTY_VALUES } = transformToBitrix({ unknown: "x" }, schema);
    expect(PROPERTY_VALUES).toEqual({});
  });
});

describe("transformToClean", () => {
  it("unwraps n0.value shape and includes id", () => {
    const schema = fixtureSchema();
    const el = fixtureElement("7", "+84123", "hello", 5);
    const result = transformToClean(el, schema);
    expect(result).toMatchObject({ id: "7", phone: "+84123", note: "hello", counter: "5" });
  });

  it("includes NAME as name when present", () => {
    const schema = fixtureSchema();
    const result = transformToClean({ ID: "1", NAME: "Test", PROPERTY_VALUES: {} }, schema);
    expect(result["name"]).toBe("Test");
  });

  it("skips unmapped PROPERTY keys", () => {
    const schema = fixtureSchema();
    const result = transformToClean(
      { ID: "1", PROPERTY_VALUES: { PROPERTY_999: { n0: { value: "x" } } } },
      schema
    );
    expect(Object.keys(result)).toEqual(["id"]);
  });
});

describe("buildListSchema", () => {
  let e: Env;
  let restoreFetch: () => void;

  beforeEach(async () => {
    e = makeTestEnv();
    await invalidateSchema(e, "42");
  });

  afterEach(() => {
    restoreFetch?.();
  });

  it("fetches from Bitrix on cold call and writes KV", async () => {
    let calls = 0;
    restoreFetch = mockFetch(() => { calls++; return bitrixOk(fixtureFieldsResponse()); });

    const schema = await buildListSchema(e, "42");
    expect(calls).toBe(1);
    expect(schema.toBitrix["phone"]).toBe("PROPERTY_123");
    const stored = await e.SCHEMA_KV!.get("schema:42");
    expect(stored).not.toBeNull();
  });

  it("uses RAM cache on second call without extra fetch", async () => {
    let calls = 0;
    restoreFetch = mockFetch(() => { calls++; return bitrixOk(fixtureFieldsResponse()); });

    await buildListSchema(e, "42");
    await buildListSchema(e, "42");
    expect(calls).toBe(1);
  });

  it("hydrates from KV after RAM is cleared", async () => {
    let calls = 0;
    restoreFetch = mockFetch(() => { calls++; return bitrixOk(fixtureFieldsResponse()); });

    // Seed KV directly and invalidate RAM
    const fixture = fixtureSchema();
    await e.SCHEMA_KV!.put("schema:42", JSON.stringify(fixture), { expirationTtl: 86400 });
    // invalidateSchema clears RAM (we never populated RAM in this test)
    await invalidateSchema(e, "42");
    await e.SCHEMA_KV!.put("schema:42", JSON.stringify(fixture), { expirationTtl: 86400 });

    const schema = await buildListSchema(e, "42");
    expect(calls).toBe(0); // KV hit, no Bitrix call
    expect(schema.toBitrix["phone"]).toBe("PROPERTY_123");
  });

  it("invalidateSchema clears both RAM and KV", async () => {
    restoreFetch = mockFetch(() => bitrixOk(fixtureFieldsResponse()));
    await buildListSchema(e, "42");
    await invalidateSchema(e, "42");

    expect(await e.SCHEMA_KV!.get("schema:42")).toBeNull();
  });
});
