import { GoogleGenAI } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

interface TacticalAiRequest {
  action: 'EVALUATE_RISK' | 'SYNTHESIZE_EVACUATION' | 'GENERATE_MEGAPHONE_SPEECH' | 'MISSION_REPORT' | 'CUSTOM_QUERY';
  sector?: string;
  context?: string;
  query?: string;
  edgeMode?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body: TacticalAiRequest = await req.json();
    const { action, sector = 'SEKTOR B-2/B-4', context = '', query = '', edgeMode = false } = body;

    // Edge AI offline simulation mode
    if (edgeMode || !process.env.GEMINI_API_KEY) {
      return NextResponse.json({
        source: edgeMode ? 'EDGE_AI_JETSON_TX2' : 'TACTICAL_LOCAL_FALLBACK',
        timestamp: new Date().toISOString(),
        analysis: generateEdgeResponse(action, sector, query),
        safeEvacuationRoute: 'Korytarz Północny -> Okno Techniczne 1. piętro -> Schody ewakuacyjne N-1 -> Brama 2',
        recommendedPriority: 'KRYTYCZNY - WYMAGANA AUTORYZACJA KDR',
        voicePrompt: 'Uwaga, tu dron ratowniczy Tarcza. Pozostańcie przy oknie. Nie schodźcie na parter. Uszczelnijcie drzwi. Strażacy rozstawiają drabinę mechaniczną.',
      });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const systemPrompt = `Jesteś wojskowo-ratowniczym Asystentem Taktycznym AI w polskim systemie "TARCZA" (Common Operating Picture dla KDR - Kierującego Działaniem Ratowniczym).
Twój styl wypowiedzi jest zwięzły, profesjonalny, oparty na procedurach PSP i ratownictwa taktycznego.
Używaj polskiego nazewnictwa pożarniczego i dowódczego (roty gaśnicze, KDR, RIT, odcinki bojowe, strefa gorąca/chłodna, BLEVE, FLIR).
Nie twórz zbędnego wstępu, podawaj bezpośrednie fakty, ocenę zagrożenia i wektory działania.`;

    let userPrompt = '';
    switch (action) {
      case 'EVALUATE_RISK':
        userPrompt = `Oceń ryzyko operacyjne dla sektora ${sector}. Dane z drona i czujników: ${context}. Określ prawdopodobieństwo zawalenia stropu, rozprzestrzeniania ognia i zalecenie dla rot ratowniczych.`;
        break;
      case 'SYNTHESIZE_EVACUATION':
        userPrompt = `Wylicz optymalny korytarz ewakuacyjny dla 3 uwięzionych osób w sektorze ${sector}. Kontekst: silne zadymienie parteru, temperatura stropu rośnie, okno na północnej ścianie dostępne. Podaj instrukcję krok po kroku.`;
        break;
      case 'GENERATE_MEGAPHONE_SPEECH':
        userPrompt = `Przygotuj krótki, uspokajający i czytelny komunikat głosowy (maksymalnie 30 słów) do odtworzenia przez megafon drona TARCZA-BRAVO-1 dla uwięzionych ludzi w zadymionym pomieszczeniu.`;
        break;
      case 'MISSION_REPORT':
        userPrompt = `Wygeneruj skrócony raport taktyczny z aktualnego stanu akcji gaśniczo-ratowniczej: stan roju dronów, wykryte zagrożenia termiczne i uwięzieni cywile.`;
        break;
      default:
        userPrompt = query || `Analiza operacyjna dla sektora ${sector}: ${context}`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: [
        { role: 'user', parts: [{ text: `${systemPrompt}\n\nZadanie: ${userPrompt}` }] }
      ],
      config: {
        temperature: 0.2,
      }
    });

    return NextResponse.json({
      source: 'CLOUD_AI_GEMINI_3_8_FLASH',
      timestamp: new Date().toISOString(),
      analysis: response.text || 'Brak danych od modelu',
      safeEvacuationRoute: 'Korytarz Północny -> Okno Techniczne 1. piętro -> Schody ewakuacyjne N-1 -> Brama 2',
      recommendedPriority: 'KRYTYCZNY - WYMAGANA AUTORYZACJA KDR',
      voicePrompt: 'Uwaga, tu dron ratowniczy Tarcza. Pozostańcie przy oknie. Nie otwierajcie drzwi wewnętrznych. Drabina mechaniczna PSP jest w drodze.',
    });
  } catch (error: unknown) {
    console.error('Tactical AI Error:', error);
    return NextResponse.json({
      source: 'LOCAL_EDGE_FALLBACK_ON_ERROR',
      timestamp: new Date().toISOString(),
      analysis: 'Błąd połączenia z chmurą AI. Uruchomiono algorytm rezerwowy Edge Jetson: Wykryto krytyczne naprężenia termiczne konstrukcji B-4. Natychmiastowe zalecenie: Wycofanie rot ze strefy 0.',
      safeEvacuationRoute: 'Wektor bezpieczny: Oś północno-zachodnia, sektor B-1 wolny od dymu toksycznego.',
      recommendedPriority: 'KRYTYCZNY',
      voicePrompt: 'Tu dron ratowniczy. Zachowajcie spokój. Oczekujcie przy oknie północnym.',
    }, { status: 200 });
  }
}

function generateEdgeResponse(action: string, sector: string, query: string): string {
  if (action === 'SYNTHESIZE_EVACUATION') {
    return `[LOKALNA ANALIZA EDGE - NVIDIA JETSON TX2]
1. Wektor ewakuacyjny: Wykluczony parter (temperatura gazów pożarowych > 320°C).
2. Wyznaczono korytarz przez okno północno-zachodnie (sektor B-2, 1. piętro).
3. Dron ALPHA-2 dokonał zrzutu maski ucieczkowej i radiotelefonu.
4. Rota RIT PSP dysponuje skokochronem i drabiną D10W w rejonie punktu zbornego Alfa.`;
  }
  if (action === 'EVALUATE_RISK') {
    return `[LOKALNA ANALIZA EDGE - ZAGROŻENIE STRUKTURALNE]
Sektor: ${sector}.
Temperatura krytyczna stali konstrukcyjnej przekroczona w 2 węzłach nośnych. Czas do utraty stateczności: szacunkowo 4-7 minut.
Rekomendacja: Wycofać ratowników do osłoniętych stanowisk gaśniczych na zewnątrz obiektu.`;
  }
  return `[LOKALNA ANALIZA EDGE] Zapytanie: "${query || sector}". Węzły sieci Mesh sprawne. Drony w pętli patrolowej. Parametry bezpieczne w sektorach A i D.`;
}
