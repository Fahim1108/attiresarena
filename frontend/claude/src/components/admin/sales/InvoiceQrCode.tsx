import { qrCodeModules, qrModuleRects } from "./invoice-helpers";

/** QR code rendered as native SVG rects from the symbol matrix (server-only). */
export async function InvoiceQrCode({ payload, label }: { payload: string; label: string }) {
  const { size, data } = await qrCodeModules(payload);
  const quiet = 2;
  const viewSize = size + quiet * 2;
  const rects = qrModuleRects(size, data);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
      shapeRendering="crispEdges"
      className="aa-invoice-qr"
    >
      <title>{label}</title>
      {rects.map((rect) => (
        <rect
          key={`${rect.x}-${rect.y}`}
          x={rect.x + quiet}
          y={rect.y + quiet}
          width={1}
          height={1}
        />
      ))}
    </svg>
  );
}
