import Link from "next/link";
import { formatDateTime } from "@/lib/admin/format";
import {
  couponValueLabel,
  deleteCoupon,
  readCoupons,
  setCouponActive,
  testCouponEligibility,
} from "@/lib/admin/coupons";
import { PageHeading, Panel, Notice, StatusBadge } from "@/components/admin/ui";
import { CouponRowActions } from "@/components/admin/sales/CouponRowActions";
import { CouponTestPanel } from "@/components/admin/sales/CouponTestPanel";
import { SalesNav } from "@/components/admin/sales/SalesNav";

export const metadata = { title: "Coupons" };

function windowLabel(coupon: { starts_at: string | null; expires_at: string | null }): string {
  if (!coupon.starts_at && !coupon.expires_at) return "No time window";
  const from = coupon.starts_at ? formatDateTime(coupon.starts_at) : "No start";
  const to = coupon.expires_at ? formatDateTime(coupon.expires_at) : "No expiry";
  return `${from} → ${to}`;
}

export default async function CouponsPage() {
  const { coupons, usageTruncated } = await readCoupons();

  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Sales"
        title="Coupons"
        description="Coupons are validated server-side. Usage counts come from recorded redemptions."
        actions={
          <Link className="aa-button" href="/admin/sales/coupons/new">
            New coupon
          </Link>
        }
      />
      <SalesNav current="coupons" />

      <Notice kind="warning">
        Applying a coupon at checkout is pending checkout integration — place_checkout_order
        has no coupon parameter yet. Coupons created here cannot be used by customers until
        that integration lands. The test panel below checks eligibility only.
      </Notice>
      {usageTruncated ? (
        <Notice kind="warning">
          Usage counts cover the 10,000 most recent redemptions and may be understated.
        </Notice>
      ) : null}

      {coupons.length === 0 ? (
        <p className="aa-panel">
          No coupons yet.{" "}
          <Link href="/admin/sales/coupons/new">Create the first coupon</Link>.
        </p>
      ) : (
        <div className="aa-table-scroll">
          <table className="aa-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Discount</th>
                <th scope="col">Window</th>
                <th scope="col">Usage</th>
                <th scope="col">First order only</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td>
                    <Link href={`/admin/sales/coupons/${coupon.id}`} className="aa-cell-main">
                      {coupon.code}
                    </Link>
                  </td>
                  <td>{couponValueLabel(coupon)}</td>
                  <td>{windowLabel(coupon)}</td>
                  <td>
                    {coupon.usageCount}
                    {coupon.total_usage_limit !== null ? ` / ${coupon.total_usage_limit}` : ""}
                    <span className="aa-cell-sub">uses</span>
                  </td>
                  <td>{coupon.first_order_only ? "Yes" : "No"}</td>
                  <td>
                    {coupon.active ? (
                      <StatusBadge tone="success">Active</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Inactive</StatusBadge>
                    )}
                  </td>
                  <td className="aa-cell-actions">
                    <Link className="aa-row-action" href={`/admin/sales/coupons/${coupon.id}`}>
                      Edit
                    </Link>{" "}
                    <CouponRowActions
                      couponId={coupon.id}
                      code={coupon.code}
                      active={coupon.active}
                      hasRedemptions={coupon.usageCount > 0}
                      toggleAction={setCouponActive}
                      deleteAction={deleteCoupon}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Panel
        title="Test coupon eligibility"
        description="Checks a code against the same server-side rules checkout will use. Nothing is applied or recorded."
      >
        <CouponTestPanel testAction={testCouponEligibility} />
      </Panel>
    </main>
  );
}
