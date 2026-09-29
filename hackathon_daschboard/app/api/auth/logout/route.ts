import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true, message: 'Wylogowano z systemu TARCZA.' });
  response.cookies.delete('tarcza_session');
  return response;
}
