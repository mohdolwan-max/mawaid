// Share targets as plain URL builders — free of React and the browser so
// they can be tested directly (ENGINEERING-STANDARDS §4).

export type ShareTargets = { whatsapp: string; telegram: string; facebook: string };

export function buildShareTargets(url: string, text: string): ShareTargets {
  const u = encodeURIComponent(url);
  return {
    // WhatsApp has a single text field, so the message and the link travel
    // together — the link on its own line, which is what WhatsApp needs to
    // build the preview card from the clinic page's og: tags.
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
    telegram: `https://t.me/share/url?url=${u}&text=${encodeURIComponent(text)}`,
    // Facebook no longer honours a text/quote parameter; the post is built
    // from the page's own og: tags, which clinic pages already set.
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
  };
}

/** A clinic's canonical public URL. Built from the site host, never from
 *  the current origin — a share made from a preview deployment or from
 *  localhost must still send people to the real site. */
export function clinicShareUrl(siteBase: string, slug: string): string {
  return `${siteBase.replace(/\/+$/, "")}/${encodeURIComponent(slug)}`;
}
