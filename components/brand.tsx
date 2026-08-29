import Image from 'next/image';

export function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="relative h-7 w-28 shrink-0 overflow-hidden rounded-sm bg-black">
        <Image src="/emich-automotive.png" alt="Emich Automotive" fill priority sizes="112px" className="object-contain" />
      </div>
      <div className="h-5 w-px bg-[var(--border)]" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]">CommunicationIQ</div>
        <div className="hidden text-[11px] text-[var(--muted)] sm:block">Customer communication intelligence</div>
      </div>
    </div>
  );
}
