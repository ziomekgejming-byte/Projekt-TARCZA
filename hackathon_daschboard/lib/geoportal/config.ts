export interface GeoportalLayerConfig {
  id: string;
  name: string;
  category: 'OSM' | 'ORTOFOTOMAPA' | 'TOPO' | 'EGiB_DZIALKI' | 'KBD_HYDRO';
  description: string;
  wmsUrl?: string;
  tileUrl?: string;
  wmtsLayerName?: string;
  format?: string;
  attribution: string;
  transparent?: boolean;
}

// Configuration of official GUGiK Geoportal Poland (geoportal.gov.pl) and OSM services
export const GEOPORTAL_LAYERS: GeoportalLayerConfig[] = [
  {
    id: 'osm',
    name: 'OpenStreetMap (Standard)',
    category: 'OSM',
    description: 'Domyślna mapa drogowa i topograficzna o globalnym zasięgu.',
    tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  {
    id: 'geoportal-orto',
    name: 'Geoportal Ortofotomapa (PZGiK ORTO)',
    category: 'ORTOFOTOMAPA',
    description: 'Oficjalna ortofotomapa lotnicza i satelitarna GUGiK o wysokiej rozdzielczości.',
    wmsUrl: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution',
    wmtsLayerName: 'Raster',
    format: 'image/jpeg',
    transparent: false,
    attribution: 'GUGiK - Geoportal.gov.pl',
  },
  {
    id: 'geoportal-topo',
    name: 'Geoportal BDOT10k (Topograficzna)',
    category: 'TOPO',
    description: 'Baza Danych Obiektów Topograficznych GUGiK w skali 1:10 000.',
    wmsUrl: 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/BDOT10k/WMS/StandardResolution',
    wmtsLayerName: 'BDOT10k',
    format: 'image/png',
    transparent: true,
    attribution: 'GUGiK - Geoportal.gov.pl (BDOT10k)',
  },
  {
    id: 'geoportal-egib',
    name: 'Geoportal EGiB (Działki i Budynki)',
    category: 'EGiB_DZIALKI',
    description: 'Krajowa Integracja Ewidencji Gruntów i Budynków (granice działek i numery).',
    wmsUrl: 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaEwidencjiGruntow',
    wmtsLayerName: 'dzialki,numery_dzialek,budynki',
    format: 'image/png',
    transparent: true,
    attribution: 'GUGiK - EGiB',
  },
  {
    id: 'geoportal-hydro',
    name: 'Geoportal Hydrografia / ISOK (Wody Polskie)',
    category: 'KBD_HYDRO',
    description: 'Mapy Zagrożenia Powodziowego i Ryzyka Powodziowego (ISOK).',
    wmsUrl: 'https://wody.isok.gov.pl/gps_portal/wms/MZP_MRP',
    wmtsLayerName: 'MZP_Q100',
    format: 'image/png',
    transparent: true,
    attribution: 'PGW Wody Polskie / ISOK',
  },
];
