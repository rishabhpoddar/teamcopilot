# Contributing to FlowPal

## Development Setup

Follow the "Running Without Docker" steps in [README.md](README.md), then use development mode for hot-reloading:

```bash
npm run dev
```

This starts both the backend (port 3000) and frontend Vite dev server (port 5173) concurrently. Open http://localhost:5173 for development - frontend changes will reflect instantly via HMR.

---

## Managing the Database

### View Database Contents

```bash
# Open Prisma Studio (visual database browser)
npx prisma studio
```

### Modify the Schema

1. Edit `prisma/schema.prisma`
2. Create and apply a migration:

```bash
npx prisma migrate dev --name describe-your-changes
```

### Reset Database

```bash
# Warning: This deletes all data
npx prisma migrate reset
```

---

## Troubleshooting

### Port Already in Use

```bash
lsof -ti:3000 | xargs kill -9
```

### Database Errors

```bash
# Reset and recreate the database
rm prisma/dev.db
npx prisma migrate dev
```

### Frontend Not Loading

Make sure the frontend is built:

```bash
cd frontend
npm run build
```
