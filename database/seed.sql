-- =============================================================================
-- L'ARTMONIE du bois — Données exemples
-- Artisanat premium : bois massif, agencement & projets sur mesure
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Catégories de prestations
-- ---------------------------------------------------------------------------
INSERT INTO categories (name, slug, description, image_url, display_order, is_active) VALUES
(
    'Cuisine sur mesure',
    'cuisine-sur-mesure',
    'Conception et fabrication de cuisines entièrement sur mesure en bois massif, stratifié haut de gamme ou panneaux laqués. Plans de travail, îlots centraux, rangements intelligents et finitions artisanales pour un espace de vie unique.',
    '/images/categories/cuisine-sur-mesure.jpg',
    1,
    TRUE
),
(
    'Dressing & rangement',
    'dressing-rangement',
    'Dressings sur mesure, placards intégrés et solutions de rangement optimisées. Portes coulissantes, tiroirs à compartiments, éclairage LED intégré et aménagement sous combles ou sous pente.',
    '/images/categories/dressing-rangement.jpg',
    2,
    TRUE
),
(
    'Salle de bain',
    'salle-de-bain',
    'Meubles vasque, colonnes, habillages muraux et rangements humidité en bois traité ou essences sélectionnées pour résister aux environnements humides avec élégance.',
    '/images/categories/salle-de-bain.jpg',
    3,
    TRUE
),
(
    'Meuble sur mesure',
    'meuble-sur-mesure',
    'Bibliothèques, buffets, tables, consoles et pièces uniques réalisées à la main selon vos dimensions, votre style et l''essence de bois de votre choix.',
    '/images/categories/meuble-sur-mesure.jpg',
    4,
    TRUE
),
(
    'Agencement intérieur',
    'agencement-interieur',
    'Aménagement complet de pièces de vie, bureaux, halls d''entrée et espaces professionnels. Boiseries murales, claustras, niches et intégration harmonieuse avec l''architecture existante.',
    '/images/categories/agencement-interieur.jpg',
    5,
    TRUE
),
(
    'Escalier & habillage bois',
    'escalier-habillage-bois',
    'Habillage d''escaliers existants, création de marches en bois massif, main courantes sculptées et garde-corps sur mesure pour sublimer votre circulation intérieure.',
    '/images/categories/escalier-habillage-bois.jpg',
    6,
    TRUE
),
(
    'Décoration bois',
    'decoration-bois',
    'Lambrequins, têtes de lit, cadres, étagères murales et éléments décoratifs en bois travaillé pour apporter chaleur et caractère à votre intérieur.',
    '/images/categories/decoration-bois.jpg',
    7,
    TRUE
),
(
    'Projet professionnel',
    'projet-professionnel',
    'Agencements pour commerces, restaurants, cabinets médicaux, hôtels et bureaux. Accompagnement de A à Z, respect des normes et délais, finitions premium.',
    '/images/categories/projet-professionnel.jpg',
    8,
    TRUE
);

-- ---------------------------------------------------------------------------
-- Clients (pour les réalisations exemples)
-- ---------------------------------------------------------------------------
INSERT INTO clients (first_name, last_name, email, phone, address, city, postal_code, notes) VALUES
(
    'Sophie',
    'Moreau',
    'sophie.moreau@email.fr',
    '06 12 34 56 78',
    '14 chemin des Cerisiers',
    'Lyon',
    '69003',
    'Souhaite une cuisine chêne clair, style contemporain. Référence Pinterest transmise.'
),
(
    'Philippe',
    'Dubois',
    'p.dubois@email.fr',
    '06 98 76 54 32',
    '8 route du Lac',
    'Annecy',
    '74000',
    'Maison de caractère, dressing sous combles avec pente importante.'
),
(
    'Laure',
    'Bernard',
    'laure.bernard@pro.fr',
    '04 76 55 44 33',
    '22 avenue Jean Jaurès',
    'Grenoble',
    '38100',
    'Rénovation complète escalier béton — habillage chêne et garde-corps verre.'
);

-- ---------------------------------------------------------------------------
-- Réalisations (3 projets terminés & mis en avant)
-- ---------------------------------------------------------------------------
INSERT INTO projects (
    client_id, category_id, title, slug, description, project_type,
    status, budget_min, budget_max, location, start_date, end_date, is_featured
) VALUES
(
    1,
    (SELECT id FROM categories WHERE slug = 'cuisine-sur-mesure'),
    'Cuisine chêne massif — Lyon Confluence',
    'cuisine-chene-massif-lyon-confluence',
    'Cuisine ouverte de 18 m² en chêne massif huilé, avec îlot central intégrant un plan de travail en pierre de Bourgogne. Façades à cadre, tiroirs à fermeture amortie Blum, éclairage LED sous meubles hauts. Un projet emblématique alliant tradition menuisière et lignes épurées.',
    'Cuisine sur mesure',
    'completed',
    28000.00,
    32000.00,
    'Lyon (69003)',
    '2025-03-01',
    '2025-06-15',
    TRUE
),
(
    2,
    (SELECT id FROM categories WHERE slug = 'dressing-rangement'),
    'Dressing sous combles — Annecy',
    'dressing-sous-combles-annecy',
    'Aménagement d''un dressing de 12 m² sous combles avec pente jusqu''à 1,40 m. Portes coulissantes miroir, penderies sur mesure, tiroirs intérieurs et étagères adaptées à la géométrie du toit. Finition laqué mat gris perle.',
    'Dressing & rangement',
    'completed',
    8500.00,
    10200.00,
    'Annecy (74000)',
    '2025-01-10',
    '2025-02-28',
    TRUE
),
(
    3,
    (SELECT id FROM categories WHERE slug = 'escalier-habillage-bois'),
    'Habillage escalier chêne — Grenoble',
    'habillage-escalier-chene-grenoble',
    'Habillage complet d''un escalier béton en marches et contremarches chêne massif, main courante sculptée et garde-corps en verre trempé fixé sur platines inox brossé. Nez de marche éclairés par bandeaux LED discrets.',
    'Escalier & habillage bois',
    'completed',
    12000.00,
    14500.00,
    'Grenoble (38100)',
    '2024-10-05',
    '2024-12-20',
    TRUE
);

-- ---------------------------------------------------------------------------
-- Photos de galerie (réalisations)
-- ---------------------------------------------------------------------------
INSERT INTO project_images (project_id, image_url, alt_text, is_main, display_order) VALUES
-- Cuisine Lyon
(
    (SELECT id FROM projects WHERE slug = 'cuisine-chene-massif-lyon-confluence'),
    '/images/realisations/cuisine-lyon-01.jpg',
    'Vue d''ensemble de la cuisine chêne massif avec îlot central — L''ARTMONIE du bois',
    TRUE,
    1
),
(
    (SELECT id FROM projects WHERE slug = 'cuisine-chene-massif-lyon-confluence'),
    '/images/realisations/cuisine-lyon-02.jpg',
    'Détail des façades à cadre en chêne et plan de travail pierre — Lyon',
    FALSE,
    2
),
(
    (SELECT id FROM projects WHERE slug = 'cuisine-chene-massif-lyon-confluence'),
    '/images/realisations/cuisine-lyon-03.jpg',
    'Îlot central avec rangements tiroirs et éclairage LED intégré',
    FALSE,
    3
),
-- Dressing Annecy
(
    (SELECT id FROM projects WHERE slug = 'dressing-sous-combles-annecy'),
    '/images/realisations/dressing-annecy-01.jpg',
    'Dressing sous combles avec portes coulissantes miroir — Annecy',
    TRUE,
    1
),
(
    (SELECT id FROM projects WHERE slug = 'dressing-sous-combles-annecy'),
    '/images/realisations/dressing-annecy-02.jpg',
    'Intérieur du dressing avec penderies et tiroirs sur mesure',
    FALSE,
    2
),
-- Escalier Grenoble
(
    (SELECT id FROM projects WHERE slug = 'habillage-escalier-chene-grenoble'),
    '/images/realisations/escalier-grenoble-01.jpg',
    'Escalier habillé chêne massif avec garde-corps verre — Grenoble',
    TRUE,
    1
),
(
    (SELECT id FROM projects WHERE slug = 'habillage-escalier-chene-grenoble'),
    '/images/realisations/escalier-grenoble-02.jpg',
    'Détail des marches chêne et nez éclairés par LED',
    FALSE,
    2
),
(
    (SELECT id FROM projects WHERE slug = 'habillage-escalier-chene-grenoble'),
    '/images/realisations/escalier-grenoble-03.jpg',
    'Main courante sculptée en chêne massif',
    FALSE,
    3
);

-- ---------------------------------------------------------------------------
-- Avis clients
-- ---------------------------------------------------------------------------
INSERT INTO reviews (client_name, city, rating, comment, project_type, is_visible) VALUES
(
    'Sophie M.',
    'Lyon',
    5,
    'Un travail d''une qualité exceptionnelle. L''équipe de L''ARTMONIE du bois a su comprendre nos attentes et livrer une cuisine qui dépasse nos espérances. Les finitions chêne sont magnifiques, les délais respectés et l''accompagnement du devis à la pose a été irréprochable. Nous recommandons sans hésitation.',
    'Cuisine sur mesure',
    TRUE
),
(
    'Philippe D.',
    'Annecy',
    5,
    'Notre dressing sous combles était un vrai casse-tête avec la pente du toit. L''ARTMONIE du bois a transformé cet espace perdu en un dressing fonctionnel et élégant. Chaque centimètre est optimisé, les portes coulissantes glissent parfaitement. Artisan sérieux et à l''écoute.',
    'Dressing & rangement',
    TRUE
),
(
    'Laure B.',
    'Grenoble',
    5,
    'L''habillage de notre escalier a complètement changé l''ambiance de la maison. Le chêne massif apporte une chaleur incroyable et le garde-corps verre laisse passer la lumière. Un savoir-faire rare, des conseils avisés et un résultat haut de gamme. Merci à toute l''équipe.',
    'Escalier & habillage bois',
    TRUE
);

-- ---------------------------------------------------------------------------
-- Pages principales du site
-- ---------------------------------------------------------------------------
INSERT INTO site_pages (page_key, title, subtitle, content, seo_title, seo_description) VALUES
(
    'home',
    'L''ARTMONIE du bois',
    'Artisan menuisier — Créations sur mesure en bois massif',
    '<p>Bienvenue chez <strong>L''ARTMONIE du bois</strong>, artisan menuisier spécialisé dans la conception et la réalisation de projets bois sur mesure. Cuisines, dressings, meubles uniques, agencements intérieurs et habillages d''escaliers : nous transformons vos idées en pièces d''exception.</p><p>Depuis notre atelier, nous travaillons essences nobles, finitions artisanales et détails soignés pour des intérieurs chaleureux, durables et parfaitement adaptés à votre mode de vie.</p>',
    'L''ARTMONIE du bois — Menuisier & agencement sur mesure',
    'Artisan menuisier premium : cuisines, dressings, meubles et agencements sur mesure en bois massif. Devis gratuit, savoir-faire artisanal.'
),
(
    'about',
    'Notre savoir-faire',
    'L''excellence du bois, de l''atelier à votre intérieur',
    '<p><strong>L''ARTMONIE du bois</strong> est née d''une passion pour le travail du bois et le souci du détail. Notre atelier réunit menuisiers et ébénistes expérimentés, formés aux techniques traditionnelles et aux exigences contemporaines.</p><p>Chaque projet est unique : nous vous accompagnons de la première esquisse à la pose finale, avec des matériaux sélectionnés, un devis transparent et un respect scrupuleux des délais convenus.</p><ul><li>Conception 3D et plans détaillés</li><li>Fabrication en atelier</li><li>Pose et finitions sur site</li><li>Essences nobles : chêne, noyer, frêne, châtaignier…</li></ul>',
    'À propos — L''ARTMONIE du bois',
    'Découvrez l''atelier L''ARTMONIE du bois : menuisiers passionnés, savoir-faire artisanal et projets sur mesure en bois massif.'
),
(
    'services',
    'Nos prestations',
    'Des créations sur mesure pour chaque espace de votre vie',
    '<p>De la cuisine familiale au projet professionnel, <strong>L''ARTMONIE du bois</strong> conçoit et fabrique des aménagements adaptés à vos besoins, votre budget et l''architecture de votre lieu.</p><p>Cuisines sur mesure, dressings, salles de bain, meubles uniques, agencements intérieurs, escaliers habillés, décoration bois et projets commerciaux : explorez nos catégories et demandez votre devis personnalisé.</p>',
    'Prestations — Cuisines, dressings & agencement sur mesure',
    'Cuisines sur mesure, dressings, meubles, escaliers et agencements professionnels. L''ARTMONIE du bois, artisan menuisier premium.'
),
(
    'gallery',
    'Nos réalisations',
    'Des projets uniques, témoins de notre savoir-faire',
    '<p>Parcourez une sélection de nos réalisations récentes : cuisines chêne massif, dressings sous combles, escaliers habillés et agencements sur mesure. Chaque photo raconte un projet pensé pour et avec nos clients.</p>',
    'Galerie — Réalisations L''ARTMONIE du bois',
    'Découvrez nos réalisations en bois sur mesure : cuisines, dressings, escaliers et agencements intérieurs premium.'
),
(
    'contact',
    'Contactez-nous',
    'Parlons de votre projet bois sur mesure',
    '<p>Vous avez un projet en tête ? Une question sur nos prestations ? L''équipe <strong>L''ARTMONIE du bois</strong> vous répond sous 48 h ouvrées.</p><p>Atelier sur rendez-vous — déplacements possibles pour prise de mesures dans un rayon de 80 km.</p>',
    'Contact — L''ARTMONIE du bois',
    'Contactez L''ARTMONIE du bois pour votre projet menuiserie sur mesure. Devis gratuit, réponse sous 48 h.'
),
(
    'quote',
    'Demande de devis',
    'Décrivez votre projet, nous vous recontactons rapidement',
    '<p>Complétez le formulaire ci-dessous pour recevoir une estimation personnalisée. Plus votre description est précise (dimensions, essences souhaitées, photos d''inspiration), plus notre devis sera adapté.</p><p><strong>L''ARTMONIE du bois</strong> s''engage à étudier chaque demande avec attention et à vous proposer un accompagnement sur mesure.</p>',
    'Devis gratuit — L''ARTMONIE du bois',
    'Demandez un devis gratuit pour votre cuisine, dressing, meuble ou agencement sur mesure. L''ARTMONIE du bois, artisan menuisier.'
);

-- ---------------------------------------------------------------------------
-- Réglages du site
-- ---------------------------------------------------------------------------
INSERT INTO settings (setting_key, setting_value) VALUES
('site_name',       'L''ARTMONIE du bois'),
('phone',           '04 78 00 00 00'),
('email',           'contact@lartmoniedubois.fr'),
('address',         'Atelier L''ARTMONIE du bois — Zone artisanale, 69000 Lyon'),
('facebook_url',    'https://www.facebook.com/lartmoniedubois'),
('instagram_url',   'https://www.instagram.com/lartmonie_du_bois'),
('opening_hours',   'Lundi – Vendredi : 8h30 – 18h | Samedi : sur rendez-vous'),
('main_color',      '#8B5A2B'),
('secondary_color', '#F3E6D0'),
('dark_color',      '#1F1A17'),
('logo_url',        '/lartmonie/assets/logo/logo.webp'),
('logo_footer_url', '/lartmonie/assets/logo/logo-footer.webp'),
('favicon_url',     '/lartmonie/assets/logo/favicon.webp');

COMMIT;
