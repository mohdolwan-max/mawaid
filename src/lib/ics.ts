// An iCalendar feed (RFC 5545) for the calendar links (0070). Free of
// React and the database so it can be tested directly
// (ENGINEERING-STANDARDS §4). Calendars are strict about the format: CRLF
// line ends, lines folded at 75 octets (bytes, not characters: an Arabic
// letter is two), and text escaped, or the whole feed is rejected.

export type IcsEvent = {
  uid: string;
  start: string;
  end: string;
  summary: string;
  description: string;
  location: string | null;
  cancelled: boolean;
  /** When the appointment last changed; calendars use it to update. */
  updated: string;
};

/** "2026-10-26T09:30:00+00:00" → "20261026T093000Z". */
export function icsTime(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Text values: backslash, semicolon, comma and line breaks escaped. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const encoder = new TextEncoder();

/** Folds one content line at 75 octets without splitting a character. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // The first line holds 75 octets; continuation lines start with a
    // space, which counts, so they hold 74.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(input: { name: string; events: readonly IcsEvent[]; now?: Date }): string {
  const stamp = icsTime((input.now ?? new Date()).toISOString());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Maw3ed//Calendar//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(input.name)}`,
    // Hints only; each calendar fetches on its own schedule.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of input.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${icsTime(e.updated)}`,
      `DTSTART:${icsTime(e.start)}`,
      `DTEND:${icsTime(e.end)}`,
      `SUMMARY:${icsText(e.summary)}`,
      `DESCRIPTION:${icsText(e.description)}`,
      ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
      `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** A token as the route receives it: "…hex….ics" or bare hex. */
export function feedToken(raw: string): string | null {
  const t = raw.replace(/\.ics$/i, "");
  return /^[0-9a-f]{64}$/.test(t) ? t : null;
}
