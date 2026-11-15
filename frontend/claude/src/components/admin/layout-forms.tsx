"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/admin/ui-client";
import type { AdminActionResult } from "@/lib/admin/authorization";

type FormAction = (
  prev: AdminActionResult | null,
  form: FormData,
) => Promise<AdminActionResult>;

export interface NavLinkRow {
  label: string;
  href: string;
  children: { label: string; href: string }[];
}

export interface FooterGroupRow {
  title: string;
  links: { label: string; href: string }[];
}

const MAX_LINKS = 12;
const MAX_CHILDREN = 6;
const MAX_GROUPS = 4;
const MAX_GROUP_LINKS = 8;

function emptyNavLink(): NavLinkRow {
  return { label: "", href: "", children: [] };
}

function emptyFooterGroup(): FooterGroupRow {
  return { title: "", links: [{ label: "", href: "" }] };
}

/** Navigation links editor: labels, addresses and up to 6 sub-links each. */
export function NavigationLinksForm({
  initial,
  action,
}: {
  initial: NavLinkRow[];
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  const [links, setLinks] = useState<NavLinkRow[]>(() =>
    initial.length > 0 ? initial : [emptyNavLink()],
  );
  // Fully empty rows are dropped from the saved value; partially filled
  // rows are kept so validation reports them.
  const payload = links
    .filter((link) => link.label.trim() !== "" || link.href.trim() !== "")
    .map((link) => ({
      ...link,
      children: link.children.filter(
        (child) => child.label.trim() !== "" || child.href.trim() !== "",
      ),
    }));
  const update = (index: number, patch: Partial<NavLinkRow>) => {
    setLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, ...patch } : link)),
    );
  };
  const updateChild = (
    index: number,
    childIndex: number,
    patch: Partial<{ label: string; href: string }>,
  ) => {
    setLinks((prev) =>
      prev.map((link, i) =>
        i === index
          ? {
              ...link,
              children: link.children.map((child, j) =>
                j === childIndex ? { ...child, ...patch } : child,
              ),
            }
          : link,
      ),
    );
  };
  return (
    <form action={formAction} method="post">
      <FormMessage state={state} />
      <input type="hidden" name="key" value="navigation_links" />
      <input type="hidden" name="value" value={JSON.stringify(payload)} />
      <div style={{ display: "grid", gap: "1rem" }}>
        {links.map((link, index) => (
          <div key={index}>
            <div className="aa-form-grid">
              <div className="aa-field">
                <label htmlFor={`nav-label-${index}`}>Link label</label>
                <input
                  id={`nav-label-${index}`}
                  maxLength={60}
                  value={link.label}
                  onChange={(event) => update(index, { label: event.target.value })}
                  placeholder="Shop"
                />
              </div>
              <div className="aa-field">
                <label htmlFor={`nav-href-${index}`}>Link address</label>
                <input
                  id={`nav-href-${index}`}
                  maxLength={500}
                  value={link.href}
                  onChange={(event) => update(index, { href: event.target.value })}
                  placeholder="/shop"
                  spellCheck={false}
                />
              </div>
            </div>
            <div style={{ marginLeft: "1rem", display: "grid", gap: "0.5rem" }}>
              {link.children.map((child, childIndex) => (
                <div className="aa-form-grid" key={childIndex}>
                  <div className="aa-field">
                    <label htmlFor={`nav-child-label-${index}-${childIndex}`}>
                      Sub-link label
                    </label>
                    <input
                      id={`nav-child-label-${index}-${childIndex}`}
                      maxLength={60}
                      value={child.label}
                      onChange={(event) =>
                        updateChild(index, childIndex, { label: event.target.value })
                      }
                    />
                  </div>
                  <div className="aa-field">
                    <label htmlFor={`nav-child-href-${index}-${childIndex}`}>
                      Sub-link address
                    </label>
                    <input
                      id={`nav-child-href-${index}-${childIndex}`}
                      maxLength={500}
                      value={child.href}
                      onChange={(event) =>
                        updateChild(index, childIndex, { href: event.target.value })
                      }
                      spellCheck={false}
                    />
                  </div>
                  <div className="aa-form-actions">
                    <button
                      type="button"
                      className="aa-secondary"
                      onClick={() =>
                        update(index, {
                          children: link.children.filter((_, j) => j !== childIndex),
                        })
                      }
                      aria-label={`Remove sub-link ${childIndex + 1} from link ${index + 1}`}
                    >
                      Remove sub-link
                    </button>
                  </div>
                </div>
              ))}
              <div className="aa-form-actions">
                <button
                  type="button"
                  className="aa-secondary"
                  disabled={link.children.length >= MAX_CHILDREN}
                  onClick={() =>
                    update(index, {
                      children: [...link.children, { label: "", href: "" }],
                    })
                  }
                >
                  Add sub-link
                </button>
                <button
                  type="button"
                  className="aa-secondary"
                  onClick={() => setLinks((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remove link ${index + 1}`}
                >
                  Remove link
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="aa-form-actions" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="aa-secondary"
          disabled={links.length >= MAX_LINKS}
          onClick={() => setLinks((prev) => [...prev, emptyNavLink()])}
        >
          Add link
        </button>
        <SubmitButton>Save navigation links</SubmitButton>
      </div>
    </form>
  );
}

/** Footer links editor: up to 4 titled groups of links. */
export function FooterLinksForm({
  initial,
  action,
}: {
  initial: FooterGroupRow[];
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  const [groups, setGroups] = useState<FooterGroupRow[]>(() =>
    initial.length > 0 ? initial : [emptyFooterGroup()],
  );
  const payload = groups
    .filter(
      (group) =>
        group.title.trim() !== "" ||
        group.links.some((link) => link.label.trim() !== "" || link.href.trim() !== ""),
    )
    .map((group) => ({
      ...group,
      links: group.links.filter(
        (link) => link.label.trim() !== "" || link.href.trim() !== "",
      ),
    }));
  const update = (index: number, patch: Partial<FooterGroupRow>) => {
    setGroups((prev) =>
      prev.map((group, i) => (i === index ? { ...group, ...patch } : group)),
    );
  };
  const updateLink = (
    index: number,
    linkIndex: number,
    patch: Partial<{ label: string; href: string }>,
  ) => {
    setGroups((prev) =>
      prev.map((group, i) =>
        i === index
          ? {
              ...group,
              links: group.links.map((link, j) =>
                j === linkIndex ? { ...link, ...patch } : link,
              ),
            }
          : group,
      ),
    );
  };
  return (
    <form action={formAction} method="post">
      <FormMessage state={state} />
      <input type="hidden" name="key" value="footer_links" />
      <input type="hidden" name="value" value={JSON.stringify(payload)} />
      <div style={{ display: "grid", gap: "1rem" }}>
        {groups.map((group, index) => (
          <div key={index}>
            <div className="aa-field">
              <label htmlFor={`footer-title-${index}`}>Group title</label>
              <input
                id={`footer-title-${index}`}
                maxLength={60}
                value={group.title}
                onChange={(event) => update(index, { title: event.target.value })}
                placeholder="Help"
              />
            </div>
            <div style={{ marginLeft: "1rem", display: "grid", gap: "0.5rem" }}>
              {group.links.map((link, linkIndex) => (
                <div className="aa-form-grid" key={linkIndex}>
                  <div className="aa-field">
                    <label htmlFor={`footer-label-${index}-${linkIndex}`}>
                      Link label
                    </label>
                    <input
                      id={`footer-label-${index}-${linkIndex}`}
                      maxLength={60}
                      value={link.label}
                      onChange={(event) =>
                        updateLink(index, linkIndex, { label: event.target.value })
                      }
                    />
                  </div>
                  <div className="aa-field">
                    <label htmlFor={`footer-href-${index}-${linkIndex}`}>
                      Link address
                    </label>
                    <input
                      id={`footer-href-${index}-${linkIndex}`}
                      maxLength={500}
                      value={link.href}
                      onChange={(event) =>
                        updateLink(index, linkIndex, { href: event.target.value })
                      }
                      spellCheck={false}
                    />
                  </div>
                  <div className="aa-form-actions">
                    <button
                      type="button"
                      className="aa-secondary"
                      onClick={() =>
                        update(index, {
                          links: group.links.filter((_, j) => j !== linkIndex),
                        })
                      }
                      aria-label={`Remove link ${linkIndex + 1} from group ${index + 1}`}
                    >
                      Remove link
                    </button>
                  </div>
                </div>
              ))}
              <div className="aa-form-actions">
                <button
                  type="button"
                  className="aa-secondary"
                  disabled={group.links.length >= MAX_GROUP_LINKS}
                  onClick={() =>
                    update(index, {
                      links: [...group.links, { label: "", href: "" }],
                    })
                  }
                >
                  Add link
                </button>
                <button
                  type="button"
                  className="aa-secondary"
                  onClick={() => setGroups((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remove group ${index + 1}`}
                >
                  Remove group
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="aa-form-actions" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="aa-secondary"
          disabled={groups.length >= MAX_GROUPS}
          onClick={() => setGroups((prev) => [...prev, emptyFooterGroup()])}
        >
          Add group
        </button>
        <SubmitButton>Save footer links</SubmitButton>
      </div>
    </form>
  );
}

/** Error page editor: title, subtitle and an optional image URL. */
export function ErrorPageForm({
  storageKey,
  initial,
  action,
}: {
  storageKey: "error_404" | "error_403";
  initial: { title: string; subtitle: string; image_url: string };
  action: FormAction;
}) {
  const [state, formAction] = useActionState(action, null);
  const prefix = storageKey === "error_404" ? "error404" : "error403";
  return (
    <form action={formAction} method="post">
      <FormMessage state={state} />
      <input type="hidden" name="key" value={storageKey} />
      <div className="aa-form-grid">
        <div className="aa-field">
          <label htmlFor={`${prefix}-title`}>Title</label>
          <input
            id={`${prefix}-title`}
            name="title"
            required
            maxLength={80}
            defaultValue={initial.title}
          />
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor={`${prefix}-subtitle`}>Subtitle</label>
          <input
            id={`${prefix}-subtitle`}
            name="subtitle"
            maxLength={200}
            defaultValue={initial.subtitle}
          />
        </div>
        <div className="aa-field aa-field--full">
          <label htmlFor={`${prefix}-image`}>Image URL (optional)</label>
          <input
            id={`${prefix}-image`}
            name="image_url"
            inputMode="url"
            maxLength={500}
            defaultValue={initial.image_url}
            placeholder="https://…"
            spellCheck={false}
          />
          <p className="aa-hint">
            Stored only: no error page renders an image yet.
          </p>
        </div>
      </div>
      <div className="aa-form-actions">
        <SubmitButton>Save error page</SubmitButton>
      </div>
    </form>
  );
}
