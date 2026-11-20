import Link from "next/link";
import { saveCoupon } from "@/lib/admin/coupons";
import { Notice } from "@/components/admin/ui";
import { CouponForm } from "@/components/admin/sales/CouponForm";
import { SalesNav } from "@/components/admin/sales/SalesNav";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/design-system/Card";
import { PageHeader } from "@/components/design-system/PageHeader";

export const metadata = { title: "New coupon" };

export default function NewCouponPage() {
  return (
    <main id="main" tabIndex={-1} className="aa-main aa-main--ds">
      <div className="space-y-6">
        <PageHeader
          title="New coupon"
          description="Create a coupon. It validates server-side and can be applied at checkout."
          actions={
            <Link className="aa-secondary" href="/admin/sales/coupons">
              Back to coupons
            </Link>
          }
        >
          <p className="text-[13px] font-medium text-admin-text-secondary">
            Sales · Coupons
          </p>
        </PageHeader>
        <SalesNav current="coupons" />
        <Notice kind="info">
          Coupons can be applied at checkout. Live redemption has not been
          verified yet — use the eligibility test panel on the Coupons page
          to check a code before sharing it.
        </Notice>
        <Card>
          <CardHeader>
            <CardTitle headingLevel="h2">Coupon details</CardTitle>
          </CardHeader>
          <CardContent>
            <CouponForm initial={null} action={saveCoupon} submitLabel="Create coupon" />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
