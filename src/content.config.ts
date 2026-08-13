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

const AUDIENCES = ['organizer', 'reviewer', 'speaker', 'participant'] as const;

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({
      extend: z.object({
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
      }),
    }),
  }),
};
