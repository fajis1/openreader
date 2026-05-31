if (!process.env.AUTH_SECRET?.trim()) {
  process.env.AUTH_SECRET = 'vitest-auth-secret';
}

if (!process.env.BASE_URL?.trim()) {
  process.env.BASE_URL = 'http://localhost:3003';
}
