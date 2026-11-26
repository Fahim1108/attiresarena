import { Suspense } from "react";
import { WhatsAppSupport } from "@/components/checkout/WhatsAppSupport";
import { RouteMotion } from "@/components/motion/RouteMotion";
import { CustomerMenu } from "@/components/layout/CustomerMenu";
import { CustomerMenuLoader } from "@/components/layout/CustomerMenuLoader";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { CartProvider } from "@/context/CartContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { getInitialCart, getProducts } from "@/services";

/** Storefront chrome (header, footer, mobile nav). Admin routes live outside this group. */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  // The catalogue + cart read lives here now, not in the root layout:
  // only storefront routes render the cart/wishlist providers (the
  // header cart badge and the mobile nav use them), so admin pages no
  // longer pay for the 500-product catalogue fetch on any load. The
  // providers wrap the whole storefront chrome, exactly as before.
  const [catalogue, initialCart] = await Promise.all([getProducts({pageSize:500}), getInitialCart()]);
  return (
    <WishlistProvider approvedProductIds={catalogue.items.map(p=>p.id)}>
      <CartProvider approvedProducts={catalogue.items} initialItems={initialCart} approvedVariantIds={catalogue.items.flatMap(p=>p.variants.filter(v=>v.stock>0).map(v=>v.id))}>
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
      </CartProvider>
    </WishlistProvider>
  );
}
