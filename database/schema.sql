-- =============================================================================
-- L'ARTMONIE du bois — Schéma de base de données
-- Entreprise artisanale premium : bois, agencement, cuisines & projets sur mesure
-- Compatible PostgreSQL 14+
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Fonction trigger : mise à jour automatique de updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. users — Comptes administrateurs
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id              BIGSERIAL       PRIMARY KEY,
    name            VARCHAR(150)    NOT NULL,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    role            VARCHAR(50)     NOT NULL DEFAULT 'admin'
                    CHECK (role IN ('admin', 'editor')),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_role  ON users (role);

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. clients — Fichier clients
-- ---------------------------------------------------------------------------
CREATE TABLE clients (
    id              BIGSERIAL       PRIMARY KEY,
    first_name      VARCHAR(100)    NOT NULL,
    last_name       VARCHAR(100)    NOT NULL,
    email           VARCHAR(255),
    phone           VARCHAR(30),
    address         VARCHAR(255),
    city            VARCHAR(100),
    postal_code     VARCHAR(10),
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_clients_email       ON clients (email);
CREATE INDEX idx_clients_last_name     ON clients (last_name);
CREATE INDEX idx_clients_postal_code   ON clients (postal_code);
CREATE INDEX idx_clients_created_at    ON clients (created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. categories — Catégories de prestations
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    id              BIGSERIAL       PRIMARY KEY,
    name            VARCHAR(150)    NOT NULL,
    slug            VARCHAR(150)    NOT NULL UNIQUE,
    description     TEXT,
    image_url       VARCHAR(500),
    display_order   SMALLINT        NOT NULL DEFAULT 0,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_slug          ON categories (slug);
CREATE INDEX idx_categories_is_active       ON categories (is_active);
CREATE INDEX idx_categories_display_order   ON categories (display_order);

-- ---------------------------------------------------------------------------
-- 4. projects — Projets sur mesure & réalisations
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
    id              BIGSERIAL       PRIMARY KEY,
    client_id       BIGINT          REFERENCES clients (id) ON DELETE SET NULL,
    category_id     BIGINT          REFERENCES categories (id) ON DELETE SET NULL,
    title           VARCHAR(255)    NOT NULL,
    slug            VARCHAR(255)    NOT NULL UNIQUE,
    description     TEXT,
    project_type    VARCHAR(100),
    status          VARCHAR(30)     NOT NULL DEFAULT 'new'
                    CHECK (status IN (
                        'new', 'quoted', 'accepted',
                        'in_progress', 'completed', 'cancelled'
                    )),
    budget_min      NUMERIC(12, 2),
    budget_max      NUMERIC(12, 2),
    location        VARCHAR(255),
    start_date      DATE,
    end_date        DATE,
    is_featured     BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_projects_client_id     ON projects (client_id);
CREATE INDEX idx_projects_category_id   ON projects (category_id);
CREATE INDEX idx_projects_status        ON projects (status);
CREATE INDEX idx_projects_slug          ON projects (slug);
CREATE INDEX idx_projects_is_featured   ON projects (is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_projects_created_at    ON projects (created_at DESC);

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. project_images — Photos de galerie liées aux projets
-- ---------------------------------------------------------------------------
CREATE TABLE project_images (
    id              BIGSERIAL       PRIMARY KEY,
    project_id      BIGINT          NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    image_url       VARCHAR(500)    NOT NULL,
    alt_text        VARCHAR(255),
    is_main         BOOLEAN         NOT NULL DEFAULT FALSE,
    display_order   SMALLINT        NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_project_images_project_id    ON project_images (project_id);
CREATE INDEX idx_project_images_display_order ON project_images (project_id, display_order);
CREATE UNIQUE INDEX idx_project_images_one_main
    ON project_images (project_id)
    WHERE is_main = TRUE;

-- ---------------------------------------------------------------------------
-- 6. quote_requests — Demandes de devis
-- ---------------------------------------------------------------------------
CREATE TABLE quote_requests (
    id                  BIGSERIAL       PRIMARY KEY,
    first_name          VARCHAR(100)    NOT NULL,
    last_name           VARCHAR(100)    NOT NULL,
    email               VARCHAR(255)    NOT NULL,
    phone               VARCHAR(30),
    city                VARCHAR(100),
    postal_code         VARCHAR(10),
    project_category    VARCHAR(150),
    project_description TEXT            NOT NULL,
    budget              VARCHAR(100),
    preferred_contact   VARCHAR(30)     DEFAULT 'email'
                        CHECK (preferred_contact IN ('email', 'phone', 'both')),
    status              VARCHAR(30)     NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                            'pending', 'contacted', 'quoted',
                            'converted', 'refused'
                        )),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quote_requests_status      ON quote_requests (status);
CREATE INDEX idx_quote_requests_email       ON quote_requests (email);
CREATE INDEX idx_quote_requests_created_at  ON quote_requests (created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. contact_messages — Messages de contact
-- ---------------------------------------------------------------------------
CREATE TABLE contact_messages (
    id              BIGSERIAL       PRIMARY KEY,
    name            VARCHAR(150)    NOT NULL,
    email           VARCHAR(255)    NOT NULL,
    phone           VARCHAR(30),
    subject         VARCHAR(255),
    message         TEXT            NOT NULL,
    is_read         BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_messages_is_read      ON contact_messages (is_read);
CREATE INDEX idx_contact_messages_created_at   ON contact_messages (created_at DESC);
CREATE INDEX idx_contact_messages_email        ON contact_messages (email);

-- ---------------------------------------------------------------------------
-- 8. reviews — Avis clients
-- ---------------------------------------------------------------------------
CREATE TABLE reviews (
    id              BIGSERIAL       PRIMARY KEY,
    client_name     VARCHAR(150)    NOT NULL,
    city            VARCHAR(100),
    rating          SMALLINT        NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT            NOT NULL,
    project_type    VARCHAR(150),
    is_visible      BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_is_visible   ON reviews (is_visible) WHERE is_visible = TRUE;
CREATE INDEX idx_reviews_rating       ON reviews (rating DESC);
CREATE INDEX idx_reviews_created_at   ON reviews (created_at DESC);

-- ---------------------------------------------------------------------------
-- 9. site_pages — Contenus administrables du site
-- ---------------------------------------------------------------------------
CREATE TABLE site_pages (
    id              BIGSERIAL       PRIMARY KEY,
    page_key        VARCHAR(50)     NOT NULL UNIQUE,
    title           VARCHAR(255)    NOT NULL,
    subtitle        VARCHAR(500),
    content         TEXT,
    seo_title       VARCHAR(255),
    seo_description VARCHAR(500),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_site_pages_page_key ON site_pages (page_key);

CREATE TRIGGER trg_site_pages_updated_at
    BEFORE UPDATE ON site_pages
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- ---------------------------------------------------------------------------
-- 10. settings — Réglages globaux du site
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
    id              BIGSERIAL       PRIMARY KEY,
    setting_key     VARCHAR(100)    NOT NULL UNIQUE,
    setting_value   TEXT,
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_settings_setting_key ON settings (setting_key);

CREATE TRIGGER trg_settings_updated_at
    BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

COMMIT;
