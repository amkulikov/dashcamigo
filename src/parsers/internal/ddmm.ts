// Shared NMEA coordinate conversion. Several binary formats store lat/lon as
// `DDmm.mmmm` / `DDDmm.mmmm` numbers (degrees*100 + minutes): Novatek freeGPS
// floats, the gps0 tail-atom doubles, Wolfbox gpmd int64 rationals. One
// helper so the conversion cannot drift between parsers.

/**
 * Converts NMEA `DDmm.mmmm` (or `DDDmm.mmmm` for longitude) to decimal
 * degrees. Sign is preserved (negative = S/W) for formats that encode the
 * hemisphere as the sign of the value itself; formats with a separate N/S/E/W
 * field pass the absolute value and apply their own sign. Invalid minute fields
 * return NaN so callers' existing finite/range gates reject the record.
 */
export function ddmmToDegrees(value: number): number {
    if (!Number.isFinite(value)) return Number.NaN;
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    const deg = Math.floor(abs / 100);
    const minutes = abs - deg * 100;
    if (minutes < 0 || minutes >= 60) return Number.NaN;
    return sign * (deg + minutes / 60);
}

export type CoordinateAxis = "lat" | "lon";

export function isCoordinateInRange(value: number, axis: CoordinateAxis): boolean {
    return Number.isFinite(value) && Math.abs(value) <= (axis === "lat" ? 90 : 180);
}
