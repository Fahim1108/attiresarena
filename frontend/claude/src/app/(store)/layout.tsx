import { Suspense } from "react";
import { WhatsAppSupport } from "@/components/checkout/WhatsAppSupport";
import { RouteMotion } from "@/components/motion/RouteMotion";
import { CustomerMenu } from "@/components/layout/CustomerMenu";
import { CustomerMenuLoader } from "@/components/layout/CustomerMenuLoader";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";

/** Storefront chrome (header, footer, mobile nav). Admin routes live outside this group. */
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header
        accountMenu={
          <Suspense fallback={<CustomerMenu />}>
            <CustomerMenuLoader />
          </Suspense>
        }
      />
      <main id="main" tabIndex={-1} className="min-h-[60vh]">
        <RouteMotion>{children}</RouteMotion>
      </main>
      <Footer />
      <MobileBottomNav />
      <WhatsAppSupport />
    </>
  );
}
