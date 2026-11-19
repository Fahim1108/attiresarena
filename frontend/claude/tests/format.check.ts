import { expect, it } from "vitest";
import { formatPriceBangla, toBanglaDigits } from "@/lib/format";

it("converts Latin digits to Bengali digits, leaving other characters alone", () => {
  expect(toBanglaDigits("৳1,055")).toBe("৳১,০৫৫");
  expect(toBanglaDigits("AA-10005")).toBe("AA-১০০০৫");
  expect(toBanglaDigits("no digits here")).toBe("no digits here");
  expect(toBanglaDigits("")).toBe("");
});

it("formats the success-screen total with the taka sign and Bengali digits", () => {
  expect(formatPriceBangla(1055)).toBe("৳১,০৫৫");
  expect(formatPriceBangla(550)).toBe("৳৫৫০");
});
