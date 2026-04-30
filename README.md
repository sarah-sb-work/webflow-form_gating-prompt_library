# sellbetter.xyz AI Prompt Library — gate

Single-file JS module that gates the `/ai-prompt-library/` index and every CMS item page behind one HubSpot form. One submission unlocks everything for 7 days. Tile clicks and direct-link visits both fire a HubSpot custom event for per-item engagement tracking.

- Plan: `C:\Users\sbats\.claude\plans\moonlit-dazzling-kettle.md`
- Audit findings: `AUDIT_REPORT.md`

---

## Publishing rule

**Do not publish the Webflow production site without explicit approval.** All building and testing runs on the Webflow staging subdomain (`*.webflow.io`). If a test must hit production, stop and ask first.

---

## Current state (v1 baseline)

These values are wired into `resource-gate.js` and the architecture is locked in for v1:

| Setting | Value | Source |
|---|---|---|
| HubSpot portal ID | `21795561` | confirmed |
| HubSpot form GUID | `24210d30-9761-480f-8e06-0c8b3d17e933` (LLM Prompt Access) | confirmed via audit; existing live form |
| Custom event internal name | `pe21795561_resource_click` (placeholder; create + confirm) | per HubSpot Enterprise convention |
| Gate TTL | 7 days | confirmed |
| Discriminator field slug | `link-to-prompt` (Webflow display name "External Link") | corrected from audit |
| Site nav component | `nav-new` (Webflow component) | discovered |
| Site footer component | `footer` (Webflow component) | discovered; not yet on CMS template |
| `/ai-prompt-library/` page | Webflow auto-generated Collection List Page (to be customized to design) | confirmed |

### v1 fields the modal will collect

**Visible:**
- Email — `name="Email"` (note capital E to match HubSpot form 24210d30)
- First name — `name="firstname"`
- Last name — `name="lastname"`

**Hidden (auto-populated by `resource-gate.js` on submit):**
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` — current-session UTMs
- `special_reg`, `recent_snack_id` — kept from existing form for marketing data continuity (script populates with empty string unless overridden)

**Hidden (auto-populated by HubSpot via `context` block):**
- `hutk` (HubSpot tracking cookie)
- `pageUri`, `pageName`
- `pageId`, `ipAddress`, `hs_unique_id` — auto-populated server-side by HubSpot's Forms API integration

### v1 fields explicitly NOT captured (deferred to v2)

- Custom click-ID hidden fields (`hs_google_click_id`, `hs_facebook_click_id`, `hs_linkedin_click_id`, `hs_tiktok_click_id`). Re-enable in v2 by (a) adding the four fields to HubSpot form 24210d30, (b) uncommenting `CLICK_ID_MAP` and the click-ID block in `attributionFields()` in `resource-gate.js`.
- `Company` field. Add by (a) creating a Company field on form 24210d30, (b) adding a visible Company input to the modal Symbol.

---

## What still needs to be done before v1 ships

### Marketing / HubSpot side

1. **Add `firstname` and `lastname` as fields to HubSpot form 24210d30.** HubSpot → Marketing → Forms → 24210d30 → Edit → add two text fields, save. The Forms API drops field values for fields not on the form, so without this step the lastname/firstname inputs in the modal will submit but HubSpot won't store the values.
2. **Create the custom event in HubSpot.** HubSpot → Reports → Data Management → Custom Events → Create event → From scratch → "Set up with a JavaScript code snippet". External name `Resource click`. Properties (all single-line text except `is_external` which is Boolean): `resource_slug`, `resource_title`, `destination_url`, `is_external`, `topics`. Copy the resulting internal name (form `pe21795561_resource_click`) into `CONFIG.customEventName` if it differs.
3. **Decide content-type for "Email Templates"** (the only ai-prompt-library item that doesn't fit the existing two `content-type` Option values; it links to a Google Sheet). Either set as `GPT` for now, or create a third option (e.g., `External Resource`) and wire it in.
4. **Tag every ai-prompt-library item with `content-topics`.** 26 topics now exist in the CMS. Marketing decides which apply per item.

### Build phase (Claude → Webflow)

5. **Build the gate modal Symbol** in Webflow Designer. Required structure:
   - Modal root: `id="gate-modal"`, hidden by default.
   - Form: `id="gate-modal-form"` containing visible inputs `name="Email"`/`name="firstname"`/`name="lastname"`, a submit button, plus hidden inputs for `utm_*`, `special_reg`, `recent_snack_id`. Hidden inputs are optional — the script auto-injects values for any that aren't present.
   - Fallback container: `<div id="gate-fallback-link" hidden><a href="">Click here if your page didn't open</a></div>`. Script sets the `href` after an external-tile submit.
6. **Update the CMS template's external-link branch** (`AI Prompt Libraries Template`, page id `69a5d7d936e95ee4c4555948`):
   - Add `data-gate-page="true"` on body.
   - Add `data-external-link={{link-to-prompt}}` on body, present only when `link-to-prompt` is populated (use Webflow Conditional Visibility on a wrapper).
   - Replace the existing `wf-form-LLM-Prompt-Access` form embed with the new gate modal Symbol.
   - Preserve the "Click here to open the GPT in a new window" link as the post-gate CTA, with `data-gate="true"` + `data-resource-*` attributes so click events fire.
   - Add a `footer` component instance (currently absent from the template).
7. **Build the CMS template's internal-prompt branch** (rendered when `link-to-prompt` is empty). Uses Webflow Conditional Visibility on the new content section. Layout per design: breadcrumb, title, two-column body with prompt block + author/promo sidebar, related-prompts row, webinar banner. Wrap in `#gated-content` and add `nav-new` + `footer` instances.
8. **Customize the auto-generated `/ai-prompt-library/` Collection List Page** to match the design: hero, sticky topic filter (multi-select), Collection List with conditional tile rendering (external vs internal), webinar banner. Reuse `nav-new` and `footer` components.
9. **Each tile** in the Collection List must have these custom attributes set:
   - `data-gate="true"`
   - `data-resource-slug="{{slug}}"`
   - `data-resource-title="{{name}}"`
   - `data-is-external="true"` on tiles where `link-to-prompt` is populated, `"false"` otherwise (use two conditionally-visible Collection Items)
   - `data-resource-topics="{{content-topics}}"` (CSV of topic slugs)
10. **Deploy `resource-gate.js`** — push this repo to GitHub and reference via jsDelivr from Webflow Project Settings → Custom Code → Before `</body>`.

---

## Verification (staging only)

Production publish requires explicit user approval per the publishing rule above.

1. **Index page → internal tile, fresh incognito.** Click an internal-content tile. Modal appears. Submit. Confirm HubSpot contact created/updated; `localStorage["sb_gate_v1"]` set ~7 days out; page navigates to the internal post; subsequent tile clicks do not re-trigger the modal.
2. **Index page → external tile, fresh incognito.** Click. Modal appears. Submit. New tab opens. Fallback "click here" link appears in modal.
3. **Direct link → internal post, fresh incognito.** Visit `/ai-prompt-library/{internal-slug}` directly. Modal overlays the post; `#gated-content` hidden. Submit. Modal closes, content reveals in place.
4. **Direct link → external post, fresh incognito.** Visit `/ai-prompt-library/{external-slug}` directly. Modal opens. Submit. New tab opens. Fallback link visible.
5. **Direct link → external post, gate already valid.** Reload `/ai-prompt-library/{external-slug}` in same browser. No modal. The in-page "Open the GPT" CTA visible — click it, new tab opens.
6. **Migrated existing post.** Repeat step 4 against `/ai-prompt-library/linkedin-messaging-gpt`. Confirm the new gate fires and submits to `24210d30` (per the new path); the old per-page form does NOT render.
7. **Gate expiration.** In DevTools, set `localStorage["sb_gate_v1"].expiresAt` to a past timestamp. Reload any post → modal returns.
8. **Filter behavior.** On the index, toggle topic pills; verify cards filter; URL updates; reload preserves filter.
9. **Custom event firing.** With DevTools Network open, click any tile. Confirm a request to `track.hubspot.com` carrying `name: pe21795561_resource_click` and properties `resource_slug`, `resource_title`, `destination_url`, `is_external`, `topics`.
10. **HubSpot timeline (post-submission).** On the contact record, verify form submission visible; subsequent CMS page views auto-attributed; `Resource click` events listed with property values.
11. **Attribution round-trip.** Open staging URL with `?utm_source=test&utm_medium=plan-verify&utm_campaign=gate`. Click a tile. Submit. In the HubSpot contact record, confirm `hs_analytics_source`, drill-downs, `hs_analytics_first_referring_domain`, etc. populated; UTMs from the submission appear under HubSpot's first/last UTM properties.
12. **No console errors** on any page. Network: 200 from `api.hsforms.com/submissions/...`, 200 from `js.hs-scripts.com/21795561.js`, 200 from `track.hubspot.com`.
13. **Pixel-fidelity spot check.** Compare staging pages to design screenshots `01-05`. Document deltas.

---

## Files in this project

- [`resource-gate.js`](resource-gate.js) — gate + attribution + tracking module.
- [`AUDIT_REPORT.md`](AUDIT_REPORT.md) — Webflow + HubSpot audit findings.
- [`Content topics.csv`](Content%20topics.csv) — canonical topic taxonomy reference.
- [`README.md`](README.md) — this file.
- `webflow.txt` — Webflow Data API token (gitignored; do not commit).
- The plan: `C:\Users\sbats\.claude\plans\moonlit-dazzling-kettle.md`.
