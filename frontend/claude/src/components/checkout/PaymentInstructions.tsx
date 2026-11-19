import type { PaymentDestination } from '@/types/manual-payment';

/** Only Personal accounts use Send Money; other accounts retain their approved instructions. */
export function PaymentInstructions({destination,available}:{destination?:PaymentDestination;available:boolean}) {
  return <div className="space-y-3">
    <h4 lang="bn" className="font-semibold">যেভাবে পেমেন্ট করবেন</h4>
    {!available && <p lang="bn" className="text-sm font-medium leading-relaxed text-primary">টাকা পাঠাবেন না। নিচের ধাপগুলোতে পেমেন্টের প্রক্রিয়াটি দেখানো হয়েছে।</p>}
    {destination?.accountType === 'personal' ? <ol lang="bn" className="space-y-2 text-sm leading-relaxed text-ink-muted">
      <li>১. bKash অথবা Nagad নির্বাচন করুন।</li>
      <li>২. আপনার bKash/Nagad অ্যাপ খুলে Send Money অপশনে যান।</li>
      <li>৩. দেখানো Personal Number-এ নির্ধারিত টাকা পাঠান।</li>
      <li>৪. Transaction ID (TrxID) কপি করুন।</li>
      <li>৫. নিচের ফর্মে TrxID এবং আপনার পেমেন্ট নম্বর লিখে Submit করুন।</li>
    </ol> : destination?.transferInstructions ? <p className="text-sm leading-relaxed text-ink-muted">{destination.transferInstructions}</p> : <p className="text-sm leading-relaxed text-ink-muted">Approved receiving-account instructions will appear here when configured.</p>}
  </div>;
}
