import type { MerchandisingCandidate } from "@/lib/merchandising";
import type { CustomerReviewInput } from "@/lib/customer/validation";
import type { ManualPaymentConfiguration, PaymentSubmissionInput, PaymentSubmissionResult } from "@/types/manual-payment";
import type {
  ActionResult,
  Address,
  Brand,
  CartItem,
  CatalogFacets,
  Category,
  CheckoutPayload,
  Money,
  Customer,
  Order,
  Paginated,
  Product,
  ProductQuery,
  Review,
  SizeGuide,
  StorefrontSettings,
} from "@/types";

export type ProductQueryInput = ProductQuery & { offers?: boolean };

export interface HomepageConfiguration {
  sections: StorefrontSettings["homepage"];
  hero: StorefrontSettings["hero"];
  promoBanners: StorefrontSettings["promoBanners"];
  valueProps: StorefrontSettings["valueProps"];
}

export interface ProductSuggestion {
  slug: string;
  name: string;
  price: number;
  image: { src: string; alt: string };
  categoryName: string;
}

/**
 * The contract every data source must implement.
 *
 * `src/services/adapters/mock.ts` implements it with local fixtures.
 * Codex: create `src/services/adapters/supabase.ts` implementing this same
 * interface, then switch the export in `src/services/adapters/index.ts`.
 */
export interface StorefrontDataSource {
  getManualPaymentConfiguration(): Promise<ManualPaymentConfiguration>;
  submitManualPayment(input: PaymentSubmissionInput): Promise<PaymentSubmissionResult>;
  // ---- Catalogue (read) ----
  getHomepageProducts(): Promise<MerchandisingCandidate[]>;
  /**
   * `catalogueUnavailable` is the feed failure signal, set only by the
   * live adapter: true when the catalogue data call itself failed, so
   * listing pages can render "catalogue unavailable" instead of
   * "0 products". Absent/false means the data call succeeded (a zero
   * total is then a genuinely empty catalogue). Other adapters omit it.
   */
  getProducts(query?: ProductQueryInput): Promise<Paginated<Product> & { facets: CatalogFacets; catalogueUnavailable?: boolean }>;
  getProductBySlug(slug: string): Promise<Product | null>;
  getProductsByIds(ids: string[]): Promise<Product[]>;
  getRelatedProducts(product: Product, limit?: number): Promise<Product[]>;
  getCollection(kind: "new-arrivals" | "featured" | "best-sellers", limit?: number): Promise<Product[]>;
  searchSuggestions(term: string, limit?: number): Promise<ProductSuggestion[]>;
  getCategories(): Promise<Category[]>;
  getCategoryBySlug(slug: string): Promise<Category | null>;
  getBrands(): Promise<Brand[]>;
  getBrandBySlug(slug: string): Promise<Brand | null>;
  getReviews(productId: string): Promise<Review[]>;
  getSizeGuide(id: string): Promise<SizeGuide | null>;

  // ---- Storefront configuration ----
  getStorefrontSettings(): Promise<StorefrontSettings>;
  getHomepageConfiguration(): Promise<HomepageConfiguration>;

  // ---- Cart ----
  /** Cart lines to pre-fill on a first visit (demo only; real backend returns the saved cart). */
  getInitialCart(): Promise<CartItem[]>;

  // ---- Customer (requires auth) ----
  getCurrentCustomer(): Promise<Customer | null>;
  getOrders(): Promise<Order[]>;
  getOrderByNumber(orderNumber: string, phone?: string): Promise<Order | null>;

  // ---- Mutations (all require backend) ----
  /** `total` is the server-calculated order total in BDT. Browser totals are never trusted. */
  placeOrder(payload: CheckoutPayload): Promise<ActionResult<{ orderNumber: string; total?: Money }>>;
  /** Email-only sign-in; phone identifiers are rejected, never resolved. */
  signIn(input: { email: string; password: string }): Promise<ActionResult>;
  /** `signedIn` is false when email confirmation is required (or the email is already registered — same non-enumerating outcome). */
  register(input: { fullName: string; email: string; phone: string; password: string }): Promise<ActionResult<{ signedIn: boolean }>>;
  requestPasswordReset(input: { email: string }): Promise<ActionResult>;
  /** Name + phone only; email is read-only and never accepted here. */
  updateProfile(input: Pick<Customer, "fullName" | "phone">): Promise<ActionResult>;
  saveAddress(address: Address): Promise<ActionResult<Address>>;
  deleteAddress(addressId: string): Promise<ActionResult>;
  /** Submit (or edit) the signed-in customer's review for one product. Reviews start pending; the RPC enforces one row per product+customer. */
  submitReview(input: CustomerReviewInput): Promise<ActionResult<{ reviewId: string }>>;
  /** Attach one optional, auto-compressed photo to the caller's own review (max 3). A photo failure never fails the review itself. */
  uploadReviewPhoto(reviewId: string, file: File, position: number): Promise<ActionResult<{ photoId: string }>>;
  subscribeNewsletter(email: string): Promise<ActionResult>;
  submitContactForm(input: { name: string; email: string; phone?: string; subject: string; message: string }): Promise<ActionResult>;
  saveStorefrontDraft(settings: StorefrontSettings): Promise<ActionResult>;
  publishStorefrontSettings(settings: StorefrontSettings): Promise<ActionResult>;
  uploadMedia(file: { name: string; type: string; size: number }): Promise<ActionResult<{ url: string }>>;
}
