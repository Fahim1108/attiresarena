import type { CommerceSettings, DemoSettings } from "@/types";

export const commerce: CommerceSettings = {
  currencySymbol: "BDT ",
  currencyCode: "BDT",
  locale: "en-BD",
  deliveryCharges: { insideBarishalCity: 50, outsideBarishalCity: 140 },
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
