import Link from "next/link";
import { saveCoupon } from "@/lib/admin/coupons";
import { PageHeading, Panel, Notice } from "@/components/admin/ui";
import { CouponForm } from "@/components/admin/sales/CouponForm";
import { SalesNav } from "@/components/admin/sales/SalesNav";

export const metadata = { title: "New coupon" };

export default function NewCouponPage() {
  return (
    <main id="main" className="aa-main">
      <PageHeading
        eyebrow="Sales · Coupons"
        title="New coupon"
        description="Create a coupon. It validates server-side but cannot be applied at checkout until checkout integration lands."
        actions={
          <Link className="aa-secondary" href="/admin/sales/coupons">
            Back to coupons
          </Link>
        }
      />
      <SalesNav current="coupons" />
      <Notice kind="warning">
        Applying a coupon at checkout is pending checkout integration. This coupon will be
        usable in the eligibility test panel only, until then.
      </Notice>
      <Panel title="Coupon details">
        <CouponForm initial={null} action={saveCoupon} submitLabel="Create coupon" />
      </Panel>
    </main>
  );
}
