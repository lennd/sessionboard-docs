/**
 * GA4 cross-domain linker hosts. The measurement id stays G-Y3H82ZJMKG
 * (Head.astro). Legacy hosts are included so a visit that starts on help or
 * support and lands on the canonical host can keep one client id. The list
 * follows site.json, so a new legacy host does not need a second edit here.
 */
export function ga4LinkerDomains(site) {
  return ['sessionboard.com', 'www.sessionboard.com', site.canonicalHost, ...(site.legacyHosts ?? [])];
}
