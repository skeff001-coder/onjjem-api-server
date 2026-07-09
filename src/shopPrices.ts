/**
 * Server-authoritative price catalog for physical print products.
 *
 * The /api/stripe/checkout route looks prices up here by SKU — it never
 * trusts a client-supplied amount. Keep this in sync with
 * artifacts/owens-photofix/lib/shopProducts.ts whenever prices change.
 */

export interface CatalogEntry {
  name: string;
  pricePence: number;
}

export const SHOP_SKU_PRICES: Record<string, CatalogEntry> = {
  // ── Stretched Canvas ──────────────────────────────────────────────────────
  "canvas-stretched-8x10":  { name: 'Stretched Canvas 8"×10"',  pricePence: 4199 },
  "canvas-stretched-10x12": { name: 'Stretched Canvas 10"×12"', pricePence: 4599 },
  "canvas-stretched-12x16": { name: 'Stretched Canvas 12"×16"', pricePence: 5399 },
  "canvas-stretched-16x20": { name: 'Stretched Canvas 16"×20"', pricePence: 7599 },
  "canvas-stretched-20x24": { name: 'Stretched Canvas 20"×24"', pricePence: 8999 },
  // ── Eco Canvas ───────────────────────────────────────────────────────────
  "eco-canvas-8x8":   { name: 'Eco Canvas 8"×8"',   pricePence: 2799 },
  "eco-canvas-8x12":  { name: 'Eco Canvas 8"×12"',  pricePence: 2999 },
  "eco-canvas-12x12": { name: 'Eco Canvas 12"×12"', pricePence: 3399 },
  "eco-canvas-12x18": { name: 'Eco Canvas 12"×18"', pricePence: 4599 },
  "eco-canvas-16x16": { name: 'Eco Canvas 16"×16"', pricePence: 4199 },
  "eco-canvas-16x24": { name: 'Eco Canvas 16"×24"', pricePence: 5999 },
  // ── Box Frame ─────────────────────────────────────────────────────────────
  "box-frame-5x7":   { name: 'Box Frame 5"×7"',   pricePence: 2999 },
  "box-frame-6x8":   { name: 'Box Frame 6"×8"',   pricePence: 3399 },
  "box-frame-11x14": { name: 'Box Frame 11"×14"', pricePence: 5399 },
  "box-frame-12x16": { name: 'Box Frame 12"×16"', pricePence: 5999 },
  "box-frame-16x20": { name: 'Box Frame 16"×20"', pricePence: 7999 },
  // ── Framed Photo Tile ────────────────────────────────────────────────────
  "photo-tile-5x7":  { name: 'Framed Photo Tile 5"×7"',  pricePence: 2099 },
  "photo-tile-8x8":  { name: 'Framed Photo Tile 8"×8"',  pricePence: 2699 },
  "photo-tile-8x10": { name: 'Framed Photo Tile 8"×10"', pricePence: 3399 },
  // ── Photo Mugs ───────────────────────────────────────────────────────────
  "mug-11oz": { name: "Photo Mug 11oz",        pricePence: 1599 },
  "mug-15oz": { name: "Photo Mug 15oz Large",  pricePence: 2099 },
  // ── Jigsaw Puzzles ───────────────────────────────────────────────────────
  "jigsaw-252":  { name: "Jigsaw Puzzle 252 pieces",  pricePence: 2699 },
  "jigsaw-500":  { name: "Jigsaw Puzzle 500 pieces",  pricePence: 3099 },
  "jigsaw-1000": { name: "Jigsaw Puzzle 1000 pieces", pricePence: 4099 },
  // ── Playing Cards ────────────────────────────────────────────────────────
  "playing-cards": { name: "Playing Cards (54 cards)", pricePence: 1995 },
  // ── Photo Coasters ───────────────────────────────────────────────────────
  "coaster-1pk": { name: "Photo Coaster (single)",  pricePence: 1299 },
  "coaster-2pk": { name: "Photo Coasters (set of 2)", pricePence: 1599 },
  "coaster-4pk": { name: "Photo Coasters (set of 4)", pricePence: 2499 },
  "coaster-6pk": { name: "Photo Coasters (set of 6)", pricePence: 3499 },
  // ── Photo Magnets ────────────────────────────────────────────────────────
  "magnet-fridge-3x2": { name: 'Photo Magnet 3"×2"',         pricePence:  699 },
  "magnet-fridge-6x4": { name: 'Photo Magnet 6"×4"',         pricePence:  899 },
  "magnet-square-4x4": { name: 'Photo Magnet 4"×4" Square',  pricePence: 1299 },
  "magnet-square-6x6": { name: 'Photo Magnet 6"×6" Square',  pricePence: 1699 },
  // ── Glow-in-the-Dark Posters ─────────────────────────────────────────────
  "glow-8x10":  { name: 'Glow Poster 8"×10"',  pricePence: 1399 },
  "glow-12x16": { name: 'Glow Poster 12"×16"', pricePence: 1699 },
  "glow-16x20": { name: 'Glow Poster 16"×20"', pricePence: 1999 },
  "glow-20x24": { name: 'Glow Poster 20"×24"', pricePence: 2599 },
  "glow-24x32": { name: 'Glow Poster 24"×32"', pricePence: 3499 },
  // ── Tea Towel ────────────────────────────────────────────────────────────
  "tea-towel": { name: 'Tea Towel 18.5"×27.5"', pricePence: 2999 },
  // ── Pet Tags ─────────────────────────────────────────────────────────────
  "pet-tag-round": { name: "Pet Tag (round)",      pricePence: 1499 },
  "pet-tag-bone":  { name: "Pet Tag (bone shape)", pricePence: 1499 },
};
