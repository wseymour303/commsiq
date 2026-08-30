export const COMMSIQ_ROOFTOPS = [
  { id: '225b13ce-0ed8-49e4-937d-0e5198ca0e01', name: 'Emich Volkswagen of Boulder', dealerNames: ['Emich Volkswagen of Boulder'] },
  { id: 'add7189f-7f8e-4af7-a4e9-3dd11abfc135', name: 'Emich Volkswagen of Denver', dealerNames: ['Emich Volkswagen', 'Emich Volkswagen of Denver'] },
  { id: '36d2524d-84bc-4d95-b7f1-3d663c32ddf3', name: 'Emich Chevrolet', dealerNames: ['Emich Chevrolet'] },
  { id: 'ce5d2f66-5d17-4a62-a4f6-d7f3d1b6a6e3', name: 'Emich Kia', dealerNames: ['Emich Kia'] }
] as const;

export function rooftopForDealer(dealer: string | null | undefined) {
  const normalized = String(dealer ?? '').trim().toLowerCase();
  if (!normalized) return null;
  return COMMSIQ_ROOFTOPS.find(rooftop => rooftop.dealerNames.some(name => name.toLowerCase() === normalized)) ?? null;
}

export function rooftopName(rooftopId: string) {
  return COMMSIQ_ROOFTOPS.find(rooftop => rooftop.id === rooftopId)?.name ?? rooftopId;
}
