/**
 * The Academy tab, in the browser (src/components/academy/AcademyHome.astro).
 * Reads the reader (/_account/me) and their Academy (/_account/academy), never
 * a token. Start / Continue asks for a one-minute sign-in link
 * (/_account/academy/sign-in) and follows it into the Learning Site.
 */
import { PRODUCT_LABELS, linkedInAddUrl, nextPathFor, visibleProducts } from '../lib/academy.mjs';

const root = document.querySelector('[data-sb-academy]');

const getJson = (path) =>
  fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) =>
    r.ok ? r.json() : r.status === 401 ? { signedOut: true } : null,
  );

const fmtDate = (d) => {
  const date = d ? new Date(d) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;
};

function setStatus(text) {
  const el = root.querySelector('[data-sb-academy-status]');
  if (el) el.textContent = text || '';
}

/** Sign in to the Learning Site and land on `next`. */
async function go(next, button) {
  const label = button.textContent;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Opening…';
  try {
    const res = await fetch('/_account/academy/sign-in', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ next }),
    });
    const body = res.ok ? await res.json() : null;
    if (body?.url) {
      window.location.assign(body.url);
      return;
    }
    setStatus("We couldn't open the Academy just now. Try again in a moment.");
  } catch {
    setStatus("We couldn't open the Academy just now. Try again in a moment.");
  }
  button.removeAttribute('aria-busy');
  button.textContent = label;
}

// ── Filters ──────────────────────────────────────────────────────────

const filters = { product: '', role: '' };
let visible = ['platform'];

function applyFilters() {
  for (const section of root.querySelectorAll('.sb-academy-product')) {
    const product = section.dataset.product;
    const on = visible.includes(product) && (!filters.product || filters.product === product);
    section.hidden = !on;
    let shown = 0;
    for (const card of section.querySelectorAll('.sb-academy-path')) {
      const show = on && (!filters.role || card.dataset.role === filters.role);
      card.hidden = !show;
      if (show) shown++;
    }
    if (shown === 0) section.hidden = true;
  }
}

function wireChips(group, key) {
  const chips = [...root.querySelectorAll(`[data-sb-academy-filters] [data-${key}]`)].filter((b) =>
    group.contains(b),
  );
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      filters[key] = chip.dataset[key];
      for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
      applyFilters();
    });
  }
}

// ── Live progress ────────────────────────────────────────────────────

function fillCard(card, live, site) {
  const start = card.querySelector('[data-sb-start]');
  const lessons = new Map((live?.lessons || []).map((l) => [l.key, l]));
  for (const li of card.querySelectorAll('[data-lesson]')) {
    const l = lessons.get(li.dataset.lesson);
    li.classList.toggle('is-done', Boolean(l?.complete));
    li.classList.toggle('is-next', Boolean(l && live.next_lesson_id === l.id));
  }
  if (!live) {
    start.textContent = 'Coming soon';
    start.setAttribute('aria-disabled', 'true');
    start.removeAttribute('href');
    return;
  }
  // The Site already serves it (e.g. a preview sync): it is not "coming soon" for this reader.
  card.querySelector('.sb-academy-soon')?.remove();
  const p = live.progress || {};
  if (p.started || live.award) {
    const box = card.querySelector('[data-sb-progress]');
    box.hidden = false;
    const bar = box.querySelector('[role=progressbar]');
    bar.setAttribute('aria-valuenow', String(p.percent || 0));
    bar.querySelector('span').style.width = `${p.percent || 0}%`;
    box.querySelector('[data-sb-progress-text]').textContent = `${p.done || 0} of ${p.total || 0} done`;
  }
  const award = live.award && live.award.status === 'active' ? live.award : null;
  let next = nextPathFor(live);
  start.textContent = p.complete && award ? 'Review the lessons' : p.started ? 'Continue' : 'Start path';
  if (award) {
    const badge = card.querySelector('[data-sb-award]');
    badge.hidden = false;
    badge.textContent = `Certified · until ${fmtDate(award.expires_at) || 'no expiry'}`;
  } else if (live.award && live.award.status === 'expired') {
    start.textContent = 'Renew';
  }
  card.dataset.next = next;
  start.href = site?.url || '#';
  start.removeAttribute('aria-disabled');
  start.addEventListener('click', (e) => {
    e.preventDefault();
    go(card.dataset.next || next, start);
  });
}

function fillCertificates(items, site) {
  const earned = items.filter((i) => i.award);
  const box = root.querySelector('[data-sb-academy-certs]');
  const list = root.querySelector('[data-sb-academy-cert-list]');
  if (!earned.length) return;
  box.hidden = false;
  list.replaceChildren(
    ...earned.map((item) => {
      const a = item.award;
      const verifyUrl = site?.url && a.verify_code ? `${site.url.replace(/\/+$/, '')}/verify/${a.verify_code}` : null;
      const li = document.createElement('li');
      const name = document.createElement('p');
      name.className = 'sb-cert-name';
      name.textContent = item.title;
      const meta = document.createElement('p');
      meta.className = 'sb-cert-meta';
      meta.textContent = [
        a.status === 'active' ? 'Active' : a.status === 'expired' ? 'Expired — take the path again to renew' : a.status,
        a.awarded_at && `earned ${fmtDate(a.awarded_at)}`,
        a.expires_at && `${a.status === 'expired' ? 'expired' : 'valid until'} ${fmtDate(a.expires_at)}`,
        a.verify_code && `ID ${a.verify_code}`,
      ]
        .filter(Boolean)
        .join(' · ');
      const links = document.createElement('p');
      links.className = 'sb-cert-links';
      const view = document.createElement('a');
      view.href = site?.url || '#';
      view.textContent = 'View certificate';
      view.addEventListener('click', (e) => {
        e.preventDefault();
        go(`/certificates/${a.id}`, view);
      });
      links.append(view);
      if (verifyUrl) {
        const verify = document.createElement('a');
        verify.href = verifyUrl;
        verify.textContent = 'Public verification page';
        links.append(verify);
        if (a.status === 'active') {
          const add = document.createElement('a');
          add.href = linkedInAddUrl({
            name: item.title,
            issued: a.awarded_at,
            expires: a.expires_at,
            certUrl: verifyUrl,
            certId: a.verify_code,
          });
          add.target = '_blank';
          add.rel = 'noopener';
          add.textContent = 'Add to LinkedIn';
          links.append(add);
        }
      }
      li.append(name, meta, links);
      return li;
    }),
  );
}

/** ?learn=<lesson key>: open the path that teaches it, and make its button start that lesson. */
function focusLesson(key, liveByKey) {
  if (!key) return;
  const card = [...root.querySelectorAll('.sb-academy-path')].find((c) =>
    JSON.parse(c.dataset.lessons || '[]').includes(key),
  );
  if (!card || card.hidden) return;
  card.classList.add('is-highlighted');
  card.querySelector('details')?.setAttribute('open', '');
  card.querySelector(`[data-lesson="${CSS.escape(key)}"]`)?.classList.add('is-next');
  const live = liveByKey.get(card.dataset.key);
  const lesson = (live?.lessons || []).find((l) => l.key === key);
  if (lesson?.available) {
    card.dataset.next = `/lessons/${lesson.id}`;
    const start = card.querySelector('[data-sb-start]');
    if (start && start.getAttribute('aria-disabled') !== 'true') start.textContent = 'Start this lesson';
  }
  card.scrollIntoView({ block: 'center' });
  card.querySelector('[data-sb-start]')?.focus({ preventScroll: true });
}

async function main() {
  if (!root) return;
  const [me, mine] = await Promise.all([getJson('/_account/me').catch(() => null), getJson('/_account/academy').catch(() => null)]);
  const reader = me?.reader ?? null;
  visible = visibleProducts(reader);

  const productChips = root.querySelector('[data-sb-academy-products]');
  for (const chip of productChips.querySelectorAll('[data-product]')) {
    if (chip.dataset.product && !visible.includes(chip.dataset.product)) chip.remove();
  }
  productChips.hidden = visible.filter((p) => root.querySelector(`.sb-academy-product[data-product="${p}"]`)).length < 2;
  wireChips(productChips, 'product');
  wireChips(root.querySelector('[data-sb-academy-filters] [aria-label="Role"]'), 'role');
  applyFilters();

  const academy = mine?.academy;
  if (!reader || mine?.signedOut) {
    setStatus('Sign in to start a path and keep your progress.');
    return;
  }
  if (!academy || academy.available !== true) {
    setStatus(
      academy === null || academy === undefined
        ? "We couldn't load your progress just now. Paths are listed below."
        : "The Academy isn't open in your region yet. Paths are listed below.",
    );
    for (const s of root.querySelectorAll('[data-sb-start]')) {
      s.textContent = 'Not available yet';
      s.setAttribute('aria-disabled', 'true');
      s.removeAttribute('href');
    }
    return;
  }
  const liveByKey = new Map((academy.items || []).filter((i) => i.key).map((i) => [i.key, i]));
  for (const card of root.querySelectorAll('.sb-academy-path')) fillCard(card, liveByKey.get(card.dataset.key), academy.site);
  fillCertificates(academy.items || [], academy.site);
  const names = visible.map((p) => PRODUCT_LABELS[p]).join(', ');
  setStatus(reader.staff ? 'Staff see every path.' : visible.length > 1 ? `Paths for ${names}.` : '');
  focusLesson(new URLSearchParams(location.search).get('learn'), liveByKey);
}

main();
