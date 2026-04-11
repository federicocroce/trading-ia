#!/bin/bash
# Setup Cloudflare Tunnel to expose local backend for production deployment
#
# Architecture:
#   [Cloudflare Pages] --> [Cloudflare Tunnel] --> [Your Mac: Backend + LM Studio + SQLite]
#        (frontend)         (free, unlimited)        (everything runs locally)

echo "=== Cloudflare Tunnel Setup ==="
echo ""
echo "Prerequisites:"
echo "  1. Install cloudflared: brew install cloudflared"
echo "  2. Login: cloudflared tunnel login"
echo "  3. Create tunnel: cloudflared tunnel create trading-dashboard"
echo ""
echo "After creating the tunnel, run:"
echo "  cloudflared tunnel route dns trading-dashboard api.yourdomain.com"
echo ""
echo "Then start the tunnel:"
echo "  cloudflared tunnel run --url http://localhost:3001 trading-dashboard"
echo ""
echo "Set VITE_API_URL=https://api.yourdomain.com when building frontend:"
echo "  VITE_API_URL=https://api.yourdomain.com npm run build --workspace=apps/frontend"
echo ""
echo "Deploy frontend to Cloudflare Pages:"
echo "  npx wrangler pages deploy apps/frontend/dist --project-name=trading-dashboard"
