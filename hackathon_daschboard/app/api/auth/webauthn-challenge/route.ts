import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

export async function GET() {
  // Generate random 32-byte challenge for WebAuthn FIDO2 assertion
  const challengeBuffer = crypto.randomBytes(32);
  const challengeBase64 = challengeBuffer.toString('base64url');

  return NextResponse.json({
    challenge: challengeBase64,
    rpId: typeof window !== 'undefined' ? window.location.hostname : 'localhost',
    timeout: 60000,
    userVerification: 'preferred',
  });
}
