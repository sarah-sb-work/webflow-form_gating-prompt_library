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
    gateTtlDays: 7,
    storageKey: 'sb_gate_v1',
    attrFirstKey: 'sb_attribution_first',
    attrLastKey: 'sb_attribution_last',
    // Webflow-side selectors / attributes.
    tileSelector: '[data-gate="true"]',
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
  function trackResourceClick(tile) {
    var props = {
      resource_slug: tile.getAttribute('data-resource-slug') || '',
      resource_title: tile.getAttribute('data-resource-title') || '',
      destination_url: tile.getAttribute('href') || '',
      is_external: tile.getAttribute('data-is-external') === 'true',
      // CSV of topic slugs from the CMS item's content-topics (multi-reference).
      // Webflow renders this as a CSV via a comma-joined collection list bound
      // to a data attribute on the tile.
      topics: tile.getAttribute('data-resource-topics') || '',
    };
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

  // ---------------------------------------------------------------------------
  // Modal wiring.
  // ---------------------------------------------------------------------------
  function getModal() { return document.getElementById(CONFIG.modalId); }
  function getModalForm() { return document.getElementById(CONFIG.modalFormId); }
  function getFallbackContainer() { return document.getElementById(CONFIG.fallbackLinkContainerId); }

  function showModal() {
    var m = getModal();
    if (!m) return;
    m.removeAttribute('hidden');
    m.style.display = 'flex';
    m.setAttribute('aria-hidden', 'false');
  }

  function hideModal() {
    var m = getModal();
    if (!m) return;
    m.setAttribute('hidden', '');
    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');
    var fb = getFallbackContainer();
    if (fb) fb.setAttribute('hidden', '');
  }

  function showFallbackLink(url) {
    var fb = getFallbackContainer();
    if (!fb) return;
    // Expect an <a> inside the container; update its href before revealing.
    var a = fb.querySelector('a');
    if (a) { a.setAttribute('href', url); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); }
    fb.removeAttribute('hidden');
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
  // Form submit handler.
  // ---------------------------------------------------------------------------
  function handleFormSubmit(e) {
    e.preventDefault();
    var form = getModalForm();
    if (!form) return;

    // Collect visible + hidden form fields.
    var values = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name) return;
      if (el.type === 'submit' || el.type === 'button') return;
      values[el.name] = el.value;
    });

    // Merge attribution — hidden field values from the form take precedence
    // if the Webflow form already has them populated; otherwise we inject.
    var attr = attributionFields();
    Object.keys(attr).forEach(function (k) {
      if (values[k] === undefined || values[k] === '') values[k] = attr[k];
    });

    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); }

    submitHubSpotForm(values)
      .then(function () {
        setGate(values.email || '', getCookie('hubspotutk'));
        executePendingAction();
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
      try { trackResourceClick(tile); } catch (err) {}
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
  // Clears any queued action so a follow-up tile click starts cleanly.
  function handleModalOverlayClick(e) {
    var modal = getModal();
    if (!modal) return;
    if (e.target === modal) {
      pendingAction = null;
      hideModal();
    }
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

  // Swap the legacy LLM-Prompt-Access form's form view for its success-message
  // view. The in-page Click-to-open-GPT CTA lives inside the success message;
  // exposing it lets users access the resource after the new modal-driven
  // gate completes. Idempotent and safe to call on every load.
  function swapLegacyForm() {
    var legacyFormEl = document.getElementById('wf-form-LLM-Prompt-Access');
    if (!legacyFormEl) return;
    var container = legacyFormEl.closest('.w-form');
    if (!container) return;
    var formInner = container.querySelector('form#wf-form-LLM-Prompt-Access');
    var successInner = container.querySelector('.w-form-done');
    if (formInner) formInner.style.display = 'none';
    if (successInner) {
      successInner.style.display = 'block';
      successInner.setAttribute('aria-hidden', 'false');
    }
  }

  function init() {
    // Always capture attribution on load, regardless of gate state, so we have
    // first- and last-touch data whenever the user eventually submits.
    captureAttribution();

    if (isGatedPage()) {
      var externalLink = getExternalLinkOnPage();

      if (externalLink) {
        // Direct-link visit to an external-link CMS post.
        // Always swap the legacy LLM-Prompt-Access form into its
        // success-message state so the in-page CTA (Click-to-open-GPT) is
        // visible to users who arrived gate-valid. The form itself is
        // defunct — the modal handles all gating.
        swapLegacyForm();
        if (!isGateValid()) {
          // Show the modal preemptively so the user gates before they see
          // or click the CTA. On submit, window.open + fallback fires.
          pendingAction = { type: 'external', url: externalLink };
          showModal();
        } else {
          revealGatedContent(); // no-op if the page lacks #gated-content
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

    // Modal form submit.
    var form = getModalForm();
    if (form) form.addEventListener('submit', handleFormSubmit);

    // Click-outside-to-close on the modal overlay.
    var modal = getModal();
    if (modal) modal.addEventListener('click', handleModalOverlayClick);

    // Prompt copy-to-clipboard. Delegated so it works even if the [data-prompt-text]
    // element is added/replaced by Webflow's CMS bindings after init.
    document.addEventListener('click', handlePromptCopyClick, true);
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

    var done = function () {
      var orig = btn.getAttribute('data-orig-label') || btn.textContent;
      btn.setAttribute('data-orig-label', orig);
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = orig; }, 1600);
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
