import "server-only";

import { createSign } from "node:crypto";

/* ------------------------------------------------------------------ */
/* Google Analytics Data API read-back for the Total Visitors graph.   */
/*                                                                     */
/* SOURCE: the GA4 property's Data API (v1beta runReport), read with  */
/* a service account. This module NEVER invents numbers: when the env  */
/* config is absent/invalid, or any API call fails, callers get null   */
/* and the Analytics page keeps its honest unavailable state.          */
/*                                                                     */
/* CONFIG (server-side env vars ONLY, set in Vercel env vars; never    */
/* NEXT_PUBLIC_, never committed, never logged):                       */
/*   GA_PROPERTY_ID                 numeric GA4 property ID            */
/*   GA_SERVICE_ACCOUNT_EMAIL       service-account client email       */
/*   GA_SERVICE_ACCOUNT_PRIVATE_KEY PEM private key; the whole       */
/*                                  service-account JSON, the PEM      */
/*                                  text, or the base64 body alone     */
/*                                  are all accepted (see              */
/*                                  normalizePrivateKey)               */
/* The service account needs Viewer (or higher) on the GA4 property    */
/* and the Analytics Data API enabled in its GCP project. Whether a    */
/* GA4 property exists at all is UNVERIFIED — the owner confirms it    */
/* in his browser before any live check.                               */
/*                                                                     */
/* NO NEW DEPENDENCY: auth is a hand-built RS256 JWT (Node crypto)     */
/* plus two plain fetch calls. Adding googleapis for two HTTPS calls   */
/* would pull in megabytes of client code for a server-only seam.      */
/*                                                                     */
/* Tests use fetchImpl/env injection only and never touch Google.      */
/* ------------------------------------------------------------------ */

const DIAGNOSTIC_PREFIX = "[attiresarena:ga-visitors]";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DATA_API_BASE_URL = "https://analyticsdata.googleapis.com/v1beta";
const GA_READONLY_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/** Per-request cap so a hung Google call never hangs the page render. */
const REQUEST_TIMEOUT_MS = 10_000;

/** JWT lifetime for the token exchange (Google's maximum is 1 hour). */
const JWT_LIFETIME_SECONDS = 3600;

export interface GaVisitorsConfiguration {
  propertyId: string;
  clientEmail: string;
  /** PEM text with real newlines (unescaped from the env value). */
  privateKey: string;
}

const PROPERTY_ID_PATTERN = /^\d{1,20}$/;

function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** PEM markers, defined once: the marker-check test counts these literals. */
const BEGIN_MARKER = "-----BEGIN PRIVATE KEY-----";
const END_MARKER = "-----END PRIVATE KEY-----";

/**
 * Accepts the private key in the shapes a dashboard paste actually
 * produces, so one paste-format slip cannot wedge the graph:
 * the whole service-account JSON, the PEM text (with literal `\n`
 * escapes or real newlines), or the base64 body alone (markers
 * re-wrapped, folded at 64 columns). Anything else passes through
 * unchanged and the marker check below rejects it, as before.
 * Never logs: the value is secret in every shape.
 */
function normalizePrivateKey(rawKey: string): string {
  let candidate = rawKey.trim();
  if (candidate.startsWith("{")) {
    try {
      const parsed = JSON.parse(candidate) as { private_key?: unknown };
      if (typeof parsed.private_key === "string" && parsed.private_key.length > 0) {
        candidate = parsed.private_key;
      }
    } catch {
      /* Not JSON after all: fall through to the marker check. */
    }
  }
  candidate = candidate.replace(/\\n/g, "\n").trim();
  if (
    candidate.length >= 2 &&
    candidate.startsWith('"') &&
    candidate.endsWith('"')
  ) {
    candidate = candidate.slice(1, -1).trim();
  }
  if (candidate.includes(BEGIN_MARKER) && candidate.includes(END_MARKER)) {
    return candidate;
  }
  const body = candidate.replace(/\s+/g, "");
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(body) && body.length >= 500) {
    const folded = body.match(/.{1,64}/g)?.join("\n") ?? body;
    return `${BEGIN_MARKER}\n${folded}\n${END_MARKER}`;
  }
  return candidate;
}

/**
 * Env-gated configuration (courier.ts shape: null-when-unconfigured).
 * The private key is normalized for paste shapes (see
 * normalizePrivateKey) before the marker check.
 */
export function gaVisitorsConfiguration(
  env: Record<string, string | undefined> = process.env,
): GaVisitorsConfiguration | null {
  const propertyId = (env.GA_PROPERTY_ID ?? "").trim();
  const clientEmail = (env.GA_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const rawKey = (env.GA_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").trim();
  if (!PROPERTY_ID_PATTERN.test(propertyId)) {
    console.error(`${DIAGNOSTIC_PREFIX} config invalid: property id`);
    return null;
  }
  if (!isPlausibleEmail(clientEmail)) {
    console.error(`${DIAGNOSTIC_PREFIX} config invalid: service account email`);
    return null;
  }
  const privateKey = normalizePrivateKey(rawKey);
  if (privateKey.length === 0) {
    console.error(`${DIAGNOSTIC_PREFIX} config invalid: private key missing`);
    return null;
  }
  if (
    !privateKey.includes(BEGIN_MARKER) ||
    !privateKey.includes(END_MARKER)
  ) {
    console.error(`${DIAGNOSTIC_PREFIX} config invalid: private key markers`);
    return null;
  }
  return { propertyId, clientEmail, privateKey };
}

export function isGaVisitorsConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return gaVisitorsConfiguration(env) !== null;
}

/** Visitor periods, in the order Fahim listed them (mirrors visitors.ts). */
export type GaVisitorPeriod = "today" | "7-days" | "15-days" | "1-month";

/**
 * GA relative date ranges, evaluated in the property's timezone by
 * Google. "1 month" is the trailing 30 days inclusive. Multi-day
 * ranges return one row per day (see fillInteriorDateGaps).
 */
export const GA_DATE_RANGES: Record<
  GaVisitorPeriod,
  { startDate: string; endDate: string }
> = {
  today: { startDate: "today", endDate: "today" },
  "7-days": { startDate: "6daysAgo", endDate: "today" },
  "15-days": { startDate: "14daysAgo", endDate: "today" },
  "1-month": { startDate: "29daysAgo", endDate: "today" },
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * RS256-signed JWT for the OAuth2 JWT-bearer grant. Exported for
 * tests, which verify the signature against a generated key pair.
 */
export function buildServiceAccountJwt(
  config: GaVisitorsConfiguration,
  nowSeconds: number,
): string {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: config.clientEmail,
    sub: config.clientEmail,
    aud: TOKEN_URL,
    scope: GA_READONLY_SCOPE,
    iat: nowSeconds,
    exp: nowSeconds + JWT_LIFETIME_SECONDS,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(config.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

type FetchImpl = typeof fetch;

async function fetchAccessToken(
  config: GaVisitorsConfiguration,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  const assertion = buildServiceAccountJwt(
    config,
    Math.floor(Date.now() / 1000),
  );
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      `${DIAGNOSTIC_PREFIX} token exchange threw: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
  if (!response.ok) {
    console.error(
      `${DIAGNOSTIC_PREFIX} token exchange failed (status ${response.status})`,
    );
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error(`${DIAGNOSTIC_PREFIX} token exchange returned invalid JSON`);
    return null;
  }
  const token =
    typeof payload === "object" &&
    payload !== null &&
    "access_token" in payload
      ? (payload as { access_token: unknown }).access_token
      : null;
  if (typeof token !== "string" || token.length === 0) {
    console.error(`${DIAGNOSTIC_PREFIX} token exchange returned no access token`);
    return null;
  }
  return token;
}

/** One parsed runReport row: a GA date key (YYYYMMDD) + active users. */
export interface GaDailyRow {
  dateKey: string;
  activeUsers: number;
}

const GA_DATE_KEY_PATTERN = /^\d{8}$/;

/**
 * Defensive parse of a runReport response. Rows with an unparseable
 * date or metric are skipped (never coerced into a fake number); a
 * wholly malformed body yields null. Exported for fixture tests.
 */
export function parseRunReportResponse(payload: unknown): GaDailyRow[] | null {
  if (typeof payload !== "object" || payload === null) return null;
  const rows = (payload as { rows?: unknown }).rows;
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) return null;
  const parsed: GaDailyRow[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) return null;
    const dimensionValues = (row as { dimensionValues?: unknown })
      .dimensionValues;
    const metricValues = (row as { metricValues?: unknown }).metricValues;
    if (!Array.isArray(dimensionValues) || !Array.isArray(metricValues)) {
      return null;
    }
    const dateValue = (
      dimensionValues[0] as { value?: unknown } | undefined
    )?.value;
    const metricValue = (
      metricValues[0] as { value?: unknown } | undefined
    )?.value;
    if (
      typeof dateValue !== "string" ||
      !GA_DATE_KEY_PATTERN.test(dateValue) ||
      typeof metricValue !== "string"
    ) {
      continue;
    }
    const activeUsers = Number(metricValue);
    if (!Number.isFinite(activeUsers) || activeUsers < 0) continue;
    parsed.push({ dateKey: dateValue, activeUsers: Math.floor(activeUsers) });
  }
  parsed.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  return parsed;
}

function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(
    Date.UTC(
      Number(dateKey.slice(0, 4)),
      Number(dateKey.slice(4, 6)) - 1,
      Number(dateKey.slice(6, 8)),
    ),
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * The Data API omits dates with zero users, so a multi-day series
 * would otherwise skip days. Interior gaps (between two returned
 * dates) are filled with 0 — the correct reading of an omitted row,
 * not an estimate. No dates are added outside the returned span:
 * leading/trailing zeros stay absent rather than invented.
 */
export function fillInteriorDateGaps(rows: readonly GaDailyRow[]): GaDailyRow[] {
  if (rows.length === 0) return [];
  const filled: GaDailyRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;
    const previous = filled[filled.length - 1];
    if (previous) {
      let cursor = shiftDateKey(previous.dateKey, 1);
      while (cursor < row.dateKey) {
        filled.push({ dateKey: cursor, activeUsers: 0 });
        cursor = shiftDateKey(cursor, 1);
      }
    }
    filled.push(row);
  }
  return filled;
}

const MONTH_SHORT_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "20261118" -> "18 Nov". Pure date-part parsing: no timezone shift. */
export function formatGaDateLabel(dateKey: string): string {
  const day = Number(dateKey.slice(6, 8));
  const month = MONTH_SHORT_NAMES[Number(dateKey.slice(4, 6)) - 1] ?? "";
  return `${day} ${month}`;
}

/** One plotted visitor total. Mirrors SeriesPoint (label + value). */
export interface GaVisitorPoint {
  label: string;
  value: number;
}

export function rowsToPoints(rows: readonly GaDailyRow[]): GaVisitorPoint[] {
  return fillInteriorDateGaps(rows).map((row) => ({
    label: formatGaDateLabel(row.dateKey),
    value: row.activeUsers,
  }));
}

export interface RunReportRequest {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions: { name: string }[];
  metrics: { name: string }[];
  orderBys: { dimension: { dimensionName: string } }[];
  limit: number;
}

/** The exact runReport body for a period. Exported for fixture tests. */
export function buildRunReportRequest(period: GaVisitorPeriod): RunReportRequest {
  const range = GA_DATE_RANGES[period];
  return {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    dimensions: [{ name: "date" }],
    metrics: [{ name: "activeUsers" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
    limit: 31,
  };
}

async function fetchDailyActiveUsers(
  config: GaVisitorsConfiguration,
  accessToken: string,
  period: GaVisitorPeriod,
  fetchImpl: FetchImpl,
): Promise<GaDailyRow[] | null> {
  const url = `${DATA_API_BASE_URL}/properties/${config.propertyId}:runReport`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRunReportRequest(period)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    console.error(
      `${DIAGNOSTIC_PREFIX} report request threw: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
  if (!response.ok) {
    console.error(
      `${DIAGNOSTIC_PREFIX} report request failed (status ${response.status})`,
    );
    return null;
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    console.error(`${DIAGNOSTIC_PREFIX} report request returned invalid JSON`);
    return null;
  }
  const rows = parseRunReportResponse(payload);
  if (rows === null) {
    console.error(`${DIAGNOSTIC_PREFIX} report response was malformed`);
  }
  return rows;
}

/**
 * Daily visitor points for a period, or null when unconfigured or on
 * any failure. Never throws: the seam turns null into the honest
 * unavailable state. `fetchImpl`/`env` overrides exist for tests
 * only; production callers pass neither.
 */
export async function readGaDailyVisitors(
  period: GaVisitorPeriod,
  overrides?: {
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchImpl;
  },
): Promise<GaVisitorPoint[] | null> {
  const config = gaVisitorsConfiguration(overrides?.env);
  if (config === null) return null;
  const fetchImpl = overrides?.fetchImpl ?? fetch;
  try {
    const accessToken = await fetchAccessToken(config, fetchImpl);
    if (accessToken === null) return null;
    const rows = await fetchDailyActiveUsers(config, accessToken, period, fetchImpl);
    if (rows === null) return null;
    return rowsToPoints(rows);
  } catch (error) {
    console.error(
      `${DIAGNOSTIC_PREFIX} visitor read threw: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
}
