import { ENTITIES } from './repo.js';
import {
  defaultComics,
  defaultArticles,
  defaultMovies,
  defaultCharacters,
  defaultTeam,
  defaultSiteSettings
} from './defaults.js';

export const SITE_SEED = { ...defaultSiteSettings };

export function siteToClient(site) {
  return {
    heroTitle: site.hero_title,
    heroSub_fa: site.hero_sub_fa,
    heroSub_en: site.hero_sub_en,
    heroDesc_fa: site.hero_desc_fa,
    heroDesc_en: site.hero_desc_en,
    aboutText_fa: site.about_fa,
    aboutText_en: site.about_en,
    btn1_fa: site.btn1_fa,
    btn1_en: site.btn1_en,
    btn2_fa: site.btn2_fa,
    btn2_en: site.btn2_en
  };
}

export const EMPTY_SITE_CLIENT = siteToClient(SITE_SEED);

export const SEEDS = {
  comic: defaultComics,
  article: defaultArticles,
  movie: defaultMovies,
  character: defaultCharacters,
  team: defaultTeam
};

/** Seed records shaped exactly like validated API input. */
export function seedInputs(type) {
  return SEEDS[type].map((record, index) => {
    const candidate = { ...record, sort_order: index };
    for (const image of ENTITIES[type].images) {
      candidate[image.input] = '';
      candidate[image.pidInput] = '';
    }
    return candidate;
  });
}
