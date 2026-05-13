/**
 * resource-gate.js
 *
 * sellbetter.xyz AI Prompt Library — unified form gate.
 *
 * Gates every tile on /ai-prompt-library/ and every CMS post page (internal
 * prompt OR external GPT) behind a single HubSpot form submission. One
 * submission unlocks any prompt for 7 days via localStorage.
 *
 *   - Index tile click → gate (if invalid) → modal → submit → navigate
 *     internally / window.open externally + show fallback link.
 *   - Direct-link visit to internal-prompt post → gate (if invalid) → modal →
 *     submit → reveal #gated-content in place.
 *   - Direct-link visit to external-link post → gate (if invalid) → modal →
 *     submit → window.open(externalLink) + fallback link. If gate already
 *     valid → window.open on page load.
 *
 * Submits via HubSpot Forms API → form 24210d30 (LLM-Prompt-Access). HubSpot
 * tracking script (loaded via GTM) auto-attributes subsequent CMS page views
 * to the contact's timeline. Tile clicks fire a custom event for both
 * internal and external destinations.
 *
 * Discriminator: a tile / page is "external" iff the CMS field
 * `link-to-prompt` (Webflow display name "External Link") is populated.
 *
 * Plan: C:\Users\sbats\.claude\plans\moonlit-dazzling-kettle.md
 * Audit findings: C:\Users\sbats\Projects\webflow-form_gating-prompt_library\AUDIT_REPORT.md
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // CONFIG
  // ---------------------------------------------------------------------------
  var CONFIG = {
    portalId: '21795561',
    // HubSpot form GUID — LLM Prompt Access (existing live form). The new
    // unified gate posts to this form so submissions stay consolidated with
    // marketing's existing data stream.
    formGuid: '24210d30-9761-480f-8e06-0c8b3d17e933',
    // Internal name of the HubSpot custom event. Format pe{portalId}_<name>.
    // Confirm and update after creating the event in HubSpot.
    customEventName: 'pe21795561_resource_click',
    // Default value for the recent_snack_id hidden HubSpot field. The legacy
    // LLM Prompt Access form embed shipped this value baked into the input
    // default; HubSpot's Forms API doesn't apply hidden-field defaults so
    // we send it explicitly via attributionFields() on every submission.
    // Not used by HubSpot for contact matching — it's a marketing tracking
    // attribute. Update if marketing wants a different value.
    recentSnackId: '148',
    gateTtlDays: 7,
    storageKey: 'sb_gate_v1',
    attrFirstKey: 'sb_attribution_first',
    attrLastKey: 'sb_attribution_last',
    // Webflow-side selectors / attributes.
    // Tile selector matches either:
    //   1. any element with data-gate="true" (canonical convention), OR
    //   2. any anchor whose class contains "pcard__link" (covers cases where
    //      Webflow stripped the data-gate attribute when duplicating the
    //      Collection Item, or auto-suffixed the class on duplication).
    tileSelector: '[data-gate="true"], a[class*="pcard__link"]',
    gatePageAttr: 'data-gate-page',
    // External-mode marker on a CMS post page: an in-page CTA link with
    // [data-external-cta] whose href is bound to the link-to-prompt CMS field.
    // The script reads the link's href to know the external destination. This
    // sidesteps Webflow's lack of CMS binding for arbitrary custom attributes.
    externalCtaSelector: '[data-external-cta]',
    gatedContentId: 'gated-content',
    modalId: 'gate-modal',
    modalFormId: 'gate-modal-form',
    fallbackLinkContainerId: 'gate-fallback-link',
  };

  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  // V1: Click-ID capture is OFF. The custom hs_*_click_id contact properties
  // exist in HubSpot, but they are NOT yet added as form fields on form
  // 24210d30 — the Forms API silently drops fields that aren't on the form,
  // so populating them here would do nothing. Re-enable in v2 after adding
  // hs_google_click_id, hs_facebook_click_id, hs_linkedin_click_id, and
  // hs_tiktok_click_id as hidden fields on form 24210d30.
  // var CLICK_ID_MAP = {
  //   gclid: 'hs_google_click_id',
  //   fbclid: 'hs_facebook_click_id',
  //   li_fat_id: 'hs_linkedin_click_id',
  //   ttclid: 'hs_tiktok_click_id',
  // };

  // V1 fields accepted by HubSpot form 24210d30 (per audit 2026-04-27):
  //   visible: Email (note capital E), firstname, lastname (firstname/lastname
  //     pending: user is adding to form 24210d30 in HubSpot)
  //   hidden / auto-context: pageName, pageId, pageUri, ipAddress, hs_unique_id,
  //     hutk (these are auto-populated by the HubSpot Forms API integration —
  //     the script only needs to send the equivalent values via context)
  //   utm: utm_source, utm_medium, utm_campaign, utm_term, utm_content
  //   legacy: special_reg, recent_snack_id (kept for marketing data continuity)

  // ---------------------------------------------------------------------------
  // Small utilities
  // ---------------------------------------------------------------------------
  function now() { return Date.now(); }

  function readJSON(storage, key) {
    try {
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function writeJSON(storage, key, value) {
    try { storage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota / disabled */ }
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : '';
  }

  function getQueryParams() {
    var out = {};
    var search = window.location.search.replace(/^\?/, '');
    if (!search) return out;
    search.split('&').forEach(function (pair) {
      if (!pair) return;
      var idx = pair.indexOf('=');
      var k = idx === -1 ? pair : pair.slice(0, idx);
      var v = idx === -1 ? '' : pair.slice(idx + 1);
      try { out[decodeURIComponent(k)] = decodeURIComponent(v); } catch (e) { out[k] = v; }
    });
    return out;
  }

  function pickKeys(src, keys) {
    var out = {};
    keys.forEach(function (k) { if (src[k]) out[k] = src[k]; });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Attribution: capture first-touch (persistent) and last-touch (per session).
  // ---------------------------------------------------------------------------
  // HubSpot already handles first/last-touch attribution server-side on the
  // standard utm_* properties, and populates first/last referring site from
  // the hutk. We keep a first-touch snapshot in localStorage as a safety net
  // (e.g. if the HubSpot cookie is blocked) and always submit the last-touch
  // UTMs on the current pageload.
  function captureAttribution() {
    var params = getQueryParams();
    var hasUtm = UTM_KEYS.some(function (k) { return params[k]; });

    var snapshot = {
      utm: pickKeys(params, UTM_KEYS),
      captured_at: new Date().toISOString(),
    };

    var first = readJSON(localStorage, CONFIG.attrFirstKey);
    if (!first) {
      writeJSON(localStorage, CONFIG.attrFirstKey, snapshot);
      first = snapshot;
    }

    var last = readJSON(sessionStorage, CONFIG.attrLastKey);
    if (!last || hasUtm) {
      writeJSON(sessionStorage, CONFIG.attrLastKey, snapshot);
      last = snapshot;
    }

    return { first: first, last: last };
  }

  function attributionFields() {
    var a = captureAttribution();
    var fields = {};

    // Submit the current session's (last-touch) UTMs under the standard HubSpot
    // property names. HubSpot's first/last attribution system fills the
    // first/last contact properties internally on submission.
    UTM_KEYS.forEach(function (k) {
      fields[k] = (a.last.utm && a.last.utm[k]) || (a.first.utm && a.first.utm[k]) || '';
    });

    // recent_snack_id — legacy marketing tracking field. The legacy LLM Prompt
    // Access form embed had this baked in as an input default value, but the
    // HubSpot Forms API doesn't apply hidden-field defaults, so we send the
    // value explicitly on every submission from the modal and inline forms.
    if (CONFIG.recentSnackId) fields.recent_snack_id = CONFIG.recentSnackId;

    return fields;
  }

  // ---------------------------------------------------------------------------
  // Gate state (localStorage).
  // ---------------------------------------------------------------------------
  function isGateValid() {
    var s = readJSON(localStorage, CONFIG.storageKey);
    return !!(s && s.expiresAt && s.expiresAt > now());
  }

  function setGate(contactEmail, hutk) {
    var ttlMs = CONFIG.gateTtlDays * 24 * 60 * 60 * 1000;
    writeJSON(localStorage, CONFIG.storageKey, {
      contactEmail: contactEmail || '',
      hutk: hutk || '',
      submittedAt: now(),
      expiresAt: now() + ttlMs,
    });
  }

  // Push an identify call to HubSpot's tracking queue using the email we
  // stored on the most recent gate submission, followed by a trackPageView
  // to actually flush the identification. Without the trackPageView,
  // identify() queues the email but doesn't tie subsequent custom events
  // to the contact in the same page session — that's the cause of the
  // "unknown contact" events that arrive with all the resource properties
  // populated but no contact attached.
  //
  // HubSpot's tracking script auto-fires a trackPageView on script load,
  // but it fires before our identify is queued, so it doesn't help. Our
  // explicit trackPageView after the identify ensures the identification
  // is applied before any custom events in this session are processed.
  //
  // Silent no-op if no email is stored (first-time visitor without a
  // submission) — those events stay anonymous until the user submits,
  // which is unavoidable. HubSpot back-attributes anonymous events to
  // the contact via the persistent hutk cookie once they do submit.
  function identifyHubspotContact() {
    var gate = readJSON(localStorage, CONFIG.storageKey);
    if (!gate || !gate.contactEmail) return;
    try {
      window._hsq = window._hsq || [];
      window._hsq.push(['identify', { email: gate.contactEmail }]);
      // Flush the identification. Without this trackPageView, the identify()
      // above queues but doesn't actually associate the visitor with the
      // contact record for subsequent events in this page session.
      window._hsq.push(['trackPageView']);
    } catch (e) { /* no-op */ }
  }

  // ---------------------------------------------------------------------------
  // HubSpot Forms API submit.
  // ---------------------------------------------------------------------------
  function submitHubSpotForm(formFieldValues) {
    var url = 'https://api.hsforms.com/submissions/v3/integration/submit/'
            + encodeURIComponent(CONFIG.portalId) + '/'
            + encodeURIComponent(CONFIG.formGuid);

    var fields = Object.keys(formFieldValues).map(function (name) {
      return { name: name, value: formFieldValues[name] == null ? '' : String(formFieldValues[name]) };
    });

    var payload = {
      fields: fields,
      context: {
        hutk: getCookie('hubspotutk') || undefined,
        pageUri: window.location.href,
        pageName: document.title,
      },
    };

    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.text().then(function (t) { throw new Error('HubSpot ' + resp.status + ': ' + t); });
      }
      return resp.json();
    });
  }

  // ---------------------------------------------------------------------------
  // HubSpot custom event (Enterprise: trackCustomBehavioralEvent).
  // ---------------------------------------------------------------------------
  // Strip "| Sell Better" / "| sellbetter.xyz" suffix from document.title so
  // page-load fallbacks for resource_title are the clean resource name.
  function stripSiteName(t) {
    return (t || '')
      .replace(/\s*[|\-—]\s*Sell\s*Better.*$/i, '')
      .replace(/\s*[|\-—]\s*sellbetter.*$/i, '')
      .trim();
  }

  function trackResourceClick(tile) {
    // Extract from tile attributes when a tile element is present (the
    // common path — tile click on index, related-prompts, or the post-page
    // success-state CTA which has data-gate/data-external-cta but may not
    // carry data-resource-slug or data-resource-title in published markup).
    var slug = '';
    var title = '';
    var topics = '';
    var isExternal = false;
    var destinationUrl = '';

    if (tile) {
      slug = tile.getAttribute('data-resource-slug') || '';
      title = tile.getAttribute('data-resource-title') || '';
      topics = tile.getAttribute('data-resource-topics') || '';
      isExternal = tile.getAttribute('data-is-external') === 'true'
                || tile.getAttribute('data-external-cta') === 'true';
      destinationUrl = tile.getAttribute('href')
                    || tile.getAttribute('data-external-href')
                    || '';
    }

    // Page-level fallback: fills in any field still empty using inference
    // from the current CMS post page. Runs whether or not we're on a gated
    // page, but is most useful on /ai-prompt-library/<slug> direct visits
    // and for the success-state CTA whose markup lacks resource-* data attrs.
    if (!slug) {
      // Last non-empty path segment, e.g. /ai-prompt-library/cold-call-script-generator
      var parts = window.location.pathname.split('/').filter(Boolean);
      slug = (parts.length ? parts[parts.length - 1] : '').trim();
    }
    if (!title) {
      title = (document.body && document.body.getAttribute('data-resource-title'))
            || stripSiteName(document.title);
    }
    if (!topics) {
      topics = (document.body && document.body.getAttribute('data-resource-topics')) || '';
    }
    if (!destinationUrl) {
      // On an external-link CMS post page the external URL is the destination;
      // on an internal-prompt page or the index the current page URL is.
      destinationUrl = getExternalLinkOnPage() || window.location.href;
    }
    if (!isExternal) {
      isExternal = !!getExternalLinkOnPage();
    }

    var props = {
      resource_slug: slug,
      resource_title: title,
      destination_url: destinationUrl,
      is_external: isExternal,
      topics: topics,
    };

    // Per-session per-resource dedupe. The same resource can be engaged with
    // multiple ways in a single session — page view, CTA click on the success
    // state, re-clicking a tile, etc. Marketing wants to know who's interested,
    // not the raw click count, so we fire exactly one Resource click per slug
    // per browser session. Re-fires only after the session storage is cleared
    // (browser closed, new tab on Safari, etc.). The dedupe key includes the
    // event name so swapping the event later doesn't collide with cached keys.
    if (slug) {
      try {
        var dedupeKey = 'sb_evt_' + CONFIG.customEventName + '_' + slug;
        if (sessionStorage.getItem(dedupeKey) === '1') {
          console.log('[resource-gate] resource_click already fired this session for "' + slug + '" — skipping duplicate');
          return;
        }
        sessionStorage.setItem(dedupeKey, '1');
      } catch (e) { /* sessionStorage unavailable in some contexts — fire anyway */ }
    }

    try {
      window._hsq = window._hsq || [];
      window._hsq.push(['trackCustomBehavioralEvent', {
        name: CONFIG.customEventName,
        properties: props,
      }]);
    } catch (e) { /* no-op */ }

    // GA4 parallel event via dataLayer (preferred when GTM is present, as it
    // is on sellbetter.xyz). Silently no-ops if dataLayer/gtag aren't loaded.
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', 'resource_click', props);
      } else if (Array.isArray(window.dataLayer)) {
        window.dataLayer.push({ event: 'resource_click', ...props });
      }
    } catch (e) { /* no-op */ }
  }

  // Fire a Resource click event on page load for direct visits to CMS post
  // pages (someone arrived from email, social, search, etc., without going
  // through a tile click on the index). Skipped if the prior tile click on
  // this domain already fired an event for this navigation — flag is set in
  // handleTileClick / executePendingAction below and cleared on first read.
  function maybeTrackPageLoadView() {
    if (!isGatedPage()) return;
    try {
      if (sessionStorage.getItem('sb_skip_view_event') === '1') {
        sessionStorage.removeItem('sb_skip_view_event');
        return;
      }
    } catch (e) { /* sessionStorage may be unavailable in some contexts */ }
    try { trackResourceClick(null); } catch (e) { /* no-op */ }
  }

  // ---------------------------------------------------------------------------
  // Modal wiring.
  // ---------------------------------------------------------------------------
  function getModal() { return document.getElementById(CONFIG.modalId); }
  function getModalForm() { return document.getElementById(CONFIG.modalFormId); }
  function getFallbackContainer() { return document.getElementById(CONFIG.fallbackLinkContainerId); }

  // Tracks the element that had focus when the modal was opened, so we can
  // restore focus there when the modal closes (WCAG 2.1 SC 2.4.3 Focus Order
  // / common a11y pattern for dialogs).
  var lastFocusedBeforeModal = null;

  // Collect every keyboard-focusable element inside the modal, in DOM order.
  // Excludes elements with tabindex="-1", disabled inputs, hidden inputs, and
  // elements not currently rendered (offsetParent null).
  function getFocusableInModal() {
    var m = getModal();
    if (!m) return [];
    var candidates = m.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
      'textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(candidates, function (el) {
      // Skip elements hidden via display:none or inside a hidden ancestor —
      // offsetParent returns null for those. Note: this also returns null for
      // position:fixed elements with no offset parent; that's fine for our
      // modal since the inputs are inside flow layout.
      return el.offsetParent !== null
          || el.tagName === 'INPUT' && el.type === 'hidden' === false;
    });
  }

  function showModal() {
    var m = getModal();
    if (!m) return;
    // Save the element that triggered the open so we can restore focus on
    // close (don't overwrite a previously-saved trigger if the modal is
    // re-shown without ever being hidden).
    if (!lastFocusedBeforeModal && document.activeElement && document.activeElement !== document.body) {
      lastFocusedBeforeModal = document.activeElement;
    }
    m.removeAttribute('hidden');
    m.style.display = 'flex';
    m.setAttribute('aria-hidden', 'false');
    // ARIA: a dialog needs role + aria-modal + a label. aria-labelledby
    // points at the H2 title so screen readers announce "Get the prompt"
    // when the dialog opens.
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    var title = m.querySelector('.gate-modal__title');
    if (title) {
      if (!title.id) title.id = 'gate-modal-title';
      m.setAttribute('aria-labelledby', title.id);
    }
    // Move focus into the modal so subsequent Tab keys cycle within it.
    // Defer one tick so the display:flex repaint completes and focusable
    // elements become reachable.
    setTimeout(function () {
      var focusables = getFocusableInModal();
      // Prefer the first form input over the close button so the user is
      // immediately ready to type. Find the first input/textarea.
      var preferred = null;
      for (var i = 0; i < focusables.length; i++) {
        var el = focusables[i];
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { preferred = el; break; }
      }
      var target = preferred || focusables[0];
      if (target && typeof target.focus === 'function') target.focus();
    }, 0);
  }

  function hideModal() {
    var m = getModal();
    if (!m) return;
    m.setAttribute('hidden', '');
    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');
    // Reset success-state visibility so reopening the modal shows the form
    // again, not the leftover fallback link from a prior submit.
    resetFormVisibility();
    // Restore focus to the element that opened the modal (e.g. the tile
    // anchor). Falls back gracefully if that element no longer exists.
    if (lastFocusedBeforeModal && document.body.contains(lastFocusedBeforeModal)
        && typeof lastFocusedBeforeModal.focus === 'function') {
      try { lastFocusedBeforeModal.focus(); } catch (e) {}
    }
    lastFocusedBeforeModal = null;
  }

  // Focus trap. Tab from the last focusable wraps to the first; Shift+Tab
  // from the first wraps to the last. Only active while the modal is open.
  function handleModalFocusTrap(e) {
    if (e.key !== 'Tab' && e.keyCode !== 9) return;
    var m = getModal();
    if (!m || m.hasAttribute('hidden') || m.style.display === 'none') return;
    var focusables = getFocusableInModal();
    if (focusables.length === 0) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !m.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Convert the visible .gate-modal__submit element from an <a> Link (or any
  // non-button element) into a real <button type="submit">.
  //
  // Why: an <a href="#"> is technically focusable, but macOS and Safari (with
  // default keyboard navigation settings) skip links during Tab traversal —
  // they only stop on form fields and explicit buttons. Users on Mac literally
  // cannot tab to the "Let's go" Link. A <button type="submit"> is universally
  // tabbable on every OS/browser, natively triggers form submission on Enter
  // and Space, and is announced correctly by screen readers without needing
  // role="button" overrides.
  //
  // Preserves the existing classes (so visual styling is unchanged), inner
  // text/markup (so any icon/arrow inside survives), and any data-/aria-/role
  // attributes. The proxy click handler already detects real submit buttons
  // and lets the browser dispatch the submit event naturally — no double-fire.
  function ensureModalSubmitIsButton() {
    var el = document.querySelector('.gate-modal__submit');
    if (!el) return;
    // Already a real submit input/button? Defensively pin tabindex and leave.
    if (el.matches && el.matches('button[type="submit"], input[type="submit"]')) {
      if (el.getAttribute('tabindex') === null) el.setAttribute('tabindex', '0');
      return;
    }
    // Already a generic <button>? Just enforce type=submit + tabindex.
    if (el.tagName === 'BUTTON') {
      el.type = 'submit';
      if (el.getAttribute('tabindex') === null) el.setAttribute('tabindex', '0');
      return;
    }
    // Otherwise it's a Link or div — swap for a real submit <button>.
    //
    // Copy ALL attributes except those that don't apply to <button> (href,
    // target, rel) and the type attribute (we set type=submit explicitly).
    // Crucially this preserves Webflow's auto-generated id="w-node-..." that
    // ties the element to its CSS Grid placement rule — dropping that id
    // breaks alignment (the button shifts to the left edge because Webflow
    // generates per-element grid-area rules keyed off the w-node id).
    var btn = document.createElement('button');
    btn.type = 'submit';
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name === 'href' || a.name === 'target' || a.name === 'rel') continue;
      if (a.name === 'type') continue;
      try { btn.setAttribute(a.name, a.value); } catch (e) {}
    }
    btn.innerHTML = el.innerHTML;
    // Defensive tabindex=0 so the button is reachable on every OS regardless
    // of browser-specific link-skipping behavior or stray tabindex=-1 carried
    // over from the original element.
    btn.setAttribute('tabindex', '0');
    if (el.parentNode) el.parentNode.replaceChild(btn, el);
    console.log('[resource-gate] converted .gate-modal__submit to <button>; tabIndex=' + btn.tabIndex);
  }

  // Inject a honeypot input into a form to catch bot submissions. The field
  // is named "special_reg" (matching the existing HubSpot form field we have
  // for this purpose) and is positioned off-screen so humans never see it.
  // Most form-spam bots blindly fill every visible input they parse from the
  // DOM, so they populate this field; the submit handler then aborts when it
  // sees a value present. The field is type="text" (not type="hidden") so
  // that bots which deliberately skip hidden inputs still get caught.
  //
  // Why off-screen positioning instead of CSS display:none: many bots skip
  // any input with display:none or visibility:hidden as obviously hidden.
  // Off-screen positioning keeps the input "rendered" from a bot's
  // perspective. autocomplete=off + tabindex=-1 + aria-hidden ensures real
  // users (including keyboard and screen-reader users) never reach or are
  // told about the field.
  function ensureHoneypotField(form) {
    if (!form) return;
    if (form.querySelector('input[name="special_reg"]')) return; // already present
    var hp = document.createElement('input');
    hp.type = 'text';
    hp.name = 'special_reg';
    hp.value = '';
    hp.setAttribute('tabindex', '-1');
    hp.setAttribute('autocomplete', 'off');
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute !important;left:-9999px !important;top:-9999px !important;' +
      'width:1px !important;height:1px !important;opacity:0 !important;pointer-events:none !important;' +
      'border:0 !important;padding:0 !important;margin:0 !important;';
    form.appendChild(hp);
  }

  // Inject a visually-hidden <button type="submit"> into a form when no real
  // submit element is present. Defensive backstop for forms whose visible
  // submit control is a Link/div — without a real submit button, pressing
  // Enter in any input does nothing. The hidden button is removed from the
  // tab order (tabindex=-1) and hidden from screen readers (aria-hidden) so
  // it never appears in keyboard navigation or aria announcements.
  //
  // After ensureModalSubmitIsButton runs, the modal form has a real visible
  // submit button so this becomes a no-op for the modal. Still called for
  // the inline form (which already has a Webflow FormButton, also a no-op)
  // and any future gate form that might lack one.
  function ensureFormHasSubmitButton(form) {
    if (!form) return;
    var existing = form.querySelector('button[type="submit"], input[type="submit"]');
    if (existing) return;
    var btn = document.createElement('button');
    btn.type = 'submit';
    btn.setAttribute('aria-hidden', 'true');
    btn.setAttribute('tabindex', '-1');
    btn.style.cssText = 'position:absolute !important;width:1px !important;height:1px !important;' +
      'padding:0 !important;margin:-1px !important;overflow:hidden !important;clip:rect(0 0 0 0) !important;' +
      'white-space:nowrap !important;border:0 !important;';
    btn.textContent = '';
    form.appendChild(btn);
  }

  function showFallbackLink(url) {
    var fb = getFallbackContainer();
    if (!fb) return;
    // Expect an <a> inside the container; update its href before revealing.
    var a = fb.querySelector('a');
    if (a) { a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    fb.removeAttribute('hidden');
    // Explicit display value (not '') so we win over any class-level
    // display:none on .gate-modal__fallback that may have been set in Webflow
    // to keep the block hidden on initial load.
    fb.style.display = 'block';

    // Hide ONLY the <form> element (not the entire .w-form wrapper) so the
    // sibling .w-form-done success message can become visible. Then reveal it.
    var form = getModalForm();
    if (form) {
      form.style.display = 'none';
      var wrapper = form.closest('.w-form');
      if (wrapper) {
        var done = wrapper.querySelector('.w-form-done');
        if (done) done.style.display = 'block';
        // Make sure the error block stays hidden — Webflow's CSS keeps it
        // hidden by default but be explicit in case classes were edited.
        var fail = wrapper.querySelector('.w-form-fail');
        if (fail) fail.style.display = 'none';
      }
    }
  }

  function resetFormVisibility() {
    var form = getModalForm();
    if (form) {
      form.style.display = '';
      var wrapper = form.closest('.w-form');
      if (wrapper) {
        // Restore wrapper display in case any prior code path hid it.
        wrapper.style.display = '';
        var done = wrapper.querySelector('.w-form-done');
        if (done) done.style.display = 'none';
        var fail = wrapper.querySelector('.w-form-fail');
        if (fail) fail.style.display = 'none';
      }
    }
    var fb = getFallbackContainer();
    if (fb) {
      fb.setAttribute('hidden', '');
      fb.style.display = 'none';
    }
  }

  function revealGatedContent() {
    var el = document.getElementById(CONFIG.gatedContentId);
    if (el) el.removeAttribute('hidden');
  }

  // ---------------------------------------------------------------------------
  // Pending action (what to do after a successful submit).
  // Shape: { type: 'reveal'|'internal'|'external', url?: string, tile?: Element }
  // 'reveal'   = direct-link visit to an internal CMS post; reveal #gated-content
  // 'internal' = index tile click → navigate same-tab to internal post URL
  // 'external' = index tile click OR direct-link external post; window.open + fallback
  // ---------------------------------------------------------------------------
  var pendingAction = null;

  function executePendingAction() {
    var action = pendingAction;
    pendingAction = null;

    // No queued action — modal opened without a tile click or direct-link
    // gating context. Just close the modal so the user isn't stuck.
    if (!action) {
      hideModal();
      return;
    }

    // Fire the resource_click custom event for any tracked action. For tile
    // clicks we use the tile's data attributes; for direct-link external
    // pages (no tile), build a synthetic tile from page-level attributes.
    var trackable = action.tile
                 || (action.type === 'external' ? makeSyntheticTile(action.url, true) : null);
    if (trackable) { try { trackResourceClick(trackable); } catch (e) {} }

    if (action.type === 'external') {
      try { window.open(action.url, '_blank', 'noopener'); } catch (e) {}
      // Always surface the fallback link — popup blockers may silently stop
      // window.open; per spec the fallback button always appears after submit.
      showFallbackLink(action.url);
      // Don't auto-close the modal; user can dismiss manually after confirming
      // the new tab opened, or click the fallback link.
    } else if (action.type === 'internal') {
      // Internal navigation after modal submit — same dedupe flag as
      // handleTileClick so the destination page doesn't double-count.
      try { sessionStorage.setItem('sb_skip_view_event', '1'); } catch (e) {}
      hideModal();
      window.location.href = action.url;
    } else if (action.type === 'reveal') {
      hideModal();
      revealGatedContent();
    } else {
      // Unknown action type — close defensively.
      hideModal();
    }
  }

  // ---------------------------------------------------------------------------
  // Form submit handler. Works for both the modal form AND the inline
  // (legacy LLM Prompt Access) form on external-link CMS post pages.
  // ---------------------------------------------------------------------------
  function handleFormSubmit(e) {
    e.preventDefault();
    // Prevent Webflow's native form integration handler from also running and
    // posting the form to its own endpoint. The legacy LLM Prompt Access form
    // is registered with Webflow's submit handler — without stopImmediate
    // we'd double-submit (once via Webflow → its endpoint, once via our
    // HubSpot Forms API call). Listener is registered in capture phase below
    // so this handler runs first.
    if (typeof e.stopImmediatePropagation === 'function') {
      e.stopImmediatePropagation();
    }

    // Submit can be triggered programmatically (e.g. via the proxy click on a
    // Link "submit"). e.target is the form for native submit events; fall back
    // to the modal form for safety.
    var form = e.target && e.target.tagName === 'FORM' ? e.target : getModalForm();
    if (!form) return;

    // Collect visible + hidden form fields.
    var values = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'submit' || el.type === 'button') return;
      values[el.name] = el.value;
    });

    // Honeypot check. The special_reg field is positioned off-screen so a
    // real user never sees, focuses, or fills it — but most form-spam bots
    // auto-fill every visible input they parse from the DOM and populate it.
    // If it has a value, abort silently: don't POST to HubSpot, don't set the
    // gate flag, don't navigate or open a new tab. We don't show an error
    // message because (a) real users will never see this case so the message
    // is wasted, and (b) showing an error gives the bot operator diagnostic
    // feedback to evade the check.
    if (values.special_reg && String(values.special_reg).trim() !== '') {
      console.warn('[resource-gate] honeypot tripped — submission blocked');
      var trippedBtn = form.querySelector('[type="submit"]');
      if (trippedBtn) { trippedBtn.disabled = false; trippedBtn.removeAttribute('aria-busy'); }
      return;
    }

    // Merge attribution — hidden field values from the form take precedence
    // if the Webflow form already has them populated; otherwise we inject.
    var attr = attributionFields();
    Object.keys(attr).forEach(function (k) {
      if (values[k] === undefined || values[k] === '') values[k] = attr[k];
    });

    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); }

    // Email field name varies (modal uses "Email", legacy form uses "Email";
    // some forms might use lowercase). Look up case-insensitively for setGate.
    var emailForGate = '';
    for (var k in values) {
      if (k && k.toLowerCase() === 'email' && values[k]) { emailForGate = values[k]; break; }
    }

    var isInlineForm = form.id === 'gate-form-inline';

    submitHubSpotForm(values)
      .then(function () {
        setGate(emailForGate, getCookie('hubspotutk'));
        // Identify the visitor to HubSpot right after we have their email +
        // the form submission has created/updated a contact. This makes any
        // events that fire later in this page session (executePendingAction's
        // tile-click events, the success-state CTA click) tie to the contact
        // instead of landing as "unknown contact" while the hubspotutk cookie
        // catches up.
        identifyHubspotContact();
        if (isInlineForm) {
          // Inline form path on external-link CMS post page. Open the
          // external URL in a new tab and swap to the form's native success
          // state (Webflow's .w-form-done with the "Click here to open the
          // GPT" CTA). Don't touch the modal — it isn't the form in play.
          if (pendingAction && pendingAction.type === 'external' && pendingAction.url) {
            try { window.open(pendingAction.url, '_blank', 'noopener'); } catch (err) {}
          }
          swapInlineForm();
          pendingAction = null;
        } else {
          // Modal form path — existing flow (navigate / reveal / external+fallback).
          executePendingAction();
        }
      })
      .catch(function (err) {
        console.error('[resource-gate] form submit failed:', err);
        alert('Sorry — something went wrong submitting the form. Please try again.');
      })
      .then(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); }
      });
  }

  // ---------------------------------------------------------------------------
  // Tile click handler (delegated).
  // ---------------------------------------------------------------------------
  // Detects external destinations resiliently:
  //   1. data-external-href attribute (preferred — bind to External Link CMS
  //      field). When set, treated as external and the new tab opens to it.
  //   2. data-is-external="true" attribute.
  //   3. Auto-detect: href is an absolute URL pointing to a different origin.
  function isExternalUrl(href) {
    if (!href) return false;
    if (href.indexOf('http://') !== 0 && href.indexOf('https://') !== 0) return false;
    try {
      return new URL(href, window.location.href).origin !== window.location.origin;
    } catch (e) { return false; }
  }

  function handleTileClick(e) {
    var tile = e.target.closest(CONFIG.tileSelector);
    if (!tile) return;

    var href = tile.getAttribute('href') || '';
    var externalHref = tile.getAttribute('data-external-href') || '';
    var dataIsExternal = tile.getAttribute('data-is-external') === 'true';
    var isExternal = !!externalHref || dataIsExternal || isExternalUrl(href);
    var actionUrl = externalHref || href;

    if (isGateValid()) {
      // Gate is valid. For external tiles, we still want a new tab even if the
      // anchor's target attribute isn't set (covers the single-Item setup
      // where target=_blank can't be conditionally applied). For internal,
      // let the browser navigate normally.
      if (isExternal) {
        e.preventDefault();
        try { trackResourceClick(tile); } catch (err) {}
        try { window.open(actionUrl, '_blank', 'noopener'); } catch (err) {}
        return;
      }
      // Internal tile click — fires event, then browser navigates. Flag the
      // destination page to skip its page-load view event so we don't
      // double-count this navigation.
      try { trackResourceClick(tile); } catch (err) {}
      try { sessionStorage.setItem('sb_skip_view_event', '1'); } catch (err) {}
      return;
    }

    // Need to gate: cancel default navigation, queue the action, show modal.
    e.preventDefault();
    pendingAction = {
      type: isExternal ? 'external' : 'internal',
      url: actionUrl,
      tile: tile,
    };
    showModal();
  }

  // Close the modal when the user clicks the dark overlay outside the card.
  // Only allowed on the index / non-gated pages — on a CMS post page the modal
  // is the only path to revealing #gated-content, so click-outside would
  // strand the user with hidden content underneath.
  function handleModalOverlayClick(e) {
    var modal = getModal();
    if (!modal) return;
    if (e.target !== modal) return;
    if (isGatedPage()) return; // can't dismiss the modal on CMS post pages
    pendingAction = null;
    hideModal();
  }

  // Close button (×) inside the modal card.
  function handleModalCloseClick(e) {
    var btn = e.target.closest('[data-modal-close]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (isGatedPage()) return; // same constraint — must complete the form
    pendingAction = null;
    hideModal();
  }

  // Submit-click proxy. The "Let's go" CTA may be a Link in Webflow (which
  // doesn't fire a form submit event when clicked). Catch the click and
  // dispatch a submit event on the form so handleFormSubmit runs once and only
  // once regardless of element type. Native submit buttons inside <form> still
  // dispatch the submit event the normal way; this proxy only matters when the
  // CTA is a Link or other non-submit element.
  function handleSubmitProxyClick(e) {
    var trigger = e.target.closest('.gate-modal__submit');
    if (!trigger) return;
    var form = getModalForm();
    if (!form) return;
    // If the trigger is already a real submit button inside the form, let the
    // browser dispatch the submit event itself — don't double-fire.
    if (typeof trigger.matches === 'function'
        && trigger.matches('button[type="submit"], input[type="submit"]')
        && form.contains(trigger)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // Use requestSubmit if available (runs validation + dispatches submit);
    // fall back to dispatching a cancelable submit event manually.
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
    } else {
      var evt;
      try {
        evt = new Event('submit', { bubbles: true, cancelable: true });
      } catch (err) {
        evt = document.createEvent('Event');
        evt.initEvent('submit', true, true);
      }
      form.dispatchEvent(evt);
    }
  }

  // Esc key closes the modal on non-gated pages.
  function handleModalEscKey(e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    var modal = getModal();
    if (!modal) return;
    // Only react when the modal is actually visible.
    var isVisible = modal.style.display === 'flex';
    if (!isVisible) return;
    if (isGatedPage()) return;
    pendingAction = null;
    hideModal();
  }

  // ---------------------------------------------------------------------------
  // Bootstrap.
  // ---------------------------------------------------------------------------
  function getExternalLinkOnPage() {
    // External-mode CMS posts have an in-page CTA element marked
    // [data-external-cta] whose href is bound to the link-to-prompt CMS
    // field. Reading the href yields the external destination URL. Returns
    // '' on internal-prompt CMS posts (no [data-external-cta] element) and
    // on the index page.
    var el = document.querySelector(CONFIG.externalCtaSelector);
    return el ? (el.getAttribute('href') || '') : '';
  }

  function isGatedPage() {
    return !!(document.body && document.body.hasAttribute(CONFIG.gatePageAttr))
        || !!document.querySelector('[' + CONFIG.gatePageAttr + '="true"]');
  }

  // Swap the inline gate-form-inline form's form view for its success-message
  // view. The in-page Click-to-open-GPT CTA lives inside the success message;
  // exposing it lets gate-valid visitors access the resource without re-
  // submitting the form. Idempotent and safe to call on every load.
  //
  // Uses !important on display via setProperty so a strong CSS rule on
  // .header2_form (e.g. display:flex from the form's combo class) cannot
  // override the inline display:none. Webflow's native form handler is
  // suppressed by our submit interceptor, so this swap is the only path that
  // toggles between form / success / error states for the inline form.
  function swapInlineForm() {
    // Use querySelector('form#...') instead of getElementById so we target
    // the <form> element specifically. Webflow can publish the FormWrapper
    // div with the same id as the form (or a user can mis-set it in
    // Designer), and getElementById returns the wrapper first in DOM order.
    // Hiding the wrapper accidentally also hides the success message inside
    // it, which is exactly the bug we're fixing here.
    var form = document.querySelector('form#gate-form-inline');
    if (!form) {
      console.warn('[resource-gate] swapInlineForm: <form id="gate-form-inline"> not found');
      return;
    }
    var wrapper = form.closest('.w-form');
    if (!wrapper) {
      console.warn('[resource-gate] swapInlineForm: enclosing .w-form not found');
      return;
    }
    form.style.setProperty('display', 'none', 'important');
    var done = wrapper.querySelector('.w-form-done');
    if (done) {
      done.style.setProperty('display', 'block', 'important');
      done.setAttribute('aria-hidden', 'false');
    } else {
      console.warn('[resource-gate] swapInlineForm: .w-form-done not found inside wrapper', wrapper);
    }
    var fail = wrapper.querySelector('.w-form-fail');
    if (fail) fail.style.setProperty('display', 'none', 'important');
    console.log('[resource-gate] inline form swapped to success state', { form: form, wrapper: wrapper, done: done });
  }

  function init() {
    // Always capture attribution on load, regardless of gate state, so we have
    // first- and last-touch data whenever the user eventually submits.
    captureAttribution();

    // Force-hide the fallback container at init. Webflow's [hidden] attribute
    // can be overridden by class-level display rules (e.g. display:flex on
    // .gate-modal__fallback), so we set inline display:none to win on
    // specificity. The fallback only ever appears via showFallbackLink() after
    // an external-action submit.
    var initialFallback = getFallbackContainer();
    if (initialFallback) {
      initialFallback.setAttribute('hidden', '');
      initialFallback.style.display = 'none';
    }

    if (isGatedPage()) {
      var externalLink = getExternalLinkOnPage();

      if (externalLink) {
        // Direct-link visit to an external-link CMS post.
        //
        // The CMS template includes the legacy LLM Prompt Access form inline
        // in the post body, with the same fields as the modal (Email +
        // firstname + lastname + UTM hidden inputs). The form's success-state
        // contains the "Click here to open the GPT" CTA from Webflow.
        //
        // - Gate valid → swap the legacy form to its success state so the
        //   user sees the CTA without re-filling the form.
        // - Gate invalid → leave the legacy form visible and attach our
        //   submit interceptor (capture phase, so we beat Webflow's native
        //   form integration). On successful submit the script opens the
        //   external URL and swaps to the success state.
        // The modal is NOT shown on these pages — the inline form is the
        // gate UX for external-link CMS posts.
        if (isGateValid()) {
          swapInlineForm();
          revealGatedContent(); // no-op if the page lacks #gated-content
        } else {
          // Queue the external action — the document-level submit listener
          // (registered below in init) will route the gate-form-inline submit
          // through handleFormSubmit, which reads pendingAction to know to
          // window.open the external URL after the API call resolves.
          pendingAction = { type: 'external', url: externalLink };
        }
      } else {
        // Internal-prompt CMS post. Reveal content if gate valid, otherwise
        // queue a reveal action and show the modal.
        if (isGateValid()) {
          revealGatedContent();
        } else {
          pendingAction = { type: 'reveal' };
          showModal();
        }
      }
    }

    // Index-page tile clicks (delegated; works for any tile, including ones
    // injected by client-side filtering).
    document.addEventListener('click', handleTileClick, true);

    // Submit handling — delegated at document level in capture phase. This is
    // the most defensive binding: it fires before any form-element-attached
    // listeners (capture beats bubble, document beats inner) and works
    // regardless of whether the gated form is in the DOM at init-time. We
    // dispatch on form id so only known gate forms route through our pipeline;
    // any other forms on the page (subscribe, daily-show, etc.) submit
    // unchanged via Webflow's native integration.
    document.addEventListener('submit', function (e) {
      var form = e.target;
      if (!form || form.tagName !== 'FORM') return;
      if (form.id === CONFIG.modalFormId || form.id === 'gate-form-inline') {
        console.log('[resource-gate] intercepting submit for', form.id);
        handleFormSubmit(e);
      }
    }, true);

    // Defensive submit-click bridge. The "Let's go" CTA inside the modal may be
    // a Link, Button, or FormButton in Webflow Designer depending on how the
    // component was last edited. A Link click does NOT dispatch a submit event,
    // so the listener above never fires and the form appears dead. Catching the
    // click on .gate-modal__submit (or anything inside it) and routing it
    // through handleFormSubmit makes submission work regardless of element type.
    document.addEventListener('click', handleSubmitProxyClick, true);

    // Click-outside-to-close on the modal overlay.
    var modal = getModal();
    if (modal) modal.addEventListener('click', handleModalOverlayClick);

    // Modal close button (×) and Esc key.
    document.addEventListener('click', handleModalCloseClick, true);
    document.addEventListener('keydown', handleModalEscKey);

    // Focus trap inside the modal — Tab cycles within the modal while open,
    // restoring focus to the opener on close. WCAG 2.1 SC 2.4.3 / typical
    // dialog accessibility pattern.
    document.addEventListener('keydown', handleModalFocusTrap, true);

    // Convert the modal's "Let's go" submit (an <a> Link by default) into a
    // real <button type="submit">. This fixes the Mac/Safari Tab-skips-links
    // accessibility bug and makes the submit reachable on every OS. Run
    // before ensureFormHasSubmitButton so the modal form will see a real
    // submit element and skip the hidden-backstop injection.
    ensureModalSubmitIsButton();

    // Inject hidden submit buttons into any gate form that still lacks one
    // so pressing Enter in any input dispatches a native submit event.
    // Idempotent — no-op for the modal form after ensureModalSubmitIsButton,
    // and no-op for the inline form which has a Webflow FormButton already.
    var modalFormEl = getModalForm();
    if (modalFormEl) ensureFormHasSubmitButton(modalFormEl);
    var inlineFormEl = document.querySelector('form#gate-form-inline');
    if (inlineFormEl) ensureFormHasSubmitButton(inlineFormEl);

    // Inject the special_reg honeypot input into both gate forms. The
    // existing legacy LLM Prompt Access form already has this field (and
    // it stays where it is); these injections cover the new modal form
    // and the new inline gate-form-inline form, neither of which had it.
    if (modalFormEl) ensureHoneypotField(modalFormEl);
    if (inlineFormEl) ensureHoneypotField(inlineFormEl);

    // Prompt copy-to-clipboard. Delegated so it works even if the [data-prompt-text]
    // element is added/replaced by Webflow's CMS bindings after init.
    document.addEventListener('click', handlePromptCopyClick, true);

    // Index-page topic filter + search bar. Bails out cleanly on other pages.
    initPromptLibraryFilters();

    // Identify the visitor to HubSpot if we have their email from a previous
    // submission. This must run BEFORE maybeTrackPageLoadView so the page-
    // load event ties to the contact rather than landing as "unknown contact".
    identifyHubspotContact();

    // Direct-visit page-load Resource click event. Fires only on gated CMS
    // post pages, and only when a prior tile click on the same domain didn't
    // already fire an event for this navigation (dedupe flag in sessionStorage).
    maybeTrackPageLoadView();
  }

  // ---------------------------------------------------------------------------
  // Index page: topic filter (pills) + free-text search bar.
  //
  // The filter pills carry data-topic="<slug>" but the cards' data-resource-
  // topics attribute is currently empty in published HTML, so we match by
  // visible chip text instead — pill display text against each card's
  // .pcard__topic chip text content. Case-insensitive substring match makes
  // "Prospecting" pill match a card with "Prospecting Generic" chip.
  //
  // Search filters the same cards on the same keystrokes — case-insensitive
  // substring search across title, blurb, author name, and topic chips.
  //
  // No-ops on any page where neither [data-topic-filter] nor [data-prompt-
  // search] is present.
  // ---------------------------------------------------------------------------
  function initPromptLibraryFilters() {
    var pillContainer = document.querySelector('[data-topic-filter]');
    var searchBar = document.querySelector('[data-prompt-search]');
    if (!pillContainer && !searchBar) return;

    var cardSelector = '.prompt-library_collection-list .w-dyn-item';
    function getCards() { return Array.prototype.slice.call(document.querySelectorAll(cardSelector)); }

    var activeTopics = []; // empty = "All" (no topic filter applied)
    var searchQuery = '';

    // Dynamically rebuild the topic pills from the topic chips that actually
    // appear on cards in the Collection List. This ensures pills track the
    // CMS Content Topics collection: a topic only shows up as a pill if at
    // least one ai-prompt-library item is tagged with it. Topics with zero
    // items (e.g. Discovery when no prompt has been tagged Discovery yet)
    // are simply absent from the pill bar.
    function rebuildPillsFromCards() {
      if (!pillContainer) return;
      var cards = getCards();
      // Map of lowercased topic key → first-seen display casing, so we
      // de-dupe case-insensitively but render the topic with its CMS casing.
      var topicMap = {};
      cards.forEach(function (card) {
        Array.prototype.forEach.call(card.querySelectorAll('.pcard__topic'), function (el) {
          var text = (el.textContent || '').trim();
          if (!text) return;
          var key = text.toLowerCase();
          if (!topicMap[key]) topicMap[key] = text;
        });
      });

      // Borrow the existing pill template's classes so the rebuilt pills
      // inherit whatever styling Webflow applies. Fall back to a sensible
      // default if no template pill is present.
      var templatePill = pillContainer.querySelector('[data-topic]:not([data-topic="all"])');
      var pillClass = templatePill
        ? templatePill.className.replace(/\bis-active\b/g, '').replace(/\s+/g, ' ').trim()
        : 'prompt-library__pill w-button';

      // Clear all existing pills and rebuild from scratch.
      pillContainer.innerHTML = '';

      // "All" pill first, active by default since no topic filter is applied.
      var allPill = document.createElement('a');
      allPill.setAttribute('data-topic', 'all');
      allPill.setAttribute('href', '#');
      allPill.className = pillClass + ' is-active';
      allPill.textContent = 'All';
      pillContainer.appendChild(allPill);

      // Add one pill per unique topic, alphabetically sorted for predictable
      // ordering. (If a specific order matters later we can match the CMS
      // collection's display order via the Data API — overkill for v1.)
      var keys = Object.keys(topicMap).sort(function (a, b) {
        return topicMap[a].localeCompare(topicMap[b]);
      });
      keys.forEach(function (key) {
        var display = topicMap[key];
        var slug = key.replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        var pill = document.createElement('a');
        pill.setAttribute('data-topic', slug);
        pill.setAttribute('href', '#');
        pill.className = pillClass;
        pill.textContent = display;
        pillContainer.appendChild(pill);
      });
    }

    function cardTopicTexts(card) {
      return Array.prototype.map.call(
        card.querySelectorAll('.pcard__topic'),
        function (el) { return (el.textContent || '').trim().toLowerCase(); }
      );
    }

    function cardHaystack(card) {
      var bits = [];
      var title = card.querySelector('.pcard__title');
      var blurb = card.querySelector('.pcard__blurb');
      var author = card.querySelector('.pcard__author-name');
      if (title) bits.push(title.textContent || '');
      if (blurb) bits.push(blurb.textContent || '');
      if (author) bits.push(author.textContent || '');
      cardTopicTexts(card).forEach(function (t) { bits.push(t); });
      return bits.join(' ').toLowerCase();
    }

    function applyFilters() {
      var q = searchQuery.trim().toLowerCase();
      var cards = getCards();
      cards.forEach(function (card) {
        var visible = true;
        if (activeTopics.length > 0) {
          var topics = cardTopicTexts(card);
          visible = activeTopics.some(function (active) {
            return topics.some(function (t) { return t === active || t.indexOf(active) !== -1 || active.indexOf(t) !== -1; });
          });
        }
        if (visible && q) {
          visible = cardHaystack(card).indexOf(q) !== -1;
        }
        card.style.display = visible ? '' : 'none';
      });
    }

    function updatePillUI() {
      if (!pillContainer) return;
      var pills = pillContainer.querySelectorAll('[data-topic]');
      Array.prototype.forEach.call(pills, function (pill) {
        var slug = pill.getAttribute('data-topic');
        var label = (pill.textContent || '').trim().toLowerCase();
        var isActive = (slug === 'all' && activeTopics.length === 0)
                    || (slug !== 'all' && activeTopics.indexOf(label) !== -1);
        pill.classList.toggle('is-active', isActive);
      });
    }

    if (pillContainer) {
      // Replace any hardcoded pills with a dynamic set derived from the
      // topic chips on the cards present on the page. This runs once at
      // init — if cards are added/removed after page load (rare on this
      // index but possible with future enhancements), call this again.
      rebuildPillsFromCards();

      // Delegated click handler. Bound on the container, so it catches
      // clicks on any pill regardless of when it was inserted.
      pillContainer.addEventListener('click', function (e) {
        var pill = e.target.closest('[data-topic]');
        if (!pill) return;
        e.preventDefault();
        var slug = pill.getAttribute('data-topic');
        var label = (pill.textContent || '').trim().toLowerCase();
        if (slug === 'all') {
          activeTopics = [];
        } else {
          var idx = activeTopics.indexOf(label);
          if (idx === -1) activeTopics.push(label);
          else activeTopics.splice(idx, 1);
        }
        updatePillUI();
        applyFilters();
      });
    }

    if (searchBar) {
      // The Webflow markup is a styled <div> with a text-placeholder <div> and
      // a "Search" button <div>. Swap the placeholder div for a real <input>
      // so the user can actually type into it.
      var textDiv = searchBar.querySelector('.prompt-library__search-text');
      var inputEl = searchBar.querySelector('input.prompt-library__search-input');
      if (!inputEl && textDiv) {
        inputEl = document.createElement('input');
        inputEl.type = 'text';
        inputEl.placeholder = (textDiv.textContent || '').trim() || 'Search...';
        inputEl.className = 'prompt-library__search-input';
        inputEl.style.cssText = 'background:transparent;border:none;outline:none;font:inherit;color:inherit;flex:1;width:100%;padding:0;';
        textDiv.parentNode.replaceChild(inputEl, textDiv);
      }
      if (inputEl) {
        inputEl.addEventListener('input', function () {
          searchQuery = inputEl.value;
          applyFilters();
        });
        inputEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); applyFilters(); }
        });
      }
      var submitBtn = searchBar.querySelector('.prompt-library__search-submit');
      if (submitBtn) {
        submitBtn.addEventListener('click', function (e) {
          e.preventDefault();
          applyFilters();
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt copy-to-clipboard (internal-prompt CMS post pages).
  // ---------------------------------------------------------------------------
  function handlePromptCopyClick(e) {
    var btn = e.target.closest('[data-prompt-copy]');
    if (!btn) return;
    e.preventDefault();
    var promptEl = document.querySelector('[data-prompt-text]');
    if (!promptEl) return;
    var text = (promptEl.innerText || promptEl.textContent || '').trim();
    if (!text) return;

    // Target the dedicated label inside the button so the copy-feedback text
    // change doesn't wipe out the icon child. Falls back to the button itself
    // when the label isn't present (older button structure).
    var labelEl = btn.querySelector('[data-prompt-copy-label]') || btn;
    var done = function () {
      var orig = labelEl.getAttribute('data-orig-label') || labelEl.textContent;
      labelEl.setAttribute('data-orig-label', orig);
      labelEl.textContent = 'Copied';
      setTimeout(function () { labelEl.textContent = orig; }, 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        legacyCopy(text, done);
      });
    } else {
      legacyCopy(text, done);
    }
  }

  function legacyCopy(text, onDone) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onDone();
    } catch (e) { /* no-op */ }
  }

  // Synthetic tile for direct-link external pages so trackResourceClick can
  // fire even though there's no <a> tile element. We pull the slug/title from
  // page-level data attributes set by the CMS template.
  function makeSyntheticTile(url, isExternal) {
    return {
      getAttribute: function (name) {
        if (name === 'href') return url;
        if (name === 'data-is-external') return isExternal ? 'true' : 'false';
        if (name === 'data-resource-slug') {
          var m = window.location.pathname.match(/\/ai-prompt-library\/([^\/?#]+)/);
          return m ? m[1] : '';
        }
        if (name === 'data-resource-title') return document.title || '';
        if (name === 'data-resource-topics') {
          var el = document.querySelector('[data-resource-topics]');
          return el ? el.getAttribute('data-resource-topics') : '';
        }
        return '';
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
