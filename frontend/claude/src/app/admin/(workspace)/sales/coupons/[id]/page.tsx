import Link from "next/link";
import { formatDateTime, formatMoney } from "@/lib/admin/format";
import {
  couponValueLabel,
  deleteCoupon,
  readCouponDetail,
  saveCoupon,
  setCouponActive,
  toDatetimeLocal,
} from "@/lib/admin/coupons";
import { resolveDisplayRecord } from "@/lib/admin/sample-data";
import { SAMPLE_COUPON_DETAIL } from "@/lib/admin/sample-sales";
import { Notice, StatusBadge } from "@/components/admin/ui";
import { SampleBadge } from "@/components/admin/SampleBadge";
import { CouponForm, type CouponFormInitial } from "@/components/admin/sales/CouponForm";
import { CouponRowActions } from "@/components/admin/sales/CouponRowActions";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export const metadata = { title: "Coupon details" };

function decimal(minor: number | null): string {
  return minor === null ? "" : (minor / 100).toFixed(2);
}

export default async function CouponDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Null means unavailable: show a labeled sample record with no working
  // edit, toggle, or delete actions. A genuinely missing coupon still 404s.
  const { record, isSample } = resolveDisplayRecord(
    await readCouponDetail(id),
    SAMPLE_COUPON_DETAIL,
  );
  const { coupon, redemptions, totalRedemptions } = record;

  const initial: CouponFormInitial = {
    id: coupon.id,
    code: coupon.code,
    kind: coupon.kind,
    percent_value: coupon.percent_value === null ? "" : String(coupon.percent_value),
    fixed_discount: decimal(coupon.fixed_discount_minor),
    min_order: decimal(coupon.min_order_minor),
    max_discount: decimal(coupon.max_discount_minor),
    starts_at: toDatetimeLocal(coupon.starts_at),
    expires_at: toDatetimeLocal(coupon.expires_at),
    total_usage_limit: coupon.total_usage_limit === null ? "" : String(coupon.total_usage_limit),
    per_customer_limit: coupon.per_customer_limit === null ? "" : String(coupon.per_customer_limit),
    first_order_only: coupon.first_order_only,
    active: coupon.active,
  };

  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title={coupon.code}
          description={couponValueLabel(coupon)}
          actions={
            <>
              <Link className="aa-secondary" href="/admin/sales/coupons">
                Back to coupons
              </Link>
              {!isSample ? (
                <CouponRowActions
                  couponId={coupon.id}
                  code={coupon.code}
                  active={coupon.active}
                  hasRedemptions={totalRedemptions > 0}
                  toggleAction={setCouponActive}
                  deleteAction={deleteCoupon}
                />
              ) : null}
            </>
          }
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Sales · Coupons
          </p>
        </PageHeader>
        <SalesNav current="coupons" />

        {isSample ? (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-admin-card border border-admin-border border-l-4 border-l-admin-primary bg-admin-soft-bg px-4 py-3 text-sm leading-6 text-admin-text"
            role="status"
          >
            <SampleBadge />
            <span>
              Live coupon data is unavailable — this coupon could not be read.
              This sample record is for testing the layout only. Editing,
              activation, and deletion are unavailable, and no sample data is
              saved.
            </span>
          </div>
        ) : null}

        <Notice kind="warning">
          Applying a coupon at checkout is pending checkout integration. This coupon cannot be
          used by customers until that integration lands.
        </Notice>

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="aa-fact-grid">
              <div>
                <dt>Status</dt>
                <dd>
                  {coupon.active ? (
                    <StatusBadge tone="success">Active</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Inactive</StatusBadge>
                  )}
                </dd>
              </div>
              <div>
                <dt>Discount</dt>
                <dd>{couponValueLabel(coupon)}</dd>
              </div>
              <div>
                <dt>Minimum order</dt>
                <dd>{formatMoney(coupon.min_order_minor)}</dd>
              </div>
              <div>
                <dt>Valid window</dt>
                <dd>
                  {coupon.starts_at ? formatDateTime(coupon.starts_at) : "No start"} →{" "}
                  {coupon.expires_at ? formatDateTime(coupon.expires_at) : "No expiry"}
                </dd>
              </div>
              <div>
                <dt>Total usage limit</dt>
                <dd>{coupon.total_usage_limit ?? "Unlimited"}</dd>
              </div>
              <div>
                <dt>Uses per customer</dt>
                <dd>{coupon.per_customer_limit ?? "Unlimited"}</dd>
              </div>
              <div>
                <dt>First order only</dt>
                <dd>{coupon.first_order_only ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Recorded uses</dt>
                <dd>{totalRedemptions}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {isSample ? (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Edit coupon</CardTitle>
            </CardHeader>
            <CardContent>
              <Notice kind="warning">
                Editing is unavailable while live coupon data cannot be loaded.
                This sample coupon cannot be changed.
              </Notice>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle headingLevel="h2">Edit coupon</CardTitle>
            </CardHeader>
            <CardContent>
              <CouponForm initial={initial} action={saveCoupon} submitLabel="Save coupon" />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Redemptions</CardTitle>
            <CardDescription>Recorded uses of this coupon. No redemptions exist until checkout integration records them.</CardDescription>
          </CardHeader>
          <CardContent>
            {redemptions.length === 0 ? (
              <p>No redemptions recorded.</p>
            ) : (
              <div className="aa-table-scroll">
                <table className="aa-table">
                  <thead>
                    <tr>
                      <th scope="col">Redeemed</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {redemptions.map((redemption) => (
                      <tr key={redemption.id}>
                        <th scope="row">
                          <time dateTime={redemption.redeemed_at}>{formatDateTime(redemption.redeemed_at)}</time>
                        </th>
                        <td data-label="Customer">
                          {redemption.phone ?? (redemption.user_id ? "Signed-in account" : "—")}
                        </td>
                        <td data-label="Order">
                          {redemption.order_id ? (
                            <Link href={`/admin/sales/orders/${redemption.order_id}`}>View order</Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {totalRedemptions > redemptions.length ? (
              <p className="aa-hint">Showing the {redemptions.length} most recent of {totalRedemptions} redemptions.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
