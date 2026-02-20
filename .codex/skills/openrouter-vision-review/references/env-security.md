# Env Security Notes

Use this model for credentials:

1. Keep `OPENROUTER_API_KEY` in the project root `.env`.
2. File contents:
   `OPENROUTER_API_KEY=...`
3. Lock permissions:
   `chmod 600 .env`

Avoid:

- storing keys in tracked files
- printing keys in logs
- copying keys into screenshots or issue reports
