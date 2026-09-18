import { readJson, writeJson } from "../storage.js";

const STORE_KEY = "live-seller-follows";
const MAX_FOLLOWS = 200000;

function clean(value, max = 254) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function load() {
  const rows = readJson(STORE_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

function save(rows) {
  writeJson(STORE_KEY, rows.slice(-MAX_FOLLOWS));
}

export function isFollowingSeller({ sellerId, userId } = {}) {
  const seller = clean(sellerId, 120);
  const user = clean(userId, 120);
  if (!seller || !user) return false;
  return load().some((row) => row && row.sellerId === seller && row.userId === user);
}

export function followSeller({ sellerId, userId, email = "", name = "" } = {}) {
  const seller = clean(sellerId, 120);
  const user = clean(userId, 120);
  if (!seller || !user) throw Object.assign(new Error("Vendeur et compte client requis."), { status: 400 });
  const rows = load();
  const existing = rows.find((row) => row && row.sellerId === seller && row.userId === user);
  if (existing) return { ...existing, duplicate: true };
  const entry = {
    sellerId: seller,
    userId: user,
    email: clean(email).toLowerCase(),
    name: clean(name, 120),
    createdAt: new Date().toISOString()
  };
  rows.push(entry);
  save(rows);
  return { ...entry, duplicate: false };
}

export function listFollowedSellerIds(userId) {
  const user = clean(userId, 120);
  if (!user) return [];
  return [...new Set(load().filter((row) => row?.userId === user).map((row) => row.sellerId))];
}
