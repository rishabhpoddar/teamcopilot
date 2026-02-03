# API and cronjob for app

## Local development

Use node version: 20.18.1

```bash
npm install
npm run dev
```

The server will run on port 3000.

## Managing prisma schema

### If making changes to prisma schema

#### For dev environment
- Make changes to prisma/schema.prisma
- Run `npx prisma migrate dev --name <name>`
- Then switch on RLS for the table.

#### For prod environment
- Make sure to change the DATABASE_URL in .env to point to prod db.
- Run `npx prisma migrate deploy`