"use client";

import { Banknote, Check, CheckCircle2, CircleAlert, Copy, Facebook, RotateCcw, ShieldCheck, ShoppingBag, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, buttonClasses, Price, Rating } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { cn } from "@/lib/cn";
import { displayedSizes, findVariant, isSizeAvailable, toCartLine } from "@/lib/product";
import type { Product, SizeGuide } from "@/types";
import { QuantitySelector } from "./QuantitySelector";
import { SizeSelector } from "./VariantSelector";
import { sizeGuideMeasurements, SizeGuideTable } from "./SizeGuideTable";
import { WishlistButton } from "./WishlistButton";

interface Props {
  product: Product;
  brandName?: string;
  colorId: string;
  onColorChange: (id: string) => void;
  compact?: boolean;
  onAdded?: () => void;
  onSizeChange?: (size:string)=>void;
  headingLevel?: "h1" | "h2";
  sizeGuide?: SizeGuide | null;
}

export function ProductPurchasePanel({ product, brandName, colorId, compact, onAdded, onSizeChange, headingLevel = "h1", sizeGuide }: Props) {
  const router = useRouter();
  const { addItem, openDrawer } = useCart();
  const oneSize = product.sizes.length === 1;
  const [size, setSize] = useState<string | undefined>(oneSize ? product.sizes[0] : undefined);
  const [qty, setQty] = useState(1);
  const [sizeError, setSizeError] = useState<string>();
  // Size Guide opens from a button just below the size selector (Fahim,
  // 2026-11-25) — the table is hidden until the shopper asks for it.
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  // Share row is client-only: the page URL comes from the browser, with an
  // empty server snapshot so server rendering never sees a mismatched href.
  const pageUrl = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("popstate", onChange);
      return () => window.removeEventListener("popstate", onChange);
    },
    () => window.location.href,
    () => "",
  );
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => { window.clearTimeout(copyTimer.current); }, []);

  async function copyLink() {
    if (!pageUrl) return;
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      setCopyFailed(false);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  }

  const variant = size ? findVariant(product, colorId, size) : undefined;
  const stock = variant?.stock ?? 0;
  const colorHasStock = stock > 0;
  // Stock in ANY size of this color: no size selected yet is "undecided",
  // not "out of stock". The purchase buttons and status line must say so
  // instead of showing Sold Out / Out of stock before the shopper chooses.
  // Only sizes the shopper can actually select may count: with apparel
  // sizing the selector shows the fixed template list, so a stocked size
  // whose name is not a canonical apparel size is invisible on the page
  // and must not make the panel claim a size can be selected.
  const displayedSizesList = displayedSizes(product);
  const anySizeInStock = displayedSizesList.some((s) =>
    isSizeAvailable(product, colorId, s),
  );
  const purchaseDisabled = !anySizeInStock || (variant !== undefined && stock < 1);

  const add = (buyNow: boolean) => {
    if (!size || !variant) {
      setSizeError("Please select a size");
      return;
    }
    if (variant.stock < 1) return;
    // A limit refusal already shows the order-limit popup: do not open the
    // drawer or navigate to checkout over it.
    const { added } = addItem(toCartLine(product, variant, brandName), qty);
    if (!added) return;
    onAdded?.();
    if (buyNow) {
      router.push("/checkout");
    } else {
      // The opening drawer is the confirmation (a toast would overlap it on phones).
      openDrawer();
    }
  };

  const Title = headingLevel;

  return (
    <div className={cn("space-y-6", compact && "space-y-5")}>
      <div className="space-y-2.5">
        {brandName && <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-muted">{brandName}</p>}
        <Title className={cn("text-balance font-serif leading-tight text-ink", compact ? "text-2xl" : "text-3xl sm:text-[40px]")}>{product.name}</Title>
        <a href="#reviews" className={cn("inline-block", compact && "pointer-events-none")}>
          {product.rating.count>0?<Rating value={product.rating.average} count={product.rating.count} />:<span className="text-sm text-ink-muted">No reviews yet.</span>}
        </a>
        <Price price={product.price} compareAt={product.compareAtPrice} size="lg" showBadge />
        {!compact && <p className="text-sm leading-relaxed text-ink-muted">{product.shortDescription}</p>}
      </div>

      {product.actualMeasurements && <p className="text-sm text-ink">Actual garment measurements (inches): {product.actualMeasurements.chestInches !== undefined && `Chest ${product.actualMeasurements.chestInches}`} {product.actualMeasurements.lengthInches !== undefined && `Length ${product.actualMeasurements.lengthInches}`}</p>}
      <p className="text-sm text-ink">Color: <span className="font-medium">{product.colors.find(c=>c.id===colorId)?.name}</span></p>

      <SizeSelector
        sizes={displayedSizesList}
        locked={product.reviewOnly === true}
        labels={product.sizeLabels}
        value={size}
        onChange={(s) => {
          setSize(s);
          onSizeChange?.(s);
          setSizeError(undefined);
          setQty(1);
        }}
        isAvailable={(s) => isSizeAvailable(product, colorId, s)}
        measurements={sizeGuide ? sizeGuideMeasurements(sizeGuide) : undefined}
        error={sizeError}
      />

      {sizeGuide && (
        <div>
          <button
            type="button"
            onClick={() => setSizeGuideOpen((open) => !open)}
            aria-expanded={sizeGuideOpen}
            aria-controls="product-size-guide"
            className={buttonClasses({ variant: "primary", size: "sm" })}
          >
            Size Guide
          </button>
          {sizeGuideOpen && (
            <div id="product-size-guide" className="mt-3">
              <SizeGuideTable guide={sizeGuide} />
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-ink">Quantity</span>
          <QuantitySelector value={qty} onChange={setQty} max={Math.max(1, stock || 10)} />
        </div>
        <StockStatus
          sizeSelected={size !== undefined}
          anyInStock={anySizeInStock}
          inStock={colorHasStock}
          stock={variant ? stock : undefined}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex gap-2.5">
          <Button size="lg" variant="outline" className="border-primary bg-white text-primary hover:bg-selected hover:text-primary" fullWidth onClick={() => add(false)} disabled={purchaseDisabled} leftIcon={<ShoppingBag className="h-4 w-4" aria-hidden />}>
            {!size && anySizeInStock ? "Select a Size" : colorHasStock ? "Add to Cart" : "Sold Out"}
          </Button>
          {!compact && <WishlistButton productId={product.id} productName={product.name} variant="inline" className="h-12 w-12 shrink-0" />}
        </div>
        <Button size="lg" variant="burgundy" fullWidth onClick={() => add(true)} disabled={purchaseDisabled} leftIcon={<Zap className="h-4 w-4" aria-hidden />}>
          Buy Now
        </Button>
        {pageUrl && (
          <div className="flex gap-2.5">
            <a
              href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Share this product on Facebook"
              className={buttonClasses({ variant: "outline", size: "sm", fullWidth: true })}
            >
              <Facebook className="h-4 w-4" aria-hidden /> Share on Facebook
            </a>
            <Button variant="outline" size="sm" fullWidth onClick={copyLink} leftIcon={copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}>
              {copied ? "Link copied" : "Copy link"}
            </Button>
          </div>
        )}
        {copyFailed && <p role="status" className="text-xs text-ink-muted">Could not copy the link. Please select and copy it manually.</p>}
        {compact && (
          <Link href={`/product/${product.slug}`} className="block pt-1 text-center text-xs text-primary underline underline-offset-4">
            View full details
          </Link>
        )}
      </div>

      {!compact && (
        <ul className="grid grid-cols-3 gap-2 border-y border-line py-4 text-center">
          {[
            { Icon: Banknote, title: "Cash on Delivery", sub: "Across Bangladesh" },
            { Icon: RotateCcw, title: "Easy Returns", sub: "3 days" },
            { Icon: ShieldCheck, title: "Secure Shopping", sub: "Your data is safe" },
          ].map(({ Icon, title, sub }) => (
            <li key={title} className="flex flex-col items-center gap-1.5">
              <Icon className="h-5 w-5 text-primary" strokeWidth={1.6} aria-hidden />
              <span className="text-[11px] font-medium leading-tight text-ink">{title}</span>
              <span className="text-[10px] leading-tight text-ink-muted">{sub}</span>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}

function StockStatus({
  sizeSelected,
  anyInStock,
  inStock,
  stock,
}: {
  sizeSelected: boolean;
  anyInStock: boolean;
  inStock: boolean;
  stock?: number;
}) {
  if (!sizeSelected) {
    if (!anyInStock)
      return (
        <span className="inline-flex items-center gap-1.5 rounded bg-primary px-2 py-1 text-xs font-semibold text-white">
          <CircleAlert className="h-4 w-4" aria-hidden /> Out of stock
        </span>
      );
    return (
      <span className="flex items-center gap-1.5 text-xs text-ink-muted">
        Select a size to see availability
      </span>
    );
  }
  if (!inStock || stock === 0)
    return (
      <span className="inline-flex items-center gap-1.5 rounded bg-primary px-2 py-1 text-xs font-semibold text-white">
        <CircleAlert className="h-4 w-4" aria-hidden /> Out of stock
      </span>
    );
  if (stock !== undefined && stock <= 3)
    return (
      <span className="flex items-center gap-1.5 text-xs text-warning">
        <CircleAlert className="h-4 w-4" aria-hidden /> Only {stock} left
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 text-xs text-success">
      <CheckCircle2 className="h-4 w-4" aria-hidden /> In Stock
    </span>
  );
}
