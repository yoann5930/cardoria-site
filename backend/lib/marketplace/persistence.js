/**
 * Persistance durable Marketplace Cardoria.
 *
 * SQLite reste le cache/runtime local rapide de l'instance Render.
 * PostgreSQL (Supabase) devient la copie persistante entre les redeploys.
 *
 * Au démarrage :
 * - si PostgreSQL est déjà initialisé, restauration PostgreSQL -> SQLite ;
 * - sinon, le seed/runtime SQLite initial est exporté vers PostgreSQL.
 *
 * Après chaque écriture Marketplace : snapshot SQLite -> PostgreSQL.
 */
import pg from "pg";
import { getDb } from "../engine/database.js";

const { Pool } = pg;

const TABLES = [
  "mk_sellers",
  "mk_listings",
  "mk_orders",