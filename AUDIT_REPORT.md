# Webflow + HubSpot Audit Report — AI Prompt Library

Produced 2026-04-27 against:
- Webflow site `sellbetter.xyz` (id `62a76705791dc060efff4704`)
- HubSpot portal `21795561`
- Design handoff `C:\Users\sbats\Downloads\Prompt Library _ Index _ post.zip`
- Approved plan `C:\Users\sbats\.claude\plans\moonlit-dazzling-kettle.md`

This report supersedes plan assumptions where the live state differs. Read this end-to-end before approving the implementation steps.

---

## 1. CMS Schema (CORRECTED FIELD SLUGS)

The plan referenced field slugs by guess; the actual Webflow slugs are different. **Use these slugs in all custom attributes, scripts, and Webflow bindings.**

### Collection: `ai-prompt-library` — id `69a5d7d836e95ee4c455592d`

| Slug (use this) | Display name | Type | Notes |
|---|---|---|---|
| `name` | Name | PlainText (required) | post title |
| `slug` | Slug | PlainText (required) | URL segment |
| `library-icon` | Library Icon | Image | "image that appears on the library page" — eyebrow icon on cards |
| `speaker-created` | Who authored or created | MultiReference → People (`63764b23651856157e08d888`) | "Only populate if guest-created; leave blank for Sell Better authored" |
| `content-type` | Content Type | **Option** (not Reference) | Two values: `Copy & Paste Prompt` (id `e553d96c25672f59d543a7ec7a27c649`), `GPT` (id `d9de042fab7b553f42439dfb2f0686bc`) |
| `link-to-prompt` | **External Link** | Link | **The discriminator field. Display is "External Link", slug is `link-to-prompt`.** |
| `description` | Description | RichText | short blurb on cards / post hero |
| `directions-2` | Directions | RichText | "How to use" copy on internal post |
| `prompt-text--rich` | Prompt Text | RichText | the copyable prompt block |
| `featured-image` | Featured image | Image (max 750px) | currently appears unused in design — confirm |
| `cta---form-submit` | CTA - form submit | PlainText | likely vestigial under the new unified modal |
| `content-topics` | Content Topics | MultiReference → Content Topics | drives the topic filter on the index |

### Collection: `Content Topics` — id `6949a47434f65b9eaf45a6b8`, slug `show-topics`

Fields: `name`, `slug`. Items currently in collection (only 6, all Cold Calling sub-topics):

| Item ID | Name | Slug |
|---|---|---|
| 6949acdaeefca680eab36564 | Cold Calling | cold-calling |
| 6949a500c34639f28e70e182 | Cold Calling: Gatekeeper Techniques | cold-calling-gatekeeper-techniques |
| 6949a4efbaa96590d6e40fb8 | Cold Calling: Objection Handling | cold-calling-objection-handling |
| 6949a4d7ff96ae62f9e3dc2e | Cold Calling: Script Structure/Frameworks | cold-calling-script-structure-frameworks |
| 6949a4b7fb3c96a15e1ba7df | Cold Calling: Openers | cold-calling-openers |
| 6949a499da847e28ef98a8d7 | Cold Calling: General (Covers a variety of subtopics) | cold-calling-general-covers-a-variety-of-subtopics |

**Decision needed:** the design references 5 main categories (Cold Emailing, Discovery, Prospecting, Cold Calling, LinkedIn). Current taxonomy has only Cold Calling sub-topics. Either:
- **A.** Flatten to 5 main categories matching the design (delete or re-purpose the existing 6 sub-topic entries).
- **B.** Keep the granular structure (treat Cold Calling sub-topics as the de facto taxonomy, add main categories for the other four areas).
- **C.** Add the 4 missing main categories alongside the existing Cold Calling entries (mixed granularity).

---

## 2. CMS Items state (9 total)

| Name | Slug | isDraft | content-type set? | content-topics set? | link-to-prompt set? |
|---|---|---|---|---|---|
| Signal Scan Prompt | signal-scan-prompt | **Draft** | Copy & Paste Prompt | no | no |
| Cold Call Script Generator | cold-call-script-generator | live | **no** | no | yes (chatgpt.com/g/...) |
| Email Campaign GPT | email-campaign-gpt | live | **no** | no | yes (chatgpt.com/g/...) |
| Testing + Iteration GPT | testing-iteration-gpt | live | **no** | no | yes (chatgpt.com/g/...) |
| Email Templates | email-templates | live | **no** | no | yes (Google Sheets) |
| LinkedIn Messaging GPT | linkedin-messaging-gpt | live | **no** | no | yes (chatgpt.com/g/...) |
| Offer Builder | offer-builder | live | **no** | no | yes (chatgpt.com/g/...) |
| Email Infrastructure Calculator | email-infrastructure-calculator | live | **no** | no | yes (chatgpt.com/share/...) |
| TAM Builder | tam-builder-chatpgt-prompt | live | **no** | no | yes (chatgpt.com/g/...) |

**Backfill required before launch:**
- Set `content-type` on all 8 live items (most appear to be `GPT`; "Email Templates" pointing to Google Sheets needs a category decision).
- Set `content-topics` on all 9 items so filter pills resolve correctly on the new index.
- Decide whether "Signal Scan Prompt" is the canonical internal-prompt prototype to publish, or a placeholder.

---

## 3. Pages

Filtered list of pages relevant to this work:

| Page ID | Title | Slug | Path | Notes |
|---|---|---|---|---|
| `69a5d7d936e95ee4c4555948` | AI Prompt Libraries Template | `detail_ai-prompt-library` | `/ai-prompt-library/{slug}` | The CMS Template Page. **Currently hosts the per-page gate form.** |
| `69a5d4282b1da86a312579a3` | AI Prompts | `ai-prompts` | `/ai-prompts` | Separate static page. Likely the old/precursor manual index — **needs decision: keep, deprecate, or repurpose.** |
| `69a5d40d729d3934b63814f2` | ChatGPT prompt | `chatgpt-prompt` | `/ai-prompts/chatgpt-prompt` | Child of "AI Prompts" — likely related precursor content. |
| (none) | (no static page) | `ai-prompt-library` | `/ai-prompt-library/` | **No static page exists for the index URL.** Webflow's auto-generated CMS Collection List Page is currently serving this URL. |

**Decision needed: how should `/ai-prompt-library/` be served?**
- **A. Build a dedicated static page** at slug `ai-prompt-library` (recommended). Lets us control the hero, sticky filter bar, custom card layout, and webinar banner exactly per the design. Webflow will serve this page over the auto-generated Collection List Page.
- **B. Customize the auto-generated Collection List Page**. Less flexible — limited to Webflow's built-in collection-page styling.

The design clearly implies (A) given the bespoke hero, filter UI, and grid composition.

---

## 4. CMS Template DOM state

The "AI Prompt Libraries Template" page currently contains:

### Components on page
- `global-styles` (instance) — site-wide CSS wrapper
- `nav-new` (instance) — site nav
- **MISSING: `footer` component** — present on Home, absent here

### Existing per-page gate form
- Form ID: `wf-form-LLM-Prompt-Access` (style class `header2_form`)
- Form action: empty (Webflow handles routing); method GET; redirect: empty; state: normal
- Visible Email input: `id=Email`, `name=Email` (capital E), `type=email`, `required=true`, classes `form-input is-round lightbg input outline input-text-gray`
- Five **untyped DOM inputs** (raw `<input>`) — text not yet inspected; likely firstname, lastname, company, plus two extras
- Submit button (style `button`)
- Privacy text + link to `/privacy`
- UTM hidden inputs (visible to user but with utm-named classes): `utm_campaign`, `utm_source`, `utm_content`, `utm_medium`, `utm_term`
- Non-UTM inputs: `special_reg`, `recent_snack_id`, plus one more DOM input

### Custom data attributes
- **No `data-gate-page` attribute** anywhere.
- **No `data-external-link` attribute** anywhere.
- Gating today is purely structural — the form is on the page; users have to fill it before scrolling/CTA-clicking.

### Headings present
Style classes used on this template (these exist in the brand system):
`heading-style-h3-xbold`, `heading-style-h5-xbold`, `heading-styl-h6-large-upright`, `text-style-allcaps`, `text-size-small`, `highlight-text-block`, `text-color-white`, `margin-bottom`, `margin-xsmall`

### Conditional visibility
**No conditional-visibility wrappers were detected** on the template via element queries. The plan assumed the existing template already used Conditional Visibility to swap layouts based on `link-to-prompt` — that assumption appears wrong. **Confirm by selecting any item-bound element in the Designer and checking the Conditional Visibility panel** (the API doesn't expose conditional-visibility metadata directly).

If there's no existing conditional visibility, the implementation needs to **introduce it** so the same template can render both layouts cleanly.

---

## 5. Site components (reusable)

Components on the Home page (representative of site-wide chrome):

| Component name | Use |
|---|---|
| `global-styles` | wraps custom CSS, present on every page |
| `nav-new` | **the site nav we will reuse** (per your earlier instruction) |
| `footer` | **the site footer we will reuse** |
| `banner` | Daily Show promo banner — irrelevant to this work |
| `slide-in-1-daily-show` | slide-in interaction — irrelevant |

**Key takeaway:** the new index page and the CMS template will instance `nav-new` and `footer` directly. **The CMS template currently lacks `footer` — adding it is part of the build.**

---

## 6. Brand variables (default collection, id `collection-4d394519-c4ed-f0af-1ed7-43ea0009b936`)

### Color tokens — design ↔ existing matches

| Design token | Design hex | Existing variable | Existing hex | Match? |
|---|---|---|---|---|
| `--sb-lime` | `#DDF44E` | `--sb-primary-yellow` | `#ddf44e` | **Exact** |
| `--sb-pink` | `#E08EC9` | `--sb-primary-pink` | `#e08ec9` | **Exact** |
| `--sb-cyan` | `#51B2CC` | `--sb-alt-blue` | `#51b2cc` | **Exact** |
| `--sb-green` | `#5FCF6F` | `--sb-alt-green` | `#5fcf6f` | **Exact** |
| `--sb-lavender` | `#D0BCF1` | `--sb-alt-light-purple-2` | `#d0bcf1` | **Exact** |
| `--sb-orange` | `#E79235` | `--sb-alt-orange` | `#e79235` | **Exact** |
| `--sb-red` | `#E35655` | `--sb-alt-red` | `#e35655` | **Exact** |
| `--sb-muted-blue` | `#92B9D4` | `--sb-primary-blue` | `#92b9d4` | **Exact** |
| `--sb-indigo` | `#5030E9` | `--sb-alt-dark-purple` | `#4f2ee8` | Near-match |
| `--sb-black` | `#1C1C1A` | `--sb-primary-dark` (`black`) | `black` (=`#000`) | Near-match |

### Color tokens NOT present
- `--sb-coral` (`#E08264`) — missing.
- `--sb-dark-navy` (`#17243F`) — missing.
- Neutral ramp `--sb-gray-50` → `--sb-gray-900` — different ramp (`graymodern25` → `graymodern1000` exists with different hex values).

### Variable categories MISSING entirely
The default collection contains **only color variables**. None of these are tokenized:
- Font-family variables — fonts likely set via Webflow's Font Settings panel directly.
- Size / spacing variables.
- Number / percentage variables.
- Motion / duration / easing variables.
- Radius variables.
- Semantic tokens (`--fg-1`, `--bg-1`, `--accent-primary`, `--border-1`, etc.).

**Decision needed: scope of token-system additions.**
- **A. Minimal additions only** — add only the brand classes the prompt-library components require (`.prompt-card`, `.topic-chip`, `.prompt-block`, `.author-card`, `.promo-card`, `.webinar-banner`, lime offset shadow utility). Do not add a token system; encode design values directly in those classes.
- **B. Full token system** — port the design handoff's token vocabulary (semantic colors, spacing, radii, motion, font families) as Webflow Variables before building components. Higher upfront effort; future-proofs the system for other pages.
- **C. Hybrid** — add only the missing color tokens (`--sb-coral`, `--sb-dark-navy`, neutral ramp if needed for cards) + the minimal brand classes. Skip semantic / spacing / motion variables for now.

I recommend **C** unless you want a longer-term token initiative.

---

## 7. Existing styles (partial — full inventory pending)

The full styles export is 346KB and could not be auto-summarized in one read. Quick observations from the template DOM:

**Brand utility classes confirmed present** (use these — don't recreate):
- Typography: `heading-style-h3-xbold`, `heading-style-h5-xbold`, `heading-styl-h6-large-upright`, `text-style-allcaps`, `text-size-small`, `text-color-white`, `highlight-text-block`
- Spacing: `margin-bottom`, `margin-xsmall`
- Forms: `form-input`, `is-round`, `lightbg`, `input outline`, `input-text-gray`, `button`
- Layout helpers: `header2_form`, `TC`

**Component classes likely needed (and not yet inventoried):**
- `.prompt-card` (cards on index + related-prompts row)
- `.prompt-card--ad` (AI Foundations promo variant — design says this lives on the post page sidebar, not in the grid)
- `.topic-chip` (filter pills + in-card chips)
- `.prompt-block` (dark copyable prompt block)
- `.author-card` (post sidebar)
- `.promo-card` (post sidebar promo card)
- `.webinar-banner` (full-bleed promo)
- `.gate-modal` (new modal symbol)
- Lime offset shadow utility — `box-shadow: 4px 4px 0 var(--sb-primary-yellow)`

A targeted style audit will be repeated after the discrepancy decisions land, so we add only what's truly missing.

---

## 8. HubSpot

### Forms
- **Existing live form**: `24210d30-9761-480f-8e06-0c8b3d17e933` (LLM Prompt Access). Visible Webflow form on the CMS template captures Email + 5 untyped DOM inputs + utm_* + special_reg + recent_snack_id. Need to confirm the 5 untyped inputs' names by selecting the form in Designer or pulling the form schema from HubSpot.
- **New unified gate form**: `c385d70f-9533-4e11-bc05-e64239d465aa`. **Field schema not yet pulled.**

### Custom click-ID properties (you confirmed these exist)
`hs_google_click_id`, `hs_facebook_click_id`, `hs_linkedin_click_id`, `hs_tiktok_click_id` — must be added as hidden fields on form `c385d70f` (the API silently drops fields not on the form).

### HubSpot defaults that auto-populate from `hutk` (do NOT post these)
`hs_analytics_first_referring_domain`, `hs_analytics_last_referring_domain`, `hs_analytics_first_page_url`, `hs_analytics_last_page_url`, `hs_analytics_first_timestamp`, `hs_analytics_last_timestamp`, `hs_analytics_num_page_views`, `hs_analytics_num_sessions`, `hs_analytics_first_conversion_date`, `hs_analytics_recent_conversion_date`, `hs_analytics_facebook_click_id` (note: different from custom `hs_facebook_click_id`), `hs_analytics_google_click_id` (different from custom `hs_google_click_id`).

### Tracking script
You confirmed `js.hs-scripts.com/21795561.js` is loaded site-wide via GTM in the Webflow `<head>`. Need to verify on staging during the verification phase.

---

## 9. API token scope status

The token at `C:\Users\sbats\Projects\webflow-form_gating-prompt_library\webflow.txt` has `cms:read` (works), but is **missing `sites:read` and `pages:read`**.

`pages:read` worked anyway via `/v2/sites/{id}/pages` — likely because that endpoint sits behind a different scope check, OR the scope name has changed. Either way, page metadata is accessible. `sites:read` for `/v2/sites/{id}` returned 403.

For the build phase, we'll need a new token (or expanded scopes on this one):
- `cms:write` — to update CMS items (backfill content-type and content-topics on the 8 live items, populate topics taxonomy, etc.).
- `pages:write` — to update page metadata if needed.

The Designer-tool-side edits (style/element/component changes) work over the bridge and don't need the API token.

---

## 10. Webflow MCP serialization bug — status

- **Designer tools** (`element_tool`, `style_tool`, `de_page_tool`, `variable_tool`, `de_component_tool`, `element_builder`, `whtml_builder`): **WORKING** as of bridge reconnect + Designer tab refresh.
- **Data tools** (`data_sites_tool`, `data_cms_tool`, `data_pages_tool`, etc.): **STILL BROKEN** with the `actions: Expected array, received string` validation error. Workaround: use the Webflow Data REST API directly via PowerShell (in flight).
- Recommend filing the data-tool serialization bug with Webflow support since you have an open ticket.

---

## 11. Decisions / inputs needed before the build resumes

1. **Topic taxonomy** — flatten to 5 main categories (A), keep granular (B), or hybrid (C)? See §1.
2. **`/ai-prompt-library/` index page** — build a dedicated static page (A, recommended) or customize the auto-generated Collection List Page (B)? See §3.
3. **`/ai-prompts` static page** — keep, deprecate, or repurpose? See §3.
4. **CMS template Conditional Visibility** — does it actually exist (and the API just doesn't expose it), or does it need to be introduced? Selecting the form / a content wrapper in Designer and checking the Conditional Visibility panel will resolve this. See §4.
5. **Brand-token additions scope** — minimal classes only (A), full token system (B), or hybrid (C, recommended)? See §6.
6. **CMS items backfill** — confirm we can set `content-type` and `content-topics` on the 8 live items as part of this work (vs. that being a marketing-side task). See §2.
7. **HubSpot form `c385d70f` field schema** — please pull the field list and paste back so the modal's input `name` attributes can be aligned. See §8.
8. **The 5 untyped DOM inputs on the existing form** — what are their `name` attributes? (Easiest: select the form in Designer, click each hidden input, check the input panel.) See §4.
9. **API token scopes** — generate a new token with `cms:write` (and ideally `pages:write`) for the implementation phase, OR expand scopes on the existing token. See §9.

---

## 12. Plan-impacting deltas vs. the approved plan

These items in the plan need to be amended given audit findings:

- **Field slugs throughout the plan:** replace `external-link` with `link-to-prompt` everywhere (custom attribute bindings, JS body attribute, etc.).
- **CMS template "Conditional Visibility branch" language** is provisional pending question #4 above. If no conditional visibility exists today, the plan's "preserve the existing external-link branch" framing simplifies into "add conditional visibility, then build both branches."
- **Index page URL routing:** plan said "build at `/ai-prompt-library/`" — that requires creating a new static page (per question #2).
- **Index page nav and footer:** "use existing site nav and footer" → translates to: instance `nav-new` and `footer` components (per audit). The CMS template also needs the `footer` instance added.
- **Backfill content-type and content-topics on existing live items** is a real prerequisite, not a footnote — the new index/filter won't render correctly until those are set.
