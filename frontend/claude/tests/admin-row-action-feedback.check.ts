import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => {
  const rpc = vi.fn(
    async (): Promise<{ error: { message: string } | null; data: unknown }> => ({
      error: null,
      data: null,
    }),
  );
  const remove = vi.fn(async () => ({ error: null }));
  // Result returned for every non-user_roles query (select list or
  // maybeSingle); each test sets it before calling the action.
  const state = {
    queryResult: { data: null as unknown, error: null as unknown },
  };
  function query(result: { data: unknown; error: unknown }) {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.maybeSingle = async () => result;
    // Awaiting the chain itself (list selects) resolves to the result.
    chain.then = (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  }
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "owner-1", is_anonymous: false } },
        error: null,
      })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: "aal2" },
          error: null,
        })),
      },
    },
    from: (table: string) => {
      if (table === "user_roles") {
        return query({ data: [{ role: "owner" }], error: null });
      }
      return query(state.queryResult);
    },
    rpc,
    storage: { from: () => ({ remove }) },
  };
  return { rpc, remove, state, client };
});

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {}, get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/admin/supabase", () => ({
  adminClient: async () => mocks.client,
  adminConfiguration: () => null,
}));

import {
  deleteBanner,
  deleteContentBlock,
  moveBanner,
  toggleBannerVisibility,
} from "../src/lib/admin/content";
import { deleteWidget, toggleWidgetActive } from "../src/lib/admin/widgets";
import { deleteRedirect, toggleRedirectActive } from "../src/lib/admin/redirects";
import { clearBrandImage } from "../src/lib/admin/settings";
import { removeStaffAccess } from "../src/lib/admin/users";

const BANNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_BANNER_ID = "22222222-2222-4222-8222-222222222222";
const WIDGET_ID = "33333333-3333-4333-8333-333333333333";
const REDIRECT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "55555555-5555-4555-8555-555555555555";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ error: null, data: null });
  mocks.state.queryResult = { data: null, error: null };
});

describe("banner row actions report success and failure", () => {
  it("deleteBanner returns ok on success and deletes the image file", async () => {
    const result = await deleteBanner(null, form({ id: BANNER_ID, image_storage_path: "banners/x.png" }));
    expect(result).toEqual({ ok: true, message: "Banner deleted." });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_delete_banner", { p_id: BANNER_ID });
    expect(mocks.remove).toHaveBeenCalledWith(["banners/x.png"]);
  });

  it("deleteBanner returns an error when the RPC fails and removes nothing", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await deleteBanner(null, form({ id: BANNER_ID, image_storage_path: "banners/x.png" }));
    expect(result).toEqual({ ok: false, error: "Banner could not be deleted." });
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("deleteBanner returns an error with no id", async () => {
    const result = await deleteBanner(null, form({}));
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("toggleBannerVisibility reports the new state on success", async () => {
    mocks.state.queryResult = {
      data: {
        id: BANNER_ID, title: "Sale", subtitle: null,
        image_storage_path: "banners/x.png", link_url: null,
        sort_position: 0, visible: true, placement: "hero",
      },
      error: null,
    };
    const result = await toggleBannerVisibility(null, form({ id: BANNER_ID }));
    expect(result).toEqual({ ok: true, message: "Banner hidden." });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "admin_save_banner",
      expect.objectContaining({ p_id: BANNER_ID, p_visible: false }),
    );
  });

  it("toggleBannerVisibility returns an error when the save RPC fails", async () => {
    mocks.state.queryResult = {
      data: {
        id: BANNER_ID, title: "Sale", subtitle: null,
        image_storage_path: "banners/x.png", link_url: null,
        sort_position: 0, visible: false, placement: "hero",
      },
      error: null,
    };
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await toggleBannerVisibility(null, form({ id: BANNER_ID }));
    expect(result).toEqual({ ok: false, error: "Banner visibility could not be changed." });
  });

  it("toggleBannerVisibility returns an error when the banner is gone", async () => {
    mocks.state.queryResult = { data: null, error: null };
    const result = await toggleBannerVisibility(null, form({ id: BANNER_ID }));
    expect(result).toEqual({ ok: false, error: "Banner not found. It may have been deleted." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("moveBanner swaps the order and reports the direction", async () => {
    mocks.state.queryResult = {
      data: [
        { id: BANNER_ID, sort_position: 0, created_at: "2026-01-01T00:00:00Z" },
        { id: OTHER_BANNER_ID, sort_position: 1, created_at: "2026-01-02T00:00:00Z" },
      ],
      error: null,
    };
    const result = await moveBanner(null, form({ id: OTHER_BANNER_ID, direction: "up" }));
    expect(result).toEqual({ ok: true, message: "Banner moved up." });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_reorder_banners", {
      p_ids: [OTHER_BANNER_ID, BANNER_ID],
    });
  });

  it("moveBanner returns an error at the edge instead of silently doing nothing", async () => {
    mocks.state.queryResult = {
      data: [
        { id: BANNER_ID, sort_position: 0, created_at: "2026-01-01T00:00:00Z" },
        { id: OTHER_BANNER_ID, sort_position: 1, created_at: "2026-01-02T00:00:00Z" },
      ],
      error: null,
    };
    const result = await moveBanner(null, form({ id: BANNER_ID, direction: "up" }));
    expect(result).toEqual({ ok: false, error: "Banner is already at the top." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("moveBanner returns an error when the reorder RPC fails", async () => {
    mocks.state.queryResult = {
      data: [
        { id: BANNER_ID, sort_position: 0, created_at: "2026-01-01T00:00:00Z" },
        { id: OTHER_BANNER_ID, sort_position: 1, created_at: "2026-01-02T00:00:00Z" },
      ],
      error: null,
    };
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await moveBanner(null, form({ id: BANNER_ID, direction: "down" }));
    expect(result).toEqual({ ok: false, error: "Banner could not be moved." });
  });
});

describe("content block delete reports success and failure", () => {
  it("deleteContentBlock returns ok on success", async () => {
    const result = await deleteContentBlock(null, form({ slug: "about" }));
    expect(result).toEqual({
      ok: true,
      message: "Content block deleted. The page now shows its built-in text.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_delete_content_block", { p_slug: "about" });
  });

  it("deleteContentBlock returns an error when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await deleteContentBlock(null, form({ slug: "about" }));
    expect(result).toEqual({ ok: false, error: "Content block could not be deleted." });
  });

  it("deleteContentBlock returns an error for an invalid slug", async () => {
    const result = await deleteContentBlock(null, form({ slug: "Bad Slug!" }));
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("widget row actions report success and failure", () => {
  const widgetRow = {
    id: WIDGET_ID, title: "Sale", type: "announcement", placement: "after-hero",
    title_visible: true, title_alignment: "left", title_size: "medium",
    subtitle: "", ends_at: null, offer_title: "", discount_text: "",
    style_theme: "default", use_theme_color: false,
    background_color: "", accent_color: "", title_color: "", content_color: "",
    sort_position: 0, active: true,
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };

  it("deleteWidget returns ok on success", async () => {
    const result = await deleteWidget(null, form({ id: WIDGET_ID }));
    expect(result).toEqual({ ok: true, message: "Widget deleted." });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_delete_widget", { p_id: WIDGET_ID });
  });

  it("deleteWidget returns an error when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await deleteWidget(null, form({ id: WIDGET_ID }));
    expect(result).toEqual({ ok: false, error: "Widget could not be deleted." });
  });

  it("toggleWidgetActive deactivates an active widget", async () => {
    mocks.state.queryResult = { data: widgetRow, error: null };
    const result = await toggleWidgetActive(null, form({ id: WIDGET_ID }));
    expect(result).toEqual({ ok: true, message: "Widget deactivated." });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "admin_save_widget",
      expect.objectContaining({ p_id: WIDGET_ID, p_active: false }),
    );
  });

  it("toggleWidgetActive returns an error when the save RPC fails", async () => {
    mocks.state.queryResult = { data: widgetRow, error: null };
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await toggleWidgetActive(null, form({ id: WIDGET_ID }));
    expect(result).toEqual({ ok: false, error: "Widget could not be updated." });
  });

  it("toggleWidgetActive returns an error when the widget is gone", async () => {
    mocks.state.queryResult = { data: null, error: null };
    const result = await toggleWidgetActive(null, form({ id: WIDGET_ID }));
    expect(result).toEqual({ ok: false, error: "Widget not found. It may have been deleted." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("redirect row actions report success and failure", () => {
  const redirectRow = {
    id: REDIRECT_ID, source_path: "/old", target_path: "/new", code: 301,
    active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };

  it("deleteRedirect returns ok on success", async () => {
    const result = await deleteRedirect(null, form({ id: REDIRECT_ID }));
    expect(result).toEqual({ ok: true, message: "Redirect deleted." });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_delete_redirect", { p_id: REDIRECT_ID });
  });

  it("deleteRedirect returns an error when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await deleteRedirect(null, form({ id: REDIRECT_ID }));
    expect(result).toEqual({ ok: false, error: "Redirect could not be deleted." });
  });

  it("toggleRedirectActive disables an active redirect", async () => {
    mocks.state.queryResult = { data: redirectRow, error: null };
    const result = await toggleRedirectActive(null, form({ id: REDIRECT_ID }));
    expect(result).toEqual({ ok: true, message: "Redirect disabled." });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "admin_save_redirect",
      expect.objectContaining({ p_id: REDIRECT_ID, p_active: false }),
    );
  });

  it("toggleRedirectActive returns an error when the save RPC fails", async () => {
    mocks.state.queryResult = { data: redirectRow, error: null };
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await toggleRedirectActive(null, form({ id: REDIRECT_ID }));
    expect(result).toEqual({ ok: false, error: "Redirect could not be updated." });
  });
});

describe("brand image removal reports success and failure", () => {
  it("clearBrandImage removes the logo and reports it", async () => {
    const result = await clearBrandImage(null, form({ kind: "logo" }));
    expect(result).toEqual({ ok: true, message: "Logo removed." });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_set_setting", {
      p_key: "logo_storage_path",
      p_value: "",
    });
  });

  it("clearBrandImage names the social sharing image", async () => {
    const result = await clearBrandImage(null, form({ kind: "social" }));
    expect(result).toEqual({ ok: true, message: "Social sharing image removed." });
  });

  it("clearBrandImage returns an error for an unknown image type", async () => {
    const result = await clearBrandImage(null, form({ kind: "nope" }));
    expect(result).toEqual({ ok: false, error: "Unknown image type." });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("clearBrandImage returns an error when the setting cannot be saved", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await clearBrandImage(null, form({ kind: "favicon" }));
    expect(result).toEqual({ ok: false, error: "Setting could not be saved." });
  });
});

describe("remove staff access reports success and failure", () => {
  it("removeStaffAccess returns ok on success", async () => {
    const result = await removeStaffAccess(null, form({ user_id: USER_ID }));
    expect(result).toEqual({ ok: true, message: "Staff access removed." });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_remove_staff", { target_user: USER_ID });
  });

  it("removeStaffAccess returns an error when the RPC fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "boom" }, data: null });
    const result = await removeStaffAccess(null, form({ user_id: USER_ID }));
    expect(result).toEqual({ ok: false, error: "Staff access could not be removed." });
  });

  it("removeStaffAccess returns an error for an invalid user id", async () => {
    const result = await removeStaffAccess(null, form({ user_id: "not-a-uuid" }));
    expect(result.ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("row UI wires the actions through useActionState feedback", () => {
  function source(path: string): string {
    return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
  }

  it("banner, widget and redirect lists use RowActionForm for toggles and moves", () => {
    for (const path of [
      "../src/components/admin/content/banner-list.tsx",
      "../src/components/admin/content/widget-list.tsx",
      "../src/components/admin/system/redirect-list.tsx",
    ]) {
      expect(source(path)).toContain("RowActionForm");
    }
  });

  it("ConfirmSubmit reports its action outcome inline", () => {
    const uiClient = source("../src/components/admin/ui-client.tsx");
    expect(uiClient).toContain("useActionState(action, null)");
    expect(uiClient).toContain("<FormMessage state={state} />");
  });

  it("BrandImageForm passes the clear action through ConfirmSubmit", () => {
    const forms = source("../src/components/admin/settings/forms.tsx");
    expect(forms).toContain("action={clearAction}");
    expect(forms).toContain("clearAction: RowAction");
  });
});
