/**
 * Per-skill "It works" and "You get" for the strip on each skill's page
 * (src/components/skills/SkillFlow.astro, src/lib/skill-flow.mjs). Josh, 2026-11-13:
 * the last two panels are unique to every skill and reflect its real steps and output.
 *
 * Sources: each skill's `steps`, `pauses` and `summary` in public/skills/downloads/skills.json.
 * When a skill's steps change in lennd/sessionboard-mcp-server, update its entry here;
 * tests/skill-flow.test.mjs fails if a skill in skills.json has no entry.
 *
 *   works  3–4 short labels in order. Kinds: 'done' (it does this on its own, check mark),
 *          'wait' (it stops and asks you, pause mark; label defaults to "Waits for your OK"),
 *          'next' (happens only after that OK, dashed).
 *   get    { label, svg }: the outcome, drawn in the 2027 grammar (abstract shapes, page
 *          tokens via classes ink / mut / ln / ac / fac, one accent focal point).
 *   ask    optional: a shorter version of the first example prompt, when that prompt
 *          carries a long URL or list that would break the bubble.
 */

const d = (label) => ({ kind: 'done', label });
const W = { kind: 'wait', label: 'Waits for your OK' };
const n = (label) => ({ kind: 'next', label });
/** Paper fill for shapes drawn on top of lines. */
const P = 'fill="var(--sb-flow-bg)"';
/** A share link: two linked rounded rings, accent, centred on (x, y). */
const link = (x, y, w = 16) =>
  `<g transform="rotate(-40 ${x} ${y})"><rect class="ac" x="${x - w + 2}" y="${y - w / 4}" width="${w}" height="${w / 2}" rx="${w / 4}"/><rect class="ac" x="${x - 2}" y="${y - w / 4}" width="${w}" height="${w / 2}" rx="${w / 4}"/></g>`;

export const SKILL_FLOWS = {
  'answer-registration-questions': {
    works: [d('Find the event'), d('Look up the person or order'), d('Answer with status and amounts')],
    get: {
      label: 'A straight answer, sourced',
      svg: `<circle class="ink" cx="40" cy="44" r="14"/><path class="ink" d="M18 92c2-14 10-22 22-22s20 8 22 22"/>
        <rect class="ink" x="80" y="18" width="70" height="80" rx="6"/>
        <path class="mut" d="M92 36h46M92 50h30M92 64h40"/>
        <path class="ln" stroke-dasharray="3 4" d="M92 78h46"/>
        <circle class="fac" cx="140" cy="86" r="11"/><path stroke="var(--sb-flow-bg)" stroke-width="2" d="m135 86 4 4 7-8"/>`,
    },
  },
  'build-a-dashboard': {
    works: [d('Check what already exists'), d("Test each widget's numbers"), W, n('Create the dashboard')],
    get: {
      label: 'A dashboard that answers you',
      svg: `<rect class="ink" x="8" y="8" width="152" height="96" rx="8"/>
        <rect class="ln" x="18" y="18" width="62" height="34" rx="4"/><rect class="fac" x="26" y="28" width="26" height="12" rx="2"/>
        <rect class="ln" x="88" y="18" width="62" height="34" rx="4"/><path class="mut" d="M96 44l12-10 10 5 22-14"/>
        <rect class="ln" x="18" y="60" width="132" height="34" rx="4"/>
        <path class="mut" d="M30 86V76M44 86V70M58 86V74M72 86V66M86 86V72M100 86V68M114 86V78M128 86V70"/>`,
    },
  },
  'build-the-agenda': {
    works: [d('Find clashes and gaps'), d('Propose rooms × times'), W, n('Publish agenda and speaker wall')],
    get: {
      label: 'Agenda on your website',
      svg: `<rect class="ink" x="8" y="8" width="104" height="96" rx="8"/>
        <path class="ln" d="M8 30h104M43 30v74M78 30v74M8 67h104"/><path class="mut" d="M18 19h40"/>
        <rect class="mut" x="13" y="36" width="25" height="24" rx="4"/><rect class="fac" x="48" y="73" width="25" height="24" rx="4"/>
        <rect class="mut" x="83" y="36" width="24" height="24" rx="4"/>
        <path class="ac" stroke-dasharray="3 4" d="M116 56h12"/>
        <path class="ink" d="M142 40l-10 16 10 16M150 40l10 16-10 16"/>`,
    },
  },
  'check-members-against-your-ams': {
    works: [d('Check your AMS fields'), d('Member snapshot and preview'), W, n('Write engagement back')],
    get: {
      label: 'Engagement in your AMS',
      svg: `<ellipse class="ink" cx="40" cy="26" rx="26" ry="9"/><path class="ink" d="M14 26v56c0 5 12 9 26 9s26-4 26-9V26"/><path class="mut" d="M14 50c0 5 12 9 26 9s26-4 26-9"/>
        <path class="ac" stroke-dasharray="3 4" d="M74 56h22"/><path class="ac" d="m92 51 6 5-6 5"/>
        <ellipse class="ink" cx="132" cy="26" rx="26" ry="9"/><path class="ink" d="M106 26v56c0 5 12 9 26 9s26-4 26-9V26"/>
        <circle class="fac" cx="132" cy="58" r="9"/>
        <text x="132" y="108" text-anchor="middle" class="sb-flow-tag">AMS</text>`,
    },
  },
  'event-performance-briefing': {
    works: [d('Read program and registrations'), d('Pull quotes from transcripts'), d('Write the sourced brief')],
    get: {
      label: 'One brief, every number sourced',
      svg: `<rect class="ink" x="34" y="6" width="100" height="100" rx="6"/>
        <path class="ac" stroke-width="3" d="M48 22h52"/>
        <path class="mut" d="M48 38h72M48 48h60M48 62h72M48 72h50"/>
        <circle class="mut" cx="126" cy="48" r="3"/><circle class="mut" cx="104" cy="72" r="3"/>
        <path class="ln" d="M48 86h72"/><path class="mut" d="M48 94h20M74 94h20"/>`,
    },
  },
  'get-speakers-ready': {
    works: [d('List speakers and sessions'), d('Find missing bios, headshots'), W, n('Fix the records you confirm')],
    get: {
      label: 'Every speaker ready',
      svg: `<g><circle class="ink" cx="24" cy="24" r="9"/><path class="mut" d="M42 24h70"/><path class="ac" d="m138 20 4 4 7-8"/></g>
        <g><circle class="ink" cx="24" cy="56" r="9"/><path class="mut" d="M42 56h56"/><path class="ac" d="m138 52 4 4 7-8"/></g>
        <g><circle class="fac" cx="24" cy="88" r="9"/><path class="mut" d="M42 88h64"/><circle class="fac" cx="142" cy="88" r="8"/><path stroke="var(--sb-flow-bg)" stroke-width="2" d="m138 88 3 3 6-7"/></g>`,
    },
  },
  'import-an-event-program': {
    works: [d('Map your columns'), d('Preview new and skipped'), W, n('Import sessions and speakers')],
    get: {
      label: 'Program in, no duplicates',
      svg: `<rect class="ink" x="8" y="14" width="64" height="84" rx="6"/>
        <path class="ln" d="M8 34h64M8 54h64M8 74h64M36 14v84"/>
        <path class="ac" stroke-dasharray="3 4" d="M78 56h14"/>
        <rect class="fac" x="98" y="18" width="62" height="16" rx="4"/>
        <rect class="mut" x="98" y="42" width="62" height="16" rx="4"/>
        <rect class="mut" x="98" y="66" width="62" height="16" rx="4"/>
        <path class="ln" stroke-dasharray="2 3" d="M98 98h62"/><path class="mut" d="m124 92 8 8m0-8-8 8"/>`,
    },
  },
  'keep-learners-on-track': {
    works: [d('Completions and credit this month'), d('Who to nudge, and why'), W, n('Assign courses, send reminders')],
    get: {
      label: 'The right people nudged',
      svg: `<circle class="mut" cx="22" cy="26" r="7"/><path class="ln" d="M38 26h86"/><path class="mut" d="M38 26h70"/>
        <circle class="mut" cx="22" cy="56" r="7"/><path class="ln" d="M38 56h86"/><path class="ac" stroke-width="2.4" d="M38 56h22"/>
        <circle class="mut" cx="22" cy="86" r="7"/><path class="ln" d="M38 86h86"/><path class="mut" d="M38 86h52"/>
        <path class="fac" d="M138 46c0-6 4-10 9-10s9 4 9 10v8l3 5h-24l3-5z"/><path class="ac" d="M143 63a4 4 0 0 0 8 0"/>`,
    },
  },
  'launch-an-awards-program': {
    works: [d('Draft Categories and deadline'), d('Read back the Scorecard'), W, n('Open nominations on your Site')],
    get: {
      label: 'Nominations open',
      svg: `<rect class="ink" x="24" y="8" width="120" height="96" rx="8"/>
        <path class="mut" d="M38 24h50"/>
        <rect class="mut" x="38" y="34" width="34" height="12" rx="6"/><rect class="mut" x="78" y="34" width="44" height="12" rx="6"/>
        <rect class="mut" x="38" y="52" width="40" height="12" rx="6"/>
        <path class="ln" d="M38 76h92"/>
        <rect class="fac" x="96" y="84" width="34" height="14" rx="7"/><circle stroke="var(--sb-flow-bg)" fill="var(--sb-flow-bg)" cx="123" cy="91" r="4"/>`,
    },
  },
  'marketing-campaigns': {
    works: [d('Draft who gets what, and when'), d('You review the draft'), W, n('Launch, then track sharing')],
    get: {
      label: 'Speakers sharing, results per person',
      svg: `<g class="ln"><path d="M84 56 30 22M84 56l54-34M84 56 30 90M84 56l54 34"/></g>
        <circle class="fac" cx="84" cy="56" r="13"/>
        <circle class="ink" cx="26" cy="20" r="9" ${P}/><circle class="ink" cx="142" cy="20" r="9" ${P}/>
        <circle class="ink" cx="26" cy="92" r="9" ${P}/><circle class="ink" cx="142" cy="92" r="9" ${P}/>
        <path class="ac" d="M152 92h8M156 88v8"/>`,
    },
  },
  'marketing-content': {
    works: [d('Import the recording'), d('Make the reel, clips and posts'), W, n('Send presenters their kit')],
    get: {
      label: 'Clips, posts and a recap',
      svg: `<rect class="ink" x="8" y="30" width="64" height="52" rx="8"/>
        <path class="mut" d="M18 56h4M26 48v16M32 52v8M38 44v24M44 50v12M50 54v4M56 47v18M62 53v6"/>
        <path class="ac" stroke-dasharray="3 5" d="M76 56h12"/>
        <rect class="fac" x="94" y="10" width="28" height="44" rx="5"/>
        <rect class="mut" x="128" y="10" width="32" height="20" rx="4"/><rect class="mut" x="128" y="36" width="32" height="20" rx="4"/>
        <rect class="mut" x="94" y="62" width="66" height="40" rx="5"/><path class="mut" d="M102 76h40M102 88h28"/>`,
    },
  },
  'marketing-events-and-apps': {
    ask: 'Import our Spring Summit from its event page and connect Zoom.',
    works: [d('Import the event from its page'), d('See which apps are connected'), W, n('Connect or sync the app')],
    get: {
      label: 'Event and apps in sync',
      svg: `<rect class="ink" x="10" y="30" width="56" height="52" rx="8"/><path class="mut" d="M20 46h30M20 58h36M20 70h20"/>
        <g class="ln"><path d="M66 56c20 0 28-34 54-34M66 56h54M66 56c20 0 28 34 54 34"/></g>
        <rect class="ink" x="122" y="10" width="26" height="24" rx="6" ${P}/>
        <rect class="fac" x="122" y="44" width="26" height="24" rx="6"/>
        <rect class="ink" x="122" y="78" width="26" height="24" rx="6" ${P}/>
        <path class="ac" d="M154 50a8 8 0 0 1 0 12"/>`,
    },
  },
  'marketing-goals': {
    works: [d('Plan by channel'), d('Pacing and the next move'), W, n('Ads under your spend cap')],
    get: {
      label: 'On pace for your number',
      svg: `<path class="ln" d="M12 100h148M12 100V10"/>
        <path class="mut" stroke-dasharray="3 5" d="M12 24h126"/>
        <path class="ac" stroke-width="2" d="M14 96c18-2 26-10 40-20s30-10 44-24 26-22 40-26"/>
        <path class="ink" d="M146 10v30"/><path class="fac" d="M146 10h14l-4 6 4 6h-14z"/>`,
    },
  },
  'marketing-pages': {
    works: [d('Draft the page in your brand'), d('Preview and revise'), W, n('Publish, embed, own domain')],
    get: {
      label: 'Your page, live on your domain',
      svg: `<rect class="ink" x="20" y="6" width="128" height="100" rx="8"/>
        <rect class="ln" x="30" y="14" width="108" height="10" rx="5"/><path class="ac" d="M36 19h28"/>
        <rect class="fac" x="30" y="32" width="108" height="30" rx="4"/>
        <rect class="mut" x="30" y="70" width="32" height="26" rx="3"/><rect class="mut" x="68" y="70" width="32" height="26" rx="3"/><rect class="mut" x="106" y="70" width="32" height="26" rx="3"/>`,
    },
  },
  'marketing-people': {
    works: [d('Read their activity and timeline'), d('Who brought whom'), d('Who is most engaged')],
    get: {
      label: 'Who drove registrations',
      svg: `<g class="ln"><path d="M84 26v20M84 46 44 66M84 46l40 20M44 66 24 90M44 66l20 24M124 66v24"/></g>
        <circle class="fac" cx="84" cy="22" r="11"/>
        <circle class="ink" cx="44" cy="66" r="8" ${P}/><circle class="ink" cx="124" cy="66" r="8" ${P}/>
        <circle class="mut" cx="24" cy="92" r="7" ${P}/><circle class="mut" cx="64" cy="92" r="7" ${P}/><circle class="mut" cx="124" cy="92" r="7" ${P}/>`,
    },
  },
  'marketing-results': {
    works: [d('Read the funnel and channels'), d('What worked, what next'), W, n('Share a read-only link')],
    get: {
      label: 'Results, explained and shareable',
      svg: `<path class="ink" d="M20 14h128l-30 30H50z"/><path class="mut" d="M50 50h68l-18 22H68z"/>
        <path class="fac" d="M70 78h28l-6 22H76z"/>
        ${link(136, 90, 14)}`,
    },
  },
  'my-event-day': {
    works: [d('Read My schedule'), d('Find gaps, suggest sessions'), d('Recaps, saved moments, credits')],
    get: {
      label: 'Your day, planned',
      svg: `<path class="ac" stroke-dasharray="3 5" d="M18 92c20 0 24-30 46-30s26 26 46 26 22-60 42-60"/>
        <circle class="ink" cx="18" cy="92" r="7" ${P}/><circle class="ink" cx="64" cy="62" r="7" ${P}/>
        <circle class="ink" cx="110" cy="88" r="7" ${P}/><circle class="fac" cx="152" cy="28" r="8"/>`,
    },
  },
  'push-the-agenda-to-your-event-app': {
    works: [d('Check the app is connected'), d('Preview rows and anything skipped'), W, n('Push, with a history')],
    get: {
      label: 'Agenda in your event app',
      svg: `<rect class="ink" x="8" y="20" width="76" height="72" rx="6"/>
        <path class="ln" d="M8 40h76M34 40v52M58 40v52M8 66h76"/>
        <rect class="mut" x="12" y="45" width="18" height="16" rx="3"/><rect class="mut" x="62" y="70" width="18" height="16" rx="3"/>
        <path class="ac" stroke-dasharray="3 4" d="M90 56h16"/><path class="ac" d="m102 51 6 5-6 5"/>
        <rect class="ink" x="116" y="10" width="44" height="92" rx="10"/>
        <rect class="fac" x="124" y="28" width="28" height="12" rx="3"/><path class="mut" d="M124 52h28M124 64h20M124 76h28"/>`,
    },
  },
  'registration-pacing-check': {
    works: [d('Pace against your goal'), d('Checkout drop-off and waitlist'), d('Brief with three next moves')],
    get: {
      label: 'Where registrations will land',
      svg: `<path class="ln" d="M12 100h148M12 100V12"/>
        <path class="mut" stroke-dasharray="3 5" d="M12 26h148"/>
        <path class="ink" d="M14 94c18-4 28-12 42-20s28-10 40-18"/>
        <path class="ac" stroke-dasharray="3 4" stroke-width="2" d="M96 56c16-8 34-20 52-24"/>
        <circle class="fac" cx="150" cy="32" r="6"/>`,
    },
  },
  'review-and-decide-submissions': {
    works: [d("Submissions and the team's tally"), d('Record your pick'), W, n('Decide, preview the emails')],
    get: {
      label: 'Decisions recorded',
      svg: `<rect class="fac" x="14" y="44" width="40" height="14" rx="3"/><rect class="fac" x="14" y="62" width="40" height="14" rx="3"/><rect class="fac" x="14" y="80" width="40" height="14" rx="3"/>
        <rect class="mut" x="64" y="62" width="40" height="14" rx="3"/><rect class="mut" x="64" y="80" width="40" height="14" rx="3"/>
        <rect class="ln" x="114" y="80" width="40" height="14" rx="3"/>
        <path class="ac" d="m27 26 5 5 9-10"/><path class="mut" d="M78 24h12M84 18v12" transform="rotate(45 84 24)"/><path class="mut" d="M127 24h14"/>`,
    },
  },
  'run-a-call-for-speakers': {
    works: [d('Title, welcome text, deadline'), d('Questions, tracks and formats'), W, n('Open the call')],
    get: {
      label: 'Your call, open and filling',
      svg: `<rect class="ink" x="10" y="10" width="78" height="92" rx="8"/>
        <path class="mut" d="M22 26h44M22 42h54M22 54h40"/><rect class="ln" x="22" y="66" width="54" height="12" rx="3"/>
        <rect class="fac" x="22" y="84" width="30" height="10" rx="5"/>
        <path class="ac" stroke-dasharray="3 4" d="M96 56h12"/>
        <rect class="mut" x="114" y="70" width="44" height="12" rx="3"/><rect class="mut" x="114" y="52" width="44" height="12" rx="3"/>
        <rect class="mut" x="114" y="34" width="44" height="12" rx="3"/><rect class="ac" x="114" y="16" width="44" height="12" rx="3" stroke-dasharray="3 3"/>`,
    },
  },
  'run-the-awards-review': {
    works: [d('Invite Reviewers'), d('Assign three each'), W, n('Remind, then announce Winners')],
    get: {
      label: 'Winners announced',
      svg: `<rect class="ink" x="8" y="8" width="152" height="96" rx="8"/>
        <path class="mut" d="M22 28h96M22 44h74M22 76h60M22 92h88"/>
        <path class="ac" stroke-width="3" d="M22 60h112"/><circle class="fac" cx="140" cy="60" r="7"/>`,
    },
  },
  'sell-courses-and-report-credits': {
    works: [d('Prices, coupons and sales'), d('Check the CE Broker report'), W, n('Send credit to CE Broker')],
    get: {
      label: 'Courses sold, credit reported',
      svg: `<path class="ink" d="M12 30 44 14h30v30L42 76z"/><circle class="mut" cx="62" cy="26" r="4"/>
        <rect class="ink" x="80" y="34" width="76" height="62" rx="6"/>
        <path class="mut" d="M92 50h52M92 60h36"/>
        <circle class="fac" cx="136" cy="80" r="10"/><path stroke="var(--sb-flow-bg)" stroke-width="2" d="m131 80 4 4 6-7"/>`,
    },
  },
  'send-a-sponsor-their-results': {
    works: [d("Read the sponsor's report"), d('What worked, what to offer next'), W, n('Make a read-only link')],
    get: {
      label: 'Counts-only report, safe link',
      svg: `<rect class="ink" x="10" y="10" width="96" height="92" rx="8"/>
        <path class="mut" d="M24 26h40"/>
        <path class="mut" d="M28 86V64M44 86V52M60 86V60"/><path class="ac" stroke-width="3" d="M76 86V38"/><path class="mut" d="M92 86V58"/>
        ${link(136, 56, 22)}`,
    },
  },
  sites: {
    works: [d('Edit the draft in plain words'), d('Preview by role and device'), W, n('Publish the Site')],
    get: {
      label: 'Site published',
      svg: `<rect class="ink" x="10" y="6" width="100" height="100" rx="8"/>
        <path class="mut" d="M22 22h50"/><rect class="mut" x="22" y="32" width="76" height="22" rx="4"/>
        <rect class="fac" x="22" y="60" width="76" height="16" rx="4"/><path class="mut" d="M22 86h58M22 96h40"/>
        <rect class="ink" x="122" y="34" width="38" height="62" rx="8"/><rect class="mut" x="128" y="46" width="26" height="10" rx="2"/><rect class="ac" x="128" y="62" width="26" height="8" rx="2"/>`,
    },
  },
  'tidy-your-people-and-companies': {
    works: [d('Find the people'), d('Show each fix side by side'), W, n('Save, tag and link to companies')],
    get: {
      label: 'Clean, linked records',
      svg: `<path class="mut" d="M10 22h34M16 38h40M8 54h30M14 70h38M10 86h28"/>
        <path class="ac" stroke-dasharray="3 4" d="M64 56h14"/>
        <rect class="ln" x="86" y="12" width="74" height="88" rx="6"/>
        <path class="mut" d="M96 28h40M96 44h40M96 60h40M96 76h40M96 92h40"/>
        <rect class="fac" x="140" y="54" width="14" height="12" rx="3"/>`,
    },
  },
  'turn-sessions-into-courses': {
    works: [d('Preview what becomes a course'), W, n('Draft lessons and a quiz'), n('Publish to learners')],
    get: {
      label: 'Courses from your sessions',
      svg: `<rect class="ink" x="8" y="30" width="58" height="44" rx="6"/><path class="ink" d="m32 44 12 8-12 8z"/>
        <path class="ac" stroke-dasharray="3 4" d="M72 52h12"/>
        <rect class="mut" x="98" y="16" width="62" height="22" rx="4"/><rect class="mut" x="94" y="42" width="62" height="22" rx="4" ${P}/>
        <rect class="ink" x="90" y="68" width="62" height="28" rx="4" ${P}/>
        <path class="mut" d="M100 82h26"/><circle class="fac" cx="140" cy="82" r="7"/><path stroke="var(--sb-flow-bg)" stroke-width="1.8" d="m137 82 2 2 4-5"/>`,
    },
  },
  'work-the-pipeline-and-contracts': {
    works: [d('Find warm people'), W, n('Add them to the pipeline'), n('Send the contract to sign')],
    get: {
      label: 'Signed, in the right stage',
      svg: `<rect class="ln" x="8" y="10" width="44" height="92" rx="6"/><rect class="ln" x="62" y="10" width="44" height="92" rx="6"/><rect class="ln" x="116" y="10" width="44" height="92" rx="6"/>
        <rect class="mut" x="14" y="20" width="32" height="16" rx="3"/><rect class="mut" x="14" y="42" width="32" height="16" rx="3"/>
        <rect class="mut" x="68" y="20" width="32" height="16" rx="3"/>
        <rect class="fac" x="122" y="20" width="32" height="30" rx="3"/><path stroke="var(--sb-flow-bg)" stroke-width="1.6" d="M128 40c4-6 6 4 10-2s5 2 10-2"/>`,
    },
  },
};
