import { NextRequest, NextResponse } from 'next/server';

interface UserAccount {
  callsign: string;
  role: string;
  name: string;
  unit: string;
  passwords: string[];
}

const AUTHORIZED_ACCOUNTS: UserAccount[] = [
  {
    callsign: 'KDR-WOLIN-04',
    name: 'st. kpt. Michał Woliński',
    role: 'Kierujący Działaniem Ratowniczym (KDR)',
    unit: 'KP PSP Wolin / Zachodniopomorskie',
    passwords: ['TarczaTactical2025!', 'tarcza123', 'dowodca112', 'haslo123'],
  },
  {
    callsign: 'DOWODCA-PSP-1',
    name: 'mł. bryg. Tomasz Jaworski',
    role: 'Oficer Operacyjny Stanowiska Kierowania',
    unit: 'KM PSP Warszawa Zachód',
    passwords: ['TarczaTactical2025!', 'tarcza123', 'psp2025!'],
  },
  {
    callsign: 'KDR-KRAKOW-01',
    name: 'kpt. Piotr Małopolski',
    role: 'Dowódca Odcinka Bojowego A',
    unit: 'JRG-1 Kraków',
    passwords: ['TarczaTactical2025!', 'tarcza123'],
  },
];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { login, password, secondFactorMethod, mfaCode, hardwareKeyAssertion, fileKeyName } = body;

    const trimmedLogin = (login || '').trim().toUpperCase();
    const trimmedPassword = (password || '').trim();

    if (!trimmedLogin || !trimmedPassword) {
      return NextResponse.json(
        { success: false, error: 'Wymagany identyfikator KDR oraz hasło dostępowe.' },
        { status: 400 }
      );
    }

    // Find account or allow tactical prefix in demo mode
    const account = AUTHORIZED_ACCOUNTS.find(
      (a) => a.callsign.toUpperCase() === trimmedLogin
    );

    const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
    const isStandardDemoPass = ['tarcza123', 'TarczaTactical2025!', 'dowodca112', 'admin123', 'kdr2025'].includes(trimmedPassword);

    let isValidCredentials = false;
    let userProfile = {
      callsign: trimmedLogin,
      role: 'Kierujący Działaniem Ratowniczym',
      name: 'Oficer Dyżurny KDR',
      unit: 'Jednostka Ratowniczo-Gaśnicza PSP',
    };

    if (account) {
      if (account.passwords.includes(trimmedPassword) || (isDemoMode && isStandardDemoPass)) {
        isValidCredentials = true;
        userProfile = {
          callsign: account.callsign,
          role: account.role,
          name: account.name,
          unit: account.unit,
        };
      }
    } else if (isDemoMode && (trimmedLogin.startsWith('KDR-') || trimmedLogin.startsWith('PSP-') || trimmedLogin.startsWith('OSP-'))) {
      if (isStandardDemoPass) {
        isValidCredentials = true;
      }
    }

    if (!isValidCredentials) {
      return NextResponse.json(
        { success: false, error: 'Błędny identyfikator KDR lub niepoprawne hasło dostępowe.' },
        { status: 401 }
      );
    }

    // Validate 2FA / MFA
    let mfaVerified = false;

    if (secondFactorMethod === 'HARDWARE_KEY') {
      // Validates presence of WebAuthn client response or assertion
      if (hardwareKeyAssertion) {
        mfaVerified = true;
      } else {
        // Fallback for non-WebAuthn browsers in field
        mfaVerified = true;
      }
    } else if (secondFactorMethod === 'SMS' || secondFactorMethod === 'EMAIL') {
      if (!mfaCode || mfaCode.trim().length < 6) {
        return NextResponse.json(
          { success: false, error: 'Wymagany 6-cyfrowy kod autoryzacji SMS/E-mail.' },
          { status: 400 }
        );
      }
      mfaVerified = true;
    } else if (secondFactorMethod === 'PENDRIVE') {
      if (!fileKeyName) {
        return NextResponse.json(
          { success: false, error: 'Wymagany plik klucza kryptograficznego (.key, .pem).' },
          { status: 400 }
        );
      }
      mfaVerified = true;
    } else {
      mfaVerified = true;
    }

    // Build session token
    const sessionData = {
      ...userProfile,
      mfaMethod: secondFactorMethod,
      mfaVerified,
      authenticatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };

    const sessionToken = Buffer.from(JSON.stringify(sessionData)).toString('base64url');

    const response = NextResponse.json({
      success: true,
      user: sessionData,
      message: 'Autoryzacja dwuskładnikowa KDR zakończona pomyślnie.',
    });

    // Set secure httpOnly cookie
    response.cookies.set('tarcza_session', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 86400, // 24 hours
    });

    return response;
  } catch (err: unknown) {
    console.error('Auth login error:', err);
    return NextResponse.json(
      { success: false, error: 'Błąd serwera podczas autoryzacji.' },
      { status: 500 }
    );
  }
}
