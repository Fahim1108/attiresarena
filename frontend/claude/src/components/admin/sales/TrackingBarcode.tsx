/* eslint-disable @next/next/no-img-element -- barcode is an embedded data-URI image; next/image cannot optimize it. */
import { barcodeSvgDataUri, renderTrackingBarcodeSvg } from "./invoice-helpers";

/**
 * Courier tracking barcode (Code 128) as an embedded data-URI image — no
 * external fetch at print time. Renders nothing when the code cannot be
 * encoded; the tracking number itself is always printed as text beside it.
 */
export async function TrackingBarcode({ trackingCode }: { trackingCode: string }) {
  const svg = await renderTrackingBarcodeSvg(trackingCode);
  if (!svg) return null;
  return (
    <img
      src={barcodeSvgDataUri(svg)}
      alt=""
      aria-hidden="true"
      className="aa-invoice-barcode"
    />
  );
}
