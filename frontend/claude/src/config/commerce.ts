import type { CommerceSettings, DemoSettings } from "@/types";

export const commerce: CommerceSettings = {
  currencySymbol: "BDT ",
  currencyCode: "BDT",
  locale: "en-BD",
  deliveryCharges: { inside: 50, outside: 140 },
  deliveryInsideDistrict: "Barishal",
  returnWindowDays: 7,
  codEnabled: true,
  onlinePaymentEnabled: false,
  demoCoupons: [
    { code: "WELCOME10", type: "percent", value: 10, description: "10% off your order (demo coupon)", minSubtotal: 1000 },
  ],
};

export const demo: DemoSettings = {
  showNotices: false,
  seedCart: false,
};
