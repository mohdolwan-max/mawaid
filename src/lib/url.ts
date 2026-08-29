// Guards against storing/rendering a "javascript:" (or other
// non-http(s)) scheme in a field an org owner controls but that later
// gets rendered as a real <a href> for anonymous visitors on the public
// booking page (org.maps_url) — otherwise a compromised or malicious
// owner account could plant a stored-XSS link that runs in every
// visitor's browser when clicked.
export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
