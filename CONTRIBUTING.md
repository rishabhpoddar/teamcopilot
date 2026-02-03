# Contributing to FlowPal

## Development Setup

Follow the "Running Without Docker" steps in [README.md](README.md), then use development mode for hot-reloading:

```bash
# Terminal 1: Backend with auto-reload
npm run dev

# Terminal 2: Frontend dev server (optional, for frontend changes)
cd frontend
npm run dev
```

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
