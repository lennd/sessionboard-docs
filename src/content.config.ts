import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

import contract from './data/product-contract.json';

/**
 * Retrieval and personalization taxonomy.
 *
 * These three fields are what let the same article be found by the right person
 * and read as if written for their event:
 *
 *   features — which product features the article assumes. Drives the
 *     "does this apply to you" banner in the reader and drops chunks from
 *     retrieval for events that do not have the feature, so Team Lead never
 *     tells someone to click into Awards when Awards is off.
 *   audience — who the article is written for. Keeps admin questions from
 *     returning speaker-portal instructions.
 *   jtbd — the job the reader is trying to finish, in their words. Retrieval
 *     matches intent better against this than against a title.
 *
 * `features` is validated against the committed product contract, so a feature
 * renamed in web-api fails the build here instead of quietly producing an
 * article that claims a paying customer lacks something.
 */
const FEATURE_IDS = contract.features as [string, ...string[]];
const PERMISSION_IDS = contract.permissions as [string, ...string[]];

const AUDIENCES = ['organizer', 'reviewer', 'speaker', 'participant'] as const;

/**
 * The Availability box (src/components/Availability.astro) renders under the
 * title of every article that declares `features`, answering the three
 * questions CS gets asked — who gets it, where it lives, how to turn it on —
 * from the product contract. These fields refine or override what the contract
 * says; most articles need none of them.
 */
const WHERE = ['org', 'event', 'both'] as const;
const AVAILABILITY = ['everyone', 'preview', 'beta', 'add_on', 'on_request', 'limited_release', 'enterprise'] as const;

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
        unlisted: z
          .boolean()
          .default(false)
          .describe(
            'Reachable only from a link we send (e.g. the release-notes email outcome page): noindex, no share card, out of the sitemap. Not the staff enablement section — that is the internalPrefix.',
          ),
        features: z
          .array(z.enum(FEATURE_IDS))
          .default([])
          .describe(
            'Product features this article assumes. Slugs from the product contract — run `npm run contract:pull` if a new one is missing.',
          ),
        audience: z
          .array(z.enum(AUDIENCES))
          .default(['organizer'])
          .describe('Who this article is written for. Defaults to event organizers.'),
        jtbd: z
          .string()
          .optional()
          .describe(
            'The job the reader is trying to get done, in their words — e.g. "get speakers to confirm before the deadline".',
          ),
        where: z
          .enum(WHERE)
          .optional()
          .describe('Where the feature lives: org, event or both. Derived from the features\u2019 contract scopes when omitted.'),
        permissions: z
          .array(z.enum(PERMISSION_IDS))
          .default([])
          .describe('Permissions a team member needs for what the article describes. Slugs from the product contract.'),
        availability: z
          .enum(AVAILABILITY)
          .optional()
          .describe('Who gets it. Derived from the features\u2019 Early Access stage and admin category when omitted; set it only to override.'),
        cs_enabled: z
          .boolean()
          .optional()
          .describe('True when Sessionboard (support or the CSM) has to turn this on for the customer. Derived from availability when omitted.'),
        enable_path: z
          .string()
          .optional()
          .describe('The menu path the customer follows to turn it on, e.g. "Event Settings \u2192 Features \u2192 Awards".'),
        reviewed: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'reviewed must be YYYY-MM-DD')
          .optional()
          .describe(
            'Date a person last confirmed the article against the product. Set it when you finish a refresh; the content-refresh queue (sessionboard-tam/training-videos/refresh) scores never-reviewed and >180-day articles higher.',
          ),
      }),
    }),
  }),
};
