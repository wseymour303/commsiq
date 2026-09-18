import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json(
    {
      paused: true,
      error: 'CommsIQ ingestion is paused by an administrator.'
    },
    { status: 503 }
  );
}
