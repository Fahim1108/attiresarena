import type { PaymentDestination } from '@/types/manual-payment';

/** Only Personal accounts use Send Money; other accounts retain their approved instructions. */
export function PaymentInstructions({destination,available}:{destination?:PaymentDestination;available:boolean}) {
  return <div className="space-y-3">
    <h4 className="font-semibold">How to pay</h4>
    {!available && <p className="text-sm font-medium leading-relaxed text-primary">Payment collection is unavailable. Do not send money. These instructions describe the flow after collection is enabled.</p>}
    {destination?.accountType === 'personal' ? <ol className="space-y-2 text-sm leading-relaxed text-ink-muted">
      <li>1. Choose bKash or Nagad.</li>
      <li>2. Open your bKash/Nagad app and go to Send Money.</li>
      <li>3. Send the exact amount to the Personal Number shown.</li>
      <li>4. Copy the Transaction ID (TrxID).</li>
      <li>5. Enter the TrxID and your payment number in the form below and submit.</li>
    </ol> : destination?.transferInstructions ? <p className="text-sm leading-relaxed text-ink-muted">{destination.transferInstructions}</p> : <p className="text-sm leading-relaxed text-ink-muted">Approved receiving-account instructions will appear here when configured.</p>}
  </div>;
}
