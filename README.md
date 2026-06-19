Backend Nest-like API (minimal)

Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install deps and generate prisma client:

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

APIs
- POST /auth/signup { name, email, password }
- POST /auth/login { email, password }
- POST /auth/send-code { email }
