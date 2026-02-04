# VRT Fixture Project (CI)

Small static site used for VRT regression coverage. It provides 5 routes with stable layouts.

## Run locally

1. Start the fixture server:
   - `node scripts/serve-fixture-site.js`

2. Run VRT using the fixture config:
   - `npm run build`
   - `node dist/src/index.js test --config test/fixtures/vrt-project/vrt.config.json`

## Configuration

- Default port: 4173 (override with `PORT=5000`)
- Custom root: `FIXTURE_ROOT=/path/to/site`
