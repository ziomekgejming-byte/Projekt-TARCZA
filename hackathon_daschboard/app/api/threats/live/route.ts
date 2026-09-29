import { NextResponse } from 'next/server';
import { INITIAL_MACRO_THREATS } from '@/lib/mock-data';
import { MacroThreat } from '@/types/tarcza';

interface ImgwSynopStation {
  id_stacji: string;
  stacja: string;
  data_pomiaru: string;
  godzina_pomiaru: string;
  temperatura: string;
  predkosc_wiatru: string;
  kierunek_wiatru: string;
  wilgotnosc_wzgledna: string;
  suma_opadu: string;
  cisnienie: string;
}

// Coordinates for key IMGW synoptic stations across Poland
const STATION_COORDINATES: Record<string, [number, number]> = {
  'Warszawa': [52.2297, 21.0122],
  'Kraków': [50.0647, 19.9450],
  'Gdańsk': [54.3520, 18.6466],
  'Wrocław': [51.1079, 17.0385],
  'Poznań': [52.4064, 16.9252],
  'Katowice': [50.2649, 19.0238],
  'Białystok': [53.1325, 23.1688],
  'Szczecin': [53.4285, 14.5528],
  'Lublin': [51.2465, 22.5684],
  'Rzeszów': [50.0412, 21.9991],
  'Łódź': [51.7592, 19.4560],
  'Toruń': [53.0138, 18.5984],
  'Olsztyn': [53.7784, 20.4801],
  'Zielona Góra': [51.9356, 15.5062],
  'Koszalin': [54.1944, 16.1722],
  'Sulejów': [51.3533, 19.8867],
  'Kielce': [50.8661, 20.6286],
  'Bielsko Biała': [49.8225, 19.0444],
  'Chojnice': [53.6953, 17.5574],
};

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const imgwRes = await fetch('https://danepubliczne.imgw.pl/api/data/synop', {
      signal: controller.signal,
      next: { revalidate: 300 }, // Cache 5 minutes
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TARCZA-Tactical-OSINT/3.5 (Rescue Response)',
      },
    });

    clearTimeout(timeout);

    if (!imgwRes.ok) {
      throw new Error(`IMGW API error: ${imgwRes.status}`);
    }

    const stations: ImgwSynopStation[] = await imgwRes.json();

    // Map stations with significant weather / fire risk into real live MacroThreat objects
    const liveImgwThreats: MacroThreat[] = stations
      .filter((s) => STATION_COORDINATES[s.stacja])
      .map((s, index) => {
        const temp = parseFloat(s.temperatura) || 15;
        const wind = parseFloat(s.predkosc_wiatru) || 0;
        const windKmh = Math.round(wind * 3.6);
        const humidity = parseFloat(s.wilgotnosc_wzgledna) || 70;
        const coords = STATION_COORDINATES[s.stacja];

        // Determine danger level based on IMGW readings
        let severity: 'KRYTYCZNE' | 'WYSOKIE' | 'ŚREDNIE' | 'INFORMACYJNE' = 'INFORMACYJNE';
        let type: MacroThreat['type'] = 'FIRE_HAZARD';
        let label = `Stacja IMGW ${s.stacja}: Temp ${temp}°C, Wiatr ${windKmh} km/h`;

        if (windKmh >= 40 || (temp >= 28 && humidity < 40)) {
          severity = 'WYSOKIE';
          label = `IMGW-PIB: Wysokie zagrożenie pożarowe lasów (Wiatr ${windKmh} km/h, Wilg. ${humidity}%) - ${s.stacja}`;
        } else if (temp >= 20 && humidity < 50) {
          severity = 'ŚREDNIE';
          label = `IMGW-PIB Monitor Meteo: ${s.stacja} (Wiatr ${windKmh} km/h, Wilg. ${humidity}%)`;
        } else {
          severity = 'INFORMACYJNE';
          type = 'INDUSTRIAL';
          label = `IMGW-PIB Synop: ${s.stacja} · T:${temp}°C · W:${windKmh}km/h · P:${s.cisnienie}hPa`;
        }

        return {
          id: `IMGW-LIVE-${s.id_stacji}-${index}`,
          title: label,
          type,
          severity,
          coords,
          region: s.stacja,
          detectedAt: `${s.data_pomiaru} ${s.godzina_pomiaru}:00 UTC (IMGW-PIB Live)`,
          source: 'IMGW-PIB Dane Publiczne (API Otwarte)',
          description: `Rzeczywisty pomiar ze stacji meteorologicznej IMGW-PIB ${s.stacja}. Temperatura: ${temp}°C, wiatr: ${windKmh} km/h (kierunek: ${s.kierunek_wiatru}°), wilgotność względna: ${humidity}%, suma opadu: ${s.suma_opadu} mm.`,
          radiusKm: Math.max(5, Math.min(25, Math.round(windKmh / 2))),
        };
      });

    // Combine real live IMGW stations with core tactical incident threats
    const combinedThreats: MacroThreat[] = [
      ...INITIAL_MACRO_THREATS,
      ...liveImgwThreats.slice(0, 10), // Include top 10 relevant synoptic stations
    ];

    return NextResponse.json({
      status: 'SUCCESS',
      source: 'IMGW-PIB-SYNOP-LIVE',
      timestamp: new Date().toISOString(),
      threatsCount: combinedThreats.length,
      threats: combinedThreats,
    });
  } catch (err: unknown) {
    console.warn('Fallback to local OSINT threats due to IMGW fetch:', err);
    return NextResponse.json({
      status: 'FALLBACK_LOCAL',
      source: 'LOCAL_TACTICAL_CACHE',
      timestamp: new Date().toISOString(),
      threatsCount: INITIAL_MACRO_THREATS.length,
      threats: INITIAL_MACRO_THREATS,
    });
  }
}
