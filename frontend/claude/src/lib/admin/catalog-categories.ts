'use server';

/**
 * Catalogue categories: server reads + Server Actions for
 * /admin/catalog/categories.
 *
 * Writes go through admin_save_category / admin_delete_category /
 * admin_reorder_categories (migration 20261115000200), which enforce
 * require_admin('catalogue.manage') + MFA, parent-cycle rejection and the
 * max-depth-3 rule in the database. No staging checks anywhere here.
 *
 * Category images/banners reuse the private 'attires-product-drafts'
 * bucket: the client uploads bytes via catalog-media.ts, the storage path
 * is stored in the new categories columns, and display uses signed URLs.
 * Note: storefront category display follows existing publication
 * behaviour; saving a category here does not change the storefront feed.
 */

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffSession } from "./access";
import {
  actionError,
  actionOk,
  requireStaff,
  type AdminActionResult,
} from "./authorization";
import { areaRoles, PRODUCT_MEDIA_BUCKET } from "./constants";
import { slugify } from "./format";
import {
  isValidSlug,
  type CategoryFlat,
} from "./catalog-variants";

const categoryRowSchema = z.object({
  id: z.uuid(),
  parent_id: z.uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  published: z.boolean(),
  description: z.string(),
  image_storage_path: z.string().nullable(),
  banner_storage_path: z.string().nullable(),
  seo_title: z.string().nullable(),
  seo_description: z.string().nullable(),
  sort_position: z.number().int(),
  updated_at: z.iso.datetime({ offset: true }),
});

export interface CategoryWithUrls extends CategoryFlat {
  imageUrl: string | null;
  bannerUrl: string | null;
}

async function signedUrl(
  client: Awaited<ReturnType<typeof staffSession>>["client"],
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const signed = await client.storage
    .from(PRODUCT_MEDIA_BUCKET)
    .createSignedUrl(path, 120);
  return signed.error ? null : signed.data.signedUrl;
}

/** All categories, sort-ordered, with signed image/banner URLs. */
export async function listCategories(): Promise<{
  categories: CategoryWithUrls[];
  canManage: boolean;
}> {
  const session = await requireStaff(areaRoles("catalogue"));
  const result = await session.client
    .from("categories")
    .select(
      "id,parent_id,name,slug,published,description,image_storage_path," +
        "banner_storage_path,seo_title,seo_description,sort_position,updated_at",
    )
    .order("sort_position", { ascending: true })
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(500);
  let rows: CategoryFlat[];
  if (result.error) {
    // Pre-migration fallback: base columns only, new fields defaulted.
    const fallback = await session.client
      .from("categories")
      .select("id,parent_id,name,slug,published,updated_at")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(500);
    if (fallback.error) {
      throw new Error("Categories could not be read.");
    }
    rows = z
      .array(
        z.object({
          id: z.uuid(),
          parent_id: z.uuid().nullable(),
          name: z.string(),
          slug: z.string(),
          published: z.boolean(),
          updated_at: z.iso.datetime({ offset: true }),
        }),
      )
      .parse(fallback.data ?? [])
      .map((row) => ({
        ...row,
        description: "",
        image_storage_path: null,
        banner_storage_path: null,
        seo_title: null,
        seo_description: null,
        sort_position: 0,
      }));
  } else {
    rows = z.array(categoryRowSchema).parse(result.data ?? []);
  }
  const categories = await Promise.all(
    rows.map(async (row) => ({
      ...row,
      imageUrl: await signedUrl(session.client, row.image_storage_path),
      bannerUrl: await signedUrl(session.client, row.banner_storage_path),
    })),
  );
  return {
    categories,
    canManage: session.roles.some(
      (r) => r === "owner" || r === "product_manager",
    ),
  };
}

// -------------------------------------------------------------------- actions

export interface CategoryFormState {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const STORAGE_PATH_PATTERN =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(120),
  slug: z
    .string()
    .trim()
    .min(1, "Enter a URL slug.")
    .max(160)
    .refine(isValidSlug, "Use lowercase letters, numbers and single hyphens."),
  parent_id: z.uuid().nullable(),
  published: z.boolean(),
  description: z.string().max(2000, "Description is too long."),
  image_storage_path: z
    .string()
    .nullable()
    .refine(
      (v) => v === null || STORAGE_PATH_PATTERN.test(v),
      "Invalid image reference.",
    ),
  banner_storage_path: z
    .string()
    .nullable()
    .refine(
      (v) => v === null || STORAGE_PATH_PATTERN.test(v),
      "Invalid banner reference.",
    ),
  seo_title: z.string().trim().max(160).nullable(),
  seo_description: z.string().trim().max(320).nullable(),
  sort_position: z.number().int().min(0),
});

function rpcMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (
      typeof message === "string" &&
      message.trim().length > 0 &&
      message.length <= 300 &&
      !/constraint|violates|SQLSTATE|relation |function |column |does not exist/i.test(
        message,
      )
    ) {
      return message.trim();
    }
  }
  return fallback;
}

function rpcCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export async function saveCategory(
  _prev: CategoryFormState,
  form: FormData,
): Promise<CategoryFormState> {
  const session = await requireStaff(areaRoles("catalogue"));
  const text = (key: string): string => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const rawId = text("id").trim();
  const isUpdate = rawId !== "";
  const id = isUpdate ? rawId : randomUUID();
  const expectedUpdatedAt = text("updated_at").trim();
  const rawName = text("name");
  const sortRaw = text("sort_position").trim();
  const sortPosition = /^\d{1,9}$/.test(sortRaw)
    ? Number.parseInt(sortRaw, 10)
    : NaN;
  const fieldErrors: Record<string, string> = {};
  if (isUpdate && !z.uuid().safeParse(id).success) {
    fieldErrors.form = "Reload the category before saving.";
  }
  if (isUpdate && !expectedUpdatedAt) {
    fieldErrors.form = "Reload the category before saving.";
  }
  if (!Number.isFinite(sortPosition)) {
    fieldErrors.sort_position = "Enter a whole-number sort position.";
  }
  const candidate = {
    name: rawName,
    slug: text("slug").trim() || slugify(rawName),
    parent_id: text("parent_id").trim() === "" ? null : text("parent_id").trim(),
    published: text("published") === "on",
    description: text("description"),
    image_storage_path:
      text("image_storage_path").trim() === ""
        ? null
        : text("image_storage_path").trim(),
    banner_storage_path:
      text("banner_storage_path").trim() === ""
        ? null
        : text("banner_storage_path").trim(),
    seo_title: text("seo_title").trim() === "" ? null : text("seo_title").trim(),
    seo_description:
      text("seo_description").trim() === ""
        ? null
        : text("seo_description").trim(),
    sort_position: Number.isFinite(sortPosition) ? sortPosition : -1,
  };
  if (candidate.parent_id === id) {
    fieldErrors.parent_id = "A category cannot be its own parent.";
  }
  const parsed = categoryFormSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: "Check the highlighted fields and try again.",
      fieldErrors,
    };
  }
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields and try again." };
  }
  const oldImage = text("old_image_storage_path").trim() || null;
  const oldBanner = text("old_banner_storage_path").trim() || null;
  const result = await session.client.rpc("admin_save_category", {
    p: {
      id,
      expected_updated_at: isUpdate ? expectedUpdatedAt : null,
      ...parsed.data,
    },
  });
  if (result.error) {
    const message = rpcMessage(result.error, "Category could not be saved.");
    if (rpcCode(result.error) === "PT409") {
      return {
        ok: false,
        error: "This category changed. Reload before saving.",
        fieldErrors: { form: "This category changed. Reload before saving." },
      };
    }
    if (rpcCode(result.error) === "23505" || /slug already exists/i.test(message)) {
      return {
        ok: false,
        error: "That URL slug already exists. Choose a different slug.",
        fieldErrors: { slug: "That URL slug already exists." },
      };
    }
    return { ok: false, error: message };
  }
  // Best-effort cleanup of replaced image bytes (category paths are not
  // referenced by product_media, so the restrictive storage policies do
  // not block removal). Failures here never fail the save.
  const stale: string[] = [];
  if (oldImage && oldImage !== parsed.data.image_storage_path) stale.push(oldImage);
  if (oldBanner && oldBanner !== parsed.data.banner_storage_path) stale.push(oldBanner);
  if (stale.length > 0) {
    await session.client.storage.from(PRODUCT_MEDIA_BUCKET).remove(stale);
  }
  revalidatePath("/admin/catalog/categories");
  revalidatePath("/admin/catalog/products");
  return {
    ok: true,
    message: isUpdate ? "Category saved." : "Category created.",
  };
}

export async function deleteCategory(
  categoryId: string,
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  if (!z.uuid().safeParse(categoryId).success) {
    return actionError("Invalid category.");
  }
  const existing = await session.client
    .from("categories")
    .select("image_storage_path,banner_storage_path")
    .eq("id", categoryId)
    .maybeSingle();
  const result = await session.client.rpc("admin_delete_category", {
    target_id: categoryId,
  });
  if (result.error) {
    return actionError(rpcMessage(result.error, "Category could not be deleted."));
  }
  if (!existing.error && existing.data) {
    const stale = [
      existing.data.image_storage_path,
      existing.data.banner_storage_path,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    if (stale.length > 0) {
      await session.client.storage.from(PRODUCT_MEDIA_BUCKET).remove(stale);
    }
  }
  revalidatePath("/admin/catalog/categories");
  revalidatePath("/admin/catalog/products");
  return actionOk("Category deleted.");
}

export async function reorderCategories(
  orderedIds: string[],
): Promise<AdminActionResult> {
  const session = await requireStaff(areaRoles("catalogue"));
  const parsed = z.array(z.uuid()).min(1).max(500).safeParse(orderedIds);
  if (!parsed.success) return actionError("Invalid category order.");
  if (new Set(parsed.data).size !== parsed.data.length) {
    return actionError("The new order contains a duplicate category.");
  }
  const result = await session.client.rpc("admin_reorder_categories", {
    ordered_ids: parsed.data,
  });
  if (result.error) {
    return actionError(rpcMessage(result.error, "Categories could not be reordered."));
  }
  revalidatePath("/admin/catalog/categories");
  return actionOk("Category order saved.");
}
