import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

const menuPages = [
  'admin.html',
  'admin-statistiques.html',
  'admin-comptabilite.html',
  'admin-achats-cartes.html',
  'admin-achats-consommables.html',
  'admin-achats-materiel.html',
  'admin-achats-acheteurs.html',
  'admin-paiements.html',
  'admin-commandes.html',
  'admin-stock.html',
  'admin-estimations.html',
  'admin-rachat.html',
  'admin-catalogue.html',
  'admin-marketplace.html',
  'admin-live.html',
  'admin-ia.html',
  'admin-scanner.html',
  'admin-marche.html',
  'admin-sante.html',
  'admin-performance-ia.html',
  'admin-ai-enterprise.html',
  'admin-ultimate.html',
  'admin-bigdata.html',
  'admin-utilisateurs.html',
  'admin-journal.html',
  'admin-integrations.html',
  'admin-seo.html'
];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

test('toutes les pages du menu Admin existent dans la source et le runtime OVH', () => {
  for (const page of menuPages) {
    assert.equal(exists(page), true, `page source manquante: ${page}`);
    assert.equal(exists(path.join('backend', 'public', page)), true, `miroir runtime manquant: backend/public/${page}`);
  }
});

test('admin-core référence toutes les pages du menu audité', () => {
  const core = read('js/admin/admin-core.js');
  for (const page of menuPages) {
    assert.match(core, new RegExp(page.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `lien de menu absent: ${page}`);
  }
});

test('chaque page Admin charge le noyau Admin et ses scripts locaux existent', () => {
  for (const page of menuPages) {
    const html = read(page);
    assert.match(html, /(?:\/|\.\/)?js\/admin\/admin-core\.js/, `${page}: admin-core.js non chargé`);

    const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const src of scripts) {
      if (/^(?:https?:)?\/\//i.test(src)) continue;
      const clean = src.split('?')[0].split('#')[0].replace(/^\//, '');
      if (!clean) continue;
      assert.equal(exists(clean), true, `${page}: script local manquant: ${clean}`);
      assert.equal(exists(path.join('backend', 'public', clean)), true, `${page}: script runtime manquant: backend/public/${clean}`);
    }
  }
});

test('la migration UI active utilise SumUp et ne présente plus Revolut', () => {
  const files = [
    'boutique.html',
    'backend/public/boutique.html',
    'js/admin/admin-core.js',
    'backend/public/js/admin/admin-core.js'
  ];

  for (const file of files) {
    const text = read(file);
    assert.doesNotMatch(text, /Revolut/i, `${file}: ancienne référence Revolut encore visible`);
  }

  assert.match(read('boutique.html'), /Paiement sécurisé SumUp/i);
  assert.match(read('js/admin/admin-core.js'), /Paiements SumUp/i);
});
