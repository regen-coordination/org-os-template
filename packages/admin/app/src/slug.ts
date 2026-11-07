/** A name as an id: lower case, digits and hyphens (boards.schema.json; the import's and New's ids follow titles
 *  through it too). */
export const slug = (s: string): string => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
