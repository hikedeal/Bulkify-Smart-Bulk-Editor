-- Metafield Presets
CREATE TABLE IF NOT EXISTS metafield_presets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_domain text NOT NULL,
    preset_name text NOT NULL,
    target text NOT NULL, -- 'product' or 'variant'
    namespace text NOT NULL,
    key text NOT NULL,
    type text NOT NULL,
    created_at timestamp DEFAULT now()
);

-- Metafield Favorites
CREATE TABLE IF NOT EXISTS metafield_favorites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop text NOT NULL,
    target text NOT NULL, -- 'product' or 'variant'
    namespace text NOT NULL,
    key text NOT NULL,
    type text NOT NULL,
    created_at timestamp DEFAULT now(),
    UNIQUE(shop, target, namespace, key)
);

-- Metafield Recently Used
CREATE TABLE IF NOT EXISTS metafield_recent (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop text NOT NULL,
    target text NOT NULL, -- 'product' or 'variant'
    namespace text NOT NULL,
    key text NOT NULL,
    type text NOT NULL,
    last_used_at timestamp DEFAULT now(),
    UNIQUE(shop, target, namespace, key)
);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_metafield_presets_shop ON metafield_presets(shop_domain);
CREATE INDEX IF NOT EXISTS idx_metafield_favorites_shop ON metafield_favorites(shop);
CREATE INDEX IF NOT EXISTS idx_metafield_recent_shop ON metafield_recent(shop);
