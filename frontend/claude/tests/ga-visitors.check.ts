import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  GA_DATE_RANGES,
  buildRunReportRequest,
  buildServiceAccountJwt,
  fillInteriorDateGaps,
  formatGaDateLabel,
  gaVisitorsConfiguration,
  isGaVisitorsConfigured,
  parseRunReportResponse,
  readGaDailyVisitors,
  resetGaAccessTokenCache,
  rowsToPoints,
  type GaDailyRow,
  type GaVisitorsConfiguration,
} from "../src/lib/admin/ga-visitors";
import { getVisitorReport } from "../src/app/admin/(workspace)/analytics/visitors";

/**
 * GA Data API read-back tests (2026-11-18, code prep only).
 *
 * No live calls: every test injects env + a stub fetch. The RSA key
 * pair is generated at runtime — no key material, real or fake, is
 * committed anywhere. The module's console.error diagnostics are
 * silenced so failure-path tests stay quiet.
 */

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** Env as the owner would paste it: private key with literal \n escapes. */
function fixtureEnv(): Record<string, string | undefined> {
  return {
    GA_PROPERTY_ID: "123456789",
    GA_SERVICE_ACCOUNT_EMAIL: "attiresarena-readback@extreme-mix-514913-v5.iam.gserviceaccount.com",
    GA_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.replaceAll("\n", "\\n"),
  };
}

function fixtureConfig(): GaVisitorsConfiguration {
  const config = gaVisitorsConfiguration(fixtureEnv());
  if (config === null) throw new Error("fixture env must configure");
  return config;
}

/** Signs a JWT with the config and verifies it against the fixture public key. */
function signedJwtVerifies(config: GaVisitorsConfiguration | null): boolean {
  if (config === null) return false;
  const jwt = buildServiceAccountJwt(config, 1_763_000_000);
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  return verifier.verify(publicKey, Buffer.from(parts[2] as string, "base64url"));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface CapturedRequest {
  url: string;
  init: RequestInit | undefined;
}

/**
 * Stub fetch: answers the token exchange and runReport from fixtures,
 * capturing every request. `reportPayload` is the runReport body.
 */
function stubFetch(reportPayload: unknown, options?: { tokenStatus?: number; reportStatus?: number }) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlText = String(url);
    requests.push({ url: urlText, init });
    if (urlText === "https://oauth2.googleapis.com/token") {
      if ((options?.tokenStatus ?? 200) !== 200) {
        return jsonResponse({ error: "invalid_grant" }, options?.tokenStatus ?? 400);
      }
      return jsonResponse({
        access_token: "fixture-access-token",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (urlText.includes("analyticsdata.googleapis.com")) {
      if ((options?.reportStatus ?? 200) !== 200) {
        return jsonResponse({ error: { message: "forbidden" } }, options?.reportStatus ?? 403);
      }
      return jsonResponse(reportPayload);
    }
    throw new Error(`unexpected URL: ${urlText}`);
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function reportFixture(rows: { date: string; users: string }[]): unknown {
  return {
    rows: rows.map((row) => ({
      dimensionValues: [{ value: row.date }],
      metricValues: [{ value: row.users }],
    })),
  };
}

function decodeJwtPart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("gaVisitorsConfiguration", () => {
  it("is null when the env config is absent or partial", () => {
    expect(gaVisitorsConfiguration({})).toBeNull();
    expect(gaVisitorsConfiguration({ GA_PROPERTY_ID: "123456789" })).toBeNull();
    expect(
      gaVisitorsConfiguration({
        GA_PROPERTY_ID: "123456789",
        GA_SERVICE_ACCOUNT_EMAIL: "a@example.com",
      }),
    ).toBeNull();
    expect(isGaVisitorsConfigured({})).toBe(false);
  });

  it("accepts a complete fixture env and unescapes the private key", () => {
    const config = gaVisitorsConfiguration(fixtureEnv());
    expect(config).not.toBeNull();
    expect(config?.propertyId).toBe("123456789");
    expect(config?.privateKey).toBe(privateKey.trim());
    expect(config?.privateKey).toContain("\n");
    expect(isGaVisitorsConfigured(fixtureEnv())).toBe(true);
  });

  it("accepts the whole service-account JSON pasted as the key value", () => {
    const wholeJson = JSON.stringify({
      type: "service_account",
      project_id: "fixture-project",
      private_key: privateKey,
      client_email: "fixture@example.iam.gserviceaccount.com",
    });
    const config = gaVisitorsConfiguration({
      ...fixtureEnv(),
      GA_SERVICE_ACCOUNT_PRIVATE_KEY: wholeJson,
    });
    expect(config?.privateKey).toBe(privateKey.trim());
    expect(signedJwtVerifies(config)).toBe(true);
  });

  it("accepts the base64 body alone, with or without literal escapes", () => {
    const body = privateKey
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\s+/g, "");
    const foldedWithEscapes = body.match(/.{1,64}/g)?.join("\\n") ?? body;
    for (const pasted of [body, foldedWithEscapes]) {
      const config = gaVisitorsConfiguration({
        ...fixtureEnv(),
        GA_SERVICE_ACCOUNT_PRIVATE_KEY: pasted,
      });
      expect(config).not.toBeNull();
      expect(signedJwtVerifies(config)).toBe(true);
    }
  });

  it("accepts a PEM wrapped in one pair of double quotes", () => {
    const config = gaVisitorsConfiguration({
      ...fixtureEnv(),
      GA_SERVICE_ACCOUNT_PRIVATE_KEY: `"${privateKey.replaceAll("\n", "\\n")}"`,
    });
    expect(config?.privateKey).toBe(privateKey.trim());
  });

  it("still rejects short base64-looking values and key-id-like hex", () => {
    expect(
      gaVisitorsConfiguration({ ...fixtureEnv(), GA_SERVICE_ACCOUNT_PRIVATE_KEY: "QUJDREVGR0g=" }),
    ).toBeNull();
    expect(
      gaVisitorsConfiguration({
        ...fixtureEnv(),
        GA_SERVICE_ACCOUNT_PRIVATE_KEY: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      }),
    ).toBeNull();
  });

  it("rejects a non-numeric property ID", () => {
    expect(
      gaVisitorsConfiguration({ ...fixtureEnv(), GA_PROPERTY_ID: "properties/123" }),
    ).toBeNull();
    expect(
      gaVisitorsConfiguration({ ...fixtureEnv(), GA_PROPERTY_ID: "G-ABCDEF1234" }),
    ).toBeNull();
  });

  it("rejects a malformed service-account email or private key", () => {
    expect(
      gaVisitorsConfiguration({ ...fixtureEnv(), GA_SERVICE_ACCOUNT_EMAIL: "not-an-email" }),
    ).toBeNull();
    expect(
      gaVisitorsConfiguration({
        ...fixtureEnv(),
        GA_SERVICE_ACCOUNT_PRIVATE_KEY: "not-a-pem-key",
      }),
    ).toBeNull();
    expect(
      gaVisitorsConfiguration({
        ...fixtureEnv(),
        GA_SERVICE_ACCOUNT_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END CERTIFICATE-----",
      }),
    ).toBeNull();
  });

  it("logs which field failed validation, never the rejected value", () => {
    const errorSpy = vi.mocked(console.error);
    errorSpy.mockClear();
    gaVisitorsConfiguration({ ...fixtureEnv(), GA_PROPERTY_ID: "G-SECRET123" });
    gaVisitorsConfiguration({ ...fixtureEnv(), GA_SERVICE_ACCOUNT_EMAIL: "bad-secret@example" });
    gaVisitorsConfiguration({ ...fixtureEnv(), GA_SERVICE_ACCOUNT_PRIVATE_KEY: "" });
    gaVisitorsConfiguration({
      ...fixtureEnv(),
      GA_SERVICE_ACCOUNT_PRIVATE_KEY: "secret-without-markers",
    });
    const messages = errorSpy.mock.calls.map((call) => String(call[0]));
    expect(messages).toContain("[attiresarena:ga-visitors] config invalid: property id");
    expect(messages).toContain("[attiresarena:ga-visitors] config invalid: service account email");
    expect(messages).toContain("[attiresarena:ga-visitors] config invalid: private key missing");
    expect(messages).toContain("[attiresarena:ga-visitors] config invalid: private key markers");
    for (const message of messages) {
      expect(message).not.toContain("SECRET");
      expect(message).not.toContain("bad-secret");
      expect(message).not.toContain("secret-without-markers");
    }
  });
});

describe("buildServiceAccountJwt", () => {
  it("builds a verifiable RS256 JWT with the GA readonly scope", () => {
    const config = fixtureConfig();
    const now = 1_763_000_000;
    const jwt = buildServiceAccountJwt(config, now);
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    expect(decodeJwtPart(headerPart)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeJwtPart(payloadPart)).toEqual({
      iss: config.clientEmail,
      sub: config.clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      iat: now,
      exp: now + 3600,
    });
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signaturePart, "base64url")),
    ).toBe(true);
  });

  it("fails verification when the payload is tampered with", () => {
    const config = fixtureConfig();
    const jwt = buildServiceAccountJwt(config, 1_763_000_000);
    const parts = jwt.split(".") as [string, string, string];
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...decodeJwtPart(parts[1]), scope: "https://www.googleapis.com/auth/analytics" }),
    ).toString("base64url");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${parts[0]}.${tamperedPayload}`);
    expect(verifier.verify(publicKey, Buffer.from(parts[2], "base64url"))).toBe(false);
  });
});

describe("date ranges", () => {
  it("maps every period to a real trailing range ending today", () => {
    expect(GA_DATE_RANGES).toEqual({
      today: { startDate: "today", endDate: "today" },
      "7-days": { startDate: "6daysAgo", endDate: "today" },
      "15-days": { startDate: "14daysAgo", endDate: "today" },
      "1-month": { startDate: "29daysAgo", endDate: "today" },
    });
  });

  it("builds the runReport body with date dimension + activeUsers metric", () => {
    expect(buildRunReportRequest("7-days")).toEqual({
      dateRanges: [{ startDate: "6daysAgo", endDate: "today" }],
      dimensions: [{ name: "date" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 31,
    });
  });

  it("sends the right range per period to the Data API", async () => {
    for (const [period, range] of Object.entries(GA_DATE_RANGES)) {
      const { fetchImpl, requests } = stubFetch({ rows: [] });
      await readGaDailyVisitors(period as keyof typeof GA_DATE_RANGES, {
        env: fixtureEnv(),
        fetchImpl,
      });
      const report = requests.find((request) =>
        request.url.includes("analyticsdata.googleapis.com"),
      );
      expect(report?.url).toBe(
        "https://analyticsdata.googleapis.com/v1beta/properties/123456789:runReport",
      );
      expect(report?.init?.headers).toMatchObject({
        Authorization: "Bearer fixture-access-token",
      });
      expect(JSON.parse(String(report?.init?.body))).toMatchObject({
        dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
      });
    }
  });
});

describe("response parsing", () => {
  it("maps rows to labelled points, ascending, with short date labels", () => {
    const rows = parseRunReportResponse(
      reportFixture([
        { date: "20261118", users: "12" },
        { date: "20261116", users: "5" },
      ]),
    );
    expect(rows).toEqual([
      { dateKey: "20261116", activeUsers: 5 },
      { dateKey: "20261118", activeUsers: 12 },
    ]);
    expect(rowsToPoints(rows ?? [])).toEqual([
      { label: "16 Nov", value: 5 },
      { label: "17 Nov", value: 0 },
      { label: "18 Nov", value: 12 },
    ]);
  });

  it("fills interior date gaps with 0, across month and year boundaries", () => {
    const rows: GaDailyRow[] = [
      { dateKey: "20261130", activeUsers: 4 },
      { dateKey: "20261202", activeUsers: 6 },
    ];
    expect(fillInteriorDateGaps(rows)).toEqual([
      { dateKey: "20261130", activeUsers: 4 },
      { dateKey: "20261201", activeUsers: 0 },
      { dateKey: "20261202", activeUsers: 6 },
    ]);
    expect(
      fillInteriorDateGaps([
        { dateKey: "20261231", activeUsers: 1 },
        { dateKey: "20270102", activeUsers: 2 },
      ]),
    ).toEqual([
      { dateKey: "20261231", activeUsers: 1 },
      { dateKey: "20270101", activeUsers: 0 },
      { dateKey: "20270102", activeUsers: 2 },
    ]);
  });

  it("adds no dates outside the returned span", () => {
    expect(
      fillInteriorDateGaps([{ dateKey: "20261118", activeUsers: 3 }]),
    ).toEqual([{ dateKey: "20261118", activeUsers: 3 }]);
    expect(fillInteriorDateGaps([])).toEqual([]);
  });

  it("skips unparseable rows instead of coercing them", () => {
    const rows = parseRunReportResponse({
      rows: [
        { dimensionValues: [{ value: "bogus" }], metricValues: [{ value: "9" }] },
        { dimensionValues: [{ value: "20261118" }], metricValues: [{ value: "NaN" }] },
        { dimensionValues: [{ value: "20261118" }], metricValues: [{ value: "7" }] },
      ],
    });
    expect(rows).toEqual([{ dateKey: "20261118", activeUsers: 7 }]);
  });

  it("treats a missing rows key as zero visitors, and a malformed body as null", () => {
    expect(parseRunReportResponse({})).toEqual([]);
    expect(parseRunReportResponse(null)).toBeNull();
    expect(parseRunReportResponse({ rows: "nope" })).toBeNull();
    expect(parseRunReportResponse({ rows: [42] })).toBeNull();
  });

  it("formats GA date labels without timezone shifts", () => {
    expect(formatGaDateLabel("20261118")).toBe("18 Nov");
    expect(formatGaDateLabel("20260105")).toBe("5 Jan");
  });
});

describe("readGaDailyVisitors failure modes", () => {
  it("returns null when unconfigured, without calling fetch", async () => {
    const fetchImpl = () => {
      throw new Error("must not be called");
    };
    await expect(
      readGaDailyVisitors("7-days", { env: {}, fetchImpl: fetchImpl as typeof fetch }),
    ).resolves.toBeNull();
  });

  it("returns null on token-exchange failure, report failure, and network throws", async () => {
    const tokenFail = stubFetch({ rows: [] }, { tokenStatus: 400 });
    await expect(
      readGaDailyVisitors("7-days", { env: fixtureEnv(), fetchImpl: tokenFail.fetchImpl }),
    ).resolves.toBeNull();

    const reportFail = stubFetch({ rows: [] }, { reportStatus: 403 });
    await expect(
      readGaDailyVisitors("7-days", { env: fixtureEnv(), fetchImpl: reportFail.fetchImpl }),
    ).resolves.toBeNull();

    const throwing = (() => Promise.reject(new Error("network down"))) as typeof fetch;
    await expect(
      readGaDailyVisitors("7-days", { env: fixtureEnv(), fetchImpl: throwing }),
    ).resolves.toBeNull();
  });

  it("returns null on invalid JSON and malformed report bodies", async () => {
    const badJson = (async (url: string | URL | Request) => {
      if (String(url).includes("oauth2")) {
        return jsonResponse({ access_token: "fixture-access-token" });
      }
      return new Response("not json{", { status: 200 });
    }) as typeof fetch;
    await expect(
      readGaDailyVisitors("7-days", { env: fixtureEnv(), fetchImpl: badJson }),
    ).resolves.toBeNull();

    const malformed = stubFetch({ rows: "nope" });
    await expect(
      readGaDailyVisitors("7-days", { env: fixtureEnv(), fetchImpl: malformed.fetchImpl }),
    ).resolves.toBeNull();
  });
});

describe("getVisitorReport with the GA read-back", () => {
  it("returns available + real points when configured and the API answers", async () => {
    const { fetchImpl } = stubFetch(
      reportFixture([
        { date: "20261117", users: "8" },
        { date: "20261118", users: "11" },
      ]),
    );
    await expect(
      getVisitorReport("7-days", { env: fixtureEnv(), fetchImpl }),
    ).resolves.toEqual({
      status: "available",
      period: "7-days",
      points: [
        { label: "17 Nov", value: 8 },
        { label: "18 Nov", value: 11 },
      ],
    });
  });

  it("returns available with empty points when the API reports no rows", async () => {
    const { fetchImpl } = stubFetch({});
    await expect(
      getVisitorReport("today", { env: fixtureEnv(), fetchImpl }),
    ).resolves.toEqual({ status: "available", period: "today", points: [] });
  });

  it("returns unavailable on API failure, never throwing", async () => {
    const { fetchImpl } = stubFetch({ rows: [] }, { reportStatus: 500 });
    await expect(
      getVisitorReport("7-days", { env: fixtureEnv(), fetchImpl }),
    ).resolves.toEqual({ status: "unavailable", period: "7-days", points: [] });
  });
});

describe("no credentials in client code", () => {
  function readSource(path: string): string {
    return readFileSync(new URL(path, import.meta.url), "utf8");
  }

  it("keeps the GA module server-only and env-driven", () => {
    const source = readSource("../src/lib/admin/ga-visitors.ts");
    expect(source).toContain('import "server-only"');
    expect(source).toContain("env.GA_PROPERTY_ID");
    expect(source).toContain("env.GA_SERVICE_ACCOUNT_EMAIL");
    expect(source).toContain("env.GA_SERVICE_ACCOUNT_PRIVATE_KEY");
    expect(source).not.toContain("process.env.GA_");
    expect(source).not.toContain("process.env.NEXT_PUBLIC");
    expect(source).not.toContain("env.NEXT_PUBLIC");
    // The only "PRIVATE KEY" strings are the PEM marker checks.
    expect(source.match(/PRIVATE KEY/g)).toHaveLength(2);
    expect(source).not.toContain("AIza");
  });

  it("references the GA env vars only inside the GA module", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = readFileSync(path, "utf8");
          if (
            text.includes("GA_PROPERTY_ID") ||
            text.includes("GA_SERVICE_ACCOUNT_EMAIL") ||
            text.includes("GA_SERVICE_ACCOUNT_PRIVATE_KEY")
          ) {
            hits.push(path);
          }
        }
      }
    };
    walk(srcRoot);
    expect(hits).toEqual([`${srcRoot}/lib/admin/ga-visitors.ts`]);
  });

  it("is imported by no client component", () => {
    const srcRoot = fileURLToPath(new URL("../src", import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          const text = readFileSync(path, "utf8");
          const isClient = text.includes('"use client"') || text.includes("'use client'");
          if (
            isClient &&
            (text.includes("ga-visitors") || text.includes("analytics/visitors"))
          ) {
            offenders.push(path);
          }
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});

describe("readGaDailyVisitors access-token cache", () => {
  it("reuses one token exchange across reads on the production path", async () => {
    resetGaAccessTokenCache();
    const env = fixtureEnv();
    const saved = {
      GA_PROPERTY_ID: process.env.GA_PROPERTY_ID,
      GA_SERVICE_ACCOUNT_EMAIL: process.env.GA_SERVICE_ACCOUNT_EMAIL,
      GA_SERVICE_ACCOUNT_PRIVATE_KEY: process.env.GA_SERVICE_ACCOUNT_PRIVATE_KEY,
    };
    const restore = (key: keyof typeof saved, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    process.env.GA_PROPERTY_ID = env.GA_PROPERTY_ID;
    process.env.GA_SERVICE_ACCOUNT_EMAIL = env.GA_SERVICE_ACCOUNT_EMAIL;
    process.env.GA_SERVICE_ACCOUNT_PRIVATE_KEY = env.GA_SERVICE_ACCOUNT_PRIVATE_KEY;
    const { fetchImpl, requests } = stubFetch(
      reportFixture([{ date: "20261118", users: "12" }]),
    );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const first = await readGaDailyVisitors("7-days");
      const second = await readGaDailyVisitors("7-days");
      expect(first).not.toBeNull();
      expect(second).toEqual(first);
      expect(
        requests.filter(
          (request) => request.url === "https://oauth2.googleapis.com/token",
        ),
      ).toHaveLength(1);
      expect(
        requests.filter((request) =>
          request.url.includes("analyticsdata.googleapis.com"),
        ),
      ).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      restore("GA_PROPERTY_ID", saved.GA_PROPERTY_ID);
      restore("GA_SERVICE_ACCOUNT_EMAIL", saved.GA_SERVICE_ACCOUNT_EMAIL);
      restore("GA_SERVICE_ACCOUNT_PRIVATE_KEY", saved.GA_SERVICE_ACCOUNT_PRIVATE_KEY);
      resetGaAccessTokenCache();
    }
  });
});
