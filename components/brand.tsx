import Image from 'next/image';

export function Brand() {
  return (
    <div className="flex min-w-0 items-center gap-3.5">
      <div className="relative h-12 w-[118px] shrink-0 sm:w-[126px]">
        <Image
          src="/emich-automotive.png"
          alt="Emich Automotive"
          fill
          priority
          sizes="126px"
          className="object-contain object-left"
        />
      </div>
      <div className="h-7 w-px bg-[var(--border)]" />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-semibold tracking-[-0.015em] text-[var(--text)]">CommunicationIQ</div>
        <div className="mt-1 hidden text-[11px] font-medium text-[var(--muted)] sm:block">Customer communication intelligence</div>
      </div>
    </div>
  );
}
