import { describe, expect, it } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EmptyState,
  Notice,
  PageHeading,
  Pagination,
  Panel,
  SkeletonRows,
  StatusBadge,
} from "@/components/admin/ui";

describe("admin ui primitives", () => {
  it("renders the page heading with eyebrow, h1 and description", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeading, {
        eyebrow: "Catalog",
        title: "Products",
        description: "Manage the catalogue.",
      }),
    );
    expect(html).toContain('<p class="aa-eyebrow">Catalog</p>');
    expect(html).toContain("<h1>Products</h1>");
    expect(html).toContain("Manage the catalogue.");
  });

  it("announces error notices assertively and other notices politely", () => {
    const error = renderToStaticMarkup(
      createElement(Notice, { kind: "error" } as ComponentProps<typeof Notice>, "Something failed."),
    );
    expect(error).toContain('role="alert"');
    expect(error).toContain("aa-notice--error");
    const info = renderToStaticMarkup(
      createElement(Notice, { kind: "info" } as ComponentProps<typeof Notice>, "All good."),
    );
    expect(info).toContain('role="status"');
    expect(info).toContain("aa-notice--info");
  });

  it("renders status badges with their tone class", () => {
    const html = renderToStaticMarkup(
      createElement(StatusBadge, { tone: "success" } as ComponentProps<typeof StatusBadge>, "Active"),
    );
    expect(html).toContain("aa-badge--success");
    expect(html).toContain(">Active<");
  });

  it("renders pagination as a labelled nav with the current page marked", () => {
    const html = renderToStaticMarkup(
      createElement(Pagination, {
        page: 2,
        totalPages: 5,
        hrefFor: (page: number) => `/admin/sales/orders?page=${page}`,
      }),
    );
    expect(html).toContain('<nav aria-label="Pagination"');
    expect(html).toContain('aria-current="page">2<');
    expect(html).toContain("Previous page");
    expect(html).toContain("Next page");
  });

  it("renders nothing for a single page of results", () => {
    expect(
      renderToStaticMarkup(
        createElement(Pagination, {
          page: 1,
          totalPages: 1,
          hrefFor: (page: number) => `?page=${page}`,
        }),
      ),
    ).toBe("");
  });

  it("hides skeleton rows from assistive technology", () => {
    const html = renderToStaticMarkup(createElement(SkeletonRows, { rows: 3 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html.match(/aa-skeleton-row/g)).toHaveLength(3);
  });

  it("renders empty states with a heading and description", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "No products yet",
        description: "Add your first product to get started.",
      }),
    );
    expect(html).toContain("<h3>No products yet</h3>");
    expect(html).toContain("Add your first product to get started.");
  });

  it("renders panels as sections with an h2 title", () => {
    const html = renderToStaticMarkup(
      createElement(
        Panel,
        {
          title: "Details",
          description: "About this record.",
        } as ComponentProps<typeof Panel>,
        "Body",
      ),
    );
    expect(html).toContain('<section class="aa-panel">');
    expect(html).toContain("<h2>Details</h2>");
    expect(html).toContain("Body");
  });
});
