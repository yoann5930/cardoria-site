# Cardoria Vercel smoke plan

No production cutover until every check is green.

1. GET /api/health/
2. GET /api/health/startup
3. Admin login and /api/auth/me
4. Admin dashboard JSON
5. Admin stock inventory
6. Boutique products use the unified stock source
7. Boutique cart and server-side stock validation
8. Revolut sandbox checkout creation only
9. Marketplace browsing/cart
10. PayPal Multi readiness and sandbox checkout only
11. Marketplace seller area
12. Webhook endpoints return expected auth/signature errors for unsigned probes
13. Dynamic SEO card/license/extension routes
14. Static pages/assets
15. PostgreSQL persistence status
16. No blocking 5xx in runtime logs
17. Domain remains unchanged until all checks pass
