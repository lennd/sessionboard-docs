/**
 * Footer "Request a demo" link. UTM parameters mirror growth-pages demo_url()
 * so HubSpot and GA4 attribute docs-driven demos alongside growth-page demos.
 *
 * Starlight's route id for the home page is "" (it normalizes the collection
 * slug `index` to an empty string). Treating only `index` as home left
 * utm_campaign empty on the homepage.
 */

export function docsCampaignSlug(id) {
  if (id == null || id === '' || id === 'index' || id === '/') return 'home';
  const slug = String(id).replace(/^\/+|\/+$/g, '').replaceAll('/', '-');
  return slug || 'home';
}

export function demoHrefFor(id) {
  const slug = docsCampaignSlug(id);
  const encoded = encodeURIComponent(slug);
  return (
    'https://www.sessionboard.com/demo/' +
    `?utm_source=help-center&utm_medium=docs&utm_campaign=${encoded}` +
    `&utm_content=footer-cta&sb_growth_page=${encoded}&sb_growth_type=docs`
  );
}
