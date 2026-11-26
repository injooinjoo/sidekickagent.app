(() => {
  'use strict';
  // Line icons for the site (#6828): one 16×16 stroke set drawn in the text colour, in the same style as the
  // landing page's check and arrow. Each name follows the app's icon for the same thing (the device capability
  // registry's `icon`), so a capability looks alike on the phone and on the web. Callers ask by name; an unknown
  // name returns null and the caller draws no icon.
  const PATHS = {
    calendar: 'M4 3.5h8A1.5 1.5 0 0 1 13.5 5v7.5A1.5 1.5 0 0 1 12 14H4a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 4 3.5ZM2.5 7h11M5.5 2v3M10.5 2v3',
    'checkmark-circle': 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2ZM5.4 8.2l1.8 1.8 3.4-3.6',
    image: 'M3.5 3h9A1.5 1.5 0 0 1 14 4.5v7a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5v-7A1.5 1.5 0 0 1 3.5 3ZM2 11l3.5-3.5 3 3 2-2 3.5 3.5M10.5 5.6a.7.7 0 1 0 0 1.4.7.7 0 0 0 0-1.4Z',
    document: 'M4.5 1.5H9L12.5 5v8.5A1 1 0 0 1 11.5 14.5h-7a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM9 1.5V5h3.5M5.5 8.5h5M5.5 11h3.5',
    'person-circle': 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2ZM8 4.8a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM4.3 12.2C5.1 10.9 6.4 10.2 8 10.2s2.9.7 3.7 2',
    camera: 'M2.5 5.5A1.5 1.5 0 0 1 4 4h1.5l1-1.5h3l1 1.5H12a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-6ZM8 6.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z',
    location: 'M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8ZM8 4.8a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z',
    flash: 'M9 1.5 3.5 9H8l-1 5.5L12.5 7H8l1-5.5Z',
    phone: 'M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 12h2'
  };

  function create(name) {
    const d = Object.prototype.hasOwnProperty.call(PATHS, name) ? PATHS[name] : '';
    if (!d) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '1em');
    svg.setAttribute('height', '1em');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'site-icon');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.4');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  window.SidekickIcons = Object.freeze({ create, names: Object.freeze(Object.keys(PATHS)) });
})();
