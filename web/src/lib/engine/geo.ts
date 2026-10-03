const M_PER_DEG_LAT = 111_320;

export function metersBetween(lon1: number, lat1: number, lon2: number, lat2: number) {
  const kx = Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180) * M_PER_DEG_LAT;
  return Math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * M_PER_DEG_LAT);
}
